import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const manage = read("academic/manage.html");
const rollover = read("academic/rollover.html");
const competencyManage = read("academic/competency-manage.html");
const competencyEntry = read("academic/competency-entry.html");
const hrSettings = read("personnel/hr-settings.html");
const visualFixture = read("tests/academic-year-source-visual.html");

// RLS: ย้าย insert/update ไปฝ่ายวิชาการ และคง select/delete เดิมไว้
const migrationMarker = "Migration: รวมแหล่งรายการปีการศึกษาที่ academic_years";
assert.equal(schema.split(migrationMarker).length - 1, 1, "migration งานนี้ต้องมีบล็อกเดียว");
const migration = schema.slice(schema.indexOf(migrationMarker));
const policyBlock = migration.slice(0, migration.indexOf("ย้อนกลับ migration นี้"));
assert.match(policyBlock, /create policy academic_years_insert[^]*?for insert[^]*?with check \(has_department\('วิชาการ'\)\)/);
assert.match(policyBlock, /create policy academic_years_update[^]*?for update[^]*?using[^]*?has_department\('วิชาการ'\)[^]*?with check[^]*?has_department\('วิชาการ'\)/);
assert.doesNotMatch(policyBlock, /has_department\('บุคลากร'\)/);
assert.doesNotMatch(migration, /drop policy if exists academic_years_delete/);
assert.match(migration, /คืนสิทธิ์เพิ่ม\/แก้ให้ฝ่ายบุคลากรเท่านั้น/);
const uncommentedMigration = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
assert.doesNotMatch(uncommentedMigration, /subjects_year_fk|references academic_years/,
  "foreign key ต้องเป็นข้อเสนอแบบ comment เท่านั้น");

// รัน helper จริงจาก supabase-client.js ด้วย sb จำลอง เพื่อทดสอบ union/sort/validation
const helperStart = client.indexOf("export async function listSelectableYears");
const helperEnd = client.indexOf("export function academicYearRange", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "ต้องมี helper ปีการศึกษากลางครบ");
const helperSource = client.slice(helperStart, helperEnd).replaceAll("export ", "");
let upsertPayload = null;
let upsertOptions = null;
const fakeSb = {
  from(table) {
    assert.equal(table, "academic_years");
    return {
      select() {
        return {
          order() {
            return Promise.resolve({
              data: [
                { year: "2569", start_date: "2026-05-18" },
                { year: "2571", start_date: "2028-05-16" }
              ],
              error: null
            });
          }
        };
      },
      upsert(payload, options) {
        upsertPayload = payload;
        upsertOptions = options;
        return {
          select() {
            return {
              single() { return Promise.resolve({ data: payload, error: null }); }
            };
          }
        };
      }
    };
  }
};
const { listSelectableYears, saveAcademicYear } = new Function("sb",
  helperSource + "; return { listSelectableYears, saveAcademicYear };"
)(fakeSb);

const selectable = await listSelectableYears(["2568", "2570", { year: "2569" }, ""]);
assert.deepEqual(selectable.map(row => row.year), ["2571", "2570", "2569", "2568"]);
assert.equal(selectable.find(row => row.year === "2569").registered, true);
assert.equal(selectable.find(row => row.year === "2570").registered, false);
assert.equal(selectable.find(row => row.year === "2570").start_date, null);

for (const badYear of ["999", "25700", "abcd"]) {
  await assert.rejects(() => saveAcademicYear(badYear, "2027-05-17"), /ตัวเลข 4 หลัก/);
}
await assert.rejects(() => saveAcademicYear("2570", ""), /เลือกวันเริ่มปี/);
const saved = await saveAcademicYear(" 2570 ", "2027-05-17");
assert.deepEqual(saved, { year: "2570", start_date: "2027-05-17" });
assert.deepEqual(upsertPayload, saved);
assert.deepEqual(upsertOptions, { onConflict: "year" });

