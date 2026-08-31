import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const projects = read("academic/projects.html");
const okrPage = read("academic/okr.html");
const dashboard = read("dashboard.html");
const client = read("supabase-client.js");
const schema = read("schema.sql");
const shell = read("app-shell.js");

function htmlFiles(directory = root) {
  return readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    if ([".git", "node_modules"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  });
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

const pureStart = client.indexOf("// ---------- OKR: สูตรล้วน (ห้ามยิง sb ในบล็อกนี้) ----------");
const pureEnd = client.indexOf("// ---------- จบสูตรล้วน OKR ----------", pureStart);
const pureSource = client.slice(pureStart, pureEnd).replaceAll("export ", "");
const { projectBudgetOf } = new Function(pureSource + "\nreturn { projectBudgetOf };")();

const guardStart = projects.indexOf("function activityBudgetGuard(");
const guardEnd = projects.indexOf("\n\n  function projectArticle", guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, "ตัดตัวตรวจเพดานจาก projects.html ไม่สำเร็จ");
const guards = new Function(
  "projectBudgetOf",
  projects.slice(guardStart, guardEnd) +
    "\nreturn { activityBudgetGuard, parentBudgetGuard, projectKindChangeGuard, activityKrGuard, parentKrGuard };"
)(projectBudgetOf);

test("1 split pages load OKRs through the completed loader", () => {
  assert.doesNotMatch(projects, /sb\.from\("school_okrs"\)/);
  assert.match(projects, /loadSchoolOkrs\(year\)/);
  assert.doesNotMatch(okrPage, /sb\.from\("school_okrs"\)/);
  assert.match(okrPage, /loadSchoolOkrs\(year\)/);
  assert.match(okrPage, /loadSchoolOkrs\(sourceYear\)/);
});

test("2 split pages call every imported OKR helper", () => {
  for (const [source, names] of [
    [projects, ["buildOkrTree", "buildProjectTree", "summarizeProjectBudget", "okrCoverage", "okrChipLabel"]],
    [okrPage, ["buildOkrTree", "okrObjectiveScore", "okrCoverage", "okrProgress", "okrScore", "indexCheckinsByOkr", "buildOkrTrend", "suggestOkrValue"]]
  ]) {
    for (const name of names) {
      assert.match(source, new RegExp(`\\b${name}\\b`), `${name} ต้องถูก import`);
      assert.match(source, new RegExp(`\\b${name}\\(`), `${name} ต้องถูกเรียกใช้งานจริง`);
    }
  }
});

test("3 HTML does not duplicate OKR arithmetic", () => {
  const html = projects + "\n" + okrPage + "\n" + dashboard;
  assert.doesNotMatch(html, /population_passed\s*\//);
  assert.doesNotMatch(html, /\/\s*(?:kr\.)?target_value\b/);
});

test("4 project budget tiles do not reduce budget_planned directly", () => {
  const renderStart = projects.indexOf("function renderProjects()");
  const renderEnd = projects.indexOf("function renderOkrPicker", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const renderSource = projects.slice(renderStart, renderEnd);
  assert.match(renderSource, /summarizeProjectBudget\(tree\)/);
  assert.doesNotMatch(renderSource, /reduce\([^)]*budget_planned|budget_planned[^\n]*reduce/);
});

test("5 changed pages use the shared confirmation dialog", () => {
  const html = projects + "\n" + okrPage + "\n" + dashboard;
  assert.doesNotMatch(html, /\b(?:alert|confirm|prompt)\s*\(/i);
  assert.match(projects, /window\.crsAskConfirm\(/);
  assert.match(okrPage, /window\.crsAskConfirm\(/);
});

test("6 projects root color tokens match UI-STANDARD", () => {
  const rootBlock = projects.match(/:root\s*\{([^}]+)\}/)?.[1] || "";
  const expected = {
    ink:"#1f2a2e", muted:"#5f6b70", line:"#dfe4e3", teal:"#0f6e56",
    "teal-soft":"#e1f5ee", bg:"#f7f8f7", white:"#ffffff", danger:"#a32d2d",
    "danger-soft":"#fceaea", amber:"#93690f", "amber-soft":"#faf1dd"
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.match(rootBlock, new RegExp(`--${name}:\\s*${value.replace("#", "\\#")}\\s*;`));
  }
});

test("7 every HTML client import uses one shared cache-buster", () => {
  const pages = htmlFiles().map(path => ({
    path,
    imports:[...readFileSync(path, "utf8").matchAll(/supabase-client\.js\?v=([0-9a-z-]+)/g)]
  })).filter(page => page.imports.length > 0);
  assert.ok(pages.length > 0, "ต้องมีหน้า HTML ที่ import supabase-client.js");
  for (const page of pages) {
    assert.equal(page.imports.length, 1, `${page.path} ต้อง import supabase-client.js ครั้งเดียว`);
    assert.equal(page.imports[0][1], "20260831-1", `${page.path} ใช้ cache-buster ไม่ตรงไฟล์อื่น`);
  }
});

test("8 app-shell cache-buster moved once for the new menu", () => {
  const sources = htmlFiles().map(path => readFileSync(path, "utf8")).join("\n");
  assert.deepEqual([...new Set([...sources.matchAll(/app-shell\.js\?v=([0-9a-z-]+)/g)].map(match => match[1]))], ["20260831-1"]);
  assert.deepEqual([...new Set([...sources.matchAll(/app-shell\.css\?v=([0-9a-z-]+)/g)].map(match => match[1]))], ["20260820-2"]);
});

test("9 page name matches app-shell, title, h1, and fallback menu", () => {
  const menuName = shell.match(/\["projects\.html",\s*"([^"]+)"\]/)?.[1];
  const titleName = projects.match(/<title>([^<]+) — CRS MIS<\/title>/)?.[1];
  const h1Name = projects.match(/<h1>([^<]+)<\/h1>/)?.[1];
  const fallbackName = projects.match(/<a href="projects\.html">([^<]+)<\/a>/)?.[1];
  assert.equal(menuName, "โครงการ/กิจกรรม");
  assert.deepEqual([titleName, h1Name, fallbackName], [menuName, menuName, menuName]);
  const okrMenuName = shell.match(/\["okr\.html",\s*"([^"]+)"\]/)?.[1];
  const okrTitleName = okrPage.match(/<title>([^<]+) — CRS MIS<\/title>/)?.[1];
  const okrH1Name = okrPage.match(/<h1>([^<]+)<\/h1>/)?.[1];
  const okrFallbackName = okrPage.match(/<a href="okr\.html">([^<]+)<\/a>/)?.[1];
  assert.equal(okrMenuName, "OKR ของโรงเรียน");
  assert.deepEqual([okrTitleName, okrH1Name, okrFallbackName], [okrMenuName, okrMenuName, okrMenuName]);
});

test("10 source-kind options exactly match the schema constraint", () => {
  const select = okrPage.match(/<select id="c-source-kind">([\s\S]*?)<\/select>/)?.[1] || "";
  const uiValues = [...select.matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]);
  const constraint = schema.match(/constraint okr_checkins_source_ok check \(source_kind in \(([\s\S]*?)\)\s*\)/)?.[1] || "";
  const schemaValues = [...constraint.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(uiValues.length, 6);
  assert.deepEqual(uiValues, schemaValues);
});

test("11 completed OKR client core remains intact", () => {
  assert.match(client, /\/\/ ---------- OKR: สูตรล้วน \(ห้ามยิง sb ในบล็อกนี้\) ----------/);
  for (const name of [
    "buildOkrTree", "buildProjectTree", "projectBudgetOf", "summarizeProjectBudget",
    "okrChipLabel", "deriveProjectObjectives", "okrProgress", "okrScore",
    "okrObjectiveScore", "indexCheckinsByOkr", "okrCoverage", "buildOkrTrend",
    "suggestOkrValue", "loadSchoolOkrs", "loadOkrCheckins"
  ]) {
    assert.match(client, new RegExp(`export (?:async )?function ${name}\\b`), `ขาด ${name}`);
  }
});

test("12 migration marker is unique and destructive cleanup stays commented", () => {
  const marker = "Migration: ลำดับชั้น OKR ผลวัด และกิจกรรมของครูเจ้าของงาน (2026-08-11)";
  assert.equal(schema.split(marker).length - 1, 1);
  assert.match(schema, /^-- update school_okrs set key_result = null where parent_id is null;$/m);
  const migration = schema.slice(schema.indexOf(marker));
  const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executable, /update school_okrs set key_result = null where parent_id is null/);
});

test("13 objective without KRs has a neutral status, not failed", () => {
  const start = okrPage.indexOf("function objectiveStatus(summary)");
  const end = okrPage.indexOf("\n\n  function trendHtml", start);
  assert.ok(start >= 0 && end > start, "ตัด objectiveStatus จาก okr.html ไม่สำเร็จ");
  const objectiveStatus = new Function(
    okrPage.slice(start, end) + "\nreturn objectiveStatus;"
  )();

  const empty = objectiveStatus({ measured:0, total:0, passed:false });
  assert.match(empty, /chip warn/);
  assert.match(empty, /ยังไม่มี KR/);
  assert.doesNotMatch(empty, /chip fail|❌|ไม่ผ่าน/);

  const failed = objectiveStatus({ measured:1, total:1, passed:false });
  assert.match(failed, /chip fail/);
  assert.match(failed, /❌ ไม่ผ่าน/);
  assert.notEqual(empty, failed);
});

test("14 old budget mismatch state is fully replaced", () => {
  assert.doesNotMatch(projects, /mismatch|งบแม่ไม่ตรงกับผลรวมกิจกรรม/);
  assert.match(projects, /budget\.unallocated/);
  assert.match(projects, /budget\.overAllocated/);
  assert.doesNotMatch(projects, /budget_planned[^\n]*(?:reduce|\+)/);
});

test("15 activity budget guard enforces the selected parent without double counting itself", () => {
  const rows = [
    { id:"parent-a", name:"แม่ A", budget_planned:3000 },
    { id:"parent-b", name:"แม่ B", budget_planned:100 },
    { id:"child-a", parent_id:"parent-a", budget_planned:2500 }
  ];
  assert.equal(guards.activityBudgetGuard(rows, "parent-a", null, 600).reason, "over-parent-budget");
  assert.equal(guards.activityBudgetGuard(rows, "parent-a", "child-a", 2500).ok, true);
  assert.equal(guards.activityBudgetGuard(rows, "parent-b", "child-a", 500).reason, "over-parent-budget");
  assert.equal(guards.activityBudgetGuard([{ id:"blank", name:"ยังไม่ตั้ง", budget_planned:null }], "blank", null, 1).reason, "missing-parent-budget");
  assert.equal(guards.activityBudgetGuard([{ id:"blank", budget_planned:null }], "blank", null, 0).ok, true);
  assert.equal(guards.activityBudgetGuard([], "missing", null, 0).reason, "missing-parent");
});

test("16 parent budget cannot be cleared or reduced below child allocations", () => {
  const rows = [
    { id:"parent", budget_planned:3000 },
    { id:"c1", parent_id:"parent", budget_planned:1800 },
    { id:"c2", parent_id:"parent", budget_planned:1000 }
  ];
  assert.equal(guards.parentBudgetGuard(rows, "parent", 2700).ok, false);
  assert.equal(guards.parentBudgetGuard(rows, "parent", null).ok, false);
  assert.equal(guards.parentBudgetGuard(rows, "parent", 2800).ok, true);
});

test("17 budget_actual is warning-only and never blocks project submit", () => {
  const start = projects.indexOf('el("project-form").addEventListener("submit"');
  const end = projects.indexOf('\n\n  el("project-list").addEventListener', start);
  const submit = projects.slice(start, end);
  assert.match(submit, /const actual = numberOrNull\("p-budget-actual"\)/);
  assert.doesNotMatch(submit, /actual\s*[><]=?\s*(?:planned|budget)|(?:planned|budget)\s*[><]=?\s*actual/);
  assert.match(projects, /chip fail">ใช้เกินงบ/);
});

test("18 KR guards enforce child subset, parent changes, and parent removals", () => {
  const rows = [
    { id:"parent-a", name:"แม่ A", okrs:[{ id:"kr1" }, { id:"kr2" }] },
    { id:"parent-b", name:"แม่ B", okrs:[{ id:"kr2" }] },
    { id:"child-a", name:"กิจกรรม ก", parent_id:"parent-a", okrs:[{ id:"kr1" }] },
    { id:"child-b", name:"กิจกรรม ข", parent_id:"parent-a", status:"ยกเลิก", okrs:[{ id:"kr1" }] }
  ];
  assert.deepEqual(guards.activityKrGuard(rows, "parent-a", ["kr3"]).invalidIds, ["kr3"]);
  assert.equal(guards.activityKrGuard(rows, "parent-a", ["kr1"]).ok, true);
  assert.equal(guards.activityKrGuard([{ id:"empty", okrs:[] }], "empty", []).ok, true);
  assert.deepEqual(guards.activityKrGuard(rows, "parent-b", ["kr1"]).invalidIds, ["kr1"]);
  const removed = guards.parentKrGuard(rows, "parent-a", ["kr2"]);
  assert.equal(removed.ok, false);
  assert.deepEqual(removed.affected, [{ okrId:"kr1", projectNames:["กิจกรรม ก", "กิจกรรม ข"] }]);
});

test("19 activity picker is scoped to its parent and empty before selecting one", () => {
  const start = projects.indexOf("function renderOkrPicker(");
  const end = projects.indexOf("\n\n  function selectedProjectOkrIds", start);
  const picker = projects.slice(start, end);
  assert.match(picker, /if \(activity && !parentId\)/);
  assert.match(picker, /เลือกโครงการแม่ก่อน แล้วจะแสดง KR ของโครงการนั้นให้เลือก/);
  assert.match(picker, /allowed\.has\(kr\.id\)/);
  assert.match(picker, /ยังไม่ได้ผูก KR/);
});

test("20 new own-policy migration broadens exactly seven policies and preserves admin policies", () => {
  const marker = "Migration: เปิดให้ครูจัดการโครงการและกิจกรรมของตัวเอง (2026-08-12)";
  assert.equal(schema.split(marker).length - 1, 1);
  const migration = schema.slice(schema.indexOf(marker));
  const rollbackAt = migration.indexOf("คำสั่งย้อนกลับ migration นี้");
  const active = migration.slice(0, rollbackAt);
  const executable = active.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  assert.equal((active.match(/create policy [a-z_]+_own\b/g) || []).length, 7);
  assert.doesNotMatch(active, /parent_id/);
  const projectPolicies = active.slice(active.indexOf("create policy academic_projects_insert_own"), active.indexOf("drop policy if exists academic_project_okrs_insert_own"));
  assert.doesNotMatch(projectPolicies, /\bkind\b/);
  for (const name of [
    "school_okrs_select", "school_okrs_insert", "school_okrs_update", "school_okrs_delete",
    "academic_projects_select", "academic_projects_insert", "academic_projects_update", "academic_projects_delete",
    "academic_project_okrs_select",
    "academic_project_okrs_insert", "academic_project_okrs_delete",
    "academic_project_links_select",
    "academic_project_links_insert", "academic_project_links_update", "academic_project_links_delete"
  ]) assert.doesNotMatch(executable, new RegExp(`drop policy(?: if exists)? ${name}\\b`, "i"));
  assert.doesNotMatch(executable, /create policy[^;]*on academic_projects for delete/i);
  const rollback = migration.slice(rollbackAt);
  assert.equal((rollback.match(/^-- create policy [a-z_]+_own\b/gm) || []).length, 7);
});

test("21 teachers can edit either own kind while OKR administration remains canEditAll-only", () => {
  const canEditStart = projects.indexOf("const canEditProject =");
  const canEditEnd = projects.indexOf("\n\n  if (canEditAll", canEditStart);
  assert.doesNotMatch(projects.slice(canEditStart, canEditEnd), /kind\s*===\s*["']กิจกรรม["']/);
  assert.match(projects, /el\("p-kind"\)\.disabled = false/);
  assert.match(projects, /เพิ่มโครงการ\/กิจกรรมของฉัน/);
  assert.match(okrPage, /\$\{canEditAll \? `<button class="ghost" data-edit-okr=/);
  assert.match(okrPage, /if \(!canEditAll\) return;[\s\S]*?function openCheckinForm/);
  assert.match(okrPage, /if \(canEditAll\) \{ staff = await listStaffPicker\(\); staffOptions\(\); \}/);
});

test("22 a project with children cannot be converted into an activity", () => {
  const withChild = [
    { id:"parent", kind:"โครงการ" },
    { id:"child", kind:"กิจกรรม", parent_id:"parent" }
  ];
  assert.deepEqual(guards.projectKindChangeGuard(withChild, "parent", "กิจกรรม"), {
    ok:false, childCount:1
  });
  assert.deepEqual(guards.projectKindChangeGuard([{ id:"parent", kind:"โครงการ" }], "parent", "กิจกรรม"), {
    ok:true, childCount:0
  });
  const submitStart = projects.indexOf('el("project-form").addEventListener("submit"');
  const submitEnd = projects.indexOf('\n\n  el("project-list").addEventListener', submitStart);
  const submit = projects.slice(submitStart, submitEnd);
  assert.ok(submit.indexOf("projectKindChangeGuard(") < submit.indexOf("activityBudgetGuard("));
  assert.match(submit, /โครงการนี้มีกิจกรรม \$\{kindGuard\.childCount\} รายการ กรุณาย้ายหรือลบกิจกรรมลูกก่อน/);
});

test("23 OKR management markup lives on the dedicated page", () => {
  for (const id of ["okr-list", "okr-form-box", "checkin-form-box", "okr-admin-tools"]) {
    assert.match(okrPage, new RegExp(`id=["']${id}["']`), `okr.html ขาด #${id}`);
  }
});

test("24 OKR page loads projects for coverage and automatic suggestions", () => {
  assert.match(okrPage, /loadAcademicProjects\(year\)/);
  assert.match(okrPage, /okrCoverage\(okrTree, projects\)/);
  assert.match(okrPage, /const ctx = \{ range:academicYearRange\(kr\.year, years\), projects \}/);
  assert.match(okrPage, /suggestOkrValue\(kr, ctx\)/);
  assert.match(okrPage, /listStaffPicker\(\)/);
});

test("25 projects no longer loads OKR administration data or forms", () => {
  for (const token of [
    "loadOkrCheckins", "loadOkrLineage", "loadOkrThresholds", "okr_checkin_evidence",
    'id="checkin-form"', 'id="okr-form"'
  ]) assert.doesNotMatch(projects, new RegExp(token));
});

test("26 project-side OKR picker and guards stay in projects", () => {
  for (const name of ["renderOkrPicker", "activityKrGuard", "parentKrGuard", "okrChipLabel"]) {
    assert.match(projects, new RegExp(`\\b${name}\\b`), `${name} ต้องยังอยู่ใน projects.html`);
  }
  assert.match(projects, /href="okr\.html"/);
  assert.match(projects, /summary\.hidden = uncovered\.length === 0/);
  assert.doesNotMatch(projects, /KR ที่ยังไม่มีโครงการรองรับ 0 ตัว/);
});

test("27 OKR menu is visible and is not in any restricted list", () => {
  assert.match(shell, /\["projects\.html", "โครงการ\/กิจกรรม"\],\s*\["okr\.html", "OKR ของโรงเรียน"\]/);
  assert.match(shell, /"okr\.html": \{\s*title: "OKR ของโรงเรียน"/);
  for (const list of ["hrOnly", "financeOnly", "reportOnly"]) {
    const values = shell.match(new RegExp(`${list}: \\[([^\\]]*)\\]`))?.[1] || "";
    assert.doesNotMatch(values, /okr\.html/, `okr.html ห้ามอยู่ใน ${list}`);
  }
});

test("28 OKR page follows the shared page standard", () => {
  assert.match(okrPage, /app-shell\.css\?v=20260820-2/);
  assert.match(okrPage, /app-shell\.js\?v=20260831-1/);
  assert.match(okrPage, /id="toast"/);
  assert.doesNotMatch(okrPage, /\b(?:alert|confirm|prompt)\s*\(/i);
  const rootBlock = okrPage.match(/:root\s*\{([^}]+)\}/)?.[1] || "";
  for (const value of ["#1f2a2e", "#5f6b70", "#dfe4e3", "#0f6e56", "#e1f5ee", "#f7f8f7", "#ffffff", "#a32d2d", "#fceaea", "#93690f", "#faf1dd"]) {
    assert.match(rootBlock, new RegExp(value.replace("#", "\\#")));
  }
});

test("29 module scripts of both split pages compile", () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  for (const html of [projects, okrPage]) {
    const match = html.match(/<script type="module">([^]*?)<\/script>/);
    assert.ok(match, "หา module script ไม่พบ");
    const body = match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m, "");
    assert.doesNotThrow(() => new AsyncFunction(body));
  }
});

console.log(`OKR UI: ${passed} cases passed`);
