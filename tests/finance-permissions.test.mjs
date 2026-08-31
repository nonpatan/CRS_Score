import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const shell = read("app-shell.js");
const report = read("finance/savings-report.html");
const overview = read("finance/index.html");

const marker = "-- ฝ่ายการเงิน — รัดสิทธิ์เงินรายห้อง (2026-08-16)";
const migrationAt = schema.indexOf(marker);
assert.ok(migrationAt >= 0, "หา migration รัดสิทธิ์การเงินไม่พบ");
const migration = schema.slice(migrationAt);

test("migration เริ่มด้วย lock timeout และแยก helper เงินออกจากเช็คชื่อ", () => {
  const firstSql = migration.split("\n").find(line => line.trim() && !line.trim().startsWith("--") && !line.trim().startsWith("="));
  assert.equal(firstSql?.trim(), "set lock_timeout = '5s';");
  const handlerAt = migration.indexOf("create or replace function is_room_money_handler(");
  const handlerEnd = migration.indexOf("create or replace function can_read_room_money(", handlerAt);
  const handler = migration.slice(handlerAt, handlerEnd);
  assert.match(handler, /coverage_assignments[\s\S]*?c\.cover_date = p_date/);
  assert.doesNotMatch(handler, /has_department\('บริหารทั่วไป'\)/);
  assert.match(schema.slice(0, migrationAt), /create or replace function is_homeroom_of\([\s\S]*?has_department\('บริหารทั่วไป'\)/);
  assert.match(schema.slice(0, migrationAt), /create or replace function is_homeroom_of_on\(/);
});

test("helper อ่าน short-circuit ฝ่ายการเงินก่อน และคนแทนอ่านย้อนหลังจากสิทธิ์วันนี้", () => {
  const readAt = migration.indexOf("create or replace function can_read_room_money(");
  const readEnd = migration.indexOf("revoke all on function can_read_room_money", readAt);
  const helper = migration.slice(readAt, readEnd);
  assert.match(helper, /select has_department\('การเงิน'\) or exists/);
  assert.ok(helper.indexOf("has_department('การเงิน')") < helper.indexOf("exists ("));
  assert.match(helper, /c\.cover_date = \(now\(\) at time zone 'Asia\/Bangkok'\)::date/);
  assert.match(migration, /revoke all on function can_read_room_money\(text,text,text\) from public, anon/);
});

test("policy เขียน 4 ตัวใช้ handler เงิน และ policy อ่าน 3 ตารางกรองรายห้อง", () => {
  const activePolicies = migration.slice(0, migration.indexOf("-- ย้อนกลับ migration นี้"));
  assert.equal((activePolicies.match(/is_room_money_handler\(year, grade_level, classroom, txn_date\)/g) || []).length, 3);
  assert.equal((activePolicies.match(/is_room_money_handler\(year, grade_level, classroom, request_date\)/g) || []).length, 3);
  for (const policy of ["savings_txns_select", "savings_withdrawals_select", "fee_remittances_select"]) {
    assert.match(migration, new RegExp(`create policy ${policy}[\\s\\S]*?using \\(can_read_room_money\\(year, grade_level, classroom\\)\\)`));
  }
  assert.match(migration, /when kind in \('ยอดยกมา', 'ถอน'\) then has_department\('การเงิน'\)/);
});

test("เมนูใช้ restricted gate ร่วม โดยหน้าบุคคลยังเรียก API เดิม", () => {
  assert.match(shell, /financeOnly: \["savings-payout\.html", "savings-remit\.html", "savings-opening\.html", "savings-report\.html", "transport-settings\.html", "transport-remit\.html", "transport-report\.html", "fee-assign\.html", "fee-payment\.html", "fee-settings\.html", "fee-stock\.html", "scholarship-grant\.html", "scholarship-sources\.html"\]/);
  assert.match(shell, /\.\.\.\(mod\.hrOnly \|\| \[\]\), \.\.\.\(mod\.financeOnly \|\| \[\]\)/);
  assert.match(client, /export function applyRestrictedMenuAccess\(allowed, keepHrefs = \[\]\)/);
  assert.match(client, /export function applyPersonnelMenuAccess\(canManageHr\) \{\s*applyRestrictedMenuAccess\(canManageHr\)/);
  for (const page of ["index", "savings-entry", "savings-opening", "savings-payout", "savings-remit", "savings-report", "savings-withdraw", "transport-entry", "transport-remit", "transport-report"]) {
    const source = read(`finance/${page}.html`);
    assert.match(source, /applyRestrictedMenuAccess\(canFinance, await financeMenuKeepHrefs\(canFinance, session\.user\.id\)\)/,
      `${page} ต้องเปิดเมนูครูประจำชั้นผ่าน helper กลาง`);
  }
  assert.match(read("finance/transport-settings.html"), /applyRestrictedMenuAccess\(canFinance, canUse \? HOMEROOM_FINANCE_LINKS : \[\]\)/);
});

test("หน้ารายงานและภาพรวมไม่แสดงตัวเลขระดับโรงเรียนให้ครูธรรมดา", () => {
  assert.match(report, /id="school-overview"/);
  assert.match(report, /el\("school-overview"\)\.hidden = true/);
  assert.match(report, /el\("room-summary-title"\)\.textContent = "ห้องของคุณ"/);
  assert.match(report, /แสดงเฉพาะห้องที่คุณรับผิดชอบ/);
  assert.match(report, /sb\.rpc\("can_read_room_money"/);
  assert.match(overview, /id="finance-status"/);
  assert.match(overview, /el\("finance-status"\)\.hidden = !canFinance/);
  assert.match(overview, /id="teacher-shortcut"/);
  assert.equal((overview.match(/data-restricted="1" hidden/g) || []).length, 11);
});

test("มี rollback คืน policy เดิมและลบ helper ใหม่ครบ", () => {
  assert.match(migration, /-- create policy savings_txns_select[\s\S]*?auth\.role\(\) = 'authenticated'/);
  assert.match(migration, /-- create policy savings_withdrawals_select[\s\S]*?auth\.role\(\) = 'authenticated'/);
  assert.match(migration, /-- create policy fee_remittances_select[\s\S]*?auth\.role\(\) = 'authenticated'/);
  assert.match(migration, /--.*is_homeroom_of_on\(year, grade_level, classroom, txn_date\)/);
  assert.match(migration, /--.*is_homeroom_of_on\(year, grade_level, classroom, request_date\)/);
  assert.match(migration, /-- drop function if exists can_read_room_money\(text,text,text\)/);
  assert.match(migration, /-- drop function if exists is_room_money_handler\(text,text,text,date\)/);
});
