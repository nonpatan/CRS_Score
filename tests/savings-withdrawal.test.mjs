import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const client = read("supabase-client.js");
const schema = read("schema.sql");
const teacher = read("finance/savings-withdraw.html");
const payout = read("finance/savings-payout.html");
const shell = read("app-shell.js");
const login = read("login.html");
const financeIndex = read("finance/index.html");

const formulaStart = client.indexOf("export function computeSavingsBalance");
const formulaEnd = client.indexOf("// รายชื่อนักเรียนที่ลงทะเบียน", formulaStart);
assert.ok(formulaStart >= 0 && formulaEnd > formulaStart, "หาสูตรออมทรัพย์กลางไม่พบ");
const formulaSource = client.slice(formulaStart, formulaEnd)
  .replaceAll("export function ", "function ")
  .replaceAll("export const ", "const ");
const { computeAvailableToWithdraw } = new Function(
  `${formulaSource}; return { computeAvailableToWithdraw };`
)();

// 🪤 ตัดขอบ **ท้าย** ของบล็อกด้วยเสมอ — schema.sql ต่อ migration ใหม่ท้ายไฟล์เรื่อย ๆ
// ถ้า slice(marker) ยาวถึงบรรทัดสุดท้าย assertion จะไปจับของ migration อื่นที่ยังไม่เกิด
// (เคยพังจริงตอนต่อ migration duty_swaps เข้าไป) แล้วฟ้องผิดโมดูลจนหาสาเหตุไม่เจอ
function slice15() {
  const start = schema.indexOf("-- ฝ่ายการเงิน Slice 1.5");
  const end = schema.indexOf("-- ฝ่ายการเงิน Slice 2", start);
  assert.ok(start >= 0, "หาบล็อก Slice 1.5 ไม่พบ");
  assert.ok(end > start, "หาขอบท้ายของ Slice 1.5 ไม่พบ — migration ถัดไปถูกย้าย/เปลี่ยนชื่อ");
  return schema.slice(start, end);
}

test("ยอดที่เบิกได้หักเฉพาะคิวรอจ่าย", () => {
  const txns = [
    { kind:"ยอดยกมา", amount:500 },
    { kind:"ถอน", amount:50 }
  ];
  const requests = [
    { status:"รอจ่าย", amount:300 },
    { status:"จ่ายแล้ว", amount:80 },
    { status:"ยกเลิก", amount:40 },
    { status:"รอจ่าย", amount:"50" }
  ];
  assert.equal(computeAvailableToWithdraw(txns, requests), 100);
  assert.equal(computeAvailableToWithdraw([], null), 0);
});

test("trigger เช็คชื่อเฉพาะการฝาก แต่วันต่อวันและยอดติดลบยังอยู่", () => {
  const start = schema.indexOf("create or replace function savings_txns_guard()");
  const end = schema.indexOf("drop trigger if exists savings_txns_guard_trg", start);
  const guard = schema.slice(start, end);
  assert.match(guard, /if new\.kind = 'ฝาก' then[\s\S]*?from daily_attendance[\s\S]*?v_status not in \('มา', 'มาสาย'\)[\s\S]*?end if;/);
  assert.match(guard, /if new\.txn_date > v_today then/);
  assert.match(guard, /if new\.kind in \('ถอน', 'หักค่ารถ'\) then/);
  assert.ok(guard.indexOf("if new.kind = 'ฝาก' then") < guard.indexOf("from daily_attendance"));
});

test("DDL คำขอเบิกมี constraints, trigger, RLS แยกรายคำสั่ง และ rollback", () => {
  const ddl = slice15();
  assert.match(ddl, /create table if not exists savings_withdrawals/);
  for (const name of ["sw_requester_ok", "sw_status_ok", "sw_amount_positive", "sw_parent_needs_consent", "sw_paid_needs_txn", "sw_cancel_needs_reason"]) {
    assert.match(ddl, new RegExp(`constraint ${name}`));
  }
  assert.match(ddl, /perform pg_advisory_xact_lock\(hashtext\(new\.student_id::text\)\)/);
  assert.match(ddl, /is_homeroom_of_on\(year, grade_level, classroom, request_date\)/);
  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(ddl, new RegExp(`savings_withdrawals_${operation}`));
  }
  assert.doesNotMatch(ddl, /savings_withdrawals[^;]*for all/i);
  assert.match(ddl, /-- drop table if exists savings_withdrawals;/);
});

