import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const schema = read("schema.sql");
const client = read("supabase-client.js");
const projectsHtml = read("academic/projects.html");
const okrHtml = read("academic/okr.html");

const marker = "Migration: ลำดับชั้น OKR ผลวัด และกิจกรรมของครูเจ้าของงาน (2026-08-11)";
const markerAt = schema.indexOf(marker);
assert.ok(markerAt >= 0, "ไม่พบบล็อก migration OKR");
// จำกัดการตรวจไว้ที่ migration ก้อนนี้เท่านั้น: schema.sql ต่อ migration ใหม่ไว้ท้ายไฟล์เสมอ
// ถ้าตัดถึง EOF กฎของก้อน OKR จะไปตัดสิน policy ของก้อนถัดไปและเกิดผลล้มเหลวลวงอีก
const nextMigrationAt = schema.indexOf("-- Migration:", markerAt + marker.length);
const migration = schema.slice(markerAt, nextMigrationAt >= 0 ? nextMigrationAt : undefined);

function section(number) {
  const startMarker = `บล็อก ${number}/6:`;
  const start = migration.indexOf(startMarker);
  const next = number < 6 ? migration.indexOf(`บล็อก ${number + 1}/6:`, start) : migration.length;
  assert.ok(start >= 0 && next > start, `ไม่พบบล็อก ${number}/6 ตามลำดับ`);
  return migration.slice(start, next);
}

function uncommented(text) {
  return text.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
}

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

test("1 migration marker and six blocks occur once in order", () => {
  assert.equal(schema.split(marker).length - 1, 1);
  let previous = -1;
  for (let number = 1; number <= 6; number += 1) {
    const token = `บล็อก ${number}/6:`;
    assert.equal(migration.split(token).length - 1, 1, `${token} ต้องมีครั้งเดียว`);
    const position = migration.indexOf(token);
    assert.ok(position > previous, `บล็อก ${number} ต้องอยู่หลังบล็อกก่อนหน้า`);
    previous = position;
  }
});

test("2 every migration block has rollback commands", () => {
  for (let number = 1; number <= 6; number += 1) {
    const block = section(number);
    assert.match(block, new RegExp(`คำสั่งย้อนกลับบล็อก ${number}/6`));
    assert.match(block, /^--\s+(?:alter|drop|update|delete)\b/im,
      `บล็อก ${number} ต้องมี SQL ย้อนกลับที่ comment ไว้`);
  }
});

test("3 objective nullability is changed before shape constraint", () => {
  const block = section(1);
  const dropNotNull = block.indexOf("alter column objective drop not null");
  const shape = block.indexOf("add constraint school_okrs_shape_ok");
  assert.ok(dropNotNull >= 0 && shape > dropNotNull);
  assert.match(block, /drop constraint if exists school_okrs_shape_ok[^]*?add constraint school_okrs_shape_ok/);
  assert.doesNotMatch(uncommented(block), /drop constraint if exists school_okrs_code_unique/);
});

test("4 KR split uses the proven dotted-code format and not old O concatenation", () => {
  const block = section(2);
  const sql = uncommented(block);
  assert.match(block, /insert into school_okrs \(year, code, objective, key_result, parent_id, sort_order, active\)/);
  assert.match(block, /substring\(line from '\^\(KR\[0-9\]\+\\\.\[0-9\]\+\)'\)/);
  assert.match(block, /O\.1=5[^\n]*O\.2=4[^\n]*O\.3=3[^\n]*O\.4=3[^\n]*O\.5=5/);
  assert.doesNotMatch(block, /'O'\s*\|\|/);
  assert.doesNotMatch(sql, /update school_okrs\s+kr\s+set\s+parent_id/i);
  assert.match(block, /^-- select o\.code as objective_code,/m);
  assert.match(block, /^-- select o\.code, count\(kr\.id\) as kr_rows/m);
  assert.doesNotMatch(sql, /select o\.code as objective_code/);
  assert.doesNotMatch(sql, /select o\.code, count\(kr\.id\) as kr_rows/);
  assert.match(block, /^-- update school_okrs set key_result = null where parent_id is null;$/m);
  assert.doesNotMatch(sql, /update school_okrs set key_result = null where parent_id is null/);
});

test("5 okr_checkins is yearly only through its OKR", () => {
  const block = section(4);
  const start = block.indexOf("create table if not exists okr_checkins (");
  const end = block.indexOf("create table if not exists okr_checkin_evidence", start);
  const definition = block.slice(start, end);
  assert.match(definition, /constraint okr_checkins_okr_unique unique \(okr_id\)/);
  assert.doesNotMatch(definition, /\byear\b/i);
});

test("6 no okr_checkins index refers to year", () => {
  const block = section(4);
  assert.match(block, /create index if not exists okr_checkins_measured_idx on okr_checkins \(measured_on\)/);
  assert.doesNotMatch(block, /create index[^;]*okr_checkins[^;]*\byear\b/i);
});

test("7 okr_checkins has four command-specific policies", () => {
  const block = section(4);
  for (const command of ["select", "insert", "update", "delete"]) {
    assert.match(block, new RegExp(`create policy okr_checkins_${command} on okr_checkins for ${command}`, "i"));
  }
  assert.equal((block.match(/create policy okr_checkins_/gi) || []).length, 4);
  assert.doesNotMatch(block, /\bfor all\b/i);
});

test("8 checkin delete is admin but evidence replacement is academic", () => {
  const block = section(4);
  assert.match(block, /create policy okr_checkins_delete[^]*?for delete[^]*?using \(is_admin\(\)\)/i);
  assert.match(block, /create policy okr_checkin_evidence_delete[^]*?for delete[^]*?using \(has_department\('วิชาการ'\)\)/i);
});

