// 프로그램 비교(2026-11-26 사용자): 가격표 그림과 별개로, 상담 비교용 프로그램 자료.
// 프로그램 = 이름 · 총금액 · 시술 구성 · 라인 이름 · 설명 · 맞춤 피부, 라인 = 이름 · 특징 · 맞춤 피부(다른 라인끼리 비교할 때만 화면에 나옴).
// 사용자가 앱에서 적거나, Claude가 만든 파일({format:'dachaeum-programs', lines:[{category, name, feature, fit}],
// programs:[{category, name, price?, items?, line?, desc?, fit?}]})로 넣는다. 공개 저장소라 가격·글은 DB에만.
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const st = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const clean = (v, n = 100) => String(v ?? '').trim().slice(0, n);
const TEXT = 400;

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
  const [{ results }, lines] = await Promise.all([
    st(env, 'SELECT id, category, name, price, items, line, descr, fit, sort FROM price_programs WHERE owner = ? ORDER BY sort, rowid', owner).all(),
    st(env, 'SELECT id, category, name, feature, fit FROM price_program_lines WHERE owner = ? ORDER BY sort, rowid', owner).all(),
  ]);
  return {
    programs: results.map(({ descr, ...r }) => ({ ...r, desc: descr, items: (() => { try { return cleanItems(JSON.parse(r.items)); } catch { return []; } })() })),
    lines: lines.results,
  };
}