test("หนึ่งคำขอสร้างรายการถอนได้ครั้งเดียวที่ฐานและกู้ orphan ด้วย withdrawal_id", () => {
  const ddl = slice15();
  assert.match(ddl, /alter table savings_txns add column if not exists withdrawal_id uuid;/);
  assert.match(ddl, /create unique index if not exists savings_txn_withdrawal_uniq\s+on savings_txns \(withdrawal_id\) where withdrawal_id is not null;/);
  assert.match(ddl, /-- drop index if exists savings_txn_withdrawal_uniq;/);
  assert.match(ddl, /-- alter table savings_txns drop column if exists withdrawal_id;/);
  assert.match(payout, /\.eq\("withdrawal_id", request\.id\)/);
  assert.match(payout, /withdrawal_id:request\.id/);
  assert.match(payout, /message\.includes\("savings_txn_withdrawal_uniq"\)/);
  assert.match(payout, /คำขอนี้ถูกจ่ายไปแล้ว กรุณาโหลดคิวล่าสุด/);
  assert.match(payout, /const withdrawalNote = request => `จ่ายตามคำขอเบิกวันที่ \$\{request\.request_date\}`/);
  assert.doesNotMatch(payout, /withdrawalNote = request => `[^`]*\$\{request\.id\}/);
});

test("หน้าแจ้งเบิกรองรับคนแทน แสดง 3 ยอด และไม่เก็บความยินยอม", () => {
  assert.match(teacher, /getMyCoverageFor\(today\)/);
  assert.match(teacher, /computeAvailableToWithdraw/);
  assert.match(teacher, />คงเหลือ</);
  assert.match(teacher, />รอจ่าย</);
  assert.match(teacher, />เบิกได้</);
  assert.match(teacher, /amount > available/);
  assert.match(teacher, /requester_type:requesterType/);
  assert.doesNotMatch(teacher, /student_confirmed/);
  assert.match(teacher, /cancel_reason:reason/);
  assert.match(teacher, /window\.crsAskConfirm/);
});

test("หน้าจ่ายจำกัดฝ่ายการเงินและสร้างรายการถอนก่อนผูกคำขอ", () => {
  assert.match(payout, /checkDepartment\("การเงิน"\)/);
  assert.match(payout, /\.eq\("status", "รอจ่าย"\)/);
  assert.match(payout, /student-confirmed/);
  assert.match(payout, /receiver-name/);
  assert.match(payout, /createdTxnByRequest/);
  const insertAt = payout.indexOf('sb.from("savings_txns").insert');
  const updateAt = payout.indexOf('sb.from("savings_withdrawals").update');
  assert.ok(insertAt >= 0 && updateAt >= 0 && insertAt > updateAt,
    "ตัวฟังก์ชัน update ประกาศก่อนใช้ได้ แต่ตอน handler ต้องเรียก insert ก่อน finishRequest");
  const handlerAt = payout.indexOf('el("queue-list").addEventListener');
  assert.ok(payout.indexOf('sb.from("savings_txns").insert', handlerAt) < payout.indexOf("await finishRequest", handlerAt));
  assert.match(payout, /kind:"ถอน"/);
  assert.match(payout, /เงินตัดจากสมุดแล้ว แต่คำขอยังค้าง/);
});

test("migration วิธีรับเงินต่อท้าย Slice เดิมและบังคับเงินสด/โอนที่ฐาน", () => {
  const marker = schema.indexOf("-- ฝ่ายการเงิน — วิธีรับเงินของคำขอเบิกออมทรัพย์");
  assert.ok(marker > schema.indexOf("-- ฝ่ายการเงิน Slice 4"), "migration ใหม่ต้องต่อท้าย Slice ที่ขึ้นฐานแล้ว");
  const nextMigration = schema.indexOf("-- ฝ่ายการเงิน — ปิดช่องโหว่ NULL ของ sw_transfer_needs_bank", marker);
  const ddl = schema.slice(marker, nextMigration > marker ? nextMigration : undefined);
  assert.match(ddl, /วิธีรับเงินของคำขอเบิกออมทรัพย์[^]*?set lock_timeout = '5s';/);
  assert.match(ddl, /add column if not exists payout_method text not null default 'เงินสด'/);
  for (const column of ["bank_name", "bank_account_name", "bank_account_no"]) {
    assert.match(ddl, new RegExp(`add column if not exists ${column} text`));
  }
  for (const constraint of ["sw_payout_method_ok", "sw_transfer_needs_bank", "sw_cash_has_no_bank"]) {
    assert.match(ddl, new RegExp(`add constraint ${constraint}`));
    assert.match(ddl, new RegExp(`-- alter table savings_withdrawals drop constraint if exists ${constraint};`));
  }
  const addConstraintsAt = ddl.indexOf("alter table savings_withdrawals\n  add constraint sw_payout_method_ok");
  assert.ok(addConstraintsAt >= 0, "หา add constraints ไม่พบ");
  for (const constraint of ["sw_payout_method_ok", "sw_transfer_needs_bank", "sw_cash_has_no_bank"]) {
    const dropAt = ddl.indexOf(`alter table savings_withdrawals drop constraint if exists ${constraint};`);
    assert.ok(dropAt >= 0 && dropAt < addConstraintsAt, `${constraint} ต้อง drop ก่อน add เพื่อให้รัน migration ซ้ำได้`);
  }
  assert.match(ddl, /bank_account_no ~ '\^\[0-9\]\{8,20\}\$'/);
  assert.match(ddl, /payout_method <> 'เงินสด'[^]*?bank_name is null and bank_account_name is null and bank_account_no is null/);
  assert.doesNotMatch(ddl, /(?:create|drop|alter) policy/i, "รอบนี้ห้ามแตะ RLS");
});