test("9 only migration-owned policies may be dropped on existing tables", () => {
  const sql = uncommented(migration);
  for (const name of [
    "school_okrs_select", "school_okrs_insert", "school_okrs_update", "school_okrs_delete",
    "academic_projects_select", "academic_projects_insert", "academic_projects_update", "academic_projects_delete",
    "academic_project_okrs_select", "academic_project_okrs_insert", "academic_project_okrs_delete",
    "academic_project_links_select", "academic_project_links_insert", "academic_project_links_update",
    "academic_project_links_delete"
  ]) {
    assert.doesNotMatch(sql, new RegExp(`drop policy(?: if exists)? ${name}\\b`, "i"),
      `ห้าม drop policy เดิม ${name}`);
  }
  for (const [name, table] of [
    ["academic_projects_insert_own", "academic_projects"],
    ["academic_projects_update_own", "academic_projects"],
    ["academic_project_okrs_insert_own", "academic_project_okrs"],
    ["academic_project_okrs_delete_own", "academic_project_okrs"],
    ["academic_project_links_insert_own", "academic_project_links"],
    ["academic_project_links_update_own", "academic_project_links"],
    ["academic_project_links_delete_own", "academic_project_links"]
  ]) {
    const dropAt = sql.indexOf(`drop policy if exists ${name} on ${table};`);
    const createAt = sql.indexOf(`create policy ${name} on ${table}`);
    assert.ok(dropAt >= 0 && createAt > dropAt, `${name} ต้อง drop ก่อน create เพื่อรันซ้ำได้`);
  }
});

test("10 every teacher-own policy uses the existing staff helper", () => {
  const block = section(5);
  const starts = [...block.matchAll(/create policy ([a-z_]+_own)\b/gi)];
  assert.equal(starts.length, 7);
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index].index;
    const end = starts[index + 1]?.index ?? block.indexOf("คำสั่งย้อนกลับ", start);
    assert.match(block.slice(start, end), /is_my_staff_row\(/, `${starts[index][1]} ต้องเช็คเจ้าของ`);
  }
  assert.doesNotMatch(migration, /create(?:\s+or\s+replace)?\s+function/i);
});

test("11 project update with-check is stricter than using", () => {
  const block = section(5);
  const start = block.indexOf("create policy academic_projects_update_own");
  const end = block.indexOf("create policy academic_project_okrs_insert_own", start);
  const policy = block.slice(start, end);
  const withCheckAt = policy.indexOf("with check");
  assert.ok(withCheckAt > 0);
  assert.doesNotMatch(policy.slice(0, withCheckAt), /kind\s*=\s*'กิจกรรม'/);
  assert.match(policy.slice(withCheckAt), /kind\s*=\s*'กิจกรรม'/);
  assert.match(policy.slice(withCheckAt), /parent_id is not null[^]*?is_my_staff_row\(responsible_staff_id\)/);
});

test("12 teachers receive no academic_projects delete policy", () => {
  const executable = uncommented(section(5));
  assert.doesNotMatch(executable, /create policy academic_projects_delete_own/i);
  assert.doesNotMatch(executable, /create policy[^;]*on academic_projects for delete/i);
});

test("13 project links have insert update and delete own policies", () => {
  const block = section(5);
  assert.match(block, /create policy academic_project_links_insert_own on academic_project_links for insert/i);
  assert.match(block, /create policy academic_project_links_update_own on academic_project_links for update/i);
  assert.match(block, /create policy academic_project_links_delete_own on academic_project_links for delete/i);
});

test("14 project depth constraint enforces both allowed shapes", () => {
  const block = section(3);
  assert.match(block, /academic_projects_depth_ok check \([^]*?kind = 'โครงการ' and parent_id is null[^]*?or[^]*?kind = 'กิจกรรม' and parent_id is not null[^]*?\)/);
});

test("15 project parent deletion is restricted", () => {
  const block = section(3);
  assert.match(block, /references academic_projects\(id\) on delete restrict/);
  const executable = uncommented(block);
  assert.doesNotMatch(executable, /on delete (?:set null|cascade)/i);
});

test("16 OKR threshold seeds preserve existing settings", () => {
  const block = section(6);
  assert.match(block, /values \('okr_kr_pass', '0\.7'\), \('okr_o_pass', '0\.7'\)[^]*?on conflict \(key\) do nothing/);
  assert.doesNotMatch(block, /do update/i);
});

test("17 the completed client-side OKR core remains present", () => {
  assert.match(client, /\/\/ ---------- OKR: สูตรล้วน \(ห้ามยิง sb ในบล็อกนี้\) ----------/);
  for (const name of [
    "buildOkrTree", "buildProjectTree", "projectBudgetOf", "summarizeProjectBudget",
    "deriveProjectObjectives", "okrChipLabel", "okrProgress", "okrScore",
    "okrObjectiveScore", "indexCheckinsByOkr", "okrCoverage", "buildOkrTrend",
    "suggestOkrValue", "loadSchoolOkrs", "loadOkrCheckins", "loadOkrLineage",
    "loadOkrThresholds"
  ]) {
    assert.match(client, new RegExp(`export (?:async )?function ${name}\\b`), `ขาด ${name}`);
  }
});

test("18 split OKR pages use the UI chunk cache-buster", () => {
  for (const html of [projectsHtml, okrHtml]) {
    const versions = [...html.matchAll(/supabase-client\.js\?v=([0-9a-z-]+)/g)]
      .map(match => match[1]);
    assert.deepEqual(versions, ["20260831-1"]);
  }
});

console.log(`OKR migration: ${passed} cases passed`);
