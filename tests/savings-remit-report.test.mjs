import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const client = read("supabase-client.js");
const schema = read("schema.sql");
const remit = read("finance/savings-remit.html");
const report = read("finance/savings-report.html");
const overview = read("finance/index.html");
const generalOverview = read("general-affairs/index.html");
const shell = read("app-shell.js");
const login = read("login.html");

const formulaStart = client.indexOf("export function computeSavingsBalance");
const formulaEnd = client.indexOf("// รายชื่อนักเรียนที่ลงทะเบียน", formulaStart);
assert.ok(formulaStart >= 0 && formulaEnd > formulaStart);
const formulaSource = client.slice(formulaStart, formulaEnd)
  .replaceAll("export function ", "function ")
  .replaceAll("export const ", "const ");
const { computeUnremitted, summarizeSavingsReport } = new Function(
  `${formulaSource}; return { computeUnremitted, summarizeSavingsReport };`
)();

test("ยอดค้างส่งนับเฉพาะฝากที่ยังไม่ผูกรอบ โดยไม่หักถอน", () => {
  const rows = [
    { kind:"ฝาก", amount:"100", remittance_id:null },
    { kind:"ฝาก", amount:50, remittance_id:"sent" },
    { kind:"ถอน", amount:80, remittance_id:null },
    { kind:"ยอดยกมา", amount:500, remittance_id:null }
  ];
  assert.equal(computeUnremitted(rows), 100);
  assert.equal(computeUnremitted(null), 0);
});

test("รายงานแยกยอดตามช่วงออกจากยอดสะสมตลอดกาล", () => {
  const rows = [
    { txn_date:"2026-05-01", kind:"ยอดยกมา", amount:500, remittance_id:null },
    { txn_date:"2026-06-01", kind:"ฝาก", amount:100, remittance_id:"sent" },
    { txn_date:"2026-06-02", kind:"ถอน", amount:40, remittance_id:null },
    { txn_date:"2026-08-01", kind:"ฝาก", amount:20, remittance_id:null },
    { txn_date:"2026-08-02", kind:"หักค่ารถ", amount:10, remittance_id:null }
  ];
  const june = summarizeSavingsReport(rows, { from:"2026-06-01", to:"2026-06-30" });
  const august = summarizeSavingsReport(rows, { from:"2026-08-01", to:"2026-08-31" });
  assert.deepEqual(june, { collectedInRange:100, withdrawnInRange:40, balanceLifetime:570, unremitted:20 });
  assert.equal(august.collectedInRange, 20);
  assert.equal(august.withdrawnInRange, 0);
  assert.equal(august.balanceLifetime, june.balanceLifetime);
});

