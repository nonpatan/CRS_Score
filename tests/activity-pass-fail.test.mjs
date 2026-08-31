import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const entry = read("academic/competency-entry.html");
const summary = read("academic/summary.html");
const manage = read("academic/manage.html");
const shell = read("app-shell.js");
const login = read("login.html");
const handover = read("handover.html");

// ของที่สร้างซ้ำถูกถอนตามลำดับที่ปลอดภัย และเก็บ migration เดิมไว้เป็นประวัติ
assert.equal(existsSync(new URL("academic/activities.html", root)), false);
assert.match(schema, /Migration: ผลกิจกรรมพัฒนาผู้เรียน ผ่าน\/ไม่ผ่าน \(2026-08-09\) — ❌ ยกเลิก/);
const cancelMarker = "Migration: ยกเลิกโมดูลกิจกรรมที่สร้างซ้ำ (2026-08-09)";
assert.equal(schema.split(cancelMarker).length - 1, 1);
const migration = schema.slice(schema.indexOf(cancelMarker));
assert.match(migration, /select \(select count\(\*\) from activities\) as activities,[^]*activity_enrollments[^]*activity_results/);
const orderedDrops = [
  "drop policy if exists activity_results_write",
  "drop policy if exists activity_results_select",
  "drop policy if exists activity_enrollments_write",
  "drop policy if exists activity_enrollments_select",
  "drop policy if exists activities_delete",
  "drop table if exists activity_results",
  "drop table if exists activity_enrollments",
  "drop table if exists activities",
  "drop function if exists can_edit_activity(uuid)"
];
let lastDrop = -1;
for (const fragment of orderedDrops) {
  const index = migration.indexOf(fragment);
  assert.ok(index > lastDrop, `${fragment} ต้องอยู่หลังรายการก่อนหน้า`);
  lastDrop = index;
}

// ตารางจริงมีตัวเดียว: ไม่มีปี/เทอม/ครั้ง และใช้ helper สิทธิ์เดิม
const createStart = migration.indexOf("create table if not exists activity_pass_results");
const createEnd = migration.indexOf(");", createStart) + 2;
const createTable = migration.slice(createStart, createEnd);
assert.match(createTable, /assessment_id uuid not null references competency_assessments\(id\) on delete cascade/);
assert.match(createTable, /student_id\s+uuid not null references students\(id\) on delete cascade/);
assert.match(createTable, /passed\s+boolean not null/);
assert.doesNotMatch(createTable, /\b(?:year|term|session_id)\b/);
assert.doesNotMatch(createTable, /passed[^\n]*default/i);
assert.match(migration, /activity_pass_results_unique unique \(assessment_id, student_id\)/);
assert.match(migration, /alter table activity_pass_results enable row level security/);
assert.match(migration, /activity_pass_results_select[^]*?auth\.role\(\) = 'authenticated'/);
assert.match(migration, /activity_pass_results_write[^]*?for all[^]*?using \(can_edit_competency_assessment\(assessment_id\)\)[^]*?with check \(can_edit_competency_assessment\(assessment_id\)\)/);
assert.doesNotMatch(migration, /create (?:or replace )?function can_edit_activity/);

