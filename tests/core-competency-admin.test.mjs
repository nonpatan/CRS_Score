import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const core = read("academic/competency-core.html");
const competencyManage = read("academic/competency-manage.html");
const competencyEntry = read("academic/competency-entry.html");
const manage = read("academic/manage.html");
const summary = read("academic/summary.html");
const shell = read("app-shell.js");

// Migration เพิ่ม active เท่านั้น ไม่เปลี่ยน RLS และ seed ซ้ำต้องไม่ทับชื่อที่ครูแก้
const marker = "Migration: ปลดระวางรายการสมรรถนะหลักแทนการลบ (2026-08-09)";
assert.equal(schema.split(marker).length - 1, 1);
const migrationStart = schema.indexOf(marker);
const nextMigrationStart = schema.indexOf("\n-- Migration:", migrationStart + marker.length);
const migration = schema.slice(migrationStart,
  nextMigrationStart < 0 ? schema.length : nextMigrationStart);
assert.match(migration, /alter table core_competencies\s+add column if not exists active boolean not null default true/);
assert.match(migration, /alter table core_competency_elements\s+add column if not exists active boolean not null default true/);
assert.doesNotMatch(migration, /create policy|drop policy/);
const seedStart = schema.indexOf("insert into core_competencies (code, name, seq)");
const elementSeedStart = schema.indexOf("insert into core_competency_elements", seedStart);
assert.match(schema.slice(seedStart, elementSeedStart), /on conflict \(code\) do nothing/);
assert.match(schema.slice(elementSeedStart, schema.indexOf("-- สิทธิ์:", elementSeedStart)), /on conflict \(competency_id, stage, seq\) do nothing/);

// Policy จริงยังเป็น admin/ฝ่ายวิชาการสำหรับ insert/update และ delete เป็น admin เท่านั้น
assert.match(schema, /core_competencies_insert[^]*?is_admin\(\) or has_department\('วิชาการ'\)/);
assert.match(schema, /core_competencies_update[^]*?using \(is_admin\(\) or has_department\('วิชาการ'\)\)[^]*?with check/);
assert.match(schema, /core_competencies_delete[^]*?using \(is_admin\(\)\)/);
assert.match(schema, /core_elements_insert[^]*?is_admin\(\) or has_department\('วิชาการ'\)/);
assert.match(schema, /competency_source_weights_update[^]*?has_department\('วิชาการ'\)/);
assert.match(schema, /competency_levels_update[^]*?has_department\('วิชาการ'\)/);

// helper ช่วงชั้น: ม.3 ไม่มีช่วงชั้น 4, ม.6 มี และค่าที่ไม่ตั้งคืนครบทุกช่วงชั้น
const gradeStart = client.indexOf("export const GRADE_ORDER");
const helperEnd = client.indexOf("// ============================================================\n// ตรรกะสรุปสมรรถนะ", gradeStart);
const helperSource = client.slice(gradeStart, helperEnd).replaceAll("export ", "");
const helpers = new Function(helperSource + "; return { availableCompetencyStages };")();
assert.deepEqual(helpers.availableCompetencyStages("ม.3"), ["ช่วงชั้น 1","ช่วงชั้น 2","ช่วงชั้น 3"]);
assert.deepEqual(helpers.availableCompetencyStages("ม.6"), ["ช่วงชั้น 1","ช่วงชั้น 2","ช่วงชั้น 3","ช่วงชั้น 4"]);
assert.deepEqual(helpers.availableCompetencyStages(null), ["ช่วงชั้น 1","ช่วงชั้น 2","ช่วงชั้น 3","ช่วงชั้น 4"]);

