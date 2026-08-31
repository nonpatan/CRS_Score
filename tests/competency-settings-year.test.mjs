import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const core = read("academic/competency-core.html");
const summary = read("academic/summary.html");
const rollover = read("academic/rollover.html");

// Migration: backfill ก่อน NOT NULL/PK, drop seq unique ก่อน copy และมี rollback ครบ
const marker = "Migration: ค่าตั้งสมรรถนะแยกตามปีการศึกษา (2026-08-09)";
assert.equal(schema.split(marker).length - 1, 1);
const migrationStart = schema.indexOf(marker);
const nextMigrationStart = schema.indexOf("\n-- Migration:", migrationStart + marker.length);
const migration = schema.slice(migrationStart,
  nextMigrationStart < 0 ? schema.length : nextMigrationStart);
assert.match(migration, /competency_source_weights add column if not exists year text/);
assert.match(migration, /update competency_source_weights[^]*?where year is null[^]*?alter table competency_source_weights alter column year set not null[^]*?primary key \(year, competency_id\)[^]*?on conflict \(year, competency_id\) do nothing/);
assert.match(migration, /competency_interpretation_levels add column if not exists year text/);
assert.match(migration, /drop constraint if exists competency_interpretation_levels_seq_key[^]*?primary key \(year, code\)[^]*?unique \(year, seq\)[^]*?on conflict \(year, code\) do nothing/);
assert.match(migration, /delete from competency_source_weights[^]*?primary key \(competency_id\)[^]*?drop column if exists year/);
assert.match(migration, /delete from competency_interpretation_levels[^]*?primary key \(code\)[^]*?unique \(seq\)[^]*?drop column if exists year/);
assert.doesNotMatch(migration, /(?:create|drop) policy/);

// ตัวโหลดกลางกรองปีตรง ๆ และไม่มี fallback ไปปีอื่น
const loaderStart = client.indexOf("export async function loadCompetencySettings");
const loaderEnd = client.indexOf("// อ่านค่าตั้งค่าส่วนกลาง", loaderStart);
const loader = client.slice(loaderStart, loaderEnd);
assert.match(loader, /competency_source_weights[^]*?\.eq\("year", normalizedYear\)/);
assert.match(loader, /competency_interpretation_levels[^]*?\.eq\("year", normalizedYear\)\.order\("seq"\)/);
assert.doesNotMatch(loader, /fallback|\.limit\(|\.order\("year"|maybeSingle/);

// หน้าตั้งค่าเลือกปีด้วย helper กลาง บันทึก composite key และเพิ่มด้านให้ทุกปีที่มีค่า
assert.match(core, /listSelectableYears\(\)/);
assert.match(core, /getActiveYear\(\)/);
assert.match(core, /setActiveYear\(\$\("settings-year"\)\.value\)/);
assert.match(core, /loadCompetencySettings\(year\)/);
assert.match(core, /น้ำหนักสรุปสมรรถนะ 3 แหล่ง"\+yearLabel/);
assert.match(core, /ปีการศึกษา "\+settingsYear\+" ยังไม่ได้ตั้งค่า/);
assert.match(core, /คัดลอกค่าจากปี/);
assert.match(core, /onConflict:"year,competency_id"/);
assert.match(core, /onConflict:"year,code"/);
assert.match(core, /settingsByYear\.set\(settingsYear,\{weights:sourceWeights,levels:interpretationLevels\}\)/);
assert.match(core, /for\(const row of selectableSettingsYears\)[^]*?settingsYears\.push\(row\.year\)[^]*?initialWeights=settingsYears\.map\(year=>\(\{year,competency_id:data\.id,subject_weight:100,activity_weight:0,routine_weight:0/);

// catalog ยังคงใช้ร่วมทุกปี: ไม่มี year ใน payload ของรายการ/องค์ประกอบ
assert.match(core, /รายการด้านและองค์ประกอบชุดนี้ใช้ร่วมทุกปี/);
assert.doesNotMatch(core, /from\("core_competencies"\)\.insert\(\{[^}]*year/);
assert.doesNotMatch(core, /from\("core_competency_elements"\)\.insert\(\{[^}]*year/);

// รายงานโหลดค่าตามปีเมื่อเปลี่ยนปี บอกชื่อปี/ด้านที่ขาด และไม่อ่านตารางค่าตั้งตรงเอง
const reportInit = summary.slice(summary.indexOf("async function initCompetencyReport"), summary.indexOf("// รายชื่อที่ยังกรอกไม่ครบ"));
assert.match(reportInit, /loadCompetencySettingsForReport\(elCompYear\.value\)/);
assert.match(reportInit, /loadCompetencySettings\(year\)/);
assert.match(reportInit, /elCompYear\.addEventListener\("change"[^]*?loadCompetencySettingsForReport/);
assert.match(reportInit, /missingWeightNames[^]*?ปีการศึกษา [^]*?ขาด:/);
assert.match(reportInit, /interpretationLevels\.length !== 4/);
assert.doesNotMatch(reportInit, /from\("competency_(?:source_weights|interpretation_levels)"\)/);

// ขึ้นปีคัดลอกค่าตั้งทันทีหลัง grade weights ก่อนแตะนักเรียน และไม่ทับค่าปลายทาง
const copyStart = rollover.indexOf("async function copyCompetencySettingsToYear");
const copyEnd = rollover.indexOf("// ---------- ตรวจสอบ + ลงมือขึ้นปีใหม่", copyStart);
const copyBlock = rollover.slice(copyStart, copyEnd);
assert.match(copyBlock, /eq\("year",sourceYear\)/);
assert.match(copyBlock, /levels\.length!==4/);
assert.match(copyBlock, /onConflict:"year,competency_id",ignoreDuplicates:true/);
assert.match(copyBlock, /onConflict:"year,code",ignoreDuplicates:true/);
const runBlock = rollover.slice(rollover.indexOf("btnRun.addEventListener"));
const gradeCopyCall = runBlock.indexOf("await copyGradeWeightsToYear");
const competencyCopyCall = runBlock.indexOf("await copyCompetencySettingsToYear");
const studentStep = runBlock.indexOf("// 1) ยืนยันว่าปีต้นทางมีประวัติ");
assert.ok(gradeCopyCall >= 0 && competencyCopyCall > gradeCopyCall && studentStep > competencyCopyCall);

const clientVersions = execFileSync("sh", ["-c", "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"], {cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);
assert.deepEqual(clientVersions,["supabase-client.js?v=20260831-1"]);

console.log("competency settings year: migration, year-scoped loader/UI/report, all-year defaults, rollover and cache passed");
