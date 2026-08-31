import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const client = read("supabase-client.js");
const savingsReport = read("finance/savings-report.html");
const transportReport = read("finance/transport-report.html");
const financePages = readdirSync(new URL("../finance/", import.meta.url))
  .filter(name => name.endsWith(".html"))
  .sort()
  .map(name => ({ name, source:read(`finance/${name}`) }));

test("ลิงก์ครูประจำชั้นมีเฉพาะสี่หน้าที่ RLS อนุญาต", () => {
  const start = client.indexOf("export const HOMEROOM_FINANCE_LINKS");
  const end = client.indexOf("export function applyPersonnelMenuAccess", start);
  assert.ok(start >= 0 && end > start, "ตัด helper เมนูการเงินไม่สำเร็จ");
  const source = client.slice(start, end).replaceAll("export ", "");
  const homeroom = async () => true;
  const { HOMEROOM_FINANCE_LINKS } = new Function(
    "isHomeroomTeacherNow",
    `${source}\nreturn { HOMEROOM_FINANCE_LINKS, financeMenuKeepHrefs };`
  )(homeroom);

  assert.deepEqual(HOMEROOM_FINANCE_LINKS, [
    "transport-settings.html", "savings-report.html", "transport-report.html", "fee-report.html"
  ]);
  for (const forbidden of ["savings-payout", "savings-remit", "savings-opening", "transport-remit"]) {
    assert.doesNotMatch(HOMEROOM_FINANCE_LINKS.join("\n"), new RegExp(forbidden));
  }
});

test("financeMenuKeepHrefs แยกฝ่ายการเงิน ครูประจำชั้น และครูทั่วไปจริง", async () => {
  const start = client.indexOf("export const HOMEROOM_FINANCE_LINKS");
  const end = client.indexOf("export function applyPersonnelMenuAccess", start);
  const source = client.slice(start, end).replaceAll("export ", "");
  const makeHelper = homeroom => new Function(
    "isHomeroomTeacherNow",
    `${source}\nreturn financeMenuKeepHrefs;`
  )(async () => homeroom);

  let checked = false;
  const financeHelper = new Function(
    "isHomeroomTeacherNow",
    `${source}\nreturn financeMenuKeepHrefs;`
  )(async () => { checked = true; return true; });
  assert.deepEqual(await financeHelper(true, "finance-user"), []);
  assert.equal(checked, false, "ฝ่ายการเงินต้องไม่ยิง query ครูประจำชั้นเพิ่ม");
  assert.deepEqual(await makeHelper(true)(false, "homeroom-user"), [
    "transport-settings.html", "savings-report.html", "transport-report.html", "fee-report.html"
  ]);
  assert.deepEqual(await makeHelper(false)(false, "teacher-user"), []);
});

test("computeTransportUnremitted นับเฉพาะเงินสดที่ยังไม่ส่ง", () => {
  const start = client.indexOf("export function computeTransportUnremitted");
  const end = client.indexOf("// สรุปรายงานออมทรัพย์", start);
  assert.ok(start >= 0 && end > start, "ตัดสูตรค้างส่งค่ารถไม่สำเร็จ");
  const source = client.slice(start, end).replace(/^export /, "");
  const computeTransportUnremitted = new Function(`${source}\nreturn computeTransportUnremitted;`)();
  const mixed = [
    { method:"เงินสด", amount:"120", remittance_id:null },
    { method:"เงินสด", amount:80, remittance_id:"sent" },
    { method:"หักออมทรัพย์", amount:500, remittance_id:null },
    { method:"เงินสด", amount:"ไม่ใช่ตัวเลข", remittance_id:null }
  ];
  assert.equal(computeTransportUnremitted(mixed), 120);
  assert.equal(computeTransportUnremitted([]), 0);
  assert.equal(computeTransportUnremitted(null), 0);
});

test("หน้าการเงินทุกหน้าใช้เมนูครูประจำชั้นจากของกลาง", () => {
  assert.equal(financePages.length, 20);
  for (const { name, source } of financePages) {
    assert.doesNotMatch(source, /applyRestrictedMenuAccess\(canFinance\);/, `${name} ยังเรียก gate เปล่า`);
    if (name === "transport-settings.html") {
      assert.match(source, /applyRestrictedMenuAccess\(canFinance, canUse \? HOMEROOM_FINANCE_LINKS : \[\]\)/);
    } else {
      assert.match(source, /applyRestrictedMenuAccess\(canFinance, await financeMenuKeepHrefs\(canFinance, session\.user\.id\)\)/, `${name} ไม่ใช้ helper กลาง`);
    }
  }
});