// หน้า catalog: เพิ่ม/แก้ชื่อ/ปลดระวาง ไม่มีลบ และสิทธิ์ทั้งหน้าใช้ admin หรือฝ่ายวิชาการ
assert.match(core, /checkDepartment\("วิชาการ"\)/);
assert.match(core, /const canManageCore = Boolean\(isAdmin \|\| hasAcademicDept\)/);
assert.match(core, /รายการสมรรถนะหลัก/);
assert.match(core, /✎ แก้ชื่อ/);
assert.match(core, /⏸ ปลดระวาง/);
assert.match(core, /↩ นำกลับมาใช้/);
assert.match(core, /ชื่อนี้ใช้ร่วมกันทุกปีการศึกษา[^]*?ปลดระวางรายการเดิมแล้วเพิ่มรายการใหม่แทน/);
assert.doesNotMatch(core, /from\("core_(?:competencies|competency_elements)"\)\.delete/);
assert.doesNotMatch(core, />[^<]*(?:ลบด้าน|ลบองค์ประกอบ)[^<]*</);
assert.doesNotMatch(core, /if\s*\(!isAdmin\)\s*return/);
assert.match(core, /canManageCore\?"":"disabled"/);

// เพิ่มด้าน/องค์ประกอบใช้ max(seq)+1 รวม active/inactive และด้านใหม่มีน้ำหนัก 100/0/0
assert.match(core, /competencies\.reduce\(\(max,row\)=>Math\.max\(max,Number\(row\.seq\)\|\|0\),0\)\+1/);
assert.match(core, /elements\.filter\(row=>row\.competency_id===competencyId&&row\.stage===stage\)\.reduce/);
assert.match(core, /subject_weight:100,activity_weight:0,routine_weight:0/);
assert.match(core, /error\.code==="23505"/);
assert.match(core, /\^\[a-z_\]\+\$/);
assert.doesNotMatch(core, /rows\.length\s*!==\s*6/);
assert.match(core, /const activeCount=activeCompetencies\(\)\.length/);
assert.match(core, /for\(const competency of activeRows\)/);

// ช่วงชั้นใช้ helper กลาง: ฟอร์มกรอง แต่รายการเดิมรวม stage ที่มีอยู่แล้วเสมอ
assert.match(core, /allowedStages=availableCompetencyStages\(highestGrade\)/);
assert.match(core, /new Set\(\[\.\.\.allowedStages,\.\.\.competencyElements\.map/);
assert.match(competencyManage, /allowedCompetencyStages=availableCompetencyStages\(highestGrade\)/);
assert.match(competencyManage, /e\.active!==false&&allowedCompetencyStages\.includes\(e\.stage\)/);
assert.match(competencyEntry, /new Set\(\[\.\.\.allowedCompetencyStages, \.\.\.targetStages, \.\.\.sessionStages\]\)/);
for (const source of [core, competencyManage, competencyEntry]) {
  assert.doesNotMatch(source, /\["ช่วงชั้น 1",\s*"ช่วงชั้น 2",\s*"ช่วงชั้น 3"\]/);
}

// ตัวเลือกใหม่กรอง active แต่ edit ต้องคงค่าปลดระวางเดิม; summary ห้ามกรอง
assert.match(competencyManage, /competencies\.filter\(row=>row\.active!==false\)/);
assert.match(manage, /\(c\.active !== false && !used\.has\(c\.id\)\) \|\| c\.id === ref\.core_competency_id/);
assert.match(manage, /e\.active !== false \|\| \(mode === "edit" && e\.id === ref\.core_competency_element_id\)/);
const reportInit = summary.slice(summary.indexOf("async function initCompetencyReport"), summary.indexOf("function renderCompetencyFilters"));
assert.match(reportInit, /from\("core_competencies"\)\.select\("\*"\)/);
assert.doesNotMatch(reportInit, /from\("core_competencies"\)[^;]*?(?:eq|filter)\("active"/);

// ไม่มี native dialog ใหม่ และ cache-buster กลางตรงกันทุกหน้า
const executableCore = core.replace(/<!--[^]*?-->/g, "").replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executableCore, /\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
assert.match(shell, /จัดการรายการและองค์ประกอบ/);
const appShellVersions = execFileSync("sh", ["-c", "grep -rho 'app-shell\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], {cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);
const clientVersions = execFileSync("sh", ["-c", "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], {cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);
assert.deepEqual(appShellVersions,["app-shell.js?v=20260831-1"]);
assert.deepEqual(clientVersions,["supabase-client.js?v=20260831-1"]);

console.log("core competency admin: migration, permissions, active catalog, dynamic weights, historical selections and stages passed");
