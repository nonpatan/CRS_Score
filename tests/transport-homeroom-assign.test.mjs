import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../finance/transport-settings.html", import.meta.url), "utf8");
const myWork = readFileSync(new URL("../personnel/my-work.html", import.meta.url), "utf8");
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const client = readFileSync(new URL("../supabase-client.js", import.meta.url), "utf8");
const financePage = name => readFileSync(new URL(`../finance/${name}.html`, import.meta.url), "utf8");

// ตัดเฉพาะสูตรล้วนออกมารัน เพื่อไม่ต้อง import Supabase CDN และไม่แตะฐานข้อมูลจริง
const start = page.indexOf("function visibleRoomsFor");
const end = page.indexOf("function selectedRoster", start);
assert.ok(start >= 0 && end > start, "ตัดสูตรสิทธิ์ครูประจำชั้นจาก transport-settings.html ไม่สำเร็จ");

const { visibleRoomsFor, canEditInPlace } = new Function(
  page.slice(start, end) + "\nreturn { visibleRoomsFor, canEditInPlace };"
)();

const allRooms = [
  { grade_level: "ป.3", classroom: "1" },
  { grade_level: "ป.3", classroom: "2" },
  { grade_level: "ป.5", classroom: "1" }
];

test("ฝ่ายการเงินเห็นทุกห้อง ไม่ถูกกรองอะไรเลย", () => {
  assert.deepEqual(visibleRoomsFor(allRooms, true, []), allRooms);
});

test("ครูประจำชั้นเห็นเฉพาะห้องตัวเอง — ห้องข้าง ๆ ของชั้นเดียวกันต้องไม่หลุดมา", () => {
  const mine = visibleRoomsFor(allRooms, false, [{ grade_level: "ป.3", classroom: "1" }]);
  assert.deepEqual(mine, [{ grade_level: "ป.3", classroom: "1" }]);
});

test("ครูคู่ชั้นหลายห้องเห็นครบทุกห้องที่รับผิดชอบ", () => {
  const mine = visibleRoomsFor(allRooms, false, [
    { grade_level: "ป.3", classroom: "2" },
    { grade_level: "ป.5", classroom: "1" }
  ]);
  assert.deepEqual(mine.map(room => `${room.grade_level}/${room.classroom}`), ["ป.3/2", "ป.5/1"]);
});

test("ไม่ได้เป็นครูประจำชั้นห้องไหนเลย ต้องไม่เห็นห้องใด", () => {
  assert.deepEqual(visibleRoomsFor(allRooms, false, []), []);
  assert.deepEqual(visibleRoomsFor(allRooms, false, null), []);
});

// เส้นแบ่งเดียวกับ trigger transport_money_guard() — เดือนที่ผ่านมาแล้วประกาศยอดไปแล้ว
const TODAY = "2026-08-24";

test("canEditInPlace ครบตารางความจริง 6 กรณี", () => {
  assert.equal(canEditInPlace({ start_date: "2026-08-01", end_date: null }, TODAY), true, "ต้นเดือนนี้");
  assert.equal(canEditInPlace({ start_date: TODAY, end_date: null }, TODAY), true, "วันนี้");
  assert.equal(canEditInPlace({ start_date: "2026-09-05", end_date: null }, TODAY), true, "อนาคต");
  assert.equal(canEditInPlace({ start_date: "2026-07-31", end_date: null }, TODAY), false, "เดือนที่แล้ว");
  assert.equal(canEditInPlace({ start_date: "2026-08-10", end_date: "2026-08-20" }, TODAY), false, "ปิดไปแล้ว");
  assert.equal(canEditInPlace(null, TODAY), false, "ไม่มีรายการ");
});

test("ปุ่มแก้รายการในที่เดิมมีอยู่จริง และผูกกับ canEditInPlace", () => {
  assert.match(page, /data-assignment="edit"/, "ต้องมีปุ่มแก้รายการในที่เดิม");
  assert.match(page, /canEditInPlace\(assignment, today\)/,
    "ปุ่มต้องโผล่ตามเงื่อนไขเดียวกับที่ฐานข้อมูลใช้ ไม่ใช่โผล่ตลอด");
});