// การ์ดผูกกับกิจกรรม ไม่ผูก session และใช้สมาชิกที่หน้าโหลดไว้แล้ว
assert.match(entry, /ผลกิจกรรมพัฒนาผู้เรียน \(ผ่าน\/ไม่ผ่าน\)/);
assert.match(entry, /current && current\.source_type === "กิจกรรม"/);
assert.doesNotMatch(entry, /source_type === "กิจวัตรประจำวัน"[^]*?activity-pass-card/);
assert.match(entry, /assessmentMembers\.map\(member => member\.student\)/);
assert.match(entry, /renderActivityPassResults\(\);[^]*?renderStageOptions\(\)/);
assert.match(entry, /function canEdit\(\) \{[^]*?isAdmin \|\| current\.owner_id === session\.user\.id/);
const passRenderStart = entry.indexOf("function renderActivityPassResults");
const passRenderEnd = entry.indexOf("function availableStagesForAssessment", passRenderStart);
assert.doesNotMatch(entry.slice(passRenderStart, passRenderEnd), /currentSession/);

// สามสถานะ: pending ลบแถว, all-pass ไม่เขียนฐาน และบันทึกตรวจจำนวนตอบกลับ
const allPassStart = entry.indexOf('$("btn-activity-all-pass").addEventListener');
const saveStart = entry.indexOf('$("btn-save-activity-pass").addEventListener', allPassStart);
const allPassBlock = entry.slice(allPassStart, saveStart);
assert.match(allPassBlock, /select\.value = "pass"/);
assert.doesNotMatch(allPassBlock, /sb\.(?:from|rpc)/);
const saveEnd = entry.indexOf("function renderTargets", saveStart);
const saveBlock = entry.slice(saveStart, saveEnd);
assert.match(saveBlock, /if \(!status\) \{[^]*?existingIds\.has\(studentId\)[^]*?removeIds\.push\(studentId\)/);
assert.match(saveBlock, /passed: status === "pass"/);
assert.match(saveBlock, /from\("activity_pass_results"\)\.upsert\(rows, \{ onConflict:"assessment_id,student_id" \}\)/);
assert.match(saveBlock, /from\("activity_pass_results"\)\.delete\(\)\.eq\("assessment_id", current\.id\)/);
assert.match(saveBlock, /saveResult\.data \|\| \[\]\)\.length !== rows\.length/);
assert.match(saveBlock, /deleteResult\.data \|\| \[\]\)\.length !== removeIds\.length/);

// ตัวนับจริงจากฟังก์ชันหน้าเว็บ
const countStart = entry.indexOf("function updateActivityPassSummary()");
const countEnd = entry.indexOf("function renderActivityPassResults()", countStart);
const countSource = entry.slice(countStart, countEnd);
const summaryNode = { textContent:"" };
const statuses = ["pass", "pass", "fail", ""];
const fakeDollar = id => id === "activity-pass-list"
  ? { querySelectorAll: () => statuses.map(value => ({ value })) }
  : summaryNode;
const updateSummary = new Function("$", countSource + "; return updateActivityPassSummary;")(fakeDollar);
updateSummary();
assert.equal(summaryNode.textContent, "ผ่าน 2 · ไม่ผ่าน 1 · ยังไม่ประเมิน 1");

// สรุปรายคนใช้ assessment/member/result จริง และไม่แตะสูตรผลการเรียน
assert.match(summary, /from\("competency_assessments"\)[^]*?\.eq\("source_type", "กิจกรรม"\)/);
assert.match(summary, /from\("competency_assessment_members"\)/);
assert.match(summary, /from\("activity_pass_results"\)/);
assert.match(summary, /badge good[^]*?ผ่าน/);
assert.match(summary, /badge bad[^]*?ไม่ผ่าน/);
assert.match(summary, /badge mid[^]*?ยังไม่ประเมิน/);
assert.match(summary, /result && !result\.passed && result\.note/);

// เมนูรวมเข้าหน้าเดิมและถอนหน้าเก่าจากทุกจุดนำทาง
assert.match(shell, /\["competency-entry\.html", "กรอกคะแนนกิจกรรม\/กิจวัตร"\]/);
assert.match(shell, /"competency-entry\.html": \{[^]*?title: "กรอกคะแนนกิจกรรม\/กิจวัตร"[^]*?ผ่าน\/ไม่ผ่าน/);
for (const source of [shell, login, handover]) assert.doesNotMatch(source, /activities\.html/);
assert.match(entry, /<title>กรอกคะแนนกิจกรรม\/กิจวัตร — CRS MIS<\/title>/);
assert.match(entry, /<h1>กรอกคะแนนกิจกรรม\/กิจวัตร<\/h1>/);

// งานพ่วงลบปียังคงเดิม
assert.match(manage, /sb\.rpc\("academic_year_reference_counts"/);
assert.match(manage, /sb\.rpc\("delete_academic_year"/);
assert.doesNotMatch(manage, /from\("academic_years"\)\.delete\(\)/);

const appShellVersions = execFileSync("sh", ["-c",
  "grep -rho 'app-shell\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"
], { cwd:root, encoding:"utf8" }).trim().split("\n").filter(Boolean);
assert.deepEqual(appShellVersions, ["app-shell.js?v=20260831-1"]);

console.log("activity pass/fail fix: reused assessments, one result table, three states, summary and navigation checks passed");