// จุดสร้าง/แก้ปีใช้ helper กลาง ส่วนตัวกรองปีอื่นยังคงตรรกะเดิม
for (const [name, html] of [
  ["manage", manage], ["rollover", rollover],
  ["competency-manage", competencyManage], ["competency-entry", competencyEntry]
]) {
  assert.match(html, /listSelectableYears/,
    `${name} ต้องใช้รายการปีจาก helper กลาง`);
  assert.doesNotMatch(html, /getAcademicYears\(/,
    `${name} ห้ามสร้างรายการปีด้วย getAcademicYears ตรง ๆ`);
}
assert.match(manage, /<select id="f-year">/);
assert.doesNotMatch(manage, /<input type="text" id="f-year"/);
assert.match(manage, /listSelectableYears\(distinctYears\(allSubjects\)\)/);
assert.match(manage, /id="academic-years-card"/);
assert.match(manage, /id="academic-year-list"/);
assert.match(manage, /แก้วันเริ่ม/);
assert.doesNotMatch(manage, /function\s+askConfirm\s*\(/,
  "manage.html ต้องใช้กล่องยืนยันกลาง ไม่สร้าง askConfirm ของตัวเอง");
assert.match(manage, /window\.crsAskConfirm\(\{[^]*?ปฏิทิน[^]*?เช็คชื่อรายวัน[^]*?สรุปเวลาทำงาน[^]*?วันลา[^]*?danger:\s*true/);
assert.match(manage, /type="date" id="new-academic-year-start"/);
assert.match(rollover, /<select id="inp-new-year">/);
assert.doesNotMatch(rollover, /<input type="text" id="inp-new-year"/);
assert.match(rollover, /ปี[^]*?ยังไม่ได้ลงทะเบียน[^]*?กด “\+ เพิ่มปี”/);
assert.match(rollover, /row\.year === suggestedYear && row\.registered/);
assert.match(competencyManage, /listSelectableYears\(assessmentYears\)/);
assert.match(competencyEntry, /listSelectableYears\(assessments\.map\(a => a\.year\)/);
for (const html of [manage, rollover]) {
  assert.match(html, /saveAcademicYear\(/);
  assert.match(html, /ดูจากปฏิทินโรงเรียนจริง อย่ากรอกวันที่ 1 โดยอัตโนมัติ/);
}

assert.doesNotMatch(hrSettings, /id="(?:new-year|new-year-start|btn-add-year)"/);
assert.doesNotMatch(hrSettings, /ต้องเพิ่มอย่างน้อย 1 ปี/);
assert.match(hrSettings, /วันเปิดเรียนของนักเรียนกำหนดโดยฝ่ายวิชาการที่หน้า “จัดการโครงสร้าง”/);
assert.match(hrSettings, /getWorkYears/);
assert.match(hrSettings, /id="btn-save-hr-years"/);
assert.doesNotMatch(hrSettings, /from\("academic_years"\)\.upsert/);

const runStart = rollover.indexOf('btnRun.addEventListener("click"');
const registeredCheck = rollover.indexOf("const latestYears = await listSelectableYears", runStart);
const copyWeights = rollover.indexOf("await copyGradeWeightsToYear(src, newYear, addLog)", runStart);
assert.ok(runStart >= 0 && registeredCheck > runStart && copyWeights > registeredCheck,
  "rollover ต้องยืนยัน academic_years ก่อนคัดลอกอัตราส่วนและก่อนแตะข้อมูลอื่น");

const executableHtml = [manage, rollover, competencyManage, competencyEntry]
  .join("\n")
  .replace(/<!--[^]*?-->/g, "")
  .replace(/\/\*[^]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executableHtml, /\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
assert.match(visualFixture, /ปีการศึกษา 2568[^]*?ยังไม่ลงทะเบียนในระบบ/);
assert.match(visualFixture, /min-height:44px/);
assert.match(visualFixture, /window\.crsAskConfirm\(\{[^]*?danger:\s*true/);
assert.doesNotMatch(visualFixture, /\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/);

const versions = execFileSync("sh", ["-c",
  "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"
], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
assert.deepEqual(versions, ["supabase-client.js?v=20260831-1"]);

console.log("academic year source: RLS, helpers, forms, rollover order and cache checks passed");
