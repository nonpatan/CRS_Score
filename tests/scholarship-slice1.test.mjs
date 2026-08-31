import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(root, path), "utf8");
const client = read("supabase-client.js");
const sourcesPage = read("finance/scholarship-sources.html");
const grantPage = read("finance/scholarship-grant.html");
const reportPage = read("finance/scholarship-report.html");
const shell = read("app-shell.js");
const login = read("login.html");

function functionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `ไม่พบฟังก์ชัน ${name}`);
  const exportStart = source.lastIndexOf("export ", start);
  const sourceStart = exportStart >= 0 && start - exportStart < 10 ? exportStart : start;
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(sourceStart, index + 1).replace(/^export\s+/, "");
  }
  throw new Error(`ตัดฟังก์ชัน ${name} ไม่สำเร็จ`);
}

function htmlFiles(dir = root) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes:true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) found.push(path);
  }
  return found;
}

test("computeScholarshipBalance คิดเครื่องหมาย ข้าม void และชนิดแปลกปลอม", () => {
  const source = functionSource(client, "computeScholarshipBalance");
  const computeScholarshipBalance = new Function(`${source}; return computeScholarshipBalance;`)();
  assert.equal(computeScholarshipBalance(null), 0);
  assert.equal(computeScholarshipBalance([
    { kind:"ยอดยกมา", amount:100 },
    { kind:"รับทุน", amount:"50.25" },
    { kind:"จ่ายค่าใช้จ่าย", amount:20 },
    { kind:"คืนเงินคงเหลือ", amount:10 },
    { kind:"รับทุน", amount:999, voided_at:"2026-08-31T00:00:00Z" },
    { kind:"ชนิดแปลกปลอม", amount:777 },
    { kind:"รับทุน", amount:"ไม่ใช่ตัวเลข" }
  ]), 120.25);
});

test("summarizeScholarshipByStudent แยกยอดรายคนไม่ปนกัน", () => {
  const balanceSource = functionSource(client, "computeScholarshipBalance");
  const summarySource = functionSource(client, "summarizeScholarshipByStudent");
  const summarizeScholarshipByStudent = new Function(`${balanceSource}; ${summarySource}; return summarizeScholarshipByStudent;`)();
  const result = summarizeScholarshipByStudent([
    { student_id:"a", kind:"รับทุน", amount:100 },
    { student_id:"b", kind:"ยอดยกมา", amount:80 },
    { student_id:"a", kind:"จ่ายค่าใช้จ่าย", amount:25 },
    { student_id:"b", kind:"รับทุน", amount:20, voided_at:"2026-08-31T00:00:00Z" },
    { kind:"รับทุน", amount:999 }
  ]);
  assert.deepEqual([...result], [["a",75],["b",80]]);
});