test("รายงานค่ารถกรองห้องด้วย RPC เดียวกับ RLS ไม่ query ครูประจำชั้นเอง", () => {
  assert.match(transportReport, /sb\.rpc\("can_read_room_money"/);
  assert.doesNotMatch(transportReport, /sb\.from\("homeroom_teachers"\)/);
  assert.match(transportReport, /placements = placements\.filter\(placement => allowedRooms\.has\(roomKey\(placement\)\)\)/);
});

test("รายงานค่ารถมีค้างส่งปัจจุบันและตารางห้าคอลัมน์", () => {
  assert.match(transportReport, /data-sort="unremitted"/);
  assert.match(transportReport, /id="school-unremitted"/);
  assert.match(transportReport, /computeTransportUnremitted\(studentPayments\)/);
  assert.match(transportReport, /computeTransportUnremitted\(payments\)/);
  assert.match(transportReport, /colspan="5"/);
  assert.doesNotMatch(transportReport, /colspan="4"/);
});

test("รายงานแยก query ค้างส่งทุกปีออกจากรายการรับเงินปีปัจจุบัน", () => {
  const allYearsQuery = transportReport.match(/fetchAllRows\(\(\) => sb\.from\("transport_payments"\)\s*\.select\("id,student_id,year,grade_level,classroom,amount,method,remittance_id"\)\s*\.eq\("method", "เงินสด"\)\.is\("remittance_id", null\), \["year","grade_level","classroom","id"\]\)/)?.[0] || "";
  assert.ok(allYearsQuery, "ไม่พบ query ยอดค้างส่งทุกปี");
  assert.doesNotMatch(allYearsQuery, /\.eq\("year"/);
  assert.match(transportReport, /select\("id,student_id,year,grade_level,classroom,pay_date,amount,method,note,remittance_id"\)\.eq\("year", currentYear\)/,
    "query รายการรับเงินที่ใช้หักยอดค้างชำระต้องยังจำกัดปีปัจจุบัน");
});

test("carryoverRooms แยกยอดปีอื่นตามปีและห้องด้วยสูตรกลาง", () => {
  const formulaStart = client.indexOf("export function computeTransportUnremitted");
  const formulaEnd = client.indexOf("// สรุปรายงานออมทรัพย์", formulaStart);
  const formulaSource = client.slice(formulaStart, formulaEnd).replace(/^export /, "");
  const computeTransportUnremitted = new Function(`${formulaSource}\nreturn computeTransportUnremitted;`)();

  const start = transportReport.indexOf("function carryoverRooms(");
  const end = transportReport.indexOf("function selectedRange", start);
  assert.ok(start >= 0 && end > start, "ตัด carryoverRooms ไม่สำเร็จ");
  const carryoverRooms = new Function(
    "computeTransportUnremitted",
    `${transportReport.slice(start, end)}\nreturn carryoverRooms;`
  )(computeTransportUnremitted);

  const rows = [
    { year:"2570", grade_level:"ป.1", classroom:"1", method:"เงินสด", amount:999, remittance_id:null },
    { year:"2569", grade_level:"ป.3", classroom:"1", method:"เงินสด", amount:"100", remittance_id:null },
    { year:"2569", grade_level:"ป.3", classroom:"1", method:"เงินสด", amount:50, remittance_id:null },
    { year:"2569", grade_level:"ป.3", classroom:"2", method:"เงินสด", amount:80, remittance_id:null },
    { year:"2568", grade_level:"ป.4", classroom:"1", method:"เงินสด", amount:40, remittance_id:null },
    { year:"2567", grade_level:"ป.5", classroom:"1", method:"หักออมทรัพย์", amount:500, remittance_id:null },
    { year:"2567", grade_level:"ป.5", classroom:"1", method:"เงินสด", amount:60, remittance_id:"sent" }
  ];
  assert.deepEqual(carryoverRooms(rows, "2570").map(({ year, grade_level, classroom, amount }) =>
    ({ year, grade_level, classroom, amount })), [
    { year:"2568", grade_level:"ป.4", classroom:"1", amount:40 },
    { year:"2569", grade_level:"ป.3", classroom:"1", amount:150 },
    { year:"2569", grade_level:"ป.3", classroom:"2", amount:80 }
  ]);
  assert.deepEqual(carryoverRooms([], "2570"), []);
  assert.deepEqual(carryoverRooms(null, "2570"), []);
});

test("แบนเนอร์ค้างส่งปีเก่าแสดงได้ทั้งฝ่ายการเงินและครูประจำชั้น", () => {
  assert.match(transportReport, /id="carryover-warning" class="banner warn" hidden/);
  assert.match(transportReport, /ค้างส่งจากปีการศึกษาก่อน/);
  assert.match(transportReport, /esc\(row\.year\)/);
  assert.match(transportReport, /esc\(row\.grade_level\)/);
  assert.match(transportReport, /esc\(row\.classroom\)/);
  const modeStart = transportReport.lastIndexOf("if (!canFinance) {");
  const modeEnd = transportReport.indexOf('el("report-content").hidden = false', modeStart);
  assert.doesNotMatch(transportReport.slice(modeStart, modeEnd), /carryover-warning/);
});

test("outstandingStudents เก็บคนที่ค้างหรือยอดยังไม่ทราบและเรียงห้องกับเลขที่แบบตัวเลข", () => {
  const start = transportReport.indexOf("function outstandingStudents(");
  const end = transportReport.indexOf("function selectedRange", start);
  assert.ok(start >= 0 && end > start, "ตัด outstandingStudents ไม่สำเร็จ");
  const outstandingStudents = new Function(
    `${transportReport.slice(start, end)}\nreturn outstandingStudents;`
  )();

  const rows = [
    { student_id:"paid", grade_level:"ป.1", classroom:"1", student:{ student_no:"1" }, outstandingKnown:true, outstandingLifetime:0 },
    { student_id:"advance", grade_level:"ป.1", classroom:"1", student:{ student_no:"3" }, outstandingKnown:true, outstandingLifetime:-50 },
    { student_id:"ten", grade_level:"ป.2", classroom:"1", student:{ student_no:"10" }, outstandingKnown:true, outstandingLifetime:100 },
    { student_id:"two", grade_level:"ป.2", classroom:"1", student:{ student_no:"2" }, outstandingKnown:true, outstandingLifetime:80 },
    { student_id:"unknown", grade_level:"ป.1", classroom:"2", student:{ student_no:"5" }, outstandingKnown:false, outstandingLifetime:0 }
  ];
  assert.deepEqual(outstandingStudents(rows).map(row => row.student_id), ["unknown", "two", "ten"]);
  assert.deepEqual(outstandingStudents([]), []);
  assert.deepEqual(outstandingStudents(null), []);
});

test("รายงานใช้ช่วงรถเดิมสร้างแบบเก็บเงินและไม่เพิ่ม query", () => {
  const buildStart = transportReport.indexOf("function buildStudents(");
  const buildEnd = transportReport.indexOf("function buildRooms", buildStart);
  const buildSource = transportReport.slice(buildStart, buildEnd);
  assert.match(buildSource, /billingModes:\[\.\.\.new Set\(\(periodsByStudent\.get\(placement\.student_id\) \|\| \[\]\)/);
  assert.match(buildSource, /\.map\(row => row\.billing_mode\)\.filter\(Boolean\)/);
  assert.equal((transportReport.match(/fetchAllRows\(/g) || []).length, 8);
  assert.equal((transportReport.match(/sb\.from\("student_transport"\)/g) || []).length, 1);
});

test("การ์ดนักเรียนค้างชำระแสดงทั้งฝ่ายการเงินและครูประจำชั้น", () => {
  assert.match(transportReport, /id="outstanding-body"/);
  assert.match(transportReport, /<td colspan="5" class="empty">ไม่มีนักเรียนค้างชำระ<\/td>/);
  assert.match(transportReport, /\.warn-text \{ color:var\(--amber\); font-weight:700; \}/);
  assert.match(transportReport, /row\.student\?\.name \|\| "ไม่พบชื่อนักเรียน"/);
  assert.match(transportReport, /renderRooms\(\); renderOutstanding\(\); renderStudents\(\);/);
  const roomCard = transportReport.indexOf('id="room-body"');
  const outstandingCard = transportReport.indexOf('id="outstanding-body"');
  const studentCard = transportReport.indexOf('id="student-card"');
  assert.ok(roomCard < outstandingCard && outstandingCard < studentCard, "การ์ดคนค้างต้องอยู่ระหว่างสรุปห้องกับ drill-down");
  const modeStart = transportReport.lastIndexOf("if (!canFinance) {");
  const modeEnd = transportReport.indexOf('el("report-content").hidden = false', modeStart);
  assert.doesNotMatch(transportReport.slice(modeStart, modeEnd), /renderOutstanding/);
});

test("รายงานทั้งสองหน้าอธิบายเมื่อครูไม่มีห้อง", () => {
  for (const source of [savingsReport, transportReport]) {
    assert.match(source, /ยังไม่พบห้องที่คุณรับผิดชอบ/);
    assert.match(source, /หน้านี้แสดงเฉพาะห้องที่คุณเป็นครูประจำชั้น/);
  }
});

test("cache-buster กลางตรงกันทุกหน้าโดยไม่ขยับ app-shell", () => {
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
  assert.deepEqual([...new Set(all.match(/app-shell\.css\?v=[0-9a-z-]+/g))], ["app-shell.css?v=20260820-2"]);
});