export async function handlePrograms(request, env, owner) {
  if (request.method === 'GET') return json(await list(env, owner));
  if (request.method !== 'POST') return json({ error: '지원하지 않는 작업입니다.' }, 405);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  if (body.action === 'save') {
    const category = clean(body.category), name = clean(body.name), price = cleanPrice(body.price), items = JSON.stringify(cleanItems(body.items));
    const line = clean(body.line), desc = clean(body.desc, TEXT), fit = clean(body.fit, TEXT);
    if (!category || !name) return json({ error: '프로그램 이름을 적어 주세요.' }, 400);
    if (Number.isNaN(price)) return json({ error: '금액을 확인해 주세요.' }, 400);
    if (body.id) {
      const r = await st(env, 'UPDATE price_programs SET category = ?, name = ?, price = ?, items = ?, line = ?, descr = ?, fit = ?, updated_at = ? WHERE id = ? AND owner = ?', category, name, price, items, line, desc, fit, now, String(body.id), owner).run();
      if (!r.meta.changes) return json({ error: '프로그램을 찾을 수 없습니다.' }, 404);
    } else {
      const max = await st(env, 'SELECT COALESCE(MAX(sort), 0) AS m FROM price_programs WHERE owner = ?', owner).first();
      await st(env, 'INSERT INTO price_programs (id, owner, category, name, price, items, line, descr, fit, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, price, items, line, desc, fit, (max?.m || 0) + 1, now).run();
    }
  } else if (body.action === 'delete') {
    const r = await st(env, 'DELETE FROM price_programs WHERE id = ? AND owner = ?', String(body.id), owner).run();
    if (!r.meta.changes) return json({ error: '프로그램을 찾을 수 없습니다.' }, 404);
  } else if (body.action === 'save-line') {
    const category = clean(body.category), name = clean(body.name), feature = clean(body.feature, TEXT), fit = clean(body.fit, TEXT);
    if (!category || !name) return json({ error: '라인 이름을 적어 주세요.' }, 400);
    if (body.id) {
      const old = await st(env, 'SELECT name FROM price_program_lines WHERE id = ? AND owner = ?', String(body.id), owner).first();
      if (!old) return json({ error: '라인을 찾을 수 없습니다.' }, 404);
      await env.DB.batch([
        st(env, 'UPDATE price_program_lines SET name = ?, feature = ?, fit = ?, updated_at = ? WHERE id = ? AND owner = ?', name, feature, fit, now, String(body.id), owner),
        st(env, 'UPDATE price_programs SET line = ? WHERE owner = ? AND category = ? AND line = ?', name, owner, category, old.name), // 라인 이름을 바꾸면 그 라인 프로그램도 같이
      ]);
    } else {
      const max = await st(env, 'SELECT COALESCE(MAX(sort), 0) AS m FROM price_program_lines WHERE owner = ?', owner).first();
      await st(env, 'INSERT INTO price_program_lines (id, owner, category, name, feature, fit, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, feature, fit, (max?.m || 0) + 1, now).run();
    }
  } else if (body.action === 'delete-line') {
    const r = await st(env, 'DELETE FROM price_program_lines WHERE id = ? AND owner = ?', String(body.id), owner).run();
    if (!r.meta.changes) return json({ error: '라인을 찾을 수 없습니다.' }, 404);
  } else if (body.action === 'import') {
    // 같은 탭·같은 이름은 고치고 없으면 새로 — 두 번 올려도 겹치지 않음. 프로그램에 price·items가 없으면(설명만 든 파일) 금액·구성은 그대로 둠.
    const programs = Array.isArray(body.programs) ? body.programs.slice(0, 200) : [], lines = Array.isArray(body.lines) ? body.lines.slice(0, 50) : [];
    if (body.format !== 'dachaeum-programs' || (!programs.length && !lines.length)) return json({ error: '프로그램 파일이 아니에요.' }, 400);
    const [have, haveLines] = await Promise.all([
      st(env, 'SELECT id, category, name FROM price_programs WHERE owner = ?', owner).all(),
      st(env, 'SELECT id, category, name FROM price_program_lines WHERE owner = ?', owner).all(),
    ]);
    const key = (c, n) => `${c}\u0000${n}`;
    const pid = new Map(have.results.map(r => [key(r.category, r.name), r.id])), lid = new Map(haveLines.results.map(r => [key(r.category, r.name), r.id]));
    const stmts = [];
    // drop_categories: 탭 이름을 바꾼 뒤 남은 예전 탭 자료를 통째로 지움(2026-11-27 사용자 '흉터·모공' 삭제) — 이 파일에 든 탭은 지우지 않음
    const keep = new Set([...programs, ...lines].map(x => clean(x?.category)));
    const drops = (Array.isArray(body.drop_categories) ? body.drop_categories : []).map(c => clean(c)).filter(c => c && !keep.has(c)).slice(0, 10);
    for (const c of drops) {
      stmts.push(st(env, 'DELETE FROM price_programs WHERE owner = ? AND category = ?', owner, c), st(env, 'DELETE FROM price_program_lines WHERE owner = ? AND category = ?', owner, c));
      for (const m of [pid, lid]) for (const k of [...m.keys()]) if (k.startsWith(`${c}\u0000`)) m.delete(k);
    }
    // drop_programs: 같은 탭에 이름만 다른 겹친 줄(예전 이름이 다시 들어간 것)을 지움 — 이 파일에 든 이름은 안 지움(2026-11-28 사용자 '선택 2가지임')
    const keepNames = new Set(programs.map(p => key(clean(p?.category), clean(p?.name))));
    for (const d of (Array.isArray(body.drop_programs) ? body.drop_programs : []).slice(0, 100)) {
      const k = key(clean(d?.category), clean(d?.name));
      if (!clean(d?.name) || keepNames.has(k) || !pid.has(k)) continue;
      stmts.push(st(env, 'DELETE FROM price_programs WHERE id = ? AND owner = ?', pid.get(k), owner));
      pid.delete(k);
    }
    lines.forEach((l, i) => {
      const category = clean(l?.category), name = clean(l?.name), feature = clean(l?.feature, TEXT), fit = clean(l?.fit, TEXT);
      if (!category || !name) return;
      const id = lid.get(key(category, name));
      stmts.push(id ? st(env, 'UPDATE price_program_lines SET feature = ?, fit = ?, sort = ?, updated_at = ? WHERE id = ? AND owner = ?', feature, fit, i + 1, now, id, owner)
        : st(env, 'INSERT INTO price_program_lines (id, owner, category, name, feature, fit, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, feature, fit, i + 1, now));
    });
    programs.forEach((p, i) => {
      const category = clean(p?.category), name = clean(p?.name);
      if (!category || !name) return;
      const hasNums = 'price' in (p || {}) || 'items' in (p || {}), price = cleanPrice(p?.price);
      if (Number.isNaN(price)) return;
      const items = JSON.stringify(cleanItems(p?.items)), line = clean(p?.line), desc = clean(p?.desc, TEXT), fit = clean(p?.fit, TEXT);
      // from = 예전 이름(이름을 가격표 이름으로 바꿀 때): 새 이름이 아직 없고 예전 이름이 있으면 그 줄의 이름을 바꿔 고침 — 두 줄로 겹치지 않게
      let id = pid.get(key(category, name));
      const from = clean(p?.from);
      if (!id && from && pid.has(key(category, from))) { id = pid.get(key(category, from)); pid.delete(key(category, from)); pid.set(key(category, name), id); }
      if (id) stmts.push(hasNums ? st(env, 'UPDATE price_programs SET name = ?, price = ?, items = ?, line = ?, descr = ?, fit = ?, sort = ?, updated_at = ? WHERE id = ? AND owner = ?', name, price, items, line, desc, fit, i + 1, now, id, owner)
        : st(env, 'UPDATE price_programs SET name = ?, line = ?, descr = ?, fit = ?, updated_at = ? WHERE id = ? AND owner = ?', name, line, desc, fit, now, id, owner));
      else stmts.push(st(env, 'INSERT INTO price_programs (id, owner, category, name, price, items, line, descr, fit, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), owner, category, name, price, items, line, desc, fit, i + 1, now));
    });
    if (!stmts.length) return json({ error: '넣을 프로그램이 없어요.' }, 400);
    await env.DB.batch(stmts);
  } else return json({ error: '지원하지 않는 작업입니다.' }, 400);
  return json(await list(env, owner));
}
