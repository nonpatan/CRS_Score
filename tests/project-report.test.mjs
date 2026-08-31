import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const page = read("academic/project-report.html");
const shell = read("app-shell.js");

function htmlFiles(directory = root) {
  return readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    if ([".git", "node_modules"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  });
}

const formulaStart = page.indexOf("function bangkokDayNumber(");
const formulaEnd = page.indexOf("\n\nconst session =", formulaStart);
assert.ok(formulaStart >= 0 && formulaEnd > formulaStart, "ตัดสูตรล้วนจากหน้ารายงานไม่สำเร็จ");
const formulaSource = page.slice(formulaStart, formulaEnd);
const formulas = new Function(
  `const DAY_MS = 86_400_000; const TH_OFFSET_MS = 7 * 60 * 60 * 1000;\n${formulaSource}\n` +
  "return { pendingTooLong, returnedTooLong, pastDueNotClosed, finishedWithoutSummary, finishedWithoutActualBudget, countByStatus };"
)();

const todayIso = "2026-08-24";
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

const ids = rows => rows.map(row => row.id);

test("budget_actual ศูนย์คือกรอกแล้ว ส่วน null ต้องตาม", () => {
  const rows = [
    { id:"zero", status:"เสร็จสิ้น", budget_actual:0 },
    { id:"null", status:"เสร็จสิ้น", budget_actual:null },
    { id:"text", status:"เสร็จสิ้น", budget_actual:120 }
  ];
  assert.deepEqual(ids(formulas.finishedWithoutActualBudget(rows, todayIso)), ["null"]);
});

test("งานวันเดียวเลยกำหนดใช้ start_date และไม่นับยกเลิก", () => {
  const rows = [
    { id:"single", status:"กำลังดำเนินการ", approved_at:"2026-08-01", start_date:"2026-08-20", end_date:null },
    { id:"today", status:"กำลังดำเนินการ", approved_at:"2026-08-01", start_date:todayIso, end_date:null },
    { id:"cancelled", status:"ยกเลิก", approved_at:"2026-08-01", start_date:"2026-08-01", end_date:null },
    { id:"unapproved", status:"กำลังดำเนินการ", approved_at:null, start_date:"2026-08-01", end_date:null }
  ];
  assert.deepEqual(ids(formulas.pastDueNotClosed(rows, todayIso)), ["single"]);
});

test("รออนุมัติต้องเกิน 7 วัน ไม่ใช่ครบ 7 วัน", () => {
  const rows = [
    { id:"seven", status:"วางแผน", approval_status:"รออนุมัติ", submitted_at:"2026-08-17" },
    { id:"six", status:"วางแผน", approval_status:"รออนุมัติ", submitted_at:"2026-08-18" },
    { id:"eight", status:"วางแผน", approval_status:"รออนุมัติ", submitted_at:"2026-08-16" },
    { id:"wrong-status", status:"วางแผน", approval_status:"ร่าง", submitted_at:"2026-08-01" },
    { id:"cancelled", status:"ยกเลิก", approval_status:"รออนุมัติ", submitted_at:"2026-08-01" }
  ];
  assert.deepEqual(ids(formulas.pendingTooLong(rows, todayIso, 7)), ["eight"]);
});

test("วันรออนุมัตินับตามวันที่ไทย", () => {
  const rows = [
    { id:"thai-seven", status:"วางแผน", approval_status:"รออนุมัติ", submitted_at:"2026-08-16T18:00:00Z" },
    { id:"thai-eight", status:"วางแผน", approval_status:"รออนุมัติ", submitted_at:"2026-08-15T16:59:59Z" }
  ];
  assert.deepEqual(ids(formulas.pendingTooLong(rows, todayIso, 7)), ["thai-eight"]);
});

test("ส่งกลับให้แก้ใชัใบพิจารณาล่าสุดแม้ submitted_at เป็น null", () => {
  const rows = [
    {
      id:"old", status:"วางแผน", approval_status:"ส่งกลับให้แก้", submitted_at:null,
      approvals:[
        { action:"ส่งกลับให้แก้", created_at:"2026-08-01" },
        { action:"ส่งกลับให้แก้", created_at:"2026-08-09" },
        { action:"อนุมัติ", created_at:"2026-08-23" }
      ]
    },
    {
      id:"latest-recent", status:"วางแผน", approval_status:"ส่งกลับให้แก้", submitted_at:null,
      approvals:[
        { action:"ส่งกลับให้แก้", created_at:"2026-08-01" },
        { action:"ส่งกลับให้แก้", created_at:"2026-08-20" }
      ]
    },
    { id:"cancelled", status:"ยกเลิก", approval_status:"ส่งกลับให้แก้", approvals:[{ action:"ส่งกลับให้แก้", created_at:"2026-08-01" }] }
  ];
  assert.deepEqual(ids(formulas.returnedTooLong(rows, todayIso, 14)), ["old"]);
});

