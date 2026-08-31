import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const client = read("supabase-client.js");
const page = read("academic/projects.html");
const schema = read("schema.sql");

const clientStart = client.indexOf("export async function reportProjectProgress");
const clientEnd = client.indexOf("export async function loadAcademicProjects", clientStart);
assert.ok(clientStart >= 0 && clientEnd > clientStart, "ตัด helper รายงานผลโครงการไม่สำเร็จ");
const clientBlock = client.slice(clientStart, clientEnd).replaceAll("export ", "");

test("reportProjectProgress ส่งครบ 6 พารามิเตอร์และคงความหมายว่าง/ไม่เปลี่ยน", async () => {
  let captured;
  const callProjectApprovalRpc = async (...args) => { captured = args; return "ok"; };
  const sb = {};
  const { reportProjectProgress } = new Function(
    "callProjectApprovalRpc", "sb",
    `${clientBlock}\nreturn { reportProjectProgress };`
  )(callProjectApprovalRpc, sb);

  await reportProjectProgress("project-1", "เสร็จสิ้น", "", {
    summary:"", obstacle:undefined, suggestion:"ทำอีกครั้ง"
  });
  assert.equal(captured[0], "report_project_progress");
  assert.deepEqual(captured[1], {
    p_project_id:"project-1",
    p_status:"เสร็จสิ้น",
    p_budget_actual:null,
    p_result_summary:"",
    p_result_obstacle:null,
    p_result_suggestion:"ทำอีกครั้ง"
  });
  assert.equal(captured[2], "รายงานผลโครงการไม่สำเร็จ");

  await reportProjectProgress("project-2", "กำลังดำเนินการ", 0);
  assert.equal(captured[1].p_budget_actual, 0, "งบ 0 ต้องไม่กลายเป็น null");
  assert.equal(captured[1].p_result_summary, null, "ผู้เรียกแบบ 3 พารามิเตอร์ต้องไม่ล้างข้อความเดิม");
});

