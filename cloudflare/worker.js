// dauril.com 배포용 Cloudflare Worker (금액 계산 데스크톱)
// 원래 앱(worker/index.js)은 OpenAI 호스팅의 로그인 헤더(oai-authenticated-user-*)를 믿고 동작한다.
// 이 파일은 그 앞에서 ① 다채움 직원 로그인(동의서 시스템과 같은 계정·같은 세션) ② DB 표 자동 생성
// ③ 파일 저장소(R2가 없으면 D1에 나눠 저장)를 맡고, 확인된 사용자만 원래 앱으로 넘긴다.
import app from '../worker/index.js';
import MIGRATIONS from './migrations.js';

const SESSION_COOKIE = 'dc_session';
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();
const nowISO = () => new Date().toISOString();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const randomToken = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

// ───────── DB 준비: 동의서 시스템과 같은 D1을 쓴다 (users·kv 표 공유 → 같은 직원 계정) ─────────
const CORE = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL, updated_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT, action TEXT NOT NULL, target TEXT, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS desktop_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS desktop_blobs (key TEXT NOT NULL, part INTEGER NOT NULL, mime TEXT, data BLOB NOT NULL, PRIMARY KEY (key, part))`
];
let ready = null;
function ensureDb(env) {
  if (!ready) ready = (async () => {
    await env.DB.batch(CORE.map(s => env.DB.prepare(s)));
    await env.DB.prepare(`INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES ('session_secret', ?, ?)`).bind(randomToken(32), nowISO()).run();
    const done = new Set(((await env.DB.prepare('SELECT name FROM desktop_migrations').all()).results || []).map(r => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      // drizzle 마이그레이션을 순서대로 1회만 적용
      await env.DB.batch(m.statements.map(s => env.DB.prepare(s)).concat([env.DB.prepare('INSERT INTO desktop_migrations (name, applied_at) VALUES (?, ?)').bind(m.name, nowISO())]));
    }
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// ───────── 파일 저장소: R2(BUCKET)가 연결돼 있으면 그대로, 없으면 D1에 900KB 조각으로 저장 ─────────
const PART = 900 * 1024;
function d1Bucket(DB) {
  return {
    async put(key, value, opts) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      const mime = opts && opts.httpMetadata && opts.httpMetadata.contentType || null;
      const stmts = [DB.prepare('DELETE FROM desktop_blobs WHERE key = ?').bind(key)];
      for (let i = 0, p = 0; i < Math.max(bytes.length, 1); i += PART, p++) stmts.push(DB.prepare('INSERT INTO desktop_blobs (key, part, mime, data) VALUES (?, ?, ?, ?)').bind(key, p, mime, bytes.subarray(i, i + PART)));
      for (let i = 0; i < stmts.length; i += 20) await DB.batch(stmts.slice(i, i + 20));
    },
    async get(key) {
      const rows = (await DB.prepare('SELECT part, mime, data FROM desktop_blobs WHERE key = ? ORDER BY part').bind(key).all()).results || [];
      if (!rows.length) return null;
      const parts = rows.map(r => new Uint8Array(r.data)), total = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(total);
      let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return { body: out, size: total, httpMetadata: { contentType: rows[0].mime || undefined }, arrayBuffer: async () => out.buffer };
    },
    async delete(key) { await DB.prepare('DELETE FROM desktop_blobs WHERE key = ?').bind(key).run(); }
  };
}

// ───────── 로그인 (동의서 시스템과 같은 방식·같은 비밀값 → 한 번 로그인하면 둘 다 사용) ─────────
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
async function hashPassword(pw) { const salt = new Uint8Array(16); crypto.getRandomValues(salt); return `pbkdf2$${PBKDF2_ITER}$${b64u(salt)}$${b64u(await pbkdf2(pw, salt, PBKDF2_ITER))}`; }
async function verifyPassword(pw, stored) {
  try { const [, iter, salt, hash] = stored.split('$'); const a = new Uint8Array(await pbkdf2(pw, b64uDec(salt), Number(iter))), b = b64uDec(hash);
    if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; } catch (e) { return false; }
}
async function secret(env) { if (env.SESSION_SECRET) return env.SESSION_SECRET; const r = await env.DB.prepare(`SELECT value FROM kv WHERE key='session_secret'`).first(); return r && r.value; }
async function hmac(sec, data) { const k = await crypto.subtle.importKey('raw', enc.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(data))); }
async function makeSession(env, u) { const p = b64u(enc.encode(JSON.stringify({ uid: u.id, name: u.name, role: u.role, exp: Date.now() + SESSION_DAYS * 86400000 }))); return p + '.' + await hmac(await secret(env), p); }
async function readSession(env, request) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'));
  if (!m) return null; const [p, sig] = m[1].split('.'); if (!p || !sig || sig !== await hmac(await secret(env), p)) return null;
  try { const s = JSON.parse(new TextDecoder().decode(b64uDec(p))); if (!s.exp || s.exp < Date.now()) return null;
    // 중지된 계정은 바로 막는다
    const u = await env.DB.prepare('SELECT active FROM users WHERE id = ?').bind(s.uid).first(); return u && Number(u.active) ? s : null; } catch (e) { return null; }
}
function cookie(request, value, maxAge) {
  const u = new URL(request.url), secure = u.protocol === 'https:' ? '; Secure' : '';
  // dauril.com 과 consent.dauril.com 이 로그인을 함께 쓰도록 상위 도메인에 저장
  const domain = /(^|\.)dauril\.com$/.test(u.hostname) ? '; Domain=dauril.com' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}${domain}`;
}
const audit = (env, user, action, target, detail) => env.DB.prepare('INSERT INTO audit (at, user, action, target, detail) VALUES (?, ?, ?, ?, ?)').bind(nowISO(), user || null, action, target || null, detail ? String(detail).slice(0, 300) : null).run();