test("ผลสรุป null กับข้อความว่างต้องตาม แต่ข้อความจริงไม่ต้อง", () => {
  const rows = [
    { id:"null", status:"เสร็จสิ้น", result_summary:null },
    { id:"empty", status:"เสร็จสิ้น", result_summary:"" },
    { id:"spaces", status:"เสร็จสิ้น", result_summary:"   " },
    { id:"done", status:"เสร็จสิ้น", result_summary:"ดำเนินการครบ" },
    { id:"cancelled", status:"ยกเลิก", result_summary:null }
  ];
  assert.deepEqual(ids(formulas.finishedWithoutSummary(rows, todayIso)), ["null", "empty", "spaces"]);
});

test("รายการยกเลิกไม่เข้ากล่องตามงานใดเลย", () => {
  const cancelled = [{
    id:"cancelled", status:"ยกเลิก", approval_status:"รออนุมัติ", submitted_at:"2026-01-01",
    approved_at:"2026-01-01", start_date:"2026-01-01", end_date:null,
    result_summary:null, budget_actual:null,
    approvals:[{ action:"ส่งกลับให้แก้", created_at:"2026-01-01" }]
  }];
  assert.equal(formulas.pendingTooLong(cancelled, todayIso, 7).length, 0);
  assert.equal(formulas.returnedTooLong(cancelled, todayIso, 14).length, 0);
  assert.equal(formulas.pastDueNotClosed(cancelled, todayIso).length, 0);
  assert.equal(formulas.finishedWithoutSummary(cancelled, todayIso).length, 0);
  assert.equal(formulas.finishedWithoutActualBudget(cancelled, todayIso).length, 0);
});

test("สรุปจำนวนแยกสถานะสี่ค่า", () => {
  const rows = ["วางแผน", "กำลังดำเนินการ", "เสร็จสิ้น", "เสร็จสิ้น", "ยกเลิก", "อื่น ๆ"]
    .map((status, index) => ({ id:String(index), status }));
  assert.deepEqual(formulas.countByStatus(rows, todayIso), {
    "วางแผน":1, "กำลังดำเนินการ":1, "เสร็จสิ้น":2, "ยกเลิก":1
  });
});

