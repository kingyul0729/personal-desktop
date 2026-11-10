// 예전 앱 일일재고 사진 숫자 넣기(한 번만 하는 고치기 모음). 일일재고 저장은 inventory.js의 화면 길(POST /daily)을 그대로 쓴다(route로 받음).
import { OLD_DAILY_COUNTS, OLD_DAILY_EXTRA, OLD_DAILY_MEMOS } from './invDailyFix.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function one(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }

// 예전 앱 일일재고 46일을 사진 숫자 그대로 한 번 넣는다(2026-11-10 사용자 '다른데' — 마감재고가 빠져 날마다 재고가 사진과 달랐음).
// 화면의 일일재고 저장과 같은 길(POST /daily: 마감재고 + 마감 전 재고 = 마감재고 + 사용량)을 날짜 순서대로. 11월에 직접 센 날은 그 수량 그대로 남는다.
const oldDailyDone = new WeakSet(); // 이미 확인한 DB
// 사진 한 날 → 일일재고 저장 값. 사용량 품목인데 사진에 사용량이 없는 날(마감재고만 적은 날)은 예전 앱처럼 차이를 사용량이 아닌 재고 차이로(사용량 —)
async function oldDayBody(db, day) {
  const items = await all(db, 'SELECT id, name, daily_mode FROM inv_items');
  const by = Object.fromEntries(items.map(i => [i.name, i]));
  const closing = {}, opening = {};
  for (const [name, [close, used]] of Object.entries(day.i)) {
    const it = by[name]; if (!it) continue;
    closing[it.id] = close;
    if (used != null) opening[it.id] = close + used;
    else if (it.daily_mode === 'usage') opening[it.id] = close;
  }
  return { closing, opening };
}
// 사진 한 날을 화면의 일일재고 저장(POST /daily)과 같은 길로 저장. 그 날 인원·메모·모델링 인원은 있던 값 그대로(없으면 사진 인원, withPhotoPatients일 때만).
async function saveOldDay(route, env, url, db, day, withPhotoPatients = false) {
  const row = await one(db, 'SELECT patients, status, extra FROM inv_daily WHERE date = ?', day.d);
  const { closing, opening } = await oldDayBody(db, day);
  let extra = {}; try { extra = row?.extra ? JSON.parse(row.extra) : {}; } catch { /* */ }
  const patients = row ? row.patients : withPhotoPatients ? (day.p ?? null) : null;
  const req = new Request(url.origin + '/api/inventory/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: day.d, patients, status: row?.status || null, extra, used: {}, closing, opening }) });
  const res = await route(req, env, new URL(req.url), '예전 앱 일일재고', db, '/daily', 'POST');
  if (!res.ok) console.log('old daily', day.d, await res.text());
}
const meta = async (db, key) => (await one(db, 'SELECT value FROM inv_meta WHERE key = ?', key).catch(() => null))?.value ?? null;
// 한 번만 하는 고치기: 앞 단계(after)가 끝났고 아직 안 했을 때, 다른 요청과 겹치지 않게 잠그고 하고 나서 끝 표시.
async function runOnceAfter(db, key, after, fn) {
  if (!(await meta(db, after)) || (await meta(db, key))) return;
  try { await db.prepare('INSERT INTO inv_requests (id, path, created_at) VALUES (?,?,?)').bind(`fix:${key}`, key, Date.now()).run(); } catch { return; }
  await fn();
  await db.prepare('INSERT OR REPLACE INTO inv_meta (key, value) VALUES (?, ?)').bind(key, String(Date.now())).run();
}
async function applyOldDailyCounts(route, env, url, db) {
  if (oldDailyDone.has(db) || env.SKIP_OLD_DAILY_FIX) return;
  const done = await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1'`).catch(() => null);
  if (done) { oldDailyDone.add(db); return; }
  const imported = await one(db, `SELECT value FROM inv_meta WHERE key = 'import'`).catch(() => null);
  if (!imported) return; // 예전 앱 자료를 넣은 곳에서만
  // D1은 요청 한 번에 쿼리 수가 정해져 있어 하루씩 나눠서(요청마다 한 날). 다른 요청과 겹치지 않게 날마다 잠금.
  const next = Number((await one(db, `SELECT value FROM inv_meta WHERE key = 'dailyfix1_next'`).catch(() => null))?.value || 0);
  if (next >= OLD_DAILY_COUNTS.length) {
    await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('dailyfix1', ?)`).bind(String(Date.now())).run();
    oldDailyDone.add(db); return;
  }
  try { await db.prepare('INSERT INTO inv_requests (id, path, created_at) VALUES (?,?,?)').bind(`fix:dailyfix1:${next}`, 'dailyfix1', Date.now()).run(); }
  catch { // 다른 요청이 이 날을 하고 있음 — 1분 넘게 끝나지 않았으면(중간에 끊김) 잠금을 풀어 다음 요청이 다시 하게
    await db.prepare('DELETE FROM inv_requests WHERE id = ? AND created_at < ?').bind(`fix:dailyfix1:${next}`, Date.now() - 60000).run().catch(() => undefined);
    return;
  }
  await saveOldDay(route, env, url, db, OLD_DAILY_COUNTS[next], true);
  await db.prepare(`INSERT OR REPLACE INTO inv_meta (key, value) VALUES ('dailyfix1_next', ?)`).bind(String(next + 1)).run();
  return true;
}

// GET /fix-left: 남은 날을 넣고(한 번 부를 때 여러 날) 아직 남은 수를 돌려준다.
export async function oldFixLeft(route, env, url, db) {
    // 다른 화면 요청은 느려지지 않게 여기서만 넣는다. 한 번에 여러 날(최대 20초) — 요청당 쿼리 한도에 걸리면 거기서 멈추고 다음 부름에서 이어서.
    const t0 = Date.now();
    for (let k = 0; k < 46 && Date.now() - t0 < 20000; k++) {
      let did = false;
      try { did = await applyOldDailyCounts(route, env, url, db); } catch { break; }
      if (!did) break;
    }
    if (!env.SKIP_OLD_DAILY_FIX) {
      // dailyfix2(사용자가 목록 확인 뒤): 7/28 하이드로 한 칸 + 10월 안 적은 날 사유. 사유는 메모만(재고 그대로).
      await runOnceAfter(db, 'dailyfix2', 'dailyfix1', async () => {
        for (const day of OLD_DAILY_EXTRA) await saveOldDay(route, env, url, db, day);
        await db.batch(OLD_DAILY_MEMOS.map(([d, memo]) => db.prepare(`INSERT INTO inv_daily (date, patients, status, extra, updated_by, updated_at) VALUES (?, NULL, ?, '{}', '예전 앱 일일재고', ?)
          ON CONFLICT(date) DO UPDATE SET status = excluded.status`).bind(d, memo, Date.now())));
      });
      // dailyfix3(2026-11-10 대조): 사진에 사용량 없이 마감재고만 있는 날(7/31·8/4·8/14·8/24·8/28·10/15)의 사용량 품목은 차이를 재고 차이로 — 사진과 같게
      await runOnceAfter(db, 'dailyfix3', 'dailyfix2', async () => {
        for (const day of OLD_DAILY_COUNTS.filter(x => Object.values(x.i).some(([, u]) => u == null) && Object.keys(x.i).some(n => /시트팩|하이드로|리바이브/.test(n)))) await saveOldDay(route, env, url, db, day);
      });
    }
    const [imported, done1, done2, done3] = await Promise.all(['import', 'dailyfix1', 'dailyfix2', 'dailyfix3'].map(k => meta(db, k)));
    const next = Number((await meta(db, 'dailyfix1_next')) || 0);
    const left = !imported || env.SKIP_OLD_DAILY_FIX ? 0 : (done1 ? 0 : Math.max(0, OLD_DAILY_COUNTS.length - next)) + (done2 ? 0 : 1) + (done3 ? 0 : 1);
    return json({ left });
}
