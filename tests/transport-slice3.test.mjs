import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const page = read("finance/transport-settings.html");
const shell = read("app-shell.js");
const login = read("login.html");
const overview = read("finance/index.html");

const marker = "-- ฝ่ายการเงิน ค่ารถรับส่ง Slice 3";
const migrationAt = schema.indexOf(marker);
assert.ok(migrationAt >= 0, "หา migration ค่ารถ Slice 3 ไม่พบ");
const nextMarker = "-- ฝ่ายการเงิน ค่ารถรับส่ง Slice 4";
const nextMigrationAt = schema.indexOf(nextMarker, migrationAt);
assert.ok(nextMigrationAt > migrationAt, "หา migration ค่ารถ Slice 4 ที่ต่อจาก Slice 3 ไม่พบ");
const migration = schema.slice(migrationAt, nextMigrationAt);
const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

test("migration เริ่มด้วย lock timeout และมี rollback", () => {
  const firstSql = migration.split("\n").find(line => line.trim() && !line.trim().startsWith("--") && !line.trim().startsWith("="));
  assert.equal(firstSql?.trim(), "set lock_timeout = '5s';");
  assert.match(migration, /create extension if not exists btree_gist/);
  assert.match(migration, /ย้อนกลับ migration นี้/);
  for (const table of ["transport_month_rates", "transport_months", "student_transport", "transport_zones"]) {
    assert.match(migration, new RegExp(`-- drop table if exists ${table}`));
  }
});

