import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const page = read("finance/transport-entry.html");
const shell = read("app-shell.js");
const login = read("login.html");
const overview = read("finance/index.html");

const slice3Marker = "-- ฝ่ายการเงิน ค่ารถรับส่ง Slice 3";
const marker = "-- ฝ่ายการเงิน ค่ารถรับส่ง Slice 4";
const slice3At = schema.indexOf(slice3Marker);
const migrationAt = schema.indexOf(marker);
assert.ok(slice3At >= 0 && migrationAt > slice3At, "Slice 4 ต้องเป็น migration ใหม่ต่อท้าย Slice 3");
const migration = schema.slice(migrationAt);
const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

const formulaStart = client.indexOf("export const TRANSPORT_CHARGE_STATUSES");
const formulaEnd = client.indexOf("// ยอดที่เบิกได้จริง", formulaStart);
assert.ok(formulaStart >= 0 && formulaEnd > formulaStart, "หาสูตรค่ารถกลางไม่พบ");
const formulaSource = client.slice(formulaStart, formulaEnd)
  .replaceAll("export const ", "const ")
  .replaceAll("export function ", "function ");
const dateHelpers = `
function toDateStr(d) { return d.toISOString().slice(0, 10); }
function addDaysStr(dateStr, n) { const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return toDateStr(d); }
function eachDate(from, to) { const out = []; for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d); return out; }
function isoWeekday(dateStr) { const wd = new Date(dateStr + "T00:00:00Z").getUTCDay(); return wd === 0 ? 7 : wd; }
`;
const { TRANSPORT_CHARGE_STATUSES, computeTransportCharges, computeTransportOutstanding } = new Function(
  `${dateHelpers}\n${formulaSource}; return { TRANSPORT_CHARGE_STATUSES, computeTransportCharges, computeTransportOutstanding };`
)();

