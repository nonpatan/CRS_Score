import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const remit = read("finance/savings-remit.html");

const marker = "-- ฝ่ายการเงิน — แก้รายการฝากที่กรอกผิด + ปลดล็อกรอบส่งเงิน (2026-08-16)";
const migrationAt = schema.indexOf(marker);
assert.ok(migrationAt >= 0, "หา migration แก้รายการฝากไม่พบ");
const migration = schema.slice(migrationAt);

test("migration ใหม่เริ่มด้วย lock timeout และเก็บ audit การปลดล็อกครบ", () => {
  const firstSql = migration.split("\n").find(line => line.trim() && !line.trim().startsWith("--") && !line.trim().startsWith("="));
  assert.equal(firstSql?.trim(), "set lock_timeout = '5s';");
  for (const column of ["status text not null default 'ยืนยันแล้ว'", "unlocked_by uuid", "unlocked_at timestamptz", "unlock_reason text"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /constraint fr_status_ok[\s\S]*?status in \('ยืนยันแล้ว', 'ปลดล็อก'\)/);
  assert.match(migration, /constraint fr_unlock_needs_trail[\s\S]*?unlocked_by is not null[\s\S]*?unlocked_at is not null[\s\S]*?unlock_reason/);
});

test("RPC ปลดล็อกเป็น transaction เดียว และ admin เท่านั้น", () => {
  const rpcAt = migration.indexOf("create or replace function unlock_savings_remittance(");
  const rpcEnd = migration.indexOf("revoke all on function unlock_savings_remittance", rpcAt);
  const rpc = migration.slice(rpcAt, rpcEnd);
  assert.match(rpc, /if not is_admin\(\) then[\s\S]*?ได้เฉพาะผู้ดูแลระบบ/);
  assert.doesNotMatch(rpc, /has_department\('การเงิน'\)/);
  assert.match(rpc, /btrim\(coalesce\(p_reason, ''\)\) = ''/);
  assert.match(rpc, /select \* into v_row from fee_remittances[\s\S]*?for update/);
  assert.match(rpc, /update savings_txns set remittance_id = null where remittance_id = p_remittance_id/);
  assert.match(rpc, /get diagnostics v_count = row_count/);
  assert.match(rpc, /set status = 'ปลดล็อก', unlocked_by = auth\.uid\(\)[\s\S]*?unlock_reason = p_reason/);
  assert.match(rpc, /รอบนี้ถูกปลดล็อกไปแล้วเมื่อ/);
});

test("trigger เปิดทางแคบเฉพาะ admin เคลียร์ remittance_id โดยธุรกรรมไม่เปลี่ยน", () => {
  const guardAt = migration.indexOf("create or replace function savings_txns_guard()");
  const guardEnd = migration.indexOf("create or replace function unlock_savings_remittance", guardAt);
  const guard = migration.slice(guardAt, guardEnd);
  const bypassAt = guard.indexOf("old.remittance_id is not null");
  const lockAt = guard.indexOf("raise exception 'รายการนี้ส่งเงินและยืนยันยอดแล้ว");
  assert.ok(bypassAt >= 0 && bypassAt < lockAt);
  assert.match(guard, /old\.remittance_id is not null[\s\S]*?new\.remittance_id is null[\s\S]*?is_admin\(\)/);
  for (const field of ["student_id", "year", "grade_level", "classroom", "txn_date", "kind", "amount", "note", "backdate_reason", "withdrawal_id", "recorded_by", "recorded_at"]) {
    assert.match(guard, new RegExp(`new\\.${field} is not distinct from old\\.${field}`));
  }
  assert.match(guard, /new\.txn_date <> v_today[\s\S]*?not v_is_finance[\s\S]*?บันทึกได้เฉพาะรายการของวันนี้/);
  assert.match(guard, /new\.kind = 'ฝาก'[\s\S]*?from daily_attendance/);
  assert.match(guard, /new\.kind in \('ถอน', 'หักค่ารถ'\)[\s\S]*?v_balance < new\.amount/);
});

test("หน้ารับเงินแก้ได้เฉพาะยอดของรายการที่ยังไม่ส่ง และบังคับเหตุผล", () => {
  assert.match(remit, /data-edit-txn=/);
  assert.match(remit, /\.update\(\{ amount, backdate_reason:reason \}\)/);
  assert.match(remit, /\.eq\("id", activeTxn\.id\)[\s\S]*?\.is\("remittance_id", null\)/);
  assert.match(remit, /amount <= 0[\s\S]*?ยอดฝากต้องมากกว่า 0 บาท/);
  assert.match(remit, /if \(!reason\)[\s\S]*?ต้องระบุเหตุผลที่แก้ยอด/);
  assert.doesNotMatch(remit, /\.update\(\{[^}]*txn_date/);
  assert.doesNotMatch(remit, /\.update\(\{[^}]*student_id/);
});

test("admin เท่านั้นที่เห็นปุ่มปลดล็อก และต้องยืนยันผลกระทบพร้อมเหตุผล", () => {
  assert.match(remit, /canAdmin && !unlocked[\s\S]*?data-unlock-remittance/);
  assert.match(remit, /canAdmin = profile\?\.role === "admin"/);
  assert.match(remit, /remittance\.txn_count[\s\S]*?formatMoney\(remittance\.expected_total\)[\s\S]*?requireText:"ปลดล็อก"/);
  assert.match(remit, /sb\.rpc\("unlock_savings_remittance", \{ p_remittance_id:remittance\.id, p_reason:reason \}\)/);
  assert.match(remit, /if \(!reason\)[\s\S]*?ต้องระบุเหตุผลที่ปลดล็อก/);
});

test("ประวัติเก็บรอบเก่าและ trail การปลดล็อก ส่วนลิงก์ยอดไม่ตรงเลื่อนในหน้าเดียว", () => {
  for (const field of ["status", "unlocked_by", "unlocked_at", "unlock_reason"]) assert.match(remit, new RegExp(field));
  assert.match(remit, /getStaffNamesByUser/);
  assert.doesNotMatch(remit, /from\("profiles"\)\.select\("id,name"\)/);
  assert.match(remit, /profileNames\.get\(row\.unlocked_by\) \|\| "ไม่พบชื่อผู้ปลด"/);
  assert.doesNotMatch(remit, /profileNames\.get\(row\.unlocked_by\) \|\| row\.unlocked_by/);
  assert.match(remit, /ปลดโดย \$\{esc\(unlocker\)\}[\s\S]*?เหตุผล: \$\{esc\(row\.unlock_reason\)\}/);
  assert.match(remit, /href="#txn-list"/);
  assert.doesNotMatch(remit, /href="savings-entry\.html">ยอดไม่ตรง/);
});

test("มี rollback ถอด RPC, constraints, columns และชี้บล็อก trigger เดิมชัดเจน", () => {
  assert.match(migration, /-- drop function if exists unlock_savings_remittance\(uuid, text\)/);
  assert.match(migration, /-- alter table fee_remittances drop constraint if exists fr_unlock_needs_trail/);
  assert.match(migration, /-- alter table fee_remittances drop constraint if exists fr_status_ok/);
  for (const column of ["unlock_reason", "unlocked_at", "unlocked_by", "status"]) {
    assert.match(migration, new RegExp(`-- alter table fee_remittances drop column if exists ${column}`));
  }
  assert.match(migration, /คืน savings_txns_guard\(\) ด้วยบล็อกเดิมใน Slice 2/);
});

test("cache-buster ไฟล์กลางยังมีค่าเดียวและไม่ได้บัมพ์โดยไม่จำเป็น", () => {
  const pages = [];
  const walk = url => {
    for (const entry of readdirSync(url, { withFileTypes:true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), url);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".html")) pages.push(readFileSync(child, "utf8"));
    }
  };
  walk(root);
  const all = pages.join("\n");
  assert.deepEqual([...new Set(all.match(/supabase-client\.js\?v=[0-9a-z-]+/g))], ["supabase-client.js?v=20260831-1"]);
  assert.deepEqual([...new Set(all.match(/app-shell\.js\?v=[0-9a-z-]+/g))], ["app-shell.js?v=20260831-1"]);
});