test("migration เริ่มด้วย lock timeout และมีตาราง FK RPC กับ RLS ครบ", () => {
  const marker = schema.indexOf("-- ฝ่ายการเงิน Slice 2");
  assert.ok(marker >= 0);
  const ddl = schema.slice(marker);
  const firstSql = ddl.split("\n").find(line => line.trim() && !line.trim().startsWith("--") && !line.trim().startsWith("="));
  assert.equal(firstSql?.trim(), "set lock_timeout = '5s';");
  assert.match(ddl, /create table if not exists fee_remittances/);
  assert.match(ddl, /constraint fr_totals_match check \(counted_total = expected_total\)/);
  assert.match(ddl, /foreign key \(remittance_id\) references fee_remittances\(id\) on delete restrict/);
  assert.match(ddl, /create or replace function confirm_savings_remittance\(/);
  assert.match(ddl, /pg_advisory_xact_lock\(hashtext\(p_year \|\| '\|' \|\| p_grade \|\| '\|' \|\| p_classroom\)\)/);
  assert.match(ddl, /where kind = 'ฝาก' and remittance_id is null/);
  assert.match(ddl, /select id, amount[\s\S]*?for update/);
  assert.match(ddl, /array_agg\(id order by id\)/);
  assert.match(ddl, /if v_sum <> p_expected then/);
  assert.match(ddl, /update savings_txns set remittance_id = v_id[\s\S]*?where id = any\(v_ids\)/);
  assert.match(ddl, /get diagnostics v_updated = row_count/);
  for (const operation of ["select","insert","update","delete"]) assert.match(ddl, new RegExp(`fee_remittances_${operation}`));
  assert.match(ddl, /fee_remittances_insert[\s\S]*?with check \(false\)/);
  assert.match(ddl, /revoke all on function confirm_savings_remittance[\s\S]*?from public, anon/);
});

test("trigger ล็อกรายการส่งแล้ว และทางลัด RPC เปลี่ยนได้เฉพาะ remittance_id", () => {
  const marker = schema.indexOf("-- ฝ่ายการเงิน Slice 2");
  const ddl = schema.slice(marker);
  assert.match(ddl, /old\.remittance_id is not null[\s\S]*?ส่งเงินและยืนยันยอดแล้ว แก้ไขไม่ได้/);
  assert.match(ddl, /old\.remittance_id is null[\s\S]*?new\.remittance_id is not null/);
  for (const field of ["student_id","txn_date","kind","amount","note","backdate_reason","withdrawal_id","recorded_by","recorded_at"]) {
    assert.match(ddl, new RegExp(`new\\.${field} is not distinct from old\\.${field}`));
  }
  assert.ok(ddl.indexOf("return new;", ddl.indexOf("new.remittance_id is not null")) < ddl.indexOf("if new.kind = 'ยอดยกมา' then"));
});

test("หน้ารับเงินใช้ยอดคำนวณ เปรียบเทียบเงินจริง และยืนยันด้วย RPC เดียว", () => {
  assert.match(remit, /<title>รับเงินส่งจากครู — CRS MIS<\/title>/);
  assert.match(remit, /<h1>รับเงินส่งจากครู<\/h1>/);
  assert.match(remit, /computeUnremitted/);
  assert.match(remit, /\.eq\("kind", "ฝาก"\)\.is\("remittance_id", null\)/);
  assert.match(remit, /เงินขาด/);
  assert.match(remit, /เงินเกิน/);
  assert.match(remit, /window\.crsAskConfirm/);
  assert.match(remit, /sb\.rpc\("confirm_savings_remittance"/);
  assert.doesNotMatch(remit, /sb\.from\("fee_remittances"\)\.insert/);
  assert.match(remit, /checkDepartment\("การเงิน"\)/);
  assert.match(remit, /คุณมีสิทธิ์ดูอย่างเดียว/);
});

test("หน้ารับเงินไม่ส่ง room key ที่มี null character ผ่าน DOM และไม่สร้าง selected ปลอม", () => {
  assert.doesNotMatch(remit, /data-room-key/);
  assert.match(remit, /data-room-index="\$\{index\}"/);
  assert.match(remit, /const index = Number\(button\.dataset\.roomIndex\)/);
  assert.match(remit, /selected = Number\.isInteger\(index\) \? groups\[index\] \|\| null : null/);
  assert.match(remit, /preferred && selected\?\.key === preferred/);
});

test("การ์ดบอกจำนวนวันค้างและรายการฝากเริ่มที่มุมมองตามคนพร้อมขยายรายวัน", () => {
  assert.match(remit, /pendingDays:new Set\(group\.rows\.map\(row => row\.txn_date\)\)\.size/);
  assert.match(remit, /ค้าง \$\{group\.pendingDays\} วัน · \$\{group\.rows\.length\} รายการ/);
  assert.match(remit, /let detailView = "person"/);
  assert.match(remit, /function summarizeByStudent\(rows\)/);
  assert.match(remit, />ตามคน<\/button>/);
  assert.match(remit, />ตามวัน<\/button>/);
  assert.match(remit, /จำนวนครั้ง/);
  assert.match(remit, /data-student-id/);
  assert.match(remit, /aria-expanded/);
  assert.match(remit, /class="daily-row"/);
});

test("หน้ารายงานใช้ช่วงปีการศึกษากลาง fetchAllRows และแยกหัวคอลัมน์ช่วงกับสะสม", () => {
  assert.match(report, /<title>รายงานออมทรัพย์ — CRS MIS<\/title>/);
  assert.match(report, /academicYearRange\(currentYear, years\)/);
  assert.equal((report.match(/fetchAllRows\(/g) || []).length, 3);
  assert.match(report, /เก็บได้ \(ในช่วง\)/);
  assert.match(report, /คงเหลือ \(สะสมทั้งหมด\)/);
  assert.match(report, /student_year_placements/);
  assert.match(report, /data-student-id/);
  assert.match(report, /renderLedger/);
});

test("กราฟใช้ renderDonut กลางและภาพรวมมีสถานะวันนี้กับค้างส่ง", () => {
  assert.match(shell, /window\.renderDonut = function/);
  assert.doesNotMatch(generalOverview, /function renderDonut/);
  assert.match(generalOverview, /window\.renderDonut\(/);
  assert.match(overview, /window\.renderDonut\(/);
  assert.match(overview, /วันนี้ยังไม่มีห้องไหนเก็บออมทรัพย์/);
  assert.match(overview, /เก็บแล้ววันนี้/);
  assert.match(overview, /ยังไม่เก็บวันนี้/);
  assert.match(overview, /computeUnremitted\(pendingRows\)/);
});

test("เมนู workflow และ allowlist มีหน้าของ Slice 2", () => {
  for (const [file, title] of [["savings-remit.html","รับเงินส่งจากครู"],["savings-report.html","รายงานออมทรัพย์"]]) {
    assert.match(shell, new RegExp(`\\["${file.replace(".", "\\.")}", "${title}"\\]`));
    assert.match(shell, new RegExp(`"${file.replace(".", "\\.")}": \\{\\s*title: "${title}"`));
    assert.match(login, new RegExp(`"${file.replace(".", "\\.")}"`));
    assert.match(overview, new RegExp(`href="${file.replace(".", "\\.")}"`));
  }
});

test("cache-buster ของไฟล์กลางมีค่าเดียวทั้งโครงการ", () => {
  const pages = [];
  const walk = url => {
    for (const entry of readdirSync(url, { withFileTypes:true })) {
      if ([".git","node_modules"].includes(entry.name)) continue;
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