test("โหมดแก้ต้อง update แถวเดิม ไม่ใช่ insert แถวใหม่", () => {
  const editBlock = page.slice(page.indexOf('if (assignmentAction === "edit")'), page.indexOf('} else if (assignmentAction === "replace")'));
  assert.ok(editBlock.length > 0, "ตัดบล็อกโหมดแก้ไม่สำเร็จ");
  assert.match(editBlock, /\.update\(/, "โหมดแก้ต้องใช้ update");
  assert.doesNotMatch(editBlock, /\.insert\(/, "โหมดแก้ต้องไม่สร้างแถวใหม่");
  // trigger ปฏิเสธถ้านักเรียนหรือปีต่างจากเดิม จึงต้องตัดออกจาก payload ไม่ใช่ส่งค่าเดิมไป
  assert.match(editBlock, /const \{ student_id, year, created_by, \.\.\.editable \} = payload/,
    "ต้องตัด student_id / year / created_by ออกจาก payload ของโหมดแก้");
});

test("โหมดแก้ต้องเติมหมายเหตุเดิมกลับมา ไม่ล้างทิ้ง", () => {
  assert.match(page, /el\("assignment-note"\)\.value = action === "edit" \? \(existing\.note \|\| ""\) : ""/,
    "ถ้าล้างโน้ตทิ้ง กดบันทึกแล้วหมายเหตุเดิมจะหายไปเงียบ ๆ");
});

test("ประตูหน้าเปิดให้ครูประจำชั้นแล้ว และข้อความเดิมที่ไม่จริงต้องหายไป", () => {
  assert.doesNotMatch(page, /หน้านี้สำหรับฝ่ายการเงินเท่านั้น/,
    "ข้อความเดิมไม่จริงแล้ว ครูประจำชั้นเข้าได้");
  assert.match(page, /const canUse = canFinance \|\| myHomerooms\.length > 0/,
    "ต้องเปิดให้ครูที่มีห้องประจำชั้นในปีปัจจุบัน");
});

test("ครูถูกล็อกให้ทำได้เฉพาะปีปัจจุบัน", () => {
  assert.match(page, /el\("year-select"\)\.disabled = !canFinance/,
    "RLS ยอมเฉพาะ year = current_academic_year() ถ้าปล่อยให้เลือกปีเก่าจะบันทึกไม่ผ่านโดยไม่รู้สาเหตุ");
});

test("โหมดครูซ่อนแท็บโซนและประกาศยอด แต่ห้ามลบ panel ทิ้ง", () => {
  const modeStart = page.indexOf("function applyHomeroomMode");
  const modeEnd = page.indexOf("function currentRange", modeStart);
  const block = page.slice(modeStart, modeEnd > modeStart ? modeEnd : modeStart + 1200);
  assert.match(block, /"zones-panel", "months-panel"/, "ต้องซ่อนทั้งสองแท็บ");
  assert.doesNotMatch(block, /\.remove\(\)/,
    "ลบ panel ทิ้งจะทำให้ renderZones()/loadMonth() พังเพราะหากล่องปลายทางไม่เจอ");
});

test("ห้ามเปิดเมนูการเงินทั้งชุดให้ครู", () => {
  assert.doesNotMatch(page, /applyRestrictedMenuAccess\(true\)/,
    "จะโชว์ลิงก์การเงินที่ RLS ปฏิเสธหมด = เมนูหลอกตา");
  assert.match(page, /applyRestrictedMenuAccess\(canFinance, canUse \? HOMEROOM_FINANCE_LINKS : \[\]\)/);
});

test("แตะ supabase-client จึงบัมพ์ cache-buster แต่ไม่บัมพ์ app-shell", () => {
  assert.match(page, /supabase-client\.js\?v=20260831-1/);
  assert.match(page, /app-shell\.js\?v=20260831-1/);
});

test("restricted gate มีค่าปริยายและเก็บได้เฉพาะ href ที่ระบุ", () => {
  assert.match(client, /export function applyRestrictedMenuAccess\(allowed, keepHrefs = \[\]\)/,
    "ค่าปริยายต้องอยู่เพื่อให้หน้าเดิมที่ส่งอาร์กิวเมนต์เดียวไม่พัง");
  assert.match(client, /keepHrefs\.some\(keep => href\.includes\(keep\)\)/);
});

test("restricted gate เก็บทั้งเมนูและการ์ดตั้งค่าค่ารถ แต่ลบลิงก์การเงินอื่นจริง", () => {
  const start = client.indexOf("export function applyRestrictedMenuAccess");
  const end = client.indexOf("export async function isHomeroomTeacherNow", start);
  assert.ok(start >= 0 && end > start, "ตัด applyRestrictedMenuAccess ไม่สำเร็จ");

  const makeLink = href => ({
    href, hidden:true, removed:false,
    getAttribute(name) { return name === "href" ? this.href : null; },
    removeAttribute(name) { if (name === "hidden") this.hidden = false; },
    remove() { this.removed = true; }
  });
  const links = [
    makeLink("transport-settings.html"),
    makeLink("../finance/transport-settings.html"),
    makeLink("savings-report.html")
  ];
  const group = {
    removed:false,
    querySelector() { return links.find(link => !link.removed) || null; },
    remove() { this.removed = true; }
  };
  const document = {
    querySelectorAll(selector) { return selector === "a[data-restricted]" ? links : [group]; }
  };
  const source = client.slice(start, end).replace(/^export /, "");
  const gate = new Function("document", `${source}\nreturn applyRestrictedMenuAccess;`)(document);

  gate(false, ["transport-settings.html"]);
  assert.equal(links[0].hidden, false, "ลิงก์ในเมนูต้องโผล่");
  assert.equal(links[1].hidden, false, "การ์ดในภาพรวมต้องโผล่ด้วย");
  assert.equal(links[2].removed, true, "ลิงก์รายงานการเงินต้องยังถูกลบ");
  assert.equal(group.removed, false, "กลุ่มที่ยังมีลิงก์ต้องไม่ถูกลบ");
});

test("หน้าการเงินใช้ helper กลางก่อนเก็บสามลิงก์ของครูประจำชั้น", () => {
  for (const name of ["index", "savings-entry", "savings-opening", "savings-payout", "savings-remit", "savings-report", "savings-withdraw", "transport-entry", "transport-remit", "transport-report"]) {
    const source = financePage(name);
    assert.match(source, /financeMenuKeepHrefs/, `${name} ต้อง import helper กลาง`);
    assert.match(source, /await financeMenuKeepHrefs\(canFinance, session\.user\.id\)/, `${name} ต้องส่งผู้ใช้ปัจจุบัน`);
  }
});

test("หน้าการเงินไม่เรียก helper สิทธิ์เมนูตัวเก่าเอง", () => {
  for (const name of ["index", "savings-entry", "savings-opening", "savings-payout", "savings-remit", "savings-report", "savings-withdraw", "transport-entry", "transport-remit", "transport-report", "transport-settings"]) {
    assert.doesNotMatch(financePage(name), /isHomeroomTeacherNow/, `${name} ต้องให้ helper กลางจัดการ`);
  }
});

test("helper ครูประจำชั้นล้มแล้วคืน false ไม่ throw จนหน้าการเงินเปิดไม่ขึ้น", () => {
  const start = client.indexOf("export async function isHomeroomTeacherNow");
  const end = client.indexOf("export function applyPersonnelMenuAccess", start);
  assert.ok(start >= 0 && end > start, "ตัด helper isHomeroomTeacherNow ไม่สำเร็จ");
  const helper = client.slice(start, end);
  assert.doesNotMatch(helper, /\bthrow\b/);
  assert.match(helper, /if \(me\.error \|\| !me\.data\) return false/);
  assert.match(helper, /if \(result\.error\) return false/);
});

test("หน้างานของฉันมีทางเข้า และโผล่เฉพาะครูประจำชั้นจริง", () => {
  assert.match(myWork, /id="homeroom-transport-card"/);
  assert.match(myWork, /href="\.\.\/finance\/transport-settings\.html"/);
  assert.match(myWork, /if \(hasHomeroom\) el\("homeroom-transport-card"\)\.hidden = false/,
    "ครูที่ไปเช็คชื่อแทนไม่มีสิทธิ์ผูกโซน จึงต้องไม่เห็นการ์ดนี้");
});

test("schema.sql บันทึก policy และ trigger ของงานนี้ไว้ครบ", () => {
  assert.match(schema, /create policy student_transport_insert_homeroom/);
  assert.match(schema, /create policy student_transport_update_homeroom/);
  assert.match(schema, /create trigger transport_money_guard_trg/);
  assert.match(schema, /create or replace function public\.is_my_own_homeroom/);
  // ลบต้องยังเป็นของ admin เท่านั้น — ห้ามมี policy ลบของครูโผล่มา
  assert.doesNotMatch(schema, /create policy student_transport_delete_homeroom/);
});
