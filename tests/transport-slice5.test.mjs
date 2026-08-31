import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const remit = read("finance/transport-remit.html");
const report = read("finance/transport-report.html");
const overview = read("finance/index.html");
const payout = read("finance/savings-payout.html");
const shell = read("app-shell.js");
const login = read("login.html");

test("SQL ที่ Opus เตรียมไว้มี RPC รอบค่ารถและปิดคู่หักออมทรัพย์ครบ", () => {
  const marker = schema.indexOf("-- ฝ่ายการเงิน Slice 5 (ฝั่งฐาน)");
  assert.ok(marker >= 0, "หา SQL Slice 5 ไม่พบ");
  const ddl = schema.slice(marker);
  assert.match(ddl, /fr_kind_ok check \(kind in \('ออมทรัพย์', 'ค่ารถ'\)\)/);
  assert.match(ddl, /create or replace function confirm_transport_remittance\(/);
  assert.match(ddl, /where method = 'เงินสด' and remittance_id is null/);
  assert.match(ddl, /values \('ค่ารถ'/);
  assert.match(ddl, /create or replace function unlock_transport_remittance\(/);
  assert.match(ddl, /if v_row\.kind <> 'ค่ารถ' then/);
  assert.match(ddl, /transport_payments_savings_uniq/);
  assert.match(ddl, /v_kind <> 'หักค่ารถ'/);
  assert.match(ddl, /v_student <> new\.student_id/);
  assert.match(ddl, /v_amount <> new\.amount/);
});

test("หน้ารับเงินค่ารถนับเฉพาะเงินสด แยกประวัติ และใช้ RPC ค่ารถ", () => {
  assert.match(remit, /<title>รับเงินค่ารถจากครู — CRS MIS<\/title>/);
  assert.match(remit, /sb\.from\("transport_payments"\)[^]*?\.eq\("method", "เงินสด"\)\.is\("remittance_id", null\)/);
  assert.match(remit, /sb\.from\("fee_remittances"\)[^]*?\.eq\("kind", "ค่ารถ"\)/);
  assert.match(remit, /sb\.rpc\("confirm_transport_remittance"/);
  assert.match(remit, /sb\.rpc\("unlock_transport_remittance"/);
  assert.doesNotMatch(remit, /confirm_savings_remittance|unlock_savings_remittance/);
  assert.match(remit, /let detailView = "person"/);
  assert.match(remit, /summarizeByStudent/);
  assert.match(remit, /เงินขาด/);
  assert.match(remit, /เงินเกิน/);
  assert.match(remit, /el\("confirm-button"\)\.disabled = !canFinance \|\| !valid/);
  assert.match(remit, /window\.crsAskConfirm/);
  assert.match(remit, /\.update\(\{ amount, backdate_reason:reason \}\)[^]*?\.eq\("method", "เงินสด"\)[^]*?\.select\("id"\)[^]*?\.maybeSingle\(\)/);
});

test("รายงานค่ารถใช้สูตรกลางและแยกยอดในช่วงจากยอดค้างสะสม", () => {
  assert.match(report, /<title>รายงานค่ารถ — CRS MIS<\/title>/);
  assert.match(report, /academicYearRange\(currentYear, years\)/);
  assert.match(report, /computeTransportCharges\(\{/);
  assert.match(report, /from:yearRange\.start, to:today/);
  assert.match(report, /computeTransportOutstanding\(charges, studentPayments\)/);
  assert.match(report, /outstandingKnown:charges\.unannouncedMonths\.length === 0/);
  assert.match(report, /ยังคำนวณยอดค้างไม่ได้/);
  assert.match(report, /ยอดดังกล่าวไม่ใช่ 0 บาท/);
  assert.match(report, /studentPayments\.filter\(row => row\.pay_date >= range\.from && row\.pay_date <= range\.to\)/);
  assert.match(report, /ยอดที่เก็บได้ \(ในช่วง\)/);
  assert.match(report, /ยอดค้างชำระ \(สะสมทั้งหมด\)/);
  assert.doesNotMatch(report, /function computeTransportCharges|TRANSPORT_CHARGE_STATUSES/);
  assert.equal((report.match(/fetchAllRows\(/g) || []).length, 8);
  for (const table of ["student_year_placements", "student_transport", "daily_attendance", "transport_day_overrides", "transport_month_rates", "transport_payments"]) {
    assert.match(report, new RegExp(`sb\\.from\\("${table}"\\)`));
  }
  assert.match(report, /checkDepartment\("การเงิน"\)/);
  assert.match(report, /id="report-content" hidden/);
});

test("ภาพรวมมีค่ารถค้างส่งและเตือนเด็กออกที่ยังมีเงินเฉพาะเมื่อมากกว่าศูนย์", () => {
  assert.match(overview, /id="transport-pending-total"/);
  assert.match(overview, /href="transport-remit\.html"/);
  assert.match(overview, /sb\.from\("transport_payments"\)[^]*?\.eq\("method", "เงินสด"\)\.is\("remittance_id", null\)/);
  assert.match(overview, /id="departed-balance-card" class="stat pending" hidden/);
  assert.match(overview, /sb\.from\("students"\)[^]*?\.or\("graduated\.eq\.true,left_school\.eq\.true"\)/);
  assert.match(overview, /summarizeSavingsByStudent\(departedTxnRes\.data \|\| \[\]\)/);
  assert.match(overview, /departedIds\.filter\(studentId => \(balances\.get\(studentId\) \|\| 0\) > 0\)/);
  assert.match(overview, /el\("departed-balance-card"\)\.hidden = departedWithBalance === 0/);
  const departedQuery = overview.slice(overview.indexOf('const departedTxnRes'), overview.indexOf('const balances', overview.indexOf('const departedTxnRes')));
  assert.doesNotMatch(departedQuery, /\.eq\("year"/);
});

test("หน้าจ่ายแสดงเด็กที่ออกโดยไม่ผ่าน activePlacements และปิดบัญชีเต็มยอด", () => {
  assert.match(payout, /id="departed-card"/);
  assert.match(payout, /sb\.from\("students"\)\.select\("id,student_no,name,graduated,left_school,status,status_date"\)[^]*?\.or\("graduated\.eq\.true,left_school\.eq\.true"\)/);
  assert.doesNotMatch(payout, /activePlacements\(/);
  const txnQuery = payout.slice(payout.indexOf('const txnRes = await fetchAllRows'), payout.indexOf('if (txnRes.error)', payout.indexOf('const txnRes = await fetchAllRows')));
  assert.doesNotMatch(txnQuery, /\.eq\("year"/);
  assert.match(payout, /balance:balanceByStudent\.get\(student\.id\) \|\| 0/);
  assert.match(payout, /\.filter\(row => row\.balance > 0\)/);
  assert.match(payout, /pendingRequest:queue\.some\(request => request\.student_id === student\.id\)/);
  assert.match(payout, /ต้องจ่ายหรือยกเลิกคำขอเบิกที่รอจ่ายก่อนปิดบัญชี/);
  assert.match(payout, /\.eq\("student_id", account\.id\)\.eq\("status", "รอจ่าย"\)/);
  assert.match(payout, /summarizeSavingsByStudent\(latestRows\)\.get\(account\.id\)/);
  assert.match(payout, /amount:currentBalance/);
  assert.match(payout, /year:latestTxn\.year, grade_level:latestTxn\.grade_level/);
  assert.match(payout, /note:`ปิดบัญชี — ผู้รับเงิน: \$\{receiverName\}`/);
  assert.match(payout, /กรุณาระบุชื่อผู้รับเงินคืน/);
  assert.match(payout, /window\.crsAskConfirm\(\{[^]*?คืนเต็มยอด \$\{formatMoney\(currentBalance\)\}[^]*?ผู้รับเงิน: \$\{receiverName\}/);
});

test("เมนู allowlist ทางเข้าภาพรวม และ cache-buster มีหน้าใหม่ครบ", () => {
  for (const [file, title] of [["transport-remit.html", "รับเงินค่ารถจากครู"], ["transport-report.html", "รายงานค่ารถ"]]) {
    const escaped = file.replace(".", "\\.");
    assert.match(shell, new RegExp(`\\["${escaped}", "${title}"\\]`));
    assert.match(shell, new RegExp(`"${escaped}": \\{\\s*title: "${title}"`));
    assert.match(login, new RegExp(`"${escaped}"`));
    assert.match(overview, new RegExp(`href="${escaped}" data-restricted="1" hidden`));
  }
  const financeOnly = shell.match(/financeOnly: \[([^\]]+)\]/)?.[1] || "";
  assert.match(financeOnly, /transport-remit\.html/);
  assert.match(financeOnly, /transport-report\.html/);
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
  assert.deepEqual([...new Set(all.match(/app-shell\.js\?v=[0-9a-z-]+/g))], ["app-shell.js?v=20260831-1"]);
  assert.deepEqual([...new Set(all.match(/supabase-client\.js\?v=[0-9a-z-]+/g))], ["supabase-client.js?v=20260831-1"]);
});

test("module scripts ของหน้าใหม่คอมไพล์ผ่านและไม่ใช้ dialog ดิบ", () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  for (const page of [remit, report]) {
    assert.doesNotMatch(page, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
    const match = page.match(/<script type="module">([^]*?)<\/script>/);
    assert.ok(match, "หา module script ไม่พบ");
    const body = match[1].replace(/^import \{[^]*?\}\s*from "[^"]+";\s*/m, "");
    assert.doesNotThrow(() => new AsyncFunction(body));
  }
});
