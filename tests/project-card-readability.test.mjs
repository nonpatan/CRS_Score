import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../academic/projects.html", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `ไม่พบกฎ ${selector}`);
  return match[1];
}

test("พรีวิวตัดบรรทัดครบสามองค์ประกอบ และข้อความยาวคงย่อหน้าเดิม", () => {
  const preview = cssRule(".long-preview");
  assert.match(preview, /display:\s*-webkit-box/);
  assert.match(preview, /-webkit-box-orient:\s*vertical/);
  assert.match(preview, /-webkit-line-clamp:\s*4/);
  assert.match(preview, /white-space:\s*pre-line/);
  assert.match(cssRule(".long-text"), /white-space:\s*pre-line/);
});

test("summary ปิด marker ครบทั้ง Safari และมาตรฐาน", () => {
  assert.match(cssRule(".long-box > summary::-webkit-details-marker"), /display:\s*none/);
  assert.match(cssRule(".long-box > summary::marker"), /content:\s*""/);
});

test("ปุ่มกางและย่อมีพื้นที่แตะอย่างน้อย 44px", () => {
  assert.match(cssRule(".long-toggle"), /min-height:\s*44px/);
});

test("ตอนกางกล่อง หัวข้อกับปุ่มย่ออยู่แถวเดียวกันโดยไม่เปลี่ยน summary ตอนหุบ", () => {
  assert.match(cssRule(".long-box > summary"), /display:\s*block/);
  assert.match(cssRule(".long-box[open] > summary"), /display:\s*flex/);
  const toggleCloseRules = [...html.matchAll(/\.long-box\[open\] \.toggle-close\s*\{([^}]+)\}/g)]
    .map(match => match[1]);
  assert.ok(toggleCloseRules.some(rule => /margin-top:\s*0/.test(rule)));
});

test("คำเตือนยังไม่ได้กรอกไม่ถูกตัดกลางวลี", () => {
  assert.match(cssRule(".fact-warn"), /white-space:\s*nowrap/);
  assert.match(cssRule(".fact-list dd"), /overflow-wrap:\s*anywhere/);
});

test("fixture ใช้ CSS ชุดเดียวกับหน้าโครงการจริง", () => {
  const fixture = readFileSync(new URL("project-card-readability-visual.html", import.meta.url), "utf8");
  const styleOf = source => source.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  assert.equal(styleOf(fixture), styleOf(html));
});

test("ลบ project-result-summary ออกจาก CSS และ JavaScript แล้ว", () => {
  assert.doesNotMatch(html, /project-result-summary/);
});

test("longBox ซ่อนค่าว่าง กางย่อได้ วางข้อความเต็มนอก summary และ escape ข้อมูล", () => {
  const start = html.indexOf("function longBox(");
  const end = html.indexOf("\n\n  function projectArticle", start);
  assert.ok(start >= 0 && end > start, "หา longBox ไม่พบ");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
  const longBox = new Function("esc", `${html.slice(start, end)}\nreturn longBox;`)(esc);

  assert.equal(longBox("รายละเอียด", "", "<div></div>"), "");
  assert.equal(longBox("รายละเอียด", "   ", "<div></div>"), "");

  const normal = longBox("รายละเอียด", "บรรทัดแรก\nบรรทัดสอง", '<div class="long-text">ข้อความเต็ม</div>');
  assert.match(normal, /<details class="long-box">/);
  assert.match(normal, /toggle-open/);
  assert.match(normal, /toggle-close/);
  assert.ok(normal.indexOf("long-text") > normal.indexOf("</summary>"), "ข้อความเต็มต้องอยู่นอก summary");

  const unsafe = '<script>alert("x")</script>';
  const escaped = longBox(unsafe, unsafe, `<div class="long-text">${esc(unsafe)}</div>`);
  assert.doesNotMatch(escaped, /<script>/);
  assert.equal((escaped.match(/&lt;script&gt;/g) || []).length, 3, "label, preview และข้อความเต็มต้องถูก escape");
});

test("งบประมาณ escape ก่อนแทนคำเตือนด้วย markup", () => {
  assert.match(html, /const budgetHtml = esc\(budgetLine\)\.replace\("ยังไม่ได้กรอก",\s*'<span class="fact-warn">ยังไม่ได้กรอก<\/span>'\)/);
});

test("ผลการดำเนินงานสร้างเฉพาะรายการเสร็จสิ้น และรองรับทุกช่องที่มีข้อความ", () => {
  assert.match(html, /const resultParts = project\.status === "เสร็จสิ้น"[\s\S]*?project\.result_summary[\s\S]*?project\.result_obstacle[\s\S]*?project\.result_suggestion[\s\S]*?\.filter\(\(\[, text\]\) => String\(text \?\? ""\)\.trim\(\)\)/);
  assert.match(html, /longBox\("ผลการดำเนินงาน", resultParts\[0\]\[1\]/);
});

test("ลำดับการ์ดเป็นหัวเรื่อง ชิป คำเตือน ข้อเท็จจริง กล่องยาว เอกสาร และข้อมูลอนุมัติ", () => {
  const start = html.indexOf("return `<article", html.indexOf("function projectArticle"));
  const end = html.indexOf("</article>`;", start);
  const card = html.slice(start, end);
  const tokens = ["item-title", "${approvalBanner}", "${factList}", "${detailBox}", "${resultBox}", "${resultLinks}", "${approvalMeta}"];
  let previous = -1;
  for (const token of tokens) {
    const index = card.indexOf(token);
    assert.ok(index > previous, `${token} ต้องอยู่ตามลำดับที่กำหนด`);
    previous = index;
  }
});

test("cache-buster ทั้งสามไฟล์คงเลขเดิม", () => {
  assert.match(html, /supabase-client\.js\?v=20260831-1/);
  assert.match(html, /app-shell\.js\?v=20260831-1/);
  assert.match(html, /app-shell\.css\?v=20260820-2/);
});
