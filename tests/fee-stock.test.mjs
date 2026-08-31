import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../finance/fee-stock.html", import.meta.url), "utf8");
const client = readFileSync(new URL("../supabase-client.js", import.meta.url), "utf8");
const stockStart = client.indexOf("export function computeStockBalance(");
const stockEnd = client.indexOf("export function computeFeeOutstanding(", stockStart);
const alertStart = page.indexOf("function stockAlerts(");
const alertEnd = page.indexOf("let session =", alertStart);
assert.ok(stockStart >= 0 && stockEnd > stockStart && alertStart >= 0 && alertEnd > alertStart, "ตัดฟังก์ชันยอดคลังไม่สำเร็จ");
const { computeStockBalance, stockAlerts, parseVariantList, latestUnitCost, inventoryValue, lowStockAlerts } = new Function(
  client.slice(stockStart, stockEnd).replace("export function", "function") + page.slice(alertStart, alertEnd) +
  "; return { computeStockBalance, stockAlerts, parseVariantList, latestUnitCost, inventoryValue, lowStockAlerts };"
)();

test("computeStockBalance รวมจำนวนบวกลบและคืน 0 เมื่อไม่มีรายการ", () => {
  assert.equal(computeStockBalance([]), 0);
  assert.equal(computeStockBalance([{ qty:10 }, { qty:-3 }, { qty:"5" }]), 12);
  assert.doesNotMatch(page, /function computeStockBalance\s*\(/, "หน้า stock ต้อง import สูตรกลาง ไม่มีสำเนาท้องถิ่น");
  assert.match(page, /รายการที่บันทึกไปแล้วแก้ไม่ได้/);
  assert.doesNotMatch(page, /kind\s*:\s*["']ขาย["']/);
  assert.match(page, /app-shell\.js\?v=20260831-1/);
  assert.match(page, /supabase-client\.js\?v=20260831-1/);
});

test("ราคาทุนล่าสุดเลือกแถวรับเข้าล่าสุดที่มีค่าและไม่แก้ข้อมูลต้นทาง", () => {
  const moves = [
    { id:"1", kind:"ยอดยกมา", unit_cost:80, recorded_at:"2026-01-01" },
    { id:"2", kind:"รับเข้า", unit_cost:null, recorded_at:"2026-02-01" },
    { id:"3", kind:"รับเข้า", unit_cost:"95.50", recorded_at:"2026-03-01" },
    { id:"4", kind:"ปรับยอด", unit_cost:999, recorded_at:"2026-04-01" }
  ];
  assert.equal(latestUnitCost(moves), "95.50");
  assert.equal(moves[0].id, "1");
});

test("มูลค่าคงคลังใช้ยอดคงเหลือคูณทุนล่าสุด และไม่มีทุนคืน null เพื่อแสดงขีด", () => {
  assert.equal(inventoryValue(12, 95.5), 1146);
  assert.equal(inventoryValue(12, null), null);
  assert.match(page, /value == null \? "—"/);
  assert.match(page, /รวมมูลค่าคงคลัง/);
});

test("เตือนของใกล้หมดเมื่อคงเหลือน้อยกว่าหรือเท่าจุดเตือนเท่านั้น", () => {
  const items = [
    { id:"low", track_stock:true, low_stock_threshold:5 },
    { id:"equal", track_stock:true, low_stock_threshold:5 },
    { id:"safe", track_stock:true, low_stock_threshold:5 },
    { id:"unset", track_stock:true, low_stock_threshold:null },
    { id:"not-stock", track_stock:false, low_stock_threshold:99 }
  ];
  const moves = [
    { item_id:"low", qty:4 }, { item_id:"equal", qty:5 }, { item_id:"safe", qty:6 },
    { item_id:"unset", qty:0 }, { item_id:"not-stock", qty:0 }
  ];
  assert.deepEqual(lowStockAlerts(items, moves).map(item => item.id), ["low", "equal"]);
  assert.match(page, /ของใกล้หมด \$\{low\.length\} รายการ/);
});

test("เพิ่มสินค้าหลายตัวเลือกพร้อมราคาและยอดยกมาใช้กลไกเดิมครบสามตาราง", () => {
  assert.deepEqual(parseVariantList("S, M, S，L"), ["S", "M", "L"]);
  assert.match(page, /sb\.from\("fee_items"\)\.insert\(payloads\)\.select\("id,display_name"\)/);
  assert.match(page, /sb\.from\("fee_product_prices"\)\.insert\(createdItems\.map/);
  assert.match(page, /sb\.from\("fee_stock_moves"\)\.insert\(createdItems\.map/);
  assert.match(page, /kind:"ยอดยกมา", qty:opening, unit_cost:unitCost/);
});

test("สร้างสินค้าแล้วขั้นราคาหรือยอดยกมาล้ม ต้องบอกสิ่งที่สำเร็จและกันกดสร้างซ้ำ", () => {
  assert.match(page, /const results = \[`สร้างสินค้า \$\{createdItems\.length\} รายการแล้ว`\]/);
  assert.match(page, /ราคาไม่สำเร็จ:/);
  assert.match(page, /ยอดยกมาไม่สำเร็จ:/);
  assert.match(page, /รายการสินค้าถูกสร้างแล้ว ห้ามกดเพิ่มซ้ำ/);
});

test("รับเข้าเก็บราคาทุน ผู้ขาย ใบส่งของ แต่ปรับยอดส่งค่าเหล่านี้เป็น null", () => {
  assert.match(page, /unit_cost:unitCost/);
  assert.match(page, /supplier:moveMode === "adjust" \? null/);
  assert.match(page, /doc_no:moveMode === "adjust" \? null/);
  assert.match(page, /el\("purchase-fields"\)\.hidden = mode === "adjust"/);
  assert.match(page, /ราคาทุน \$\{formatMoney\(move\.unit_cost\)\}/);
});

test("stockAlerts คืนเฉพาะสินค้าคุมสต๊อกที่ยังไม่มียอดยกมา", () => {
  const items = [
    { id:"shirt-s", track_stock:true },
    { id:"shirt-m", track_stock:true },
    { id:"lab", track_stock:false }
  ];
  const moves = [
    { item_id:"shirt-s", kind:"ยอดยกมา", qty:10 },
    { item_id:"shirt-m", kind:"รับเข้า", qty:5 },
    { item_id:"lab", kind:"ยอดยกมา", qty:1 }
  ];
  assert.deepEqual(stockAlerts(items, moves), [{ id:"shirt-m", track_stock:true }]);
  assert.match(page, /ยังไม่ได้ตั้งยอดยกมา \$\{missing\.length\} รายการ/);
  assert.match(page, /moveMode === "adjust" && !reason/);
  assert.match(page, /financeMenuKeepHrefs\(canFinance, session\.user\.id\)/);
  assert.doesNotMatch(page, /\b(?:alert|confirm|prompt)\s*\(/);
});