test("สูตรทุกตัวรับ todayIso และไม่อ่านวันที่ปัจจุบันเอง", () => {
  for (const name of [
    "pendingTooLong", "returnedTooLong", "pastDueNotClosed",
    "finishedWithoutSummary", "finishedWithoutActualBudget", "countByStatus"
  ]) {
    assert.match(formulaSource, new RegExp(`function ${name}\\(projects, todayIso`));
  }
  assert.doesNotMatch(formulaSource, /new Date\s*\(|Date\.now\s*\(/);
});

test("หน้าใช้สิทธิ์ ผอ. หรือฝ่ายวิชาการและปฏิเสธครูทั่วไป", () => {
  assert.match(page, /isProjectApprover\(\)/);
  assert.match(page, /checkDepartment\("วิชาการ"\)/);
  assert.match(page, /const canSee = approver \|\| academic/);
  assert.match(page, /หน้านี้สำหรับผู้บริหารและฝ่ายวิชาการ/);
  assert.match(page, /href="projects\.html"/);
});

test("หน้าเป็น read-only จริงและไม่โหลดข้อมูล OKR เกินจำเป็น", () => {
  for (const method of ["update", "insert", "delete", "upsert"]) {
    assert.doesNotMatch(page, new RegExp(`\\.${method}\\s*\\(`));
  }
  assert.doesNotMatch(page, /loadOkrCheckins|loadOkrThresholds|loadOkrLineage/);
  assert.match(page, /loadAcademicProjects\(year\)/);
  assert.match(page, /loadSchoolOkrs\(year\)/);
  assert.match(page, /from\("academic_project_approvals"\)[\s\S]*?\.select\(/);
});

test("งบรวมใช้ project tree helper และไม่ reduce budget_planned ตรง ๆ", () => {
  assert.match(page, /summarizeProjectBudget\(buildProjectTree\(projects\)\)/);
  assert.doesNotMatch(page, /budget_planned[^\n]*reduce|reduce[^\n]*budget_planned/);
});

test("กับดักงบศูนย์ end_date และใบพิจารณาล่าสุดถูกล็อกใน source", () => {
  assert.match(page, /project\.budget_actual == null/);
  assert.doesNotMatch(page, /!\s*project\.budget_actual/);
  assert.match(page, /project\.end_date \?\? project\.start_date/);
  const returnedStart = page.indexOf("function returnedTooLong(");
  const returnedEnd = page.indexOf("\n\nfunction pastDueNotClosed", returnedStart);
  const returnedSource = page.slice(returnedStart, returnedEnd);
  assert.match(returnedSource, /latestReturnedApproval\(project\)/);
  assert.doesNotMatch(returnedSource, /submitted_at/);
});

test("ตารางมีตัวกรองครบและเลื่อนแนวนอนเฉพาะในกรอบ", () => {
  for (const id of ["filter-owner", "filter-objective", "filter-status", "filter-kind"]) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(page, /class="project-name\$\{child \? " child"/);
});

test("ชื่อโครงการเป็นปุ่มเปิดรายละเอียดและกิจกรรมลูกยังใช้คลาส child", () => {
  const start = page.indexOf("function projectRow(");
  const end = page.indexOf("\n\n  function renderTable", start);
  const block = page.slice(start, end);
  assert.match(block, /<td class="project-name\$\{child \? " child" : ""\}">/);
  assert.match(block, /<button type="button" class="name-btn" data-detail="\$\{esc\(project\.id\)\}">\$\{esc\(project\.name\)\}<\/button>/);
});

test("โหมดพิมพ์คงชื่อโครงการและซ่อน popup รายละเอียด", () => {
  const start = page.indexOf("@media print {");
  const end = page.indexOf("</style>", start);
  assert.ok(start >= 0 && end > start, "หาบล็อก print ไม่พบ");
  const printBlock = page.slice(start, end);
  assert.match(printBlock, /#detail-overlay[^}]*display:\s*none\s*!important/);
  assert.match(printBlock, /\.name-btn\s*\{[^}]*display:\s*inline\s*!important/);
  assert.match(printBlock, /\.name-btn\s*\{[^}]*color:\s*#000\s*!important/);
  assert.match(printBlock, /\.name-btn\s*\{[^}]*text-decoration:\s*none\s*!important/);
});

test("popup ใช้ข้อมูลในหน่วยความจำและไม่เพิ่ม query", () => {
  assert.equal((page.match(/\bsb\.from\(/g) || []).length, 1);
  assert.match(page, /projects\.find\(row => String\(row\.id\) === trigger\.dataset\.detail\)/);
  const start = page.indexOf("function detailHtml(");
  const end = page.indexOf("\n\n  function projectRow", start);
  assert.doesNotMatch(page.slice(start, end), /sb\.from\(/);
});

test("detailHtml ข้ามหัวข้อว่าง แสดงผลช่องใดช่องหนึ่ง เอกสารทุกประเภท และ escape ข้อมูล", () => {
  const start = page.indexOf("function detailHtml(");
  const end = page.indexOf("\n\n  function projectRow", start);
  assert.ok(start >= 0 && end > start, "ตัด detailHtml ไม่สำเร็จ");
  const projects = [{ id:"parent-1", name:"โครงการแม่" }];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
  const detailHtml = new Function(
    "projects", "projectApprovalBadge", "esc", "fmtDate", "fmtDateTime", "fmtMoneyOrMissing", "krHtml", "responsibleName",
    `${page.slice(start, end)}\nreturn detailHtml;`
  )(
    projects,
    () => ({ label:"อนุมัติแล้ว", tone:"" }),
    esc,
    value => value || "—",
    value => value ? new Date(value).toLocaleString("th-TH", {
      dateStyle:"medium", timeStyle:"short", timeZone:"Asia/Bangkok"
    }) : "—",
    value => value == null ? "ยังไม่ได้กรอก" : `${value} บาท`,
    project => project.okrs?.length ? '<span class="chip">KR</span>' : "—",
    () => "ครูตัวอย่าง"
  );
  const base = {
    id:"project-1", name:"โครงการทดสอบ", kind:"โครงการ", status:"กำลังดำเนินการ",
    start_date:"2026-08-01", end_date:null, budget_planned:null, budget_actual:null,
    standard_note:null, detail:null, result_summary:null, result_obstacle:null,
    result_suggestion:null, okrs:[], links:[], approvals:[]
  };

  const empty = detailHtml(base);
  for (const heading of ["รายละเอียด", "มาตรฐาน/กลยุทธ์", "ผลการดำเนินงาน", "เอกสาร", "ผลการพิจารณาล่าสุด"]) {
    assert.doesNotMatch(empty, new RegExp(`>${heading}<`));
  }
  assert.doesNotMatch(empty, /ผลการดำเนินงาน/);

  const unsafe = '<script>alert("x")</script>';
  const completed = detailHtml({
    ...base,
    status:"เสร็จสิ้น",
    result_obstacle:unsafe,
    links:[
      { kind:"เอกสารนำเสนอเพื่ออนุมัติ", label:"เสนอ", url:"https://example.com/1" },
      { kind:"สรุปโครงการ", label:"สรุป", url:"https://example.com/2" },
      { kind:"อื่น ๆ", label:unsafe, url:"https://example.com/3" }
    ],
    approvals:[{ action:"อนุมัติ", acted_by_name:"ผู้อำนวยการ", created_at:"2026-08-25T19:30:00+00:00", note:unsafe }]
  });
  assert.match(completed, /<span class="long-label">ผลการดำเนินงาน<\/span>/);
  assert.match(completed, /<div class="long-sub">ปัญหา\/อุปสรรค<\/div>/);
  assert.equal((completed.match(/class="detail-document"/g) || []).length, 3);
  assert.match(completed, /ผลการพิจารณาล่าสุด/);
  assert.match(completed, /26 ส\.ค\. 2569/);
  assert.doesNotMatch(completed, /25 ส\.ค\. 2569/);
  assert.doesNotMatch(completed, /<script>/);
  assert.match(completed, /&lt;script&gt;/);
});

test("fmtDate ตรงกับหน้าอนุมัติทุกตัวอักษรและล็อก UTC", () => {
  const approvalPage = read("academic/project-approval.html");
  const extract = source => source.match(/  const fmtDate = value =>[\s\S]*?\n  \}\) : "—";/)?.[0] || "";
  const reportFmtDate = extract(page);
  assert.ok(reportFmtDate, "ไม่พบ fmtDate ในหน้ารายงาน");
  assert.equal(reportFmtDate, extract(approvalPage));
  assert.match(reportFmtDate, /timeZone:"UTC"/);
});

test("fmtDateTime ตรงกับหน้าอนุมัติและส่ง timestamp เต็มเข้าเวลาประเทศไทย", () => {
  const approvalPage = read("academic/project-approval.html");
  const extract = source => source.match(/  const fmtDateTime = value =>[\s\S]*?\n  \}\) : "—";/)?.[0] || "";
  const reportFmtDateTime = extract(page);
  assert.ok(reportFmtDateTime, "ไม่พบ fmtDateTime ในหน้ารายงาน");
  assert.equal(reportFmtDateTime, extract(approvalPage));
  assert.match(reportFmtDateTime, /timeZone:"Asia\/Bangkok"/);

  const start = page.indexOf("function detailHtml(");
  const end = page.indexOf("\n\n  function projectRow", start);
  const detailBlock = page.slice(start, end);
  assert.match(detailBlock, /fmtDateTime\(latest\.created_at\)/);
  assert.doesNotMatch(detailBlock, /\.slice\(0, 10\)/);
});

test("popup ผูก listener ครั้งเดียว ปิดได้สามทาง และคืนโฟกัส", () => {
  assert.equal((page.match(/el\("project-rows"\)\?\.addEventListener\("click"/g) || []).length, 1);
  assert.match(page, /event\.target\.closest\("\[data-detail\]"\)/);
  assert.match(page, /el\("detail-close"\)\.focus\(\)/);
  assert.match(page, /event\.target === el\("detail-overlay"\)/);
  assert.equal((page.match(/document\.addEventListener\("keydown"/g) || []).length, 1);
  assert.match(page, /event\.key === "Escape" && !el\("detail-overlay"\)\.hidden/);
  assert.match(page, /if \(trigger\?\.isConnected\) trigger\.focus\(\)/);
});

test("follow-grid ใบเดียวเต็มแถวทั้งบนจอและตอนพิมพ์โดยไม่ดันจอแคบ", () => {
  const rules = [...page.matchAll(/\.follow-grid\s*\{([^}]*)\}/g)].map(match => match[1]);
  const repeatRules = rules.filter(rule => rule.includes("repeat("));
  assert.equal(repeatRules.length, 2, "ต้องมีกฎ repeat สำหรับจอและ print อย่างละหนึ่งจุด");
  for (const rule of repeatRules) {
    assert.match(rule, /repeat\(auto-fit,/);
    assert.match(rule, /minmax\(min\(100%,\s*420px\),\s*1fr\)/);
    assert.doesNotMatch(rule, /repeat\(2,/);
  }
});

test("CSS พิมพ์ซ่อนเมนูและตัวควบคุม พร้อมกันแถวถูกตัดครึ่ง", () => {
  assert.match(page, /@media print\s*\{/);
  assert.match(page, /header, header \.nav,[^}]*display:\s*none\s*!important/);
  assert.match(page, /#year-card, #filter-card, button, #toast/);
  assert.match(page, /\.print-header\s*\{\s*display:\s*block\s*!important/);
  assert.match(page, /break-inside:\s*avoid/);
  assert.match(page, /page-break-inside:\s*avoid/);
  assert.match(page, /รายงานสรุปโครงการ\/กิจกรรม ปีการศึกษา/);
  assert.match(page, /วันที่พิมพ์/);
});

test("ชื่อหน้าและ workflow ตรงกันสี่จุด", () => {
  const menuName = shell.match(/\["project-report\.html",\s*"([^"]+)"\]/)?.[1];
  const titleName = page.match(/<title>([^<]+) — CRS MIS<\/title>/)?.[1];
  const h1Name = page.match(/<h1>([^<]+)<\/h1>/)?.[1];
  const workflowName = shell.match(/"project-report\.html": \{\s*title: "([^"]+)"/)?.[1];
  assert.equal(menuName, "รายงานโครงการ/กิจกรรม");
  assert.deepEqual([titleName, h1Name, workflowName], [menuName, menuName, menuName]);
});

test("เมนูรายงานไม่อยู่ในลิสต์จำกัดสิทธิ์", () => {
  assert.match(shell, /\["project-approval\.html", "อนุมัติโครงการ\/กิจกรรม"\],\s*\["project-report\.html", "รายงานโครงการ\/กิจกรรม"\]/);
  for (const list of ["hrOnly", "financeOnly", "reportOnly"]) {
    const values = shell.match(new RegExp(`${list}: \\[([^\\]]*)\\]`))?.[1] || "";
    assert.doesNotMatch(values, /project-report\.html/);
  }
});

test("cache-buster ถูกบัมพ์เฉพาะ app-shell", () => {
  const all = htmlFiles().map(path => readFileSync(path, "utf8")).join("\n");
  assert.deepEqual([...new Set(all.match(/app-shell\.js\?v=[0-9a-z-]+/g))], ["app-shell.js?v=20260831-1"]);
  assert.deepEqual([...new Set(all.match(/supabase-client\.js\?v=[0-9a-z-]+/g))], ["supabase-client.js?v=20260831-1"]);
  assert.deepEqual([...new Set(all.match(/app-shell\.css\?v=[0-9a-z-]+/g))], ["app-shell.css?v=20260820-2"]);
});

test("หน้ารายงานคง cache-buster ทั้งสามตัวเลขเดิม", () => {
  assert.match(page, /supabase-client\.js\?v=20260831-1/);
  assert.match(page, /app-shell\.js\?v=20260831-1/);
  assert.match(page, /app-shell\.css\?v=20260820-2/);
});

test("module script คอมไพล์ผ่านและไม่มี native dialog", () => {
  assert.doesNotMatch(page, /\b(?:alert|confirm|prompt)\s*\(/i);
  const match = page.match(/<script type="module">([^]*?)<\/script>/);
  assert.ok(match);
  const body = match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m, "");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(body));
});

console.log(`project report: ${passed} cases passed`);