async function handleAuth(request, env, url) {
  const path = url.pathname;
  if (path === '/auth/state') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(); const s = await readSession(env, request);
    return json({ ok: true, needsSetup: !r || Number(r.n) === 0, user: s ? { name: s.name, role: s.role } : null });
  }
  if (request.method !== 'POST') return json({ ok: false, error: '잘못된 요청' }, 405);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ ok: false, error: '요청을 확인할 수 없습니다' }, 403);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim(), pw = String(body.password || '');
  if (path === '/auth/setup') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (r && Number(r.n) > 0) return json({ ok: false, error: '이미 관리자 계정이 있습니다' }, 403);
    if (!name) return json({ ok: false, error: '이름을 입력해 주세요' }, 400);
    if (pw.length < 6) return json({ ok: false, error: '비밀번호는 6자 이상이어야 합니다' }, 400);
    await env.DB.prepare(`INSERT INTO users (name, pw_hash, role, active, created_at) VALUES (?, ?, 'admin', 1, ?)`).bind(name, await hashPassword(pw), nowISO()).run();
    const u = await env.DB.prepare('SELECT id, name, role FROM users WHERE name = ?').bind(name).first();
    await audit(env, name, 'setup.admin', 'desktop');
    return json({ ok: true }, 200, { 'set-cookie': cookie(request, await makeSession(env, u), SESSION_DAYS * 86400) });
  }
  if (path === '/auth/login') {
    const u = await env.DB.prepare('SELECT id, name, role, active, pw_hash FROM users WHERE name = ?').bind(name).first();
    if (!u || !Number(u.active) || !(await verifyPassword(pw, u.pw_hash))) { await audit(env, null, 'login.fail', name, 'desktop'); return json({ ok: false, error: '이름 또는 비밀번호가 맞지 않습니다' }, 401); }
    await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(nowISO(), u.id).run();
    await audit(env, u.name, 'login', null, 'desktop');
    return json({ ok: true }, 200, { 'set-cookie': cookie(request, await makeSession(env, { id: u.id, name: u.name, role: u.role }), SESSION_DAYS * 86400) });
  }
  if (path === '/auth/logout') return json({ ok: true }, 200, { 'set-cookie': cookie(request, '', 0) });
  return json({ ok: false, error: '없는 주소' }, 404);
}

const PUBLIC = p => p === '/login.html' || p === '/favicon.svg' || p.startsWith('/fonts/') || p === '/icons/pink-folder-ribbon.png' || p === '/wallpapers/pink-cloud-grid.png';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      await ensureDb(env);
      if (url.pathname === '/auth/signout') return new Response(null, { status: 302, headers: { Location: '/login.html', 'set-cookie': cookie(request, '', 0), 'cache-control': 'no-store' } });
      if (url.pathname === '/signin-with-chatgpt') return Response.redirect(url.origin + '/login.html', 302);
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, env, url);
      const s = await readSession(env, request);
      if (!s) {
        if (PUBLIC(url.pathname)) return env.ASSETS.fetch(request);
        if (url.pathname.startsWith('/api/')) return json({ error: '로그인 후 이용해 주세요.' }, 401);
        return Response.redirect(url.origin + '/login.html?next=' + encodeURIComponent(url.pathname + url.search), 302);
      }
      if (url.pathname === '/login.html') return Response.redirect(url.origin + '/', 302);
      // 원래 앱이 기대하는 로그인 헤더를 서버에서 채운다 (브라우저가 보낸 같은 이름의 헤더는 버림)
      const h = new Headers(request.headers);
      for (const k of [...h.keys()]) if (k.toLowerCase().startsWith('oai-')) h.delete(k);
      h.set('oai-authenticated-user-id', 'dauril:' + s.uid);
      h.set('oai-authenticated-user-email', 'staff' + s.uid + '@dauril.com');   // 헤더는 영문만 가능
      const req = new Request(request, { headers: h });
      const appEnv = { ...env, BUCKET: env.BUCKET || d1Bucket(env.DB) };
      const res = await app.fetch(req, appEnv, ctx);
      const out = new Response(res.body, res);
      out.headers.set('x-content-type-options', 'nosniff');
      if (!url.pathname.startsWith('/api/') && (url.pathname === '/' || url.pathname.endsWith('.html'))) out.headers.set('cache-control', 'no-cache');
      return out;
    } catch (e) {
      console.error('[dauril-desktop]', e && e.stack || e);
      return new Response('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n' + (e && e.message || ''), { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }
};
