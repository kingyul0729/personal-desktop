import { ensureInvSchema } from './invSchema.js';
// 직원 스케줄·성과·연차 — 예전 재고관리 앱(webapp, src/staff.ts)의 서버 계산을 그대로 옮김.
// 데이터는 팀 공용 D1(바인딩 INV_DB, 표는 invSchema.js가 만든다). 주문·결제 표는 없다.
// 근무시간·연차 차감은 원본과 같다. 성과 집계는 사용자 규칙(2026-11-08: 풀상담일 제외·원본 보존)만 반영했다.
function kstCurrentMonth() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Hono 대신 쓰는 작은 라우터(원본 코드의 c.req.query/param/json, c.json 만 사용)
function router() {
  const routes = [];
  const add = method => (path, fn) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
  };
  return {
    get: add('GET'), post: add('POST'),
    async handle(request, env, sub) {
      for (const r of routes) {
        if (r.method !== request.method) continue;
        const m = sub.match(r.re); if (!m) continue;
        const url = new URL(request.url);
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const c = {
          env: { DB: env.INV_DB },
          req: { query: k => url.searchParams.get(k) ?? undefined, param: k => params[k], json: () => request.json() },
          json: (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } }),
        };
        return r.fn(c);
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    },
  };
}
const staff = router();
const STD = {
  weekday: { start: "10:00", end: "19:30" },
  saturday: { start: "09:30", end: "15:30" }
};
const NO_WORK_TIME = ["\uD734\uBB34", "\uC5F0\uCC28", "\uACF5\uD734\uC77C", "\uBCD1\uC6D0\uD734\uBB34", "\uC0C1\uB2F4", "\uBBF8\uAE30\uB85D"];
const DEFAULT_COLOR_PALETTE = ["#8FA3D9", "#8FCBB0", "#E0BB6B", "#7FB3D9", "#A990D9", "#D98F7A", "#6FBFBF", "#B39B7A"];
const isHexColor = (v) => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v.trim());
const ETC_TIME_DETAILS = ["2\uC2DC \uCD9C\uADFC", "\uC624\uBC84\uD0C0\uC784 \uC0AC\uC6A9", "\uC870\uD1F4", "\uAC1C\uC778 \uC0AC\uC720", "\uAD50\uC721", "\uAE30\uD0C0"];
const RECORD_MODES = ["stock", "perf"];
function toMin(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function diffMin(start, end) {
  const s = toMin(start), e = toMin(end);
  if (s == null || e == null) return null;
  const d = e - s;
  return d > 0 ? d : null;
}
function dayOfWeek(workDate) {
  return (/* @__PURE__ */ new Date(workDate + "T00:00:00")).getDay();
}
function calcWorkMinutes(row, workDate) {
  const att = row.attendance;
  if (row.manual_adjust === 1 && row.work_minutes != null) return row.work_minutes;
  if (att === "\uAE30\uD0C0") {
    if (row.etc_type === "time") return diffMin(row.start_time, row.end_time);
    return null;
  }
  if (NO_WORK_TIME.includes(att)) return null;
  const sat = dayOfWeek(workDate) === 6;
  if (att === "\uC815\uC0C1\uADFC\uBB34") {
    if (row.start_time && row.end_time) return diffMin(row.start_time, row.end_time);
    const std = sat ? STD.saturday : STD.weekday;
    return diffMin(std.start, std.end);
  }
  return null;
}
function allowManagedInput(att, etcType) {
  if (att === "\uC815\uC0C1\uADFC\uBB34") return true;
  if (att === "\uAE30\uD0C0" && etcType === "time") return true;
  return false;
}
function allowDesignatedInput(att, etcType) {
  if (att === "\uAE30\uD0C0" && etcType === "unpaid") return false;
  if (att === "\uBCD1\uC6D0\uD734\uBB34") return false;
  // 본인이 휴무·연차·휴일이면 지정 환자 수도 받지 않는다(팀장·직원 공통, 사용자 지정 2026-11-08)
  if (att === "\uD734\uBB34" || att === "\uC5F0\uCC28" || att === "\uACF5\uD734\uC77C") return false;
  return true;
}
// 총 피부관리 인원(일일재고) = 그날 직원들이 성과에 적은 관리 인원 합계(사용자 지정 2026-11-08, 예전 앱도 같은 숫자).
// 관리 인원이 한 명이라도 적힌 날만 자동으로 채운다(풀상담일처럼 관리 인원이 없는 날은 일일재고에서 직접 적은 값을 둔다).
export async function dailyPatientsAuto(db, date) {
  const r = await db.prepare(`SELECT count(managed_count) AS n, sum(managed_count) AS s FROM staff_attendance WHERE work_date = ?`).bind(date).first();
  return r && r.n > 0 ? r.s : null;
}
async function syncDailyPatients(db, date) {
  const auto = await dailyPatientsAuto(db, date);
  if (auto == null) return;
  await db.prepare(`INSERT INTO inv_daily (date, patients, updated_by, updated_at) VALUES (?, ?, '성과 입력', ?) ON CONFLICT(date) DO UPDATE SET patients = excluded.patients, updated_at = excluded.updated_at`).bind(date, auto, Date.now()).run();
}
function remainLeave(total, used) {
  return (total || 0) - (used || 0);
}
function isFutureMonthLeave(workDate) {
  const leaveMonth = (workDate || "").slice(0, 7);
  if (leaveMonth.length !== 7) return false;
  return leaveMonth > kstCurrentMonth();
}
const DAY_FULL = [0, 24 * 60];
function leaderWorkContext(leaderRow, workDate, isClinicOff) {
  const EXCLUDED = { intervals: [], designatedEligible: false };
  if (isClinicOff) return EXCLUDED;
  if (!leaderRow) return EXCLUDED;
  const att = leaderRow.attendance;
  const etcType = leaderRow.etc_type;
  const ps = toMin(leaderRow.partial_start), pe = toMin(leaderRow.partial_end);
  if (att === "\uBCD1\uC6D0\uD734\uBB34" || att === "\uACF5\uD734\uC77C") return EXCLUDED;
  if (att === "\uD734\uBB34" || att === "\uC5F0\uCC28") return EXCLUDED;
  if (att === "\uC0C1\uB2F4") return EXCLUDED;
  if (att === "\uBBF8\uAE30\uB85D") return EXCLUDED;
  const ws = toMin(leaderRow.start_time), we = toMin(leaderRow.end_time);
  let base = ws != null && we != null && we > ws ? [ws, we] : DAY_FULL;
  let intervals = [base];
  if (ps != null && pe != null && pe > ps) {
    intervals = subtractInterval(base, [ps, pe]);
  }
  return { intervals, designatedEligible: true };
}
function subtractInterval(base, cut) {
  const [bs, be] = base, [cs, ce] = cut;
  const res = [];
  if (cs > bs) res.push([bs, Math.min(cs, be)]);
  if (ce < be) res.push([Math.max(ce, bs), be]);
  return res.filter(([s, e]) => e > s);
}
function overlapMinutes(staffInterval, leaderIntervals) {
  let sum = 0;
  for (const [ls, le] of leaderIntervals) {
    const s = Math.max(staffInterval[0], ls);
    const e = Math.min(staffInterval[1], le);
    if (e > s) sum += e - s;
  }
  return sum;
}
function sortStaff(list) {
  return list.slice().sort((a, b) => {
    const ar = a.status === "retired" ? 1 : 0;
    const br = b.status === "retired" ? 1 : 0;
    if (ar !== br) return ar - br;
    if (ar === 0) {
      if (a.is_leader !== b.is_leader) return b.is_leader - a.is_leader;
    }
    const ad = a.hire_date || "9999-12-31";
    const bd = b.hire_date || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.id - b.id;
  });
}
async function backfillDueLeave(env, staff2) {
  if (!staff2 || staff2.is_leader === void 0) return staff2?.used_leave || 0;
  const curMonthEnd = kstCurrentMonth() + "-31";
  const pendingDays = (await env.DB.prepare(
    `SELECT DISTINCT log_date FROM staff_leave_log
     WHERE staff_id=? AND log_type='pending' AND log_date <= ?`
  ).bind(staff2.id, curMonthEnd).all()).results;
  if (!pendingDays.length) return staff2.used_leave || 0;
  for (const row of pendingDays) {
    const wd = String(row.log_date);
    const del = await env.DB.prepare(
      `DELETE FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type='pending'`
    ).bind(staff2.id, wd).run();
    if (!del.meta?.changes) continue;
    const cond = `EXISTS (SELECT 1 FROM staff_attendance WHERE staff_id=? AND work_date=? AND attendance='\uC5F0\uCC28')
      AND (SELECT COALESCE(SUM(amount),0) FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')) <= 0`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE staff SET used_leave=used_leave+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${cond}`).bind(staff2.id, staff2.id, wd, staff2.id, wd),
      env.DB.prepare(`INSERT INTO staff_leave_log
        (staff_id, log_type, log_date, amount, before_used, after_used, after_remain, reason, editor)
        SELECT id, 'use', ?, 1, used_leave-1, used_leave, COALESCE(total_leave,0)-used_leave, '\uD574\uB2F9 \uC6D4 \uB3C4\uB798 \uC5F0\uCC28 \uC790\uB3D9 \uBC18\uC601', '\uC2DC\uC2A4\uD15C'
        FROM staff WHERE id=? AND ${cond}`).bind(wd, staff2.id, staff2.id, wd, staff2.id, wd)
    ]);
  }
  const fresh = await env.DB.prepare(`SELECT used_leave FROM staff WHERE id=?`).bind(staff2.id).first();
  const used = Number(fresh?.used_leave || 0);
  return used;
}
staff.get("/list", async (c) => {
  const includeRetired = c.req.query("include_retired") === "1";
  const rows = (await c.env.DB.prepare(`SELECT * FROM staff`).all()).results;
  const filtered = includeRetired ? rows : rows.filter((r) => r.status !== "retired");
  for (const s of filtered) {
    const newUsed = await backfillDueLeave(c.env, s);
    s.used_leave = newUsed;
  }
  const sorted = sortStaff(filtered).map((s) => ({
    ...s,
    remain_leave: remainLeave(s.total_leave, s.used_leave)
  }));
  return c.json(sorted);
});
staff.get("/leave-dates", async (c) => {
  const year = String(c.req.query("year") || "").match(/^\d{4}$/) ? c.req.query("year") : String((/* @__PURE__ */ new Date()).getFullYear());
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const rows = (await c.env.DB.prepare(
    `SELECT staff_id, work_date, memo FROM staff_attendance WHERE attendance='\uC5F0\uCC28' AND work_date BETWEEN ? AND ? ORDER BY staff_id, work_date`
  ).bind(from, to).all()).results;
  const byStaff = {}, marks = {};
  for (const r of rows) {
    (byStaff[r.staff_id] = byStaff[r.staff_id] || []).push(r.work_date);
    // 직원연차 화면용: 예전 앱 순번 표기(memo '예전 앱 표기 7/17')를 함께 준다
    (marks[r.staff_id] = marks[r.staff_id] || []).push({ date: r.work_date, memo: r.memo || null });
  }
  return c.json({ year, leave_dates: byStaff, leave_marks: marks });
});
staff.get("/month", async (c) => {
  const staffId = Number(c.req.query("staff_id"));
  const month = c.req.query("month");
  if (!staffId || !month) return c.json({ error: "\uC9C1\uC6D0\uACFC \uC6D4\uC744 \uC9C0\uC815\uD558\uC138\uC694" }, 400);
  const from = month + "-01";
  const to = month + "-31";
  const att = (await c.env.DB.prepare(
    `SELECT * FROM staff_attendance WHERE staff_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date`
  ).bind(staffId, from, to).all()).results;
  const days = (await c.env.DB.prepare(
    `SELECT * FROM staff_day_status WHERE work_date BETWEEN ? AND ?`
  ).bind(from, to).all()).results;
  const leaderForMonth = await c.env.DB.prepare(`SELECT * FROM staff WHERE is_leader=1 LIMIT 1`).first();
  const leaderAttMonth = {};
  if (leaderForMonth) {
    const lr = (await c.env.DB.prepare(
      `SELECT * FROM staff_attendance WHERE staff_id=? AND work_date BETWEEN ? AND ?`
    ).bind(leaderForMonth.id, from, to).all()).results;
    for (const r of lr) leaderAttMonth[r.work_date] = r;
  }
  const clinicOffSet = new Set(days.filter((d) => d.status === "clinic_off").map((d) => d.work_date));
  const leaderExcludedDates = [];
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${month}-${String(d).padStart(2, "0")}`;
    const ctx = leaderWorkContext(leaderAttMonth[ds] || null, ds, clinicOffSet.has(ds));
    if (!ctx.designatedEligible) leaderExcludedDates.push(ds);
  }
  let workDays = 0, totalMin = 0, mgSum = 0, mgCnt = 0;
  for (const r of att) {
    if (r.work_minutes != null) {
      workDays++;
      totalMin += r.work_minutes;
    }
    if (r.managed_count != null) {
      mgSum += r.managed_count;
      mgCnt++;
    }
  }
  const summary = {
    work_days: workDays,
    total_hours: totalMin > 0 ? Math.round(totalMin / 6) / 10 : null,
    // 1자리 시간
    avg_managed: mgCnt > 0 ? Math.round(mgSum / mgCnt * 10) / 10 : null
  };
  return c.json({ attendance: att, day_status: days, summary, leader_excluded_dates: leaderExcludedDates });
});
staff.post("/attendance", async (c) => {
  const b = await c.req.json();
  const staffId = Number(b.staff_id);
  const workDate = String(b.work_date || "");
  const att = String(b.attendance || "");
  if (!staffId || !workDate || !att) return c.json({ error: "\uD544\uC218 \uAC12\uC774 \uB204\uB77D\uB418\uC5C8\uC2B5\uB2C8\uB2E4" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return c.json({ error: "\uB0A0\uC9DC \uD615\uC2DD(YYYY-MM-DD)\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4" }, 400);
  const badNum = (v) => v !== "" && v != null && !(Number.isFinite(Number(v)) && Number(v) >= 0);
  if (badNum(b.managed_count) || badNum(b.designated_count) || b.manual_adjust === 1 && badNum(b.work_minutes)) {
    return c.json({ error: "\uC778\uC6D0\xB7\uADFC\uBB34\uC2DC\uAC04\uC740 0 \uC774\uC0C1\uC758 \uC22B\uC790\uB85C \uC785\uB825\uD558\uC138\uC694" }, 400);
  }
  if (b.manual_adjust === 1 && b.work_minutes != null && b.work_minutes !== "") b.work_minutes = Number(b.work_minutes);
  const sf = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(staffId).first();
  if (!sf) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  if (sf.status === "retired" && sf.retire_date && workDate > sf.retire_date) {
    return c.json({ error: "\uD1F4\uC0AC\uC77C \uC774\uD6C4\uC5D0\uB294 \uC785\uB825\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 400);
  }
  const etcType = att === "\uAE30\uD0C0" ? b.etc_type || null : null;
  let etcDetail = att === "\uAE30\uD0C0" && etcType === "time" ? b.etc_detail || null : null;
  if (etcDetail && !ETC_TIME_DETAILS.includes(etcDetail)) etcDetail = null;
  const recordMode = att === "\uBBF8\uAE30\uB85D" && RECORD_MODES.includes(b.record_mode) ? b.record_mode : null;
  const manualAdjust = b.manual_adjust === 1 ? 1 : 0;
  if (manualAdjust === 1 && !b.adjust_reason) {
    return c.json({ error: "\uADFC\uBB34\uC2DC\uAC04 \uC218\uB3D9 \uBCF4\uC815 \uC2DC \uC0AC\uC720 \uC785\uB825\uC740 \uD544\uC218\uC785\uB2C8\uB2E4" }, 400);
  }
  const isTimeEtc = att === "\uAE30\uD0C0" && etcType === "time";
  const workMin = calcWorkMinutes({
    attendance: att,
    etc_type: etcType,
    start_time: b.start_time,
    end_time: b.end_time,
    manual_adjust: manualAdjust,
    work_minutes: b.work_minutes
  }, workDate);
  // 원본 보존(사용자 지정 2026-11-08): 상태를 바꿔도 이미 적힌 출퇴근시간·관리인원·지정환자수를 지우거나 0으로 바꾸지 않는다.
  // 입력할 수 없는 상태(휴무·연차·상담 등)에서는 새 값을 받지 않고 기존 값을 그대로 둔다. 성과 계산은 상태로 거른다.
  const prior = await c.env.DB.prepare(`SELECT managed_count, designated_count, start_time, end_time FROM staff_attendance WHERE staff_id=? AND work_date=?`).bind(staffId, workDate).first();
  const numOrNull = (v) => v !== "" && v != null ? Math.max(0, Number(v)) : null;
  // 풀상담일(팀장 '상담')에는 팀장·직원 모두 관리 인원을 새로 받지 않는다(사용자 지정 2026-11-08) — 기존 값은 보존
  const leaderRow = await c.env.DB.prepare(`SELECT id FROM staff WHERE is_leader=1 LIMIT 1`).first();
  const leaderDay = leaderRow ? await c.env.DB.prepare(`SELECT attendance, etc_type FROM staff_attendance WHERE staff_id=? AND work_date=?`).bind(leaderRow.id, workDate).first() : null;
  const fullConsultDay = att === "\uC0C1\uB2F4" && sf.is_leader === 1 || leaderDay?.attendance === "\uC0C1\uB2F4" && sf.is_leader !== 1;
  // 팀장이 휴무·연차 등으로 근무하지 않은 날에는 직원 관리 인원도 받지 않는다(0 처리). 팀장 근태가 아직 없으면 막지 않는다(입력 순서 때문)
  const leaderOff = sf.is_leader !== 1 && !!leaderDay && !(leaderDay.attendance === "\uC815\uC0C1\uADFC\uBB34" || leaderDay.attendance === "\uAE30\uD0C0" && leaderDay.etc_type === "time") && leaderDay.attendance !== "\uC0C1\uB2F4";
  const allowMg = allowManagedInput(att, etcType) && !fullConsultDay && !leaderOff;
  const managed = allowMg && b.managed_count !== undefined ? numOrNull(b.managed_count) : prior?.managed_count ?? null;
  const allowDg = allowDesignatedInput(att, etcType);
  const designated = allowDg && b.designated_count !== undefined ? numOrNull(b.designated_count) : prior?.designated_count ?? null;
  const workTime = att === "\uC815\uC0C1\uADFC\uBB34" || isTimeEtc;
  const startT = workTime ? b.start_time || null : prior?.start_time ?? null;
  const endT = workTime ? b.end_time || null : prior?.end_time ?? null;
  const partialStart = b.partial_start || null;
  const partialEnd = b.partial_end || null;
  const prev = await c.env.DB.prepare(
    `SELECT * FROM staff_attendance WHERE staff_id=? AND work_date=?`
  ).bind(staffId, workDate).first();
  const wasLeave = prev && prev.attendance === "\uC5F0\uCC28";
  const isLeave = att === "\uC5F0\uCC28";
  const leaveStmts = [];
  if (!wasLeave && isLeave) {
    if (isFutureMonthLeave(workDate)) {
      const hasPending = await c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM staff_leave_log
         WHERE staff_id=? AND log_date=? AND log_type='pending'`
      ).bind(staffId, workDate).first();
      if (Number(hasPending?.cnt || 0) === 0) {
        await c.env.DB.prepare(`INSERT INTO staff_leave_log
          (staff_id, log_type, log_date, amount, before_used, after_used, after_remain, reason, editor)
          VALUES (?,?,?,?,?,?,?,?,?)`).bind(
          staffId,
          "pending",
          workDate,
          0,
          sf.used_leave || 0,
          sf.used_leave || 0,
          remainLeave(sf.total_leave, sf.used_leave || 0),
          "\uBBF8\uB798\uC6D4 \uC5F0\uCC28 \uBBF8\uB9AC \uB4F1\uB85D(\uB3C4\uB798 \uC2DC \uC790\uB3D9 \uCC28\uAC10)",
          b.editor || "\uAD00\uB9AC\uC790"
        ).run();
      }
    } else {
      leaveStmts.push(
        c.env.DB.prepare(`UPDATE staff SET used_leave=used_leave+1, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND (SELECT COALESCE(SUM(amount),0) FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')) <= 0`).bind(staffId, staffId, workDate),
        c.env.DB.prepare(`INSERT INTO staff_leave_log
          (staff_id, log_type, log_date, amount, before_used, after_used, after_remain, editor)
          SELECT id, 'use', ?, 1, used_leave-1, used_leave, COALESCE(total_leave,0)-used_leave, ? FROM staff
          WHERE id=? AND (SELECT COALESCE(SUM(amount),0) FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')) <= 0`).bind(workDate, b.editor || "\uAD00\uB9AC\uC790", staffId, staffId, workDate)
      );
    }
  } else if (wasLeave && !isLeave) {
    const netRow = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS net FROM staff_leave_log
       WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')`
    ).bind(staffId, workDate).first();
    const net = Number(netRow?.net || 0);
    if (net > 0) {
      leaveStmts.push(
        c.env.DB.prepare(`UPDATE staff SET used_leave=MAX(0, used_leave-1), updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND (SELECT COALESCE(SUM(amount),0) FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')) > 0`).bind(staffId, staffId, workDate),
        c.env.DB.prepare(`INSERT INTO staff_leave_log
          (staff_id, log_type, log_date, amount, before_used, after_used, after_remain, reason, editor)
          SELECT id, 'revert', ?, -1, used_leave+1, used_leave, COALESCE(total_leave,0)-used_leave, '\uADFC\uD0DC \uC0C1\uD0DC \uBCC0\uACBD(\uC5F0\uCC28 \uD574\uC81C)', ? FROM staff
          WHERE id=? AND (SELECT COALESCE(SUM(amount),0) FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type IN ('use','revert')) > 0`).bind(workDate, b.editor || "\uAD00\uB9AC\uC790", staffId, staffId, workDate)
      );
    } else {
      const pendingRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM staff_leave_log
         WHERE staff_id=? AND log_date=? AND log_type='pending'`
      ).bind(staffId, workDate).first();
      const hasPending = Number(pendingRow?.cnt || 0) > 0;
      if (hasPending) {
        await c.env.DB.prepare(
          `DELETE FROM staff_leave_log WHERE staff_id=? AND log_date=? AND log_type='pending'`
        ).bind(staffId, workDate).run();
      } else if (!isFutureMonthLeave(workDate) && (sf.used_leave || 0) > 0) {
        const newUsed = Math.max(0, (sf.used_leave || 0) - 1);
        const remain = remainLeave(sf.total_leave, newUsed);
        await c.env.DB.prepare(`UPDATE staff SET used_leave=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newUsed, staffId).run();
        await c.env.DB.prepare(`INSERT INTO staff_leave_log
          (staff_id, log_type, log_date, amount, before_used, after_used, after_remain, reason, editor)
          VALUES (?,?,?,?,?,?,?,?,?)`).bind(staffId, "revert", workDate, -1, sf.used_leave || 0, newUsed, remain, "\uADFC\uD0DC \uC0C1\uD0DC \uBCC0\uACBD(\uC5F0\uCC28 \uD574\uC81C\xB7\uAE30\uC874 \uBC18\uC601\uBD84)", b.editor || "\uAD00\uB9AC\uC790").run();
      }
    }
  }
  const isDemo = b.is_demo === true || b.is_demo === 1 ? 1 : 0;
  await c.env.DB.batch([c.env.DB.prepare(`
    INSERT INTO staff_attendance
      (staff_id, work_date, attendance, etc_type, etc_detail, record_mode, start_time, end_time,
       work_minutes, manual_adjust, adjust_reason, managed_count, designated_count,
       partial_start, partial_end, memo, editor, is_demo, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(staff_id, work_date) DO UPDATE SET
      attendance=excluded.attendance, etc_type=excluded.etc_type, etc_detail=excluded.etc_detail,
      record_mode=excluded.record_mode,
      start_time=excluded.start_time, end_time=excluded.end_time, work_minutes=excluded.work_minutes,
      manual_adjust=excluded.manual_adjust, adjust_reason=excluded.adjust_reason,
      managed_count=excluded.managed_count, designated_count=excluded.designated_count,
      partial_start=excluded.partial_start, partial_end=excluded.partial_end,
      memo=excluded.memo, editor=excluded.editor, is_demo=excluded.is_demo, updated_at=CURRENT_TIMESTAMP
  `).bind(
    staffId,
    workDate,
    att,
    etcType,
    etcDetail,
    recordMode,
    startT,
    endT,
    workMin,
    manualAdjust,
    manualAdjust === 1 ? b.adjust_reason || null : null,
    managed,
    designated,
    partialStart,
    partialEnd,
    b.memo || null,
    b.editor || "\uAD00\uB9AC\uC790",
    isDemo
  ), ...leaveStmts]);
  await syncDailyPatients(c.env.DB, workDate);
  const updated = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(staffId).first();
  return c.json({
    ok: true,
    work_minutes: workMin,
    remain_leave: remainLeave(updated.total_leave, updated.used_leave),
    used_leave: updated.used_leave
  });
});
staff.post("/attendance/move", async (c) => {
  const b = await c.req.json();
  const staffId = Number(b.staff_id);
  const fromDate = String(b.from_date || "");
  const toDate = String(b.to_date || "");
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!staffId || !dateRe.test(fromDate) || !dateRe.test(toDate)) {
    return c.json({ error: "\uC9C1\uC6D0/\uC6D0\uB798 \uB0A0\uC9DC/\uC774\uB3D9\uD560 \uB0A0\uC9DC\uB97C \uC62C\uBC14\uB974\uAC8C \uC9C0\uC815\uD558\uC138\uC694" }, 400);
  }
  if (fromDate === toDate) return c.json({ error: "\uAC19\uC740 \uB0A0\uC9DC\uB85C\uB294 \uC774\uB3D9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 400);
  const sf = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(staffId).first();
  if (!sf) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  if (sf.status === "retired" && sf.retire_date && toDate > sf.retire_date) {
    return c.json({ error: "\uD1F4\uC0AC\uC77C \uC774\uD6C4\uB85C\uB294 \uC774\uB3D9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 400);
  }
  const src = await c.env.DB.prepare(
    `SELECT * FROM staff_attendance WHERE staff_id=? AND work_date=?`
  ).bind(staffId, fromDate).first();
  if (!src) return c.json({ error: "\uC774\uB3D9\uD560 \uADFC\uD0DC \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  const dst = await c.env.DB.prepare(
    `SELECT id FROM staff_attendance WHERE staff_id=? AND work_date=?`
  ).bind(staffId, toDate).first();
  if (dst) return c.json({ error: "\uC774\uB3D9\uD560 \uB0A0\uC9DC\uC5D0 \uC774\uBBF8 \uADFC\uD0DC \uAE30\uB85D\uC774 \uC788\uC2B5\uB2C8\uB2E4" }, 409);
  await c.env.DB.prepare(
    `UPDATE staff_attendance SET work_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(toDate, src.id).run();
  await c.env.DB.prepare(
    `UPDATE staff_leave_log SET log_date=? WHERE staff_id=? AND log_date=? AND log_type IN ('use','pending')`
  ).bind(toDate, staffId, fromDate).run();
  const updated = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(staffId).first();
  return c.json({
    ok: true,
    moved: { attendance: src.attendance, from: fromDate, to: toDate },
    remain_leave: remainLeave(updated.total_leave, updated.used_leave),
    used_leave: updated.used_leave
  });
});
staff.post("/day-status", async (c) => {
  const b = await c.req.json();
  const workDate = String(b.work_date || "");
  if (!workDate) return c.json({ error: "\uB0A0\uC9DC\uB97C \uC9C0\uC815\uD558\uC138\uC694" }, 400);
  if (b.clear) {
    await c.env.DB.prepare(`DELETE FROM staff_day_status WHERE work_date=?`).bind(workDate).run();
    return c.json({ ok: true, cleared: true });
  }
  await c.env.DB.prepare(`
    INSERT INTO staff_day_status (work_date, status, memo, updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(work_date) DO UPDATE SET status=excluded.status, memo=excluded.memo, updated_at=CURRENT_TIMESTAMP
  `).bind(workDate, b.status || "clinic_off", b.memo || null).run();
  return c.json({ ok: true });
});
staff.post("/add", async (c) => {
  const b = await c.req.json();
  if (!b.name || !b.hire_date) return c.json({ error: "\uC9C1\uC6D0 \uC774\uB984\uACFC \uC785\uC0AC\uC77C\uC790\uB294 \uD544\uC218\uC785\uB2C8\uB2E4" }, 400);
  const staffType = b.staff_type === "newbie" ? "newbie" : "regular";
  if (b.is_leader) {
    const lead = await c.env.DB.prepare(`SELECT id FROM staff WHERE is_leader=1 AND status != 'retired' LIMIT 1`).first();
    if (lead) return c.json({ error: "\uD300\uC7A5\uC740 \uC774\uBBF8 \uB4F1\uB85D\uB3FC \uC788\uC2B5\uB2C8\uB2E4" }, 409);
  }
  const totalLeave = staffType === "newbie" ? 0 : Number(b.total_leave) || 0;
  const usedLeave = staffType === "newbie" ? 0 : Number(b.used_leave) || 0;
  let personalColor = isHexColor(b.personal_color) ? b.personal_color.trim() : null;
  if (!personalColor) {
    const cnt = (await c.env.DB.prepare(`SELECT COUNT(*) as n FROM staff`).first())?.n || 0;
    personalColor = DEFAULT_COLOR_PALETTE[cnt % DEFAULT_COLOR_PALETTE.length];
  }
  const res = await c.env.DB.prepare(`
    INSERT INTO staff (name, position, is_leader, hire_date, status, staff_type, total_leave, used_leave, second_shift_count, memo, personal_color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    b.name,
    b.position || "\uC9C1\uC6D0",
    b.is_leader ? 1 : 0,
    b.hire_date,
    "active",
    staffType,
    totalLeave,
    usedLeave,
    Number(b.second_shift_count) || 0,
    b.memo || null,
    personalColor
  ).run();
  return c.json({ ok: true, id: res.meta.last_row_id });
});
staff.post("/update/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const cur = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  if (!cur) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  const fields = ["name", "position", "hire_date", "total_leave", "used_leave", "second_shift_count", "memo", "personal_color"];
  const changes = {};
  for (const f of fields) {
    if (b[f] !== void 0 && String(b[f]) !== String(cur[f] ?? "")) {
      changes[f] = { before: cur[f], after: b[f] };
    }
  }
  const newColor = b.personal_color !== void 0 ? isHexColor(b.personal_color) ? b.personal_color.trim() : cur.personal_color : cur.personal_color;
  await c.env.DB.prepare(`
    UPDATE staff SET name=?, position=?, hire_date=?, total_leave=?, used_leave=?, second_shift_count=?, memo=?, personal_color=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    b.name ?? cur.name,
    b.position ?? cur.position,
    b.hire_date ?? cur.hire_date,
    Number(b.total_leave ?? cur.total_leave),
    Number(b.used_leave ?? cur.used_leave),
    Number(b.second_shift_count ?? cur.second_shift_count),
    b.memo ?? cur.memo,
    newColor,
    id
  ).run();
  if (Object.keys(changes).length > 0) {
    await c.env.DB.prepare(`INSERT INTO staff_info_log (staff_id, changes, editor) VALUES (?,?,?)`).bind(id, JSON.stringify(changes), b.editor || "\uAD00\uB9AC\uC790").run();
  }
  const updated = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  return c.json({ ok: true, remain_leave: remainLeave(updated.total_leave, updated.used_leave) });
});
staff.post("/leave-adjust/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  if (!b.reason) return c.json({ error: "\uC218\uC815 \uC0AC\uC720 \uC120\uD0DD\uC740 \uD544\uC218\uC785\uB2C8\uB2E4" }, 400);
  const cur = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  if (!cur) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  const newTotal = b.total_leave != null ? Number(b.total_leave) : cur.total_leave;
  const newUsed = b.used_leave != null ? Number(b.used_leave) : cur.used_leave;
  const remain = remainLeave(newTotal, newUsed);
  await c.env.DB.prepare(`UPDATE staff SET total_leave=?, used_leave=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newTotal, newUsed, id).run();
  await c.env.DB.prepare(`INSERT INTO staff_leave_log
    (staff_id, log_type, before_total, after_total, before_used, after_used, after_remain, reason, memo, editor)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, "adjust", cur.total_leave, newTotal, cur.used_leave, newUsed, remain, b.reason, b.memo || null, b.editor || "\uAD00\uB9AC\uC790").run();
  return c.json({ ok: true, total_leave: newTotal, used_leave: newUsed, remain_leave: remain });
});
staff.post("/leave-grant/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const cur = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  if (!cur) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  if (b.action === "convert") {
    const newTotal2 = b.total_leave != null ? Number(b.total_leave) : 15;
    const remain2 = remainLeave(newTotal2, cur.used_leave);
    await c.env.DB.prepare(`UPDATE staff SET total_leave=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newTotal2, id).run();
    await c.env.DB.prepare(`INSERT INTO staff_leave_log
      (staff_id, log_type, before_total, after_total, after_remain, reason, memo, editor)
      VALUES (?,?,?,?,?,?,?,?)`).bind(id, "convert", cur.total_leave, newTotal2, remain2, "\uC815\uC9C1\uC6D0 \uC5F0\uCC28 \uAE30\uC900 \uC804\uD658", b.memo || null, b.editor || "\uAD00\uB9AC\uC790").run();
    return c.json({ ok: true, total_leave: newTotal2, remain_leave: remain2 });
  }
  if (b.approve === false) {
    await c.env.DB.prepare(`INSERT INTO staff_leave_log
      (staff_id, log_type, amount, before_total, after_total, reason, editor)
      VALUES (?,?,?,?,?,?,?)`).bind(id, "grant", 0, cur.total_leave, cur.total_leave, b.reason || "\uB2F9\uC6D4 \uC5F0\uCC28 \uBC1C\uC0DD \uC5C6\uC74C", b.editor || "\uAD00\uB9AC\uC790").run();
    return c.json({ ok: true, total_leave: cur.total_leave });
  }
  const newTotal = (cur.total_leave || 0) + 1;
  const remain = remainLeave(newTotal, cur.used_leave);
  await c.env.DB.prepare(`UPDATE staff SET total_leave=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newTotal, id).run();
  await c.env.DB.prepare(`INSERT INTO staff_leave_log
    (staff_id, log_type, amount, before_total, after_total, after_remain, reason, editor)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id, "grant", 1, cur.total_leave, newTotal, remain, "\uC6D4 \uC5F0\uCC28 \uBC1C\uC0DD \uC9C0\uAE09 \uC2B9\uC778", b.editor || "\uAD00\uB9AC\uC790").run();
  return c.json({ ok: true, total_leave: newTotal, remain_leave: remain });
});
staff.get("/leave-log/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const logs = (await c.env.DB.prepare(
    `SELECT * FROM staff_leave_log WHERE staff_id=? ORDER BY created_at DESC, id DESC`
  ).bind(id).all()).results;
  return c.json(logs);
});
staff.get("/info-log/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const logs = (await c.env.DB.prepare(
    `SELECT * FROM staff_info_log WHERE staff_id=? ORDER BY created_at DESC, id DESC`
  ).bind(id).all()).results;
  return c.json(logs);
});
staff.post("/retire/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  if (!b.retire_date) return c.json({ error: "\uD1F4\uC0AC\uC77C\uC790\uB294 \uD544\uC218\uC785\uB2C8\uB2E4" }, 400);
  const cur = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  if (!cur) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  await c.env.DB.prepare(`UPDATE staff SET status='retired', retire_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(b.retire_date, id).run();
  await c.env.DB.prepare(`INSERT INTO staff_info_log (staff_id, changes, editor) VALUES (?,?,?)`).bind(id, JSON.stringify({ retire: { before: cur.status, after: "retired", retire_date: b.retire_date } }), b.editor || "\uAD00\uB9AC\uC790").run();
  return c.json({ ok: true });
});
staff.post("/restore/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const cur = await c.env.DB.prepare(`SELECT * FROM staff WHERE id=?`).bind(id).first();
  if (!cur) return c.json({ error: "\uC9C1\uC6D0\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }, 404);
  await c.env.DB.prepare(`UPDATE staff SET status='active', retire_date=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await c.env.DB.prepare(`INSERT INTO staff_info_log (staff_id, changes, editor) VALUES (?,?,?)`).bind(id, JSON.stringify({ restore: { before: "retired", after: "active" } }), b.editor || "\uAD00\uB9AC\uC790").run();
  return c.json({ ok: true });
});
staff.get("/performance", async (c) => {
  const month = c.req.query("month");
  const includeRetired = c.req.query("include_retired") === "1";
  if (!month) return c.json({ error: "\uC6D4\uC744 \uC9C0\uC815\uD558\uC138\uC694" }, 400);
  const from = month + "-01", to = month + "-31";
  const leader = await c.env.DB.prepare(`SELECT * FROM staff WHERE is_leader=1 LIMIT 1`).first();
  const leaderAtt = {};
  if (leader) {
    const rows = (await c.env.DB.prepare(
      `SELECT * FROM staff_attendance WHERE staff_id=? AND work_date BETWEEN ? AND ?`
    ).bind(leader.id, from, to).all()).results;
    for (const r of rows) leaderAtt[r.work_date] = r;
  }
  const clinicOffRows = (await c.env.DB.prepare(
    `SELECT work_date FROM staff_day_status WHERE status='clinic_off' AND work_date BETWEEN ? AND ?`
  ).bind(from, to).all()).results;
  const clinicOff = new Set(clinicOffRows.map((r) => r.work_date));
  const isFullConsultDay = (date) => leaderAtt[date]?.attendance === "\uC0C1\uB2F4";
  // 팀장 그날 상태 이름(성과 확인 사유에 그대로 보여 줌)
  const leaderLabel = (date) => {
    const l = leaderAtt[date];
    if (clinicOff.has(date)) return "병원휴무일";
    if (!l) return "팀장 근태 미입력";
    if (l.attendance === "기타" && l.etc_type === "time") return l.etc_detail === "2시 출근" ? "팀장 2출" : "팀장 출퇴근 기타";
    if (l.attendance === "공휴일") return "팀장 휴일";
    return "팀장 " + l.attendance;
  };
  const ctxCache = {};
  const ctxOf = (date) => {
    if (!ctxCache[date]) ctxCache[date] = leaderWorkContext(leaderAtt[date] || null, date, clinicOff.has(date));
    return ctxCache[date];
  };
  const staffRows = (await c.env.DB.prepare(`SELECT * FROM staff`).all()).results;
  const monthEnd = to, monthStart = from;
  const allAttRows = (await c.env.DB.prepare(
    `SELECT * FROM staff_attendance WHERE work_date BETWEEN ? AND ? ORDER BY work_date`
  ).bind(from, to).all()).results;
  const attByStaff = {};
  for (const r of allAttRows) {
    if (!attByStaff[r.staff_id]) attByStaff[r.staff_id] = [];
    attByStaff[r.staff_id].push(r);
  }
  const result = [];
  for (const s of staffRows) {
    const hiredBefore = !s.hire_date || s.hire_date <= monthEnd;
    const notRetiredBeforeMonth = s.status !== "retired" || !s.retire_date || s.retire_date >= monthStart;
    const wasActive = hiredBefore && notRetiredBeforeMonth;
    if (!wasActive) continue;
    if (s.status === "retired" && !includeRetired && (!s.retire_date || s.retire_date < monthStart)) continue;
    const att = attByStaff[s.id] || [];
    const isLeaderSelf = s.is_leader === 1;
    let workDays = 0, totalMin = 0, totalMgSum = 0, totalMgCnt = 0, dgSum = 0, dgCnt = 0, leaveUsed = 0;

    let consultCount = 0;
    const exclusions = [];
    let satOffCount = 0;
    let earlyLeaveCount = 0;
    let unpaidCount = 0;
    for (const r of att) {
      if (r.attendance === "\uC5F0\uCC28") leaveUsed++;
      if (r.attendance === "\uC0C1\uB2F4") consultCount++;
      {
        const dow = (/* @__PURE__ */ new Date(r.work_date + "T00:00:00Z")).getUTCDay();
        if (dow === 6 && (r.attendance === "\uC5F0\uCC28" || r.attendance === "\uD734\uBB34")) satOffCount++;
        if (r.attendance === "\uAE30\uD0C0" && r.etc_type === "time" && r.etc_detail === "\uC870\uD1F4") earlyLeaveCount++;
        if (r.attendance === "\uAE30\uD0C0" && r.etc_type === "unpaid") unpaidCount++;
      }
      const ctx = isLeaderSelf ? (() => {
        const a = r.attendance;
        const eligible2 = a === "\uC815\uC0C1\uADFC\uBB34" || a === "\uAE30\uD0C0" && r.etc_type === "time";
        return eligible2 ? { intervals: [DAY_FULL], designatedEligible: true } : { intervals: [], designatedEligible: false };
      })() : ctxOf(r.work_date);
      const eligible = ctx.designatedEligible;
      {
        const a = r.attendance;
        const isUnpaidEtc = a === "\uAE30\uD0C0" && r.etc_type === "unpaid";
        const selfEligibleStatus = a === "\uC815\uC0C1\uADFC\uBB34" || a === "\uAE30\uD0C0" && r.etc_type === "time";
        let reason = null;
        if (a === "\uC0C1\uB2F4") {
          reason = "\uC0C1\uB2F4 \uC81C\uC678";
        } else if (a === "\uBBF8\uAE30\uB85D") {
          reason = "\uBBF8\uAE30\uB85D \uD655\uC778 \uD544\uC694";
        } else if (isUnpaidEtc) {
          reason = "\uC131\uACFC \uC81C\uC678";
        } else if (selfEligibleStatus && !isLeaderSelf && !eligible) {
          // 성과는 팀장 기준(팀장만 관리): 팀장이 근무하지 않았거나 팀장 근태가 비면 그날 근무시간·관리수 0
          reason = leaderLabel(r.work_date) + " \u00B7 \uD300\uC7A5 \uAE30\uC900 \uC81C\uC678";
        } else if (selfEligibleStatus && !isLeaderSelf && eligible && leaderAtt[r.work_date]?.attendance === "\uAE30\uD0C0") {
          reason = leaderLabel(r.work_date) + " \u00B7 \uD300\uC7A5 \uADFC\uBB34\uC2DC\uAC04\uB9CC \uC778\uC815";
        }
        if (reason) exclusions.push({ date: r.work_date, reason });
      }
      if (eligible && r.work_minutes != null) {
        const ws = toMin(r.start_time), we = toMin(r.end_time);
        let creditedMin;
        if (isLeaderSelf) {
          creditedMin = r.work_minutes;
        } else if (ws != null && we != null && we > ws) {
          creditedMin = overlapMinutes([ws, we], ctx.intervals);
        } else {
          creditedMin = ctx.intervals.reduce((a, [ss, ee]) => a + (ee - ss), 0);
          creditedMin = Math.min(creditedMin, r.work_minutes);
        }
        if (creditedMin > 0) {
          workDays++;
          totalMin += creditedMin;
        }
      }
      const ownWork = r.attendance === "\uC815\uC0C1\uADFC\uBB34" || r.attendance === "\uAE30\uD0C0" && r.etc_type === "time";
      // 관리수 = 관리 인원(일반 + 본인 지정 환자 모두 포함, 사용자 지정 2026-11-10). 팀장이 근무한 날만(팀장 기준).
      // 지정 환자 수는 관리수에 이미 들어 있는 환자 중 본인 지정만 따로 적는 원장님 확인용 숫자 — 관리수·시간당·평균에 더하지 않는다.
      if (eligible && ownWork && !isFullConsultDay(r.work_date) && r.managed_count != null) {
        totalMgSum += r.managed_count;
        totalMgCnt++;
      }
      // 지정 환자 수 월 합계(원장님 확인용): 본인이 근무(정상근무·출퇴근 기타)했거나 상담한 날의 값. 풀상담일 값도 같은 칸에 합친다(2026-11-10 '풀상담 지정' 열 없앰).
      // 휴무·연차·휴일·병원휴무·미기록·무급 날의 보존된 값은 넣지 않는다
      const dgCounts = ownWork || r.attendance === "\uC0C1\uB2F4";
      if (dgCounts && r.designated_count != null) {
        dgSum += r.designated_count;
        dgCnt++;
      }
    }
    result.push({
      id: s.id,
      name: s.name,
      position: s.position,
      is_leader: s.is_leader,
      staff_type: s.staff_type,
      status: s.status,
      retire_date: s.retire_date,
      work_days: workDays,
      total_hours: totalMin > 0 ? Math.round(totalMin / 6) / 10 : null,
      // 시간당 관리수 = 관리수 합계 ÷ 실근무시간(팀장 근무시간과 겹친 시간). 팀장 2출 날은 관리 인원도 2시 이후만 적는다(사용자 지정 2026-11-08).
      //   관리인원 기록 일수(totalMgCnt)로 나누지 않는다(2026-08 확정) — 총근무시간이 0이면 계산하지 않음.
      avg_managed: totalMgCnt > 0 && totalMin > 0 ? Math.round(totalMgSum / (totalMin / 60) * 10) / 10 : null,
      // 관리수(지정 포함) = 관리 인원 합계(팀장 근무일만)
      total_managed: totalMgCnt > 0 ? totalMgSum : null,
      // 지정 환자 수 월 합계(원장님 확인용, 성과 계산과 무관)
      total_designated: dgCnt > 0 ? dgSum : null,
      avg_designated: dgCnt > 0 ? Math.round(dgSum / dgCnt * 10) / 10 : null,
      leave_used: leaveUsed,
      remain_leave: remainLeave(s.total_leave, s.used_leave),
      // 지급연차(화면 '지급연차' 표시용)
      total_leave: s.total_leave,
      // 사용연차 누적(표시 전용, 계산 로직과 무관): 달이 바뀌어도 유지·재계약 전까지 누적
      used_leave: s.used_leave,
      // 비고 표시용 메타 (성과 계산 로직과 무관): 해당 월 상담 일수
      consult_count: consultCount,
      // 화면/PDF 표시 전용 카운트 (계산 로직과 무관)
      sat_off_count: satOffCount,
      // 토요 휴무 N회 (토요일 연차/휴무)
      early_leave_count: earlyLeaveCount,
      // 조퇴 N회
      unpaid_count: unpaidCount,
      // 무급 N회
      // 성과 제외 사유(표시 전용, 계산 로직과 무관) — 날짜순
      exclusions: exclusions.slice().sort((a, b) => a.date.localeCompare(b.date))
    });
  }
  return c.json(sortStaff(result));
});


export async function handleStaff(request, env, url) {
  if (!env.INV_DB) return Response.json({ error: '직원 자료(예전 재고관리 DB)가 아직 연결되지 않았어요.', unavailable: true }, { status: 503 });
  try { await ensureInvSchema(env.INV_DB); return await staff.handle(request, env, url.pathname.slice('/api/staff'.length) || '/'); }
  catch (e) {
    // 원인을 화면에서 바로 볼 수 있게(로그인한 직원에게만) DB 오류 문구와 예전 DB의 표 이름을 함께 돌려준다.
    let tables = [];
    try { tables = ((await env.INV_DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()).results || []).map(r => r.name); } catch (t) { tables = ['(표 목록도 읽지 못함: ' + String(t?.message || t).slice(0, 120) + ')']; }
    return Response.json({ error: '직원 자료를 처리하지 못했어요.', detail: String(e?.message || e).slice(0, 300), tables: tables.slice(0, 80) }, { status: 500 });
  }
}