test("schema มี 4 ตารางและบังคับ snapshot/ช่วงไม่ทับกันที่ฐาน", () => {
  for (const table of ["transport_zones", "student_transport", "transport_months", "transport_month_rates"]) {
    assert.match(executable, new RegExp(`create table if not exists ${table} \\(`));
  }
  assert.match(executable, /daily_round\s+numeric\(10,2\) not null/);
  assert.match(executable, /daily_one_way\s+numeric\(10,2\) not null/);
  assert.match(executable, /monthly_round\s+numeric\(10,2\) not null/);
  assert.match(executable, /monthly_one_way\s+numeric\(10,2\) not null/);
  assert.match(executable, /rate_amount\s+numeric\(10,2\) not null/);
  assert.match(executable, /student_transport_no_overlap exclude using gist/);
  assert.match(executable, /daterange\(start_date, coalesce\(end_date, 'infinity'::date\), '\[\]'\) with &&/);
  assert.match(executable, /transport_months_open_days_ok check \(open_days between 0 and 31\)/);
  assert.match(executable, /create table if not exists transport_months \([^]*?primary key \(year, ym\)/);
  assert.match(executable, /create table if not exists transport_month_rates \([^]*?year\s+text not null/);
  assert.match(executable, /primary key \(year, ym, zone_id, trip_mode\)/);
  assert.match(executable, /foreign key \(year, ym\)\s+references transport_months\(year, ym\)/);
  assert.doesNotMatch(executable, /references transport_months\(ym\)/);
});

test("RLS ทั้ง 4 ตารางแยก select/insert/update/delete และไม่ใช้ for all", () => {
  for (const table of ["transport_zones", "student_transport", "transport_months", "transport_month_rates"]) {
    assert.match(executable, new RegExp(`alter table ${table} enable row level security`));
    assert.match(executable, new RegExp(`create policy ${table}_select[^]*?for select[^]*?auth\\.role\\(\\) = 'authenticated'`));
    assert.match(executable, new RegExp(`create policy ${table}_insert[^]*?for insert[^]*?has_department\\('การเงิน'\\)`));
    assert.match(executable, new RegExp(`create policy ${table}_update[^]*?for update[^]*?using \\(has_department\\('การเงิน'\\)\\)[^]*?with check \\(has_department\\('การเงิน'\\)\\)`));
    assert.match(executable, new RegExp(`create policy ${table}_delete[^]*?for delete using \\(is_admin\\(\\)\\)`));
  }
  assert.doesNotMatch(executable, /for all/i);
  assert.doesNotMatch(executable, /savings_txns|savings_withdrawals|fee_remittances/);
});

test("หน้าตั้งค่ากันสิทธิ์ฝ่ายอื่นและใช้รายชื่อ/การแบ่งหน้าของกลาง", () => {
  assert.match(page, /checkDepartment\("การเงิน"\)/);
  assert.match(page, /applyRestrictedMenuAccess\(canFinance, canUse \? HOMEROOM_FINANCE_LINKS : \[\]\)/);
  // 2026-08-24: หน้านี้ไม่ใช่ของฝ่ายการเงินอย่างเดียวแล้ว — ครูประจำชั้นผูกโซนห้องตัวเองได้
  // ข้อความปฏิเสธจึงเปลี่ยนไป · เงื่อนไขสิทธิ์ตัวจริงอยู่ที่ tests/transport-homeroom-assign.test.mjs
  assert.match(page, /เปิดหน้าตั้งค่าค่ารถไม่ได้/);
  assert.match(page, /const canUse = canFinance \|\| myHomerooms\.length > 0/);
  assert.match(page, /getStudentPlacements\(currentYear\)/);
  assert.match(page, /activePlacements\(placements\)/);
  assert.match(page, /fetchAllRows\(\(\) => sb\.from\("student_transport"\)/);
  assert.doesNotMatch(page, /students\.classroom|from\("students"\)/);
});

test("การผูกเด็กแช่เรต และการเปลี่ยนปิดแถวเดิมก่อนเปิดแถวใหม่", () => {
  assert.match(page, /rate_amount:rate/);
  assert.match(page, /แช่เรต/);
  assert.match(page, /update\(\{ end_date:oldEnd/);
  assert.match(page, /sb\.from\("student_transport"\)\.insert\(payload\)/);
  assert.match(page, /update\(\{ end_date:null/);
  assert.match(page, /เลิกใช้รถ/);
  assert.doesNotMatch(page, /\.delete\(\)/);
});

test("เดือนเดียวกันข้ามปีการศึกษาแยกด้วย composite key ทุกชั้น", () => {
  assert.match(page, /from\("transport_month_rates"\)[^\n]*\.eq\("year", currentYear\)\.eq\("ym", ym\)/);
  assert.match(page, /\["year", "ym", "zone_id", "trip_mode"\]/);
  assert.match(page, /from\("transport_months"\)[^\n]*\.eq\("year", currentYear\)/);
  assert.match(page, /rows\.push\(\{ year:currentYear, ym:selectedMonth/);
  assert.match(page, /const monthPayload = \{ ym:selectedMonth, year:currentYear/);
  assert.match(page, /onConflict:"year,ym"/);
  assert.match(page, /onConflict:"year,ym,zone_id,trip_mode"/);
  assert.doesNotMatch(page, /onConflict:"ym"/);
  assert.doesNotMatch(page, /onConflict:"ym,zone_id,trip_mode"/);
});

test("รายการเดือนและวัน จ.–ศ. ตัดด้วย academicYearRange โดยช่องยังแก้ได้", () => {
  assert.match(page, /academicYearRange\(currentYear, years\)/);
  assert.match(page, /monthKeys\(currentRange\(\)\)/);
  assert.match(page, /weekdayCount\(selectedMonth, currentRange\(\)\)/);
  assert.match(page, /id="weekday-hint"/);
  assert.match(page, /เดือนนี้มีวันจันทร์–ศุกร์ในปีการศึกษา \$\{suggestedOpenDays\} วัน — แก้ได้ถ้ามีปิดเทอมหรือวันหยุดพิเศษ/);
  assert.doesNotMatch(page, /id="open-days"[^>]*disabled/);
  assert.match(page, /เดือนที่โรงเรียนเปิดไม่ครบ ให้กรอกยอดตามจริงที่จะเก็บ/);
  assert.match(page, /ยังไม่ประกาศ/);
  assert.doesNotMatch(page, /2569|2026-05-01|2026-05-18/);

  const start = page.indexOf("function monthKeys(range)");
  const end = page.indexOf("function renderMonthOptions()", start);
  const source = page.slice(start, end);
  const { monthKeys, weekdayCount } = new Function(`${source}; return { monthKeys, weekdayCount };`)();
  assert.deepEqual(monthKeys({ start:"2026-05-18", end:"2027-05-17" }), [
    "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01",
    "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01"
  ]);
  assert.equal(weekdayCount("2026-05-01", { start:"2026-05-18", end:"2027-05-17" }), 10);
  assert.equal(weekdayCount("2027-05-01", { start:"2026-05-18", end:"2027-05-17" }), 11);
  assert.equal(weekdayCount("2026-06-01", { start:"2026-05-18", end:"2027-05-17" }), 22);
  assert.equal(weekdayCount("2026-04-01", { start:"2026-05-18", end:"2027-05-17" }), 0);
});

test("renderMonthEditor ไม่มีพารามิเตอร์หลงเหลือ", () => {
  assert.match(page, /function renderMonthEditor\(\)/);
  assert.match(page, /renderMonthEditor\(\);/);
  assert.doesNotMatch(page, /function renderMonthEditor\(month\)/);
});

test("เมนู workflow ทางลัด และ login allowlist มีหน้าตั้งค่าค่ารถครบ", () => {
  assert.match(page, /<title>ตั้งค่าค่ารถ — CRS MIS<\/title>/);
  assert.match(page, /<h1>ตั้งค่าค่ารถ<\/h1>/);
  assert.match(shell, /\["transport-settings\.html", "ตั้งค่าค่ารถ"\]/);
  assert.match(shell, /"transport-settings\.html": \{\s*title: "ตั้งค่าค่ารถ"/);
  assert.match(shell, /financeOnly: \[[^\]]*"transport-settings\.html"/);
  assert.match(login, /finance: new Set\(\[[^]*?"transport-settings\.html"/);
  assert.match(overview, /href="transport-settings\.html" data-restricted="1" hidden/);
});

test("หน้าใหม่ใช้มาตรฐาน UI และ cache-buster เหลือค่าเดียว", () => {
  assert.match(page, /--ink:#1f2a2e; --muted:#5f6b70; --line:#dfe4e3; --teal:#0f6e56/);
  assert.match(page, /font-size:16px/);
  assert.match(page, /min-height:44px/);
  assert.match(page, /window\.crsAskConfirm/);
  assert.doesNotMatch(page, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  const versions = execFileSync("sh", ["-c", "grep -rho 'app-shell\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], { cwd:root, encoding:"utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(versions, ["app-shell.js?v=20260831-1"]);
});

test("โมดูลสคริปต์ของหน้าคอมไพล์ผ่าน", () => {
  const match = page.match(/<script type="module">([^]*?)<\/script>/);
  assert.ok(match, "หา module script ไม่พบ");
  const body = match[1].replace(/^import \{[^]*?\} from "[^\"]+";\s*/m, "");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(body));
});