test("Slice 4 เป็น migration ใหม่ เริ่มด้วย lock timeout และ rollback ครบ", () => {
  const firstSql = migration.split("\n").find(line => line.trim() && !line.trim().startsWith("--") && !line.trim().startsWith("="));
  assert.equal(firstSql?.trim(), "set lock_timeout = '5s';");
  assert.match(executable, /create table if not exists transport_day_overrides \(/);
  assert.match(executable, /create table if not exists transport_payments \(/);
  assert.match(executable, /transport_day_overrides_student_date_uniq unique \(student_id, charge_date\)/);
  assert.match(executable, /transport_payments_savings_txn_uniq[^]*?where savings_txn_id is not null/);
  assert.match(executable, /transport_payments_savings_pair check \([^]*?method <> 'หักออมทรัพย์' or savings_txn_id is not null/);
  assert.match(migration, /ย้อนกลับ migration นี้/);
  assert.match(migration, /-- drop table if exists transport_payments/);
  assert.match(migration, /-- drop table if exists transport_day_overrides/);
});

test("override ย้อนหลังได้ในปีการศึกษาโดยบังคับเหตุผลและ audit แต่ไม่ล็อกวันนี้", () => {
  const start = executable.indexOf("create or replace function transport_day_overrides_guard");
  const end = executable.indexOf("create or replace function transport_payments_guard", start);
  const guard = executable.slice(start, end);
  assert.match(guard, /from academic_years where year = new\.year/);
  assert.match(guard, /new\.charge_date < v_start or new\.charge_date > v_end/);
  assert.match(guard, /btrim\(coalesce\(new\.reason, ''\)\) = ''/);
  assert.match(guard, /new\.overridden_by := auth\.uid\(\)/);
  assert.match(guard, /new\.overridden_at := now\(\)/);
  assert.doesNotMatch(guard, /v_today|current_date|Asia\/Bangkok/);
});

test("payment guard ล็อกวันและเช็คชื่อเฉพาะเงินสด พร้อมทางผ่าน remittance", () => {
  const start = executable.indexOf("create or replace function transport_payments_guard");
  const end = executable.indexOf("create or replace function pay_transport_from_savings", start);
  const guard = executable.slice(start, end);
  assert.match(guard, /\(now\(\) at time zone 'Asia\/Bangkok'\)::date/);
  assert.doesNotMatch(guard, /current_date/);
  assert.match(guard, /new\.pay_date <> v_today[^]*?not v_is_finance[^]*?backdate_reason/);
  assert.match(guard, /if new\.method = 'เงินสด' then[^]*?from daily_attendance[^]*?not in \('มา', 'มาสาย'\)/);
  assert.match(guard, /old\.remittance_id is null[^]*?new\.remittance_id is not null[^]*?return new/);
  assert.match(guard, /tg_op = 'DELETE'[^]*?old\.remittance_id is not null/);
  assert.doesNotMatch(guard, /ยอดค้าง|computeTransport/);
});

test("RPC หักออมและลงรับค่ารถ atomically แบบ security invoker โดยไม่เช็คยอดซ้ำ", () => {
  const start = executable.indexOf("create or replace function pay_transport_from_savings");
  const end = executable.indexOf("alter table transport_day_overrides enable row level security", start);
  const rpc = executable.slice(start, end);
  assert.match(rpc, /security invoker/);
  assert.doesNotMatch(rpc, /security definer/);
  assert.match(rpc, /insert into savings_txns \([^]*?'หักค่ารถ'/);
  assert.match(rpc, /insert into transport_payments \([^]*?'หักออมทรัพย์'/);
  assert.match(rpc, /returning id into v_savings_id[^]*?savings_txn_id[^]*?v_savings_id/);
  assert.doesNotMatch(rpc, /pg_advisory|v_balance|sum\s*\(/);
  assert.match(executable, /revoke all on function pay_transport_from_savings\(uuid,text,text,text,numeric,text\) from public, anon/);
  assert.match(executable, /grant execute on function pay_transport_from_savings\(uuid,text,text,text,numeric,text\) to authenticated/);
});

test("RLS สองตารางใช้ helper เงินรายห้องและแยก policy ทุกคำสั่ง", () => {
  for (const table of ["transport_day_overrides", "transport_payments"]) {
    assert.match(executable, new RegExp(`alter table ${table} enable row level security`));
    assert.match(executable, new RegExp(`create policy ${table}_select[^]*?for select[^]*?can_read_room_money\\(year, grade_level, classroom\\)`));
    assert.match(executable, new RegExp(`create policy ${table}_insert[^]*?for insert[^]*?has_department\\('การเงิน'\\)[^]*?is_room_money_handler\\(year, grade_level, classroom,`));
    assert.match(executable, new RegExp(`create policy ${table}_update[^]*?for update[^]*?using[^]*?with check`));
    assert.match(executable, new RegExp(`create policy ${table}_delete[^]*?for delete[^]*?is_admin\\(\\)`));
  }
  assert.doesNotMatch(executable, /for all/i);
});

test("สูตรรายวันคิด 3 วันที่มา ไม่คิดลาป่วย และรายงานวันธรรมดาที่ขาดเช็คชื่อ", () => {
  assert.deepEqual(TRANSPORT_CHARGE_STATUSES, ["มา", "มาสาย"]);
  const charges = computeTransportCharges({
    periods:[{ year:"2569", zone_id:"z1", billing_mode:"รายวัน", trip_mode:"ไป-กลับ", rate_amount:"30", start_date:"2026-06-01", end_date:"2026-06-05" }],
    attendance:[
      { attend_date:"2026-06-01", status:"มา" },
      { attend_date:"2026-06-02", status:"มาสาย" },
      { attend_date:"2026-06-03", status:"มา" },
      { attend_date:"2026-06-04", status:"ลาป่วย" }
    ],
    from:"2026-06-01", to:"2026-06-05"
  });
  assert.equal(charges.total, 90);
  assert.deepEqual(charges.days.map(row => row.amount), [30, 30, 30, 0, 0]);
  assert.deepEqual(charges.missingAttendanceDates, ["2026-06-05"]);
});

test("สูตรรายเดือนแยก announced:false จากยอดศูนย์ และเลือกเรตด้วย period.year", () => {
  const charges = computeTransportCharges({
    periods:[{ year:"2569", zone_id:"z1", billing_mode:"รายเดือน", trip_mode:"ขาเดียว", rate_amount:999, start_date:"2026-06-01", end_date:"2026-07-31" }],
    monthRates:[
      { year:"2569", ym:"2026-06-01", zone_id:"z1", trip_mode:"ขาเดียว", amount:"300" },
      { year:"2570", ym:"2026-07-01", zone_id:"z1", trip_mode:"ขาเดียว", amount:"888" }
    ],
    from:"2026-06-01", to:"2026-07-31"
  });
  assert.deepEqual(charges.months, [
    { ym:"2026-06-01", amount:300, announced:true, source:"month_rate" },
    { ym:"2026-07-01", amount:0, announced:false, source:"month_rate" }
  ]);
  assert.equal(charges.total, 300);
  assert.deepEqual(charges.unannouncedMonths, ["2026-07-01"]);
});

test("สูตรรายวันเปลี่ยนเป็นรายเดือนกลางเดือนไม่คิดซ้อน และ override ที่ anchor ชนะ", () => {
  const attendance = ["08","09","10","11","12"].map(day => ({ attend_date:`2026-06-${day}`, status:"มา" }));
  const charges = computeTransportCharges({
    periods:[
      { year:"2569", zone_id:"z1", billing_mode:"รายวัน", trip_mode:"ไป-กลับ", rate_amount:10, start_date:"2026-06-08", end_date:"2026-06-12" },
      { year:"2569", zone_id:"z1", billing_mode:"รายเดือน", trip_mode:"ไป-กลับ", rate_amount:500, start_date:"2026-06-15", end_date:"2026-06-30" }
    ],
    attendance,
    overrides:[{ charge_date:"2026-06-15", amount:240 }],
    monthRates:[{ year:"2569", ym:"2026-06-01", zone_id:"z1", trip_mode:"ไป-กลับ", amount:500 }],
    from:"2026-06-08", to:"2026-06-30"
  });
  assert.equal(charges.days.length, 5);
  assert.deepEqual(charges.months, [{ ym:"2026-06-01", amount:240, announced:true, source:"override" }]);
  assert.equal(charges.total, 290);
  assert.equal(computeTransportOutstanding(charges, [{ amount:40 }, { amount:"10" }]), 240);
});

test("หน้าครูกรองช่วงที่ server ใช้ fetchAllRows และแยกเงินสดจากหักออม", () => {
  for (const table of ["student_transport", "daily_attendance", "transport_day_overrides", "transport_month_rates", "transport_payments", "savings_txns", "transport_zones"]) {
    assert.match(page, new RegExp(`fetchAllRows\\(\\(\\) => sb\\.from\\("${table}"\\)`));
  }
  assert.match(page, /\.gte\("attend_date", yearRange\.start\)\.lte\("attend_date", today\)/);
  assert.match(page, /\.gte\("charge_date", yearRange\.start\)\.lte\("charge_date", today\)/);
  assert.match(page, /\.gte\("pay_date", yearRange\.start\)\.lte\("pay_date", today\)/);
  assert.match(page, /TRANSPORT_CHARGE_STATUSES\.includes\(state\.attendance\?\.status\)/);
  assert.match(page, /sb\.rpc\("pay_transport_room_batch"/);
  assert.match(page, /ออมทรัพย์เหลือ[^]*?ตัวเลือกหักออมทรัพย์ถูกปิด/);
  assert.match(page, /วันนี้[^]*?จึงรับเงินสดไม่ได้/);
  assert.match(page, /ฝ่ายการเงินยังไม่ประกาศยอด[^]*?ยอดดังกล่าวไม่ใช่ 0 บาท/);
});

test("QA 15: คำนวณประวัติด้วย student_id ข้ามห้อง และเตือนรายคนเมื่อห้องมีเช็คชื่อแต่เด็กไม่มีแถว", () => {
  const queryStart = page.indexOf("const [attendanceRes, roomAttendanceRes");
  const queryEnd = page.indexOf("const failed =", queryStart);
  assert.ok(queryStart >= 0 && queryEnd > queryStart, "หาชุด query ค่ารถไม่พบ");
  const queries = page.slice(queryStart, queryEnd);
  const firstAttendance = queries.indexOf('fetchAllRows(() => sb.from("daily_attendance")');
  const secondAttendance = queries.indexOf('fetchAllRows(() => sb.from("daily_attendance")', firstAttendance + 1);
  const overrideAt = queries.indexOf('fetchAllRows(() => sb.from("transport_day_overrides")');
  const rateAt = queries.indexOf('fetchAllRows(() => sb.from("transport_month_rates")');
  const paymentAt = queries.indexOf('fetchAllRows(() => sb.from("transport_payments")');
  const savingsAt = queries.indexOf('fetchAllRows(() => sb.from("savings_txns")');
  const studentAttendanceQuery = queries.slice(firstAttendance, secondAttendance);
  const roomAttendanceQuery = queries.slice(secondAttendance, overrideAt);
  const overrideQuery = queries.slice(overrideAt, rateAt);
  const paymentQuery = queries.slice(paymentAt, savingsAt);
  for (const studentQuery of [studentAttendanceQuery, overrideQuery, paymentQuery]) {
    assert.match(studentQuery, /\.eq\("year", currentYear\)\.in\("student_id", studentIds\)/);
    assert.doesNotMatch(studentQuery, /\.eq\("grade_level"|\.eq\("classroom"/);
  }
  assert.match(roomAttendanceQuery, /\.eq\("grade_level", selectedRoom\.grade_level\)\.eq\("classroom", selectedRoom\.classroom\)/);
  assert.doesNotMatch(roomAttendanceQuery, /\.in\("student_id"/);

  const helperStart = page.indexOf("function isWeekday(date)");
  const helperEnd = page.indexOf("function splitTransportRoster", helperStart);
  const helpers = page.slice(helperStart, helperEnd);
  const { missingStudentRoomDates } = new Function(`${helpers}; return { missingStudentRoomDates };`)();
  const roomRows = [
    { student_id:"other", attend_date:"2026-06-01" },
    { student_id:"moved", attend_date:"2026-06-02" },
    { student_id:"other", attend_date:"2026-06-06" }
  ];
  assert.deepEqual(missingStudentRoomDates(roomRows, "moved"), ["2026-06-01"]);
  assert.match(page, /อาจย้ายห้องระหว่างปีหรือเข้าเรียนภายหลัง/);
  assert.match(page, /ยอดค้างที่แสดงอาจไม่ครบ — ให้ฝ่ายการเงินตรวจ/);
});

test("QA 16: ผู้เลิกใช้รถที่ยังค้างอยู่ในกลุ่มพับได้และยังรับชำระได้", () => {
  const helperStart = page.indexOf("function splitTransportRoster(rows, states)");
  const helperEnd = page.indexOf("function buildState()", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "หาตัวแบ่งกลุ่มผู้ใช้รถไม่พบ");
  const splitTransportRoster = new Function(`${page.slice(helperStart, helperEnd)}; return splitTransportRoster;`)();
  const rows = [{ student_id:"active" }, { student_id:"stopped-due" }, { student_id:"stopped-paid" }];
  const states = new Map([
    ["active", { period:{ id:"p1" }, outstanding:100 }],
    ["stopped-due", { period:null, outstanding:75 }],
    ["stopped-paid", { period:null, outstanding:0 }]
  ]);
  const groups = splitTransportRoster(rows, states);
  assert.deepEqual(groups.active.map(row => row.student_id), ["active"]);
  assert.deepEqual(groups.stoppedOutstanding.map(row => row.student_id), ["stopped-due"]);
  assert.match(page, /<details id="stopped-group"/);
  assert.match(page, /เลิกใช้รถแล้ว · ค้างหรือมีรายการวันนี้ \$\{stoppedTransportRoster\.length\} คน/);
  assert.match(page, /renderStudentRows\(stoppedTransportRoster\)/);
  assert.match(page, /<select class="method"/);
  assert.match(page, /<option value="เงินสด"[^]*?>เงินสด<\/option>/);
  assert.match(page, /<option value="หักออมทรัพย์"[^]*?>หักออมทรัพย์<\/option>/);
  assert.doesNotMatch(page, /end_date === null/);
});

test("เมนู workflow ทางลัด login และ cache-buster ครบโดยหน้าครูไม่ถูกจำกัดฝ่ายการเงิน", () => {
  assert.match(page, /<title>รับเงินค่ารถ — CRS MIS<\/title>/);
  assert.match(page, /<h1>รับเงินค่ารถ<\/h1>/);
  assert.match(shell, /\["transport-entry\.html", "รับเงินค่ารถ"\]/);
  assert.match(shell, /"transport-entry\.html": \{\s*title: "รับเงินค่ารถ"/);
  const financeOnly = shell.match(/financeOnly: \[([^\]]+)\]/)?.[1] || "";
  assert.doesNotMatch(financeOnly, /transport-entry\.html/);
  assert.match(login, /finance: new Set\(\[[^]*?"transport-entry\.html"/);
  assert.match(overview, /href="transport-entry\.html"/);
  assert.doesNotMatch(overview, /href="transport-entry\.html" data-restricted/);
  const appVersions = execFileSync("sh", ["-c", "grep -rho 'app-shell\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], { cwd:root, encoding:"utf8" }).trim().split("\n").filter(Boolean);
  const clientVersions = execFileSync("sh", ["-c", "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], { cwd:root, encoding:"utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(appVersions, ["app-shell.js?v=20260831-1"]);
  assert.deepEqual(clientVersions, ["supabase-client.js?v=20260831-1"]);
});

test("module script ของหน้าใหม่คอมไพล์ผ่านและไม่ใช้ dialog ดิบ", () => {
  assert.match(page, /window\.crsAskConfirm/);
  assert.doesNotMatch(page, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  const match = page.match(/<script type="module">([^]*?)<\/script>/);
  assert.ok(match, "หา module script ไม่พบ");
  const body = match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m, "");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(body));
});
