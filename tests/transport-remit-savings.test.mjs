import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const page = read("finance/transport-remit.html");
const sourceOf = name => {
  const start = page.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  return page.slice(start, page.indexOf("\n}", start) + 2);
};
const moduleBody = page.match(/<script type="module">([^]*?)<\/script>/)[1]
  .replace(/^import \{[^]*?\}\s*from "[^"]+";\s*/m, "");
const withoutComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const fixture = (changes = {}) => ({
  id:"payment-1", student_id:"student-1", year:"2569", grade_level:"ม.2", classroom:"1",
  pay_date:"2026-08-28", method:"เงินสด", amount:20, remittance_id:null,
  student:{name:"นักเรียนหนึ่ง",student_no:"1"}, ...changes
});

function groupHarness({ pending = [], savings = [], remittances = [] } = {}) {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {innerHTML:""});
    return elements.get(id);
  };
  const api = new Function("env", `
    const {el,formatMoney,esc,thaiDate,pendingRows,savingsData,remittanceRows} = env;
    const roomKey = row => [row.year,row.grade_level,row.classroom].join("\\u0000");
    let pending=pendingRows, savingsRows=savingsData, remittances=remittanceRows, groups=[], selected=null;
    ${sourceOf("lastRemitDate")}
    ${sourceOf("savingsForRoom")}
    ${sourceOf("buildGroups")}
    ${sourceOf("renderRooms")}
    return {run(){buildGroups();renderRooms();return {groups,html:el("room-grid").innerHTML};}};
  `)({
    el, pendingRows:pending, savingsData:savings, remittanceRows:remittances,
    formatMoney:value=>`${Number(value).toFixed(2)} บาท`,
    esc:value=>String(value ?? "").replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]),
    thaiDate:value=>value
  });
  return api.run();
}

