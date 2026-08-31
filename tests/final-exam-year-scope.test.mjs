import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const client = readFileSync(new URL("../supabase-client.js", import.meta.url), "utf8");
const rollover = readFileSync(new URL("../academic/rollover.html", import.meta.url), "utf8");
const entry = readFileSync(new URL("../academic/entry.html", import.meta.url), "utf8");

const migrationMarker = "Migration: คะแนนสอบปลายภาค/ปลายปี + อัตราส่วนคะแนน";
assert.equal(schema.split(migrationMarker).length - 1, 1, "ต้องแก้ migration ก้อน 3 เดิม ไม่สร้างบล็อกซ้อน");
const migrationStart = schema.indexOf(migrationMarker);
const nextMigrationStart = schema.indexOf("Migration: รวมแหล่งรายการปีการศึกษาที่ academic_years", migrationStart);
const migration = schema.slice(migrationStart, nextMigrationStart);
assert.match(migration, /alter table subjects alter column year set not null/);
assert.match(migration, /subjects_year_not_blank check \(btrim\(year\) <> ''\)/);
assert.match(migration, /year\s+text\s+not null/);
assert.match(migration, /primary key \(year, level\)/);
assert.doesNotMatch(migration, /references\s+academic_years/i);
assert.match(migration, /cross join \(values[^]*?'ประถม'[^]*?'มัธยม'/);
assert.match(migration, /on conflict \(year, level\) do nothing/);
assert.match(migration, /create policy grade_weights_insert[^]*?for insert[^]*?has_department\('วิชาการ'\)/);
assert.match(migration, /can_edit_subject\(p_subject_id\) or has_department\('วิชาการ'\)/);
assert.match(migration, /drop policy if exists grade_weights_insert on grade_weights/);
assert.match(migration, /alter table subjects alter column year drop not null/);

const examWriteStart = migration.indexOf("create policy exam_scores_write");
const examWriteEnd = migration.indexOf("-- อัตราส่วน:", examWriteStart);
const examWritePolicy = migration.slice(examWriteStart, examWriteEnd);
assert.match(examWritePolicy, /can_edit_subject\(subject_id\)/);
assert.doesNotMatch(examWritePolicy, /has_department/);

assert.match(client, /select\("year, level, collect_weight, exam_weight, updated_at"\)/);
assert.match(client, /row\.year === subj\.year && row\.level === subj\.level/);
assert.match(client, /gradeWeight\.level !== subj\.level \|\| gradeWeight\.year !== subj\.year/);
assert.match(client, /จัดการโครงสร้าง/);

const entryWeightSelector = entry.match(
  /currentGradeWeight = gradeWeights\.find\(\s*(row => row\.year === currentSubject\.year && row\.level === currentSubject\.level)\s*\) \|\| null;/
);
assert.ok(entryWeightSelector, "entry.html ต้องจับคู่อัตราส่วนด้วยทั้งปีและระดับ");
assert.doesNotMatch(entry,
  /gradeWeights\.find\(\s*row => row\.level === currentSubject\.level\s*\)/,
  "entry.html ห้ามเลือกอัตราส่วนด้วยระดับอย่างเดียว");
assert.match(entry, /อัตราส่วนคะแนนของปีการศึกษา[^]*?ระดับ[^]*?จัดการโครงสร้าง/);
assert.match(entry, /ตัวเลขนี้มาจากอัตราส่วนของปีการศึกษา/);

const selectEntryWeight = new Function("gradeWeights", "currentSubject",
  `return gradeWeights.find(${entryWeightSelector[1]}) || null;`);
const fixtureWeights = [
  { year: "2569", level: "ประถม", collect_weight: 80, exam_weight: 20 },
  { year: "2570", level: "ประถม", collect_weight: 70, exam_weight: 30 }
];
const fixtureSubject = { year: "2570", level: "ประถม" };
assert.equal(selectEntryWeight(fixtureWeights, fixtureSubject)?.exam_weight, 30,
  "วิชาปี 2570 ต้องใช้เพดาน 30 ของปี 2570 ไม่ใช่เพดาน 20 ของปี 2569");

assert.match(rollover, /\.from\("grade_weights"\)[^]*?\.eq\("year", sourceYear\)/);
assert.match(rollover, /onConflict: "year,level"/);
assert.match(rollover, /ignoreDuplicates: true/);
assert.match(rollover, /ปีต้นทางยังไม่มีค่า ใช้ค่าเริ่มต้นประถม 80:20 · มัธยม 70:30 แล้ว/);
const copyAt = rollover.indexOf("await copyGradeWeightsToYear(src, newYear, addLog)");
const mutateStudentAt = rollover.indexOf("กำลังจัดการนักเรียน", copyAt);
const cloneSubjectAt = rollover.indexOf("กำลังยกวิชาไปปี", copyAt);
assert.ok(copyAt >= 0 && mutateStudentAt > copyAt && cloneSubjectAt > copyAt,
  "ต้องคัดลอกอัตราส่วนสำเร็จก่อนแตะนักเรียนและก่อนก๊อปวิชา");

const versions = execFileSync("sh", ["-c",
  "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"
], { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim().split("\n").filter(Boolean);
assert.deepEqual(versions, ["supabase-client.js?v=20260831-1"]);

console.log("final-exam year scope: schema, RLS, client, entry, rollover and cache checks passed");