test("นิยามสุดท้ายของ sw_transfer_needs_bank กัน NULL ครบทั้งสามช่อง", () => {
  const marker = "\nalter table savings_withdrawals add constraint sw_transfer_needs_bank check (";
  const start = schema.lastIndexOf(marker);
  assert.ok(start >= 0, "หานิยามสุดท้ายของ sw_transfer_needs_bank ไม่พบ");
  const end = schema.indexOf("\n);", start);
  assert.ok(end > start, "หาจุดจบของ sw_transfer_needs_bank ไม่พบ");
  const latest = schema.slice(start, end + 3);
  assert.match(latest, /btrim\(coalesce\(bank_name, ''\)\) <> ''/);
  assert.match(latest, /btrim\(coalesce\(bank_account_name, ''\)\) <> ''/);
  assert.match(latest, /coalesce\(bank_account_no, ''\) ~ '\^\[0-9\]\{8,20\}\$'/);
});

test("guard ใหม่คงตรรกะเดิมและล็อกบัญชีของคำขอที่จ่ายแล้ว", () => {
  const blockAt = start => {
    const end = schema.indexOf("\n$$;", start);
    assert.ok(start >= 0 && end > start);
    return schema.slice(start, end + 4);
  };
  const originalStart = schema.indexOf("create or replace function savings_withdrawals_guard()");
  const newStart = schema.lastIndexOf("\ncreate or replace function savings_withdrawals_guard()") + 1;
  const original = blockAt(originalStart);
  const updated = blockAt(newStart);
  const bankLock = /\n  -- หลักฐานบัญชีปลายทาง[^]*?\n  end if;\n/;
  assert.match(updated, bankLock);
  assert.match(updated, /tg_op = 'UPDATE' and old\.status = 'จ่ายแล้ว'/);
  for (const column of ["payout_method", "bank_name", "bank_account_name", "bank_account_no"]) {
    assert.match(updated, new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  }
  assert.match(updated, /คำขอที่จ่ายแล้ว แก้วิธีรับเงินหรือบัญชีปลายทางไม่ได้/);
  assert.equal(updated.replace(bankLock, ""), original, "นอกเหนือจาก bank lock ต้องคง guard เดิมทุกบรรทัด");
  assert.match(schema.slice(newStart), /-- create or replace function savings_withdrawals_guard\(\)[^]*?--   new\.updated_at := now\(\);[^]*?-- \$\$;/);
});

test("หน้าแจ้งเบิกรับบัญชีโอน ตรวจค่า ส่ง null สำหรับเงินสด และล้างฟอร์ม", () => {
  for (const id of ["payout-method", "transfer-fields", "bank-name", "bank-other-field", "bank-other", "account-name", "account-no"]) {
    assert.match(teacher, new RegExp(`id="${id}"`));
  }
  for (const bank of ["ธนาคารกรุงไทย", "ธนาคารทหารไทยธนชาต (ttb)", "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)", "ธนาคารยูโอบี"]) {
    assert.ok(teacher.includes(`"${bank}"`), `ขาดธนาคาร ${bank}`);
  }
  assert.match(teacher, /const accountNo = el\("account-no"\)\.value\.replace\(\/\\D\/g, ""\)/);
  assert.match(teacher, /กรุณาเลือกหรือระบุธนาคารปลายทาง/);
  assert.match(teacher, /กรุณากรอกชื่อบัญชีปลายทาง/);
  assert.match(teacher, /เลขที่บัญชีต้องเป็นตัวเลข 8–20 หลัก/);
  assert.match(teacher, /payout_method:payoutMethod, bank_name:isTransfer \? bankName : null/);
  assert.match(teacher, /bank_account_name:isTransfer \? accountName : null, bank_account_no:isTransfer \? accountNo : null/);
  assert.match(teacher, /isTransfer \? `โอนเข้า \$\{bankName\} · \$\{accountName\} · \$\{accountNo\}` : "รับเป็นเงินสดที่ฝ่ายการเงิน"/);
  assert.match(teacher, /if \(!isTransfer\) clearTransferFields\(\)/);
  assert.match(teacher, /el\("payout-method"\)\.value = "เงินสด";[^]*?el\("transfer-fields"\)\.hidden = true;[^]*?clearTransferFields\(\)/);
});

test("หน้าแจ้งเบิกล้างบัญชีคนเดิมก่อนเติมของนักเรียนคนใหม่", () => {
  const select = teacher.match(/\.select\("([^"]*payout_method[^"]*)"\)/)?.[1] || "";
  for (const column of ["payout_method", "bank_name", "bank_account_name", "bank_account_no"]) assert.ok(select.includes(column));
  assert.match(teacher, /row\.payout_method === "โอน"[^]*?โอน \$\{esc\(row\.bank_name[^]*?\$\{esc\(row\.bank_account_no/);
  const autofillStart = teacher.indexOf("function fillLatestTransfer");
  const autofillEnd = teacher.indexOf("function studentNumbers", autofillStart);
  const autofill = teacher.slice(autofillStart, autofillEnd);
  assert.doesNotMatch(autofill, /some\(id => el\(id\)\.value\.trim\(\)\)\) return/);
  assert.match(autofill, /filter\(row => row\.payout_method === "โอน" && row\.status !== "ยกเลิก"\)/);
  assert.match(autofill, /String\(b\.requested_at[^]*?localeCompare\(String\(a\.requested_at/);
  assert.match(autofill, /BANKS\.includes\(latest\.bank_name\)/);
  assert.match(autofill, /el\("bank-name"\)\.value = "อื่น ๆ"/);
  const handlerStart = teacher.indexOf('el("student-select").addEventListener("change"');
  const handlerEnd = teacher.indexOf('el("requester-type").addEventListener', handlerStart);
  const handler = teacher.slice(handlerStart, handlerEnd);
  assert.match(handler, /el\("payout-method"\)\.value = "เงินสด"/);
  assert.match(handler, /el\("transfer-fields"\)\.hidden = true/);
  assert.ok(handler.indexOf("clearTransferFields()") < handler.indexOf("fillLatestTransfer("),
    "ต้องล้างบัญชีของนักเรียนคนก่อนก่อนเติมบัญชีของคนใหม่");
});

test("autofill ไม่ใช้คำขอยกเลิกและเปลี่ยนบัญชีตามนักเรียน", () => {
  const helperStart = teacher.indexOf("function clearTransferFields");
  const helperEnd = teacher.indexOf("function studentNumbers", helperStart);
  const elements = Object.fromEntries([
    "bank-name", "bank-other", "account-name", "account-no", "bank-other-field",
    "payout-method", "transfer-fields"
  ].map(id => [id, { value:"", hidden:true }]));
  const el = id => elements[id];
  const BANKS = ["ธนาคารกรุงไทย"];
  const requestsByStudent = new Map([
    ["student-a", [{ payout_method:"โอน", status:"รอจ่าย", requested_at:"2026-08-15T10:00:00Z",
      bank_name:"ธนาคารกรุงไทย", bank_account_name:"บัญชี ก", bank_account_no:"11111111" }]],
    ["student-b", [
      { payout_method:"โอน", status:"ยกเลิก", requested_at:"2026-08-16T10:00:00Z",
        bank_name:"ธนาคารกรุงไทย", bank_account_name:"บัญชีผิด", bank_account_no:"99999999" },
      { payout_method:"โอน", status:"รอจ่าย", requested_at:"2026-08-14T10:00:00Z",
        bank_name:"ธนาคารกรุงไทย", bank_account_name:"บัญชี ข", bank_account_no:"22222222" }
    ]],
    ["student-c", [{ payout_method:"โอน", status:"ยกเลิก", requested_at:"2026-08-16T10:00:00Z",
      bank_name:"ธนาคารกรุงไทย", bank_account_name:"บัญชียกเลิก", bank_account_no:"33333333" }]]
  ]);
  const helpers = new Function("el", "BANKS", "requestsByStudent",
    `${teacher.slice(helperStart, helperEnd)}; return { clearTransferFields, fillLatestTransfer };`
  )(el, BANKS, requestsByStudent);

  helpers.fillLatestTransfer("student-a");
  assert.equal(elements["account-name"].value, "บัญชี ก");
  helpers.clearTransferFields();
  helpers.fillLatestTransfer("student-b");
  assert.equal(elements["account-name"].value, "บัญชี ข");
  assert.equal(elements["account-no"].value, "22222222");
  helpers.clearTransferFields();
  helpers.fillLatestTransfer("student-c");
  assert.equal(elements["account-name"].value, "");
  assert.equal(elements["account-no"].value, "");
});

test("หน้าจ่ายแยกเงินสด/โอน ใช้ชื่อบัญชี และไม่เก็บเลขเต็มในสมุด", () => {
  const select = payout.match(/\.select\("([^"]*payout_method[^"]*)"\)/)?.[1] || "";
  for (const column of ["payout_method", "bank_name", "bank_account_name", "bank_account_no"]) assert.ok(select.includes(column));
  assert.match(payout, /const primaryLabel = isTransfer \? "ยืนยันว่าโอนแล้ว" : "ยืนยันและจ่ายเงิน"/);
  assert.match(payout, /retryTxnId \? "ผูกคำขออีกครั้ง" : primaryLabel/);
  assert.match(payout, /button\.textContent = primaryLabel/);
  assert.match(payout, /โอนเข้าบัญชี[^]*?esc\(row\.bank_name[^]*?ชื่อบัญชี[^]*?esc\(row\.bank_account_name[^]*?เลขที่[^]*?esc\(row\.bank_account_no/);
  assert.match(payout, /<span class="meta">รับเป็นเงินสด<\/span>/);
  assert.match(payout, /const receivedByName = isTransfer[^]*?request\.bank_account_name/);
  assert.match(payout, /if \(isParent && !confirmed\)/);
  assert.match(payout, /isTransfer \? `โอนเข้า \$\{request\.bank_name\} · \$\{request\.bank_account_name\} · \$\{request\.bank_account_no\}`/);
  assert.match(payout, /เลขที่ลงท้าย \$\{String\(request\.bank_account_no \|\| ""\)\.slice\(-4\)\}/);
  const noteStart = payout.indexOf("const withdrawalNote");
  const noteEnd = payout.indexOf("async function recoverOrphanTxn", noteStart);
  assert.doesNotMatch(payout.slice(noteStart, noteEnd), /เลขที่ \$\{request\.bank_account_no\}/);
});

test("module scripts ของหน้าแจ้งและหน้าจ่ายคอมไพล์ผ่าน", () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  for (const html of [teacher, payout]) {
    const match = html.match(/<script type="module">([^]*?)<\/script>/);
    assert.ok(match, "หา module script ไม่พบ");
    const body = match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m, "");
    assert.doesNotThrow(() => new AsyncFunction(body));
  }
});

test("ชื่อหน้า เมนู ทางเข้าภาพรวม และ allowlist ตรงกัน", () => {
  for (const [html, filename, title] of [
    [teacher, "savings-withdraw.html", "แจ้งเบิกออมทรัพย์"],
    [payout, "savings-payout.html", "จ่ายเงินออมทรัพย์"]
  ]) {
    assert.match(html, new RegExp(`<title>${title} — CRS MIS</title>`));
    assert.match(html, new RegExp(`<h1>${title}</h1>`));
    assert.match(shell, new RegExp(`\\["${filename.replace(".", "\\.")}", "${title}"\\]`));
    assert.match(shell, new RegExp(`"${filename.replace(".", "\\.")}": \\{\\s*title: "${title}"`));
    assert.match(login, new RegExp(`"${filename.replace(".", "\\.")}"`));
    assert.match(financeIndex, new RegExp(`href="${filename.replace(".", "\\.")}"`));
  }
});

test("cache-buster ของไฟล์กลางมีค่าเดียวทั้งโครงการ", () => {
  const htmlFiles = [];
  const walk = url => {
    for (const entry of readdirSync(url, { withFileTypes:true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), url);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".html")) htmlFiles.push(readFileSync(child, "utf8"));
    }
  };
  walk(root);
  const all = htmlFiles.join("\n");
  assert.deepEqual([...new Set(all.match(/supabase-client\.js\?v=[0-9a-z-]+/g))], ["supabase-client.js?v=20260831-1"]);
  assert.deepEqual([...new Set(all.match(/app-shell\.js\?v=[0-9a-z-]+/g))], ["app-shell.js?v=20260831-1"]);
});
