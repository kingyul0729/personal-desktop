// 프로그램 비교(2026-11-26 사용자): 가격표 그림과 별개로, 상담 비교용 프로그램 자료(이름·총금액·시술 구성).
// 숫자는 사용자가 앱에서 적거나, Claude가 가격표로 만든 파일({format:'dachaeum-programs', programs:[{category, name, price, items:[{name, qty|label}]}]})로 넣는다.
// 공개 저장소라 가격은 코드에 두지 않는다 — DB(price_programs)에만.
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const st = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const clean = (v, n = 100) => String(v ?? '').trim().slice(0, n);

export function cleanItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).map(x => {
    const name = clean(x?.name, 60);
    const q = x?.qty === '' || x?.qty == null ? null : Number(x.qty);
    const qty = Number.isFinite(q) && q >= 0 ? Math.round(q * 100) / 100 : null;
    const label = qty == null ? clean(x?.label, 30) : '';
    return name ? { name, qty, ...(label ? { label } : {}) } : null;
  }).filter(Boolean);
}
const cleanPrice = v => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : NaN; };

async function list(env, owner) {
  const { results } = await st(env, 'SELECT id, category, name, price, items, sort FROM price_programs WHERE owner = ? ORDER BY sort, rowid', owner).all();
  return { programs: results.map(r => ({ ...r, items: (() => { try { return cleanItems(JSON.parse(r.items)); } catch { return []; } })() })) };
}

export async function handlePrograms(request, env, owner) {
  if (request.method === 'GET') return json(await list(env, owner));
  if (request.method !== 'POST') return json({ error: '지원하지 않는 작업입니다.' }, 405);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  if (body.action === 'save') {
    const category = clean(body.category), name = clean(body.name), price = cleanPrice(body.price), items = cleanItems(body.items);
    if (!category || !name) return json({ error: '프로그램 이름을 적어 주세요.' }, 400);
    if (Number.isNaN(price)) return json({ error: '금액을 확인해 주세요.' }, 400);
    if (body.id) {
      const r = await st(env, 'UPDATE price_programs SET category = ?, name = ?, price = ?, items = ?, updated_at = ? WHERE id = ? AND owner = ?', category, name, price, JSON.stringify(items), now, String(body.id), owner).run();
      if (!r.meta.changes) return json({ error: '프로그램을 찾을 수 없습니다.' }, 404);
    } else {
      const max = await st(env, 'SELECT COALESCE(MAX(sort), 0) AS m FROM price_programs WHERE owner = ?', owner).first();
      await st(env, 'INSERT INTO price_programs (id, owner, category, name, price, items, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, price, JSON.stringify(items), (max?.m || 0) + 1, now).run();
    }
  } else if (body.action === 'delete') {
    const r = await st(env, 'DELETE FROM price_programs WHERE id = ? AND owner = ?', String(body.id), owner).run();
    if (!r.meta.changes) return json({ error: '프로그램을 찾을 수 없습니다.' }, 404);
  } else if (body.action === 'import') {
    // 같은 탭·같은 이름이 있으면 금액·구성만 바꾸고, 없으면 새로 — 두 번 올려도 겹치지 않음. 순서는 파일 순서.
    if (body.format !== 'dachaeum-programs' || !Array.isArray(body.programs) || !body.programs.length) return json({ error: '프로그램 파일이 아니에요.' }, 400);
    const { results } = await st(env, 'SELECT id, category, name FROM price_programs WHERE owner = ?', owner).all();
    const have = new Map(results.map(r => [`${r.category}\u0000${r.name}`, r.id]));
    const stmts = [];
    body.programs.slice(0, 200).forEach((p, i) => {
      const category = clean(p?.category), name = clean(p?.name), price = cleanPrice(p?.price);
      if (!category || !name || Number.isNaN(price)) return;
      const items = JSON.stringify(cleanItems(p?.items)), id = have.get(`${category}\u0000${name}`);
      stmts.push(id ? st(env, 'UPDATE price_programs SET price = ?, items = ?, sort = ?, updated_at = ? WHERE id = ? AND owner = ?', price, items, i + 1, now, id, owner)
        : st(env, 'INSERT INTO price_programs (id, owner, category, name, price, items, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, price, items, i + 1, now));
    });
    if (!stmts.length) return json({ error: '넣을 프로그램이 없어요.' }, 400);
    await env.DB.batch(stmts);
  } else return json({ error: '지원하지 않는 작업입니다.' }, 400);
  return json(await list(env, owner));
}
