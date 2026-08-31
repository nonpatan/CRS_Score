import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../finance/fee-settings.html", import.meta.url), "utf8");
const start = page.indexOf("function buildRateGrid(");
const end = page.indexOf("const today =", start);
assert.ok(start >= 0 && end > start, "ตัดฟังก์ชันล้วนจาก fee-settings.html ไม่สำเร็จ");
const { buildRateGrid, copyTermRates, parseVariantList, gradesThroughHighest, fillRateDraft } = new Function(
  page.slice(start, end) + "; return { buildRateGrid, copyTermRates, parseVariantList, gradesThroughHighest, fillRateDraft };"
)();

test("buildRateGrid แยกช่องว่างออกจากอัตรา 0 บาท", () => {
  const grid = buildRateGrid(
    ["ป.1", "ป.2"],
    [{ id:"lab" }, { id:"activity" }],
    [
      { grade_level:"ป.1", item_id:"lab", amount:0 },
      { grade_level:"ป.2", item_id:"activity", amount:125.50 }
    ]
  );
  assert.deepEqual(grid, [
    { grade_level:"ป.1", values:[{ item_id:"lab", amount:0 }, { item_id:"activity", amount:null }] },
    { grade_level:"ป.2", values:[{ item_id:"lab", amount:null }, { item_id:"activity", amount:125.5 }] }
  ]);
  assert.match(page, /ช่องว่าง ≠ 0/);
  assert.match(page, /academicYearOf\(today, years\)/);
  assert.match(page, /app-shell\.js\?v=20260831-1/);
  assert.match(page, /supabase-client\.js\?v=20260831-1/);
});

test("copyTermRates เติมเฉพาะช่องที่เทอมปลายทางยังไม่มีและรักษา 0 ไว้", () => {
  const rows = [
    { year:"2569", term:1, grade_level:"ป.1", item_id:"lab", amount:300 },
    { year:"2569", term:1, grade_level:"ป.2", item_id:"lab", amount:350 },
    { year:"2569", term:2, grade_level:"ป.1", item_id:"lab", amount:0 }
  ];
  const copied = copyTermRates(rows, 1, 2).filter(row => row.term === 2);
  assert.deepEqual(copied, [
    { year:"2569", term:2, grade_level:"ป.1", item_id:"lab", amount:0 },
    { year:"2569", term:2, grade_level:"ป.2", item_id:"lab", amount:350 }
  ]);
  assert.equal(rows.length, 3, "ฟังก์ชันต้องไม่แก้ array ต้นทาง");
});

test("parseVariantList ตัดช่องว่าง ทิ้งค่าว่าง และกันตัวเลือกซ้ำ", () => {
  assert.deepEqual(
    parseVariantList(" หญิง เบอร์ S, หญิง เบอร์ M, ,หญิง เบอร์ S，ชาย เบอร์ L "),
    ["หญิง เบอร์ S", "หญิง เบอร์ M", "ชาย เบอร์ L"]
  );
  assert.match(page, /ตั้งได้แค่อัตรา ส่วนใครได้บ้างเป็นการติ๊กรายคนที่หน้าตั้งหนี้/);
  assert.match(page, /financeMenuKeepHrefs\(canFinance, session\.user\.id\)/);
  assert.doesNotMatch(page, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("highest_grade ตัดตารางอัตรา ช่องเลือกชั้น และเงินอุดหนุนไว้ถึงชั้นที่โรงเรียนเปิด", () => {
  const all = ["อ.1", "อ.2", "ป.1", "ป.2", "ม.1", "ม.2", "ม.3", "ม.4"];
  assert.deepEqual(gradesThroughHighest(all, "ม.3"), ["อ.1", "อ.2", "ป.1", "ป.2", "ม.1", "ม.2", "ม.3"]);
  assert.match(page, /grades = gradesThroughHighest\(GRADE_ORDER, await getSetting\("highest_grade"\)\)/);
  assert.match(page, /buildRateGrid\(grades, adminItems, rows\)/);
  assert.match(page, /\$\{grades\.map\(grade =>/);
});

test("highest_grade ไม่มีค่า อ่านไม่ได้ หรือไม่ตรงรายการ ให้ถอยไปแสดงทุกชั้น", () => {
  const all = ["ป.1", "ป.2", "ป.3"];
  assert.deepEqual(gradesThroughHighest(all, null), all);
  assert.deepEqual(gradesThroughHighest(all, "ม.9"), all);
  assert.notEqual(gradesThroughHighest(all, null), all, "ต้องคืน array ใหม่ ไม่แก้ค่ากลาง");
  assert.match(page, /catch \(error\) \{ grades = \[\.\.\.GRADE_ORDER\]; \}/);
});

test("ใส่อัตราเปลี่ยนเฉพาะรายการและชั้นที่เลือก ชั้นอื่นคงค่าเดิม", () => {
  const source = [
    { item_id:"admin", grade_level:"ป.1", amount:"100" },
    { item_id:"admin", grade_level:"ป.2", amount:"200" },
    { item_id:"lunch", grade_level:"ป.1", amount:"300" }
  ];
  const filled = fillRateDraft(source, "admin", 450, ["ป.2"]);
  assert.deepEqual(filled, [
    { item_id:"admin", grade_level:"ป.1", amount:"100" },
    { item_id:"admin", grade_level:"ป.2", amount:450 },
    { item_id:"lunch", grade_level:"ป.1", amount:"300" }
  ]);
  assert.deepEqual(source[1], { item_id:"admin", grade_level:"ป.2", amount:"200" });
  assert.match(page, /กรุณาเลือกอย่างน้อย 1 ชั้นก่อนใส่จำนวน/);
});

test("หน้าตั้งค่าเหลือสองแท็บและงานสินค้าไม่อยู่ในหน้านี้", () => {
  assert.equal((page.match(/role="tab"/g) || []).length, 2);
  assert.doesNotMatch(page, /id="prices-panel"|id="many-form"|id="item-category"/);
  assert.match(page, /บันทึกอัตราของภาคเรียนนี้/);
  assert.match(page, /กดครั้งเดียวบันทึกทุกชั้นในตาราง/);
});