test("พารามิเตอร์ผลลัพธ์มีค่าปริยาย และ appendProjectLinks เพิ่มอย่างเดียว", async () => {
  assert.match(clientBlock, /reportProjectProgress\(id, status, budgetActual, result = \{\}\)/);
  const inserted = [];
  const sb = {
    from(table) {
      assert.equal(table, "academic_project_links");
      return { insert(rows) { inserted.push(...rows); return Promise.resolve({ error:null }); } };
    }
  };
  const callProjectApprovalRpc = async () => null;
  const { appendProjectLinks } = new Function(
    "callProjectApprovalRpc", "sb",
    `${clientBlock}\nreturn { appendProjectLinks };`
  )(callProjectApprovalRpc, sb);

  await appendProjectLinks("project-1", [
    { label:"สรุป", url:"https://example.test/summary", kind:"สรุปโครงการ" },
    { label:"ภาพ", url:"https://example.test/photo", kind:"อื่น ๆ" }
  ], 4);
  assert.deepEqual(inserted.map(row => row.sort_order), [4, 5]);
  assert.ok(inserted.every(row => row.project_id === "project-1"));
  const appendStart = clientBlock.indexOf("async function appendProjectLinks");
  const appendBlock = clientBlock.slice(appendStart);
  assert.doesNotMatch(appendBlock, /\.delete\(|\.update\(/, "append-only ห้ามแตะไฟล์เดิม");
});

test("reportStatusOptions คงวางแผนเฉพาะรายการที่ยังวางแผนจริง", () => {
  const start = page.indexOf("function reportStatusOptions(");
  const end = page.indexOf("\n\n  // Postgres", start);
  assert.ok(start >= 0 && end > start, "ตัด reportStatusOptions ไม่สำเร็จ");
  const reportStatusOptions = new Function(`${page.slice(start, end)}\nreturn reportStatusOptions;`)();
  assert.deepEqual(reportStatusOptions("วางแผน"), ["วางแผน", "กำลังดำเนินการ", "เสร็จสิ้น", "ยกเลิก"]);
  for (const status of ["กำลังดำเนินการ", "เสร็จสิ้น", "ยกเลิก"]) {
    assert.deepEqual(reportStatusOptions(status), ["กำลังดำเนินการ", "เสร็จสิ้น", "ยกเลิก"]);
  }
  assert.match(page, /const reportStatuses = reportStatusOptions\(project\?\.status \|\| "วางแผน"\)/);
  assert.match(page, /กำลังดำเนินการ = เริ่มแล้วแต่ยังไม่จบ · เสร็จสิ้น = ต้องแนบเอกสารสรุปโครงการด้วย/);
});

test("ฟอร์มมี 3 ช่องไม่บังคับ และเติมค่าจริงทุกครั้งที่เปิด", () => {
  for (const [id, max] of [
    ["p-report-summary", "6000"],
    ["p-report-obstacle", "4000"],
    ["p-report-suggestion", "4000"]
  ]) {
    const tag = page.match(new RegExp(`<textarea id="${id}"[^>]*>`))?.[0] || "";
    assert.ok(tag, `ไม่พบ ${id}`);
    assert.match(tag, new RegExp(`maxlength="${max}"`));
    assert.doesNotMatch(tag, /\brequired\b/, `${id} ต้องเว้นว่างได้`);
  }
  assert.match(page, /el\("p-report-summary"\)\.value = project\?\.result_summary \?\? ""/);
  assert.match(page, /el\("p-report-obstacle"\)\.value = project\?\.result_obstacle \?\? ""/);
  assert.match(page, /el\("p-report-suggestion"\)\.value = project\?\.result_suggestion \?\? ""/);
});

test("กล่องไฟล์แนบอยู่นอก fieldset แผน และล็อกเฉพาะไฟล์เดิมที่ไม่ใช่สรุป", () => {
  const fieldsetStart = page.indexOf('<fieldset class="plan-fields" id="project-plan-fields">');
  const fieldsetEnd = page.indexOf("</fieldset>", fieldsetStart);
  const linksAt = page.indexOf('id="project-links-field"');
  assert.ok(fieldsetStart >= 0 && fieldsetEnd > fieldsetStart && linksAt > fieldsetEnd,
    "กล่องไฟล์แนบต้องอยู่นอก fieldset ที่ถูก disabled หลังอนุมัติ");
  assert.match(page, /readonly:progressMode && link\.kind !== "สรุปโครงการ"/);
  assert.match(page, /fixedKind:progressMode/,
    "ล็อกประเภทแถวเดิมเฉพาะโหมดรายงานผล");
  assert.match(page, /if \(link\.id\) row\.dataset\.id = link\.id/,
    "แถวจากฐานต้องเก็บ data-id เพื่อไม่ insert ซ้ำ");
  const readonlyStart = page.indexOf("if (options.readonly)");
  const editableStart = page.indexOf("const kindField", readonlyStart);
  const readonlyBlock = page.slice(readonlyStart, editableStart);
  assert.doesNotMatch(readonlyBlock, /<input|<select|remove-link|เอาออก/,
    "ไฟล์เดิมที่ไม่ใช่สรุปต้องอ่านอย่างเดียวและไม่มีปุ่มเอาออก");
  assert.match(readonlyBlock, /rel="noopener noreferrer"/);
  const editableEnd = page.indexOf("el(containerId).appendChild(row);", editableStart);
  const editableBlock = page.slice(editableStart, editableEnd);
  assert.match(editableBlock, /options\.fixedKind[\s\S]*link-readonly[\s\S]*esc\(kind\)/,
    "แถวเดิมต้องแสดงประเภทเป็นข้อความ");
  assert.match(editableBlock, /remove-link[\s\S]*เอาออก/,
    "แถวสรุปเดิมและแถวใหม่ต้องมีปุ่มเอาออก");
});

test("โหมดรายงานผลจัดการลิงก์ก่อน RPC ไม่เรียก replace และไม่แตะ KR", () => {
  const start = page.indexOf('if (editingProjectMode === "progress")');
  const end = page.indexOf('\n    const kind = el("p-kind").value;', start);
  assert.ok(start >= 0 && end > start, "ตัดบล็อกบันทึกรายงานผลไม่สำเร็จ");
  const progress = page.slice(start, end);
  assert.match(progress, /readLinks\("project-link-list", "project-link", \{ newOnly:true \}\)/);
  const linksAt = progress.indexOf("await saveProgressLinks(project, existingSummaryLinks, newLinksOnly)");
  const reportAt = progress.indexOf("await reportProjectProgress(project.id, reportStatus, budgetActual, result)");
  assert.ok(linksAt >= 0 && reportAt > linksAt, "ต้องบันทึกลิงก์ก่อน reportProjectProgress");
  assert.doesNotMatch(progress, /replaceProjectDetails/);
  assert.doesNotMatch(progress, /selectedProjectOkrIds|academic_project_okrs|\bokrIds\b/);
  assert.match(progress, /บันทึกเอกสารแล้ว แต่บันทึกผลไม่สำเร็จ/);
});

test("เสร็จสิ้นต้องมีเอกสารสรุปและหยุดก่อนเขียนทุกอย่าง", () => {
  const start = page.indexOf('if (editingProjectMode === "progress")');
  const end = page.indexOf('\n    const kind = el("p-kind").value;', start);
  const progress = page.slice(start, end);
  const guardAt = progress.indexOf('if (reportStatus === "เสร็จสิ้น" && !hasSummaryDocument)');
  const linksAt = progress.indexOf("await saveProgressLinks(");
  const reportAt = progress.indexOf("await reportProjectProgress(");
  assert.ok(guardAt >= 0 && linksAt > guardAt && reportAt > guardAt,
    "ต้องเตือนก่อนเขียนลิงก์และก่อนเรียก RPC");
  const guardEnd = progress.indexOf("const result =", guardAt);
  const guard = progress.slice(guardAt, guardEnd);
  assert.match(guard, /return toast\(/);
  assert.match(guard, /กด "เพิ่มไฟล์แนบ" แล้วใส่ลิงก์เอกสารสรุป หรือเลือกสถานะ "กำลังดำเนินการ" ไว้ก่อน/);
});

test("เอกสารรายงานผลบันทึกครบสามขาโดยไม่เปลี่ยน kind เดิม", () => {
  const start = page.indexOf("async function saveProgressLinks(");
  const end = page.indexOf("\n\n  function syncProjectKind", start);
  assert.ok(start >= 0 && end > start, "ตัด saveProgressLinks ไม่สำเร็จ");
  const block = page.slice(start, end);
  assert.match(block, /\.update\(\{ label:link\.label, url:link\.url \}\)/);
  assert.match(block, /\.delete\(\)\.eq\("id", link\.id\)/);
  assert.match(block, /appendProjectLinks\(project\.id, newLinksOnly, \(project\.links \|\| \[\]\)\.length\)/);
  assert.doesNotMatch(block, /update\(\{[^}]*kind/,
    "RLS ไม่ยอมให้แถวเดิมเปลี่ยนประเภท");
});

test("ไฟล์ใหม่ในโหมดรายงานผลเริ่มเป็นสรุปโครงการ และกล่องผล escape ข้อมูลครบ", () => {
  assert.match(page, /defaultKind: editingProjectMode === "progress" \? "สรุปโครงการ" : null/);
  assert.match(page, /const resultParts = project\.status === "เสร็จสิ้น"/);
  assert.match(page, /project\.result_summary[\s\S]*project\.result_obstacle[\s\S]*project\.result_suggestion/);
  assert.match(page, /<div class="long-text">\$\{esc\(text\)\}<\/div>/);
  assert.match(page, /filter\(link => link\.kind === "สรุปโครงการ"\)\.length/);
});

test("schema ล็อกคอลัมน์ผลลัพธ์ไว้นอก grant update รายคอลัมน์", () => {
  for (const column of ["result_summary", "result_obstacle", "result_suggestion"]) {
    assert.match(schema, new RegExp(`add column if not exists ${column}\\s+text`));
  }
  const grants = schema.match(/grant update \([^;]+\) on academic_projects/gi) || [];
  assert.ok(grants.length > 0, "ไม่พบ grant update รายคอลัมน์ของ academic_projects");
  for (const grant of grants) {
    assert.doesNotMatch(grant, /result_(?:summary|obstacle|suggestion)/,
      "ห้ามเปิดสิทธิ์เขียน 3 ช่องตรงผ่าน table grant");
  }
});

test("cache-buster supabase-client เหลือค่าเดียวทั้งโครงการ", () => {
  const output = execFileSync("sh", ["-c", "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], {
    cwd:new URL("..", import.meta.url), encoding:"utf8"
  }).trim().split("\n").filter(Boolean);
  assert.deepEqual(output, ["supabase-client.js?v=20260831-1"]);
});

test("รอบนี้ cache-buster ทั้งสามไฟล์คงเลขเดิม", () => {
  const grep = pattern => execFileSync("sh", ["-c", `grep -rho '${pattern}' --include='*.html' . | sort -u`], {
    cwd:new URL("..", import.meta.url), encoding:"utf8"
  }).trim().split("\n").filter(Boolean);
  assert.deepEqual(grep("app-shell\\.js?v=[0-9a-z-]*"), ["app-shell.js?v=20260831-1"]);
  assert.deepEqual(grep("supabase-client\\.js?v=[0-9a-z-]*"), ["supabase-client.js?v=20260831-1"]);
  assert.deepEqual(grep("app-shell\\.css?v=[0-9a-z-]*"), ["app-shell.css?v=20260820-2"]);
});