test("คิวรี่รายการค่ารถไม่กรอง method แต่ยังกรอง remittance_id และมีคิวรี่โหลดเพียงชุดเดียว", () => {
  // 🪤 กติกาที่ต้องล็อกคือ "โหลด transport_payments ด้วย fetchAllRows ชุดเดียว"
  // ไม่ใช่ "ชื่อตารางปรากฏในไฟล์ครั้งเดียว" — หน้านี้ยังมี sb.from("transport_payments")
  // อีกที่โดยชอบธรรมคือคำสั่ง update ตอนแก้ยอด ซึ่งมีมาก่อนงานนี้และไม่เกี่ยวกัน
  // (สเปกเดิมใน brief เขียนผิด ทำให้เคยมีการเพิ่มค่าคงที่มาบังชื่อตารางเพื่อให้เทสต์ผ่าน)
  assert.equal((page.match(/fetchAllRows\(\(\) => sb\.from\("transport_payments"\)/g) || []).length, 1);
  const load = withoutComments(sourceOf("loadData"));
  const query = load.match(/fetchAllRows\(\(\) => sb\.from\("transport_payments"\)[^\n]+/)[0];
  assert.doesNotMatch(query,/\.eq\("method",\s*"เงินสด"\)/);
  assert.match(query,/\.is\("remittance_id", null\)/);
});

test("แยก pending เป็นเงินสดล้วนและ savingsRows เป็นหักออมทรัพย์ทันทีหลังโหลด", () => {
  const load = withoutComments(sourceOf("loadData"));
  assert.match(load,/const rows = txnRes\.data \|\| \[\];/);
  assert.match(load,/pending = rows\.filter\(row => row\.method === "เงินสด"\);/);
  assert.match(load,/savingsRows = rows\.filter\(row => row\.method === "หักออมทรัพย์"\);/);
});

test("ยอดตามระบบและยอดยืนยันมาจาก pending เงินสดเท่านั้น", () => {
  const groups = sourceOf("buildGroups");
  assert.match(groups,/for \(const txn of pending\)/);
  assert.match(groups,/total:group\.rows\.reduce/);
  assert.doesNotMatch(groups,/total:[^\n]*(?:savingsRows|group\.savings)/);
  assert.match(page,/p_expected:snapshot\.total, p_counted:counted/);
  assert.doesNotMatch(page,/(?:snapshot|selected)\.total\s*\+\s*(?:savingsRows|selected\.savings)/);
});

test("ขอบเขตใช้รอบยืนยันล่าสุด ไม่รวมรอบปลดล็อก และรับรายการวันเดียวกันด้วย >=", () => {
  const api = new Function(`
    let remittances=[];
    ${sourceOf("lastRemitDate")}
    return {set(rows){remittances=rows},lastRemitDate};
  `)();
  assert.equal(api.lastRemitDate("2569","ม.2","1"),null);
  api.set([
    {year:"2569",grade_level:"ม.2",classroom:"1",status:"ยืนยันแล้ว",confirmed_at:"2026-08-26T10:00:00Z"},
    {year:"2569",grade_level:"ม.2",classroom:"1",status:"ปลดล็อก",confirmed_at:"2026-08-29T10:00:00Z"},
    {year:"2569",grade_level:"ม.2",classroom:"1",status:"ยืนยันแล้ว",confirmed_at:"2026-08-28T10:00:00Z"},
    {year:"2569",grade_level:"ม.3",classroom:"1",status:"ยืนยันแล้ว",confirmed_at:"2026-08-30T10:00:00Z"}
  ]);
  assert.equal(api.lastRemitDate("2569","ม.2","1"),"2026-08-28");
  assert.match(sourceOf("savingsForRoom"),/row\.pay_date >= boundary/);
  assert.doesNotMatch(sourceOf("savingsForRoom"),/row\.pay_date > boundary/);
});

test("ห้องที่มีแต่หักออมทรัพย์ในขอบเขตโผล่ต่อท้ายและไม่แสดงยอด 0.00 บาท", () => {
  const result = groupHarness({
    pending:[fixture({id:"cash",grade_level:"ม.1",amount:30})],
    savings:[fixture({id:"old",method:"หักออมทรัพย์",amount:100,pay_date:"2026-08-27"}),
      fixture({id:"same-day",method:"หักออมทรัพย์",amount:40,pay_date:"2026-08-28"})],
    remittances:[{year:"2569",grade_level:"ม.2",classroom:"1",status:"ยืนยันแล้ว",confirmed_at:"2026-08-28T12:00:00Z"}]
  });
  assert.equal(result.groups.length,2);
  assert.equal(result.groups[1].savings.length,1);
  assert.equal(result.groups[1].savings[0].id,"same-day");
  assert.match(result.html,/ม\.2[^]*ไม่มีเงินต้องนับ[^]*หักออมทรัพย์ 1 รายการ/);
  assert.doesNotMatch(result.html,/<strong>0\.00 บาท<\/strong>/);
});

test("ห้องเงินสดเรียงด้วยยอดเงินสดเดิมและห้อง savings-only อยู่ต่อท้าย", () => {
  const result = groupHarness({
    pending:[fixture({id:"cash-a",grade_level:"ม.1",amount:10}),fixture({id:"cash-b",grade_level:"ม.2",amount:20})],
    savings:[fixture({id:"saving-a",grade_level:"ม.1",method:"หักออมทรัพย์",amount:999}),
      fixture({id:"saving-only",grade_level:"ม.3",method:"หักออมทรัพย์",amount:200})]
  });
  assert.deepEqual(result.groups.map(group=>group.grade_level),["ม.2","ม.1","ม.3"]);
  assert.deepEqual(result.groups.map(group=>group.total),[20,10,0]);
  assert.match(sourceOf("buildGroups"),/sort\(\(a,b\) => b\.total - a\.total/);
});

test("ส่วนหักออมทรัพย์แสดงขอบเขต ตาราง ยอดรวม และปุ่มลบเฉพาะ admin โดยไม่มีงานนับเงิน", () => {
  assert.match(page,/หักออมทรัพย์ในรอบนี้ · ไม่ใช่เงินที่ครูถือมาส่ง/);
  assert.match(sourceOf("renderSavingsList"),/แสดงตั้งแต่รอบนำส่งล่าสุด \$\{thaiDate\(boundary\)\}/);
  assert.match(sourceOf("renderSavingsList"),/ยังไม่เคยมีรอบนำส่ง — แสดงทั้งหมด/);
  assert.match(sourceOf("renderSavingsList"),/รวม \$\{sortedRows\.length\} รายการ · \$\{formatMoney\(total\)\}/);
  assert.match(sourceOf("renderSavingsList"),/canAdmin \? `<td><button[^>]+class="txn-void danger"[^>]+data-void-txn=/);
  const section = page.slice(page.indexOf('<section id="savings-section"'),page.indexOf('</section>',page.indexOf('<section id="savings-section"')));
  assert.doesNotMatch(section,/ยืนยันรับเงิน|counted-total|นับเงินได้จริง/);
});

test("handler ปุ่มลบค้นทั้ง pending และ savingsRows และผูกกับตารางออมทรัพย์", () => {
  const handler = sourceOf("handleTxnClick");
  assert.match(handler,/pending\.find\([^]*?\|\| savingsRows\.find\(/);
  assert.match(page,/el\("savings-list"\)\.addEventListener\("click", handleTxnClick\)/);
  assert.match(sourceOf("openVoidModal"),/txn\.method === "หักออมทรัพย์"[^]*?คืนเข้าสมุดออมทรัพย์/);
});

test("module คอมไพล์ ไม่มี dialog ดิบ และ cache-buster ทั้งสามตัวยังคงเดิม", () => {
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(moduleBody));
  assert.doesNotMatch(page,/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  const pages=[];
  const walk=url=>{for(const entry of readdirSync(url,{withFileTypes:true})) {
    if([".git","node_modules"].includes(entry.name)) continue;
    const next=new URL(entry.name+(entry.isDirectory()?"/":""),url);
    if(entry.isDirectory()) walk(next);
    else if(entry.name.endsWith(".html")) pages.push(readFileSync(next,"utf8"));
  }};
  walk(root);
  const all=pages.join("\n");
  for(const [file,version] of [["supabase-client.js","20260831-1"],["app-shell.js","20260831-1"],["app-shell.css","20260820-2"]]) {
    const matches=all.match(new RegExp(file.replace(".","\\.")+"\\?v=[0-9a-z-]+","g"));
    assert.deepEqual([...new Set(matches)],[`${file}?v=${version}`]);
  }
});