test("หน้า Slice 1 ใช้สูตรกลางและไม่มีทางจ่ายหรือปิดบัญชีทุน", () => {
  assert.match(grantPage, /computeScholarshipBalance/);
  assert.match(reportPage, /computeScholarshipBalance/);
  assert.match(reportPage, /summarizeScholarshipByStudent/);
  for (const [name, page] of [["sources",sourcesPage],["grant",grantPage],["report",reportPage]]) {
    assert.doesNotMatch(page, /function\s+(?:compute|summarize)Scholarship/iu, `${name} เขียนสูตรทุนซ้ำในหน้า`);
    assert.doesNotMatch(page, /ปิดบัญชี|จ่ายเงินทุน|scholarship-payout/iu, `${name} มีทางเงินออกใน Slice 1`);
  }
  assert.match(sourcesPage, /escapeHtml\(source\.name\)/);
  assert.match(reportPage, /escapeHtml\(group\.source\.name/);
});

test("payload บันทึกแช่ปี ชั้น ห้องจาก placement ของปีที่เลือก", () => {
  const selected = functionSource(grantPage, "selectedPlacement");
  assert.match(selected, /placement\.year === year && placement\.student_id === studentId/);
  const start = grantPage.indexOf('el("save-txn").addEventListener("click"');
  const end = grantPage.indexOf('\nel("history").addEventListener', start);
  assert.ok(start >= 0 && end > start, "ตัด handler บันทึกทุนไม่สำเร็จ");
  const handler = grantPage.slice(start, end);
  assert.match(handler, /student_id:placement\.student_id/);
  assert.match(handler, /year:placement\.year/);
  assert.match(handler, /grade_level:placement\.grade_level/);
  assert.match(handler, /classroom:placement\.classroom/);
  assert.doesNotMatch(handler, /grade_level:room\.|classroom:room\./);
});

test("ยอดยกมาไม่ส่ง source_id แต่รับทุนส่งและยืนยันผ่าน crsAskConfirm", () => {
  const start = grantPage.indexOf('el("save-txn").addEventListener("click"');
  const end = grantPage.indexOf('\nel("history").addEventListener', start);
  const handler = grantPage.slice(start, end);
  const payloadStart = handler.indexOf("const payload = {");
  const payloadEnd = handler.indexOf("};", payloadStart);
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, "ตัด payload รับทุนไม่สำเร็จ");
  assert.doesNotMatch(handler.slice(payloadStart, payloadEnd), /source_id/);
  assert.match(handler, /if \(kind === "รับทุน"\) payload\.source_id = sourceId/);
  assert.match(handler, /if \(kind === "ยอดยกมา" && openingRow\(\)\)/);
  assert.match(handler, /await window\.crsAskConfirm\(/);
  assert.match(grantPage.slice(end), /await window\.crsAskConfirm\(/, "การยกเลิกรายการเงินต้องยืนยันด้วยกล่องกลาง");
  assert.doesNotMatch(grantPage, /\b(?:confirm|prompt|alert)\s*\(/);
});

test("รายงานเตือนข้อจำกัดเฉพาะครู ไม่เตือนฝ่ายการเงิน", () => {
  assert.match(reportPage, /แสดงเฉพาะปีและห้องที่คุณสอน/);
  assert.match(reportPage, /ยอดจริงของนักเรียนอาจมากกว่านี้/);
  assert.match(reportPage, /if \(!canFinance\) el\("limited-note"\)\.hidden = false/);
  assert.match(reportPage, /id="limited-note" class="card" hidden/);
});

test("เมนูและ login ต่อครบ โดยรายงานไม่อยู่ใน financeOnly", () => {
  for (const page of ["scholarship-grant.html","scholarship-sources.html","scholarship-report.html"]) {
    assert.match(shell, new RegExp(`\\["${page.replace(".","\\.")}"`));
    assert.match(login, new RegExp(`"${page.replace(".","\\.")}"`));
    assert.match(shell, new RegExp(`"${page.replace(".","\\.")}": \\{`), `${page} ไม่มี workflow`);
  }
  const financeOnlyStart = shell.indexOf("financeOnly:", shell.indexOf("finance: {"));
  const financeOnlyEnd = shell.indexOf("],", financeOnlyStart);
  const financeOnly = shell.slice(financeOnlyStart, financeOnlyEnd);
  assert.match(financeOnly, /scholarship-grant\.html/);
  assert.match(financeOnly, /scholarship-sources\.html/);
  assert.doesNotMatch(financeOnly, /scholarship-report\.html/);
});

test("cache-buster app-shell และ supabase-client เป็น 20260831-1 ทุก HTML", () => {
  const versions = { shell:new Set(), client:new Set() };
  let shellFiles = 0, clientFiles = 0;
  for (const path of htmlFiles()) {
    const source = readFileSync(path, "utf8");
    const shells = [...source.matchAll(/app-shell\.js\?v=([0-9a-z-]+)/g)];
    const clients = [...source.matchAll(/supabase-client\.js\?v=([0-9a-z-]+)/g)];
    if (shells.length) { shellFiles++; assert.equal(shells.length, 1, `${path} อ้าง app-shell.js ไม่ใช่ 1 จุด`); }
    if (clients.length) { clientFiles++; assert.equal(clients.length, 1, `${path} อ้าง supabase-client.js ไม่ใช่ 1 จุด`); }
    shells.forEach(match => versions.shell.add(match[1]));
    clients.forEach(match => versions.client.add(match[1]));
  }
  assert.deepEqual([...versions.shell], ["20260831-1"]);
  assert.deepEqual([...versions.client], ["20260831-1"]);
  assert.equal(shellFiles, 56);
  assert.equal(clientFiles, 57);
});
