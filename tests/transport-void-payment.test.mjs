import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const page = read("finance/transport-remit.html");
const schema = read("schema.sql");
const startMarker = "-- ฝ่ายการเงิน ค่ารถรับส่ง — ลบรายการรับเงินที่ลงผิด (2026-08-28)";
const endMarker = "-- drop table if exists transport_payment_voids;";
const start = schema.indexOf(startMarker);
const end = schema.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start);
// ตัดที่ท้าย migration นี้ ไม่ให้ migration ในอนาคตไหลเข้ามาในเทสต์
const migration = schema.slice(start, end + endMarker.length);
const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
const sourceOf = name => {
  const start = page.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  return page.slice(start, page.indexOf("\n}", start) + 2);
};
const moduleBody = page.match(/<script type="module">([^]*?)<\/script>/)[1]
  .replace(/^import \{[^]*?\}\s*from "[^"]+";\s*/m, "");
const fixtureTxn = (changes = {}) => ({
  id:"00000000-0000-4000-8000-000000000001", student_id:"student-1",
  year:"2569", grade_level:"ม.2", classroom:"1", pay_date:"2026-08-28", amount:20,
  method:"เงินสด", remittance_id:null, student:{ name:'นักเรียน <ทดสอบ> & "หนึ่ง"', student_no:"1" },
  ...changes
});
function harness({ admin = true, finance = true, txns = [fixtureTxn()], rpc, confirm, loadError } = {}) {
  const elements = new Map(), documentEvents = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value:"", textContent:"", innerHTML:"", className:"", hidden:false, disabled:false,
      readOnly:false, attrs:{}, listeners:new Map(), focus(){},
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(type, fn) { this.listeners.set(type, fn); }
    });
    return elements.get(id);
  };
  const document = { getElementById:element, addEventListener:(type,fn) => documentEvents.set(type,fn) };
  const calls = [], confirmations = [], queries = [];
  const pendingRows = [...txns];
  const history = [{id:"remit-1", year:"2569", grade_level:"ม.2",classroom:"1",confirmed_at:"2026-08-27T10:00:00Z",txn_count:1,expected_total:30,counted_total:30,status:"ยืนยันแล้ว"}];
  const sb = {
    from(table) {
      queries.push(table);
      const query = { select(){return query}, eq(){return query}, is(){return query},
        then(resolve, reject) { return Promise.resolve({data:table === "transport_payments" ? pendingRows : history,error:loadError || null}).then(resolve,reject); }
      };
      return query;
    },
    async rpc(name,args) {
      calls.push({name,args});
      if (rpc) return await rpc(name,args);
      const txn = pendingRows.find(row => row.id === args.p_payment_id);
      if (!txn) return {error:{code:"P0001",message:"ไม่พบรายการรับเงินนี้"}};
      pendingRows.splice(pendingRows.indexOf(txn),1);
      return {data:[{student_id:txn.student_id,amount:txn.amount,method:txn.method,savings_removed:txn.method === "หักออมทรัพย์"}],error:null};
    }
  };
  const env = { document, sb, formatMoney:value => `${Number(value).toFixed(2)} บาท`, setTimeout:()=>0, clearTimeout:()=>{},
    window:{crsAskConfirm:async options => {confirmations.push(options);return confirm ? await confirm(options) : true}},
    fetchAllRows:async builder=>await builder(), getStaffNamesByUser:async()=>new Map() };
  const script = moduleBody.slice(0,moduleBody.indexOf("const session = await requireAuth();"));
  const api = new Function("env", `
    const {${Object.keys(env).join(",")}} = env;
    ${script}
    return {openVoidModal, openEditModal, openUnlockModal, closeActionModal, renderTxnList, renderHistory,
      setup(rows,admin,finance) { pending=rows;canAdmin=admin;canFinance=finance;buildGroups();selected=groups[0];remittances=${JSON.stringify(history)}; },
      setView(value) {detailView=value;renderTxnList();},
      getState() { return {actionMode,activeTxn,activeRemittance,voidBusy,selected}; }
    };
  `)(env);
  api.setup(txns,admin,finance);
  return {...api, element, documentEvents, calls, confirmations, queries,
    submit:()=>element("action-submit").listeners.get("click")(),
    clickTxn:txn=>element("txn-list").listeners.get("click")({target:{closest:selector=>selector === "[data-void-txn]" ? {dataset:{voidTxn:txn.id}} : null}})
  };
}

test("migration มีตารางประวัติ RPC definer จำกัดสิทธิ์ execute และ rollback ครบ", () => {
  assert.match(executable,/create table if not exists transport_payment_voids \(/);
  assert.match(executable,/create or replace function void_transport_payment\(/);
  assert.match(executable,/security definer\s+set search_path = public/);
  assert.match(executable,/returns table \(student_id uuid, amount numeric, method text, savings_removed boolean\)/);
  assert.match(executable,/revoke all on function void_transport_payment\(uuid,text\) from public, anon/);
  assert.match(executable,/grant execute on function void_transport_payment\(uuid,text\) to authenticated/);
  assert.match(migration,/-- drop function if exists void_transport_payment\(uuid,text\);/);
  assert.match(migration,/-- drop table if exists transport_payment_voids;/);
});

test("ประวัติมี policy SELECT ตัวเดียว ไม่มีช่องเขียนหรือลบประวัติจาก client", () => {
  assert.match(executable,/alter table transport_payment_voids enable row level security/);
  const policies = executable.match(/create policy[^;]+;/g) || [];
  assert.equal(policies.length,1);
  assert.match(policies[0],/transport_payment_voids_select on transport_payment_voids for select/);
  assert.match(policies[0],/can_read_room_money\(year, grade_level, classroom\)/);
  assert.doesNotMatch(policies.join("\n"),/for (?:insert|update|delete|all)\b/i);
  assert.match(executable,/payment_recorded_by[^]*?payment_recorded_at[^]*?reason[^]*?voided_by[^]*?voided_by_name[^]*?voided_at/);
});

test("RPC ตรวจ admin เหตุผล รายการนำส่งทั้งสองฝั่ง และคำขอเบิกก่อน audit และลบตามลำดับ FK", () => {
  assert.match(executable,/if not is_admin\(\) then/);
  assert.match(executable,/btrim\(coalesce\(p_reason, ''\)\)/);
  assert.match(executable,/if v_reason = '' then/);
  assert.match(executable,/v_pay\.id is null/);
  assert.match(executable,/v_pay\.remittance_id is not null/);
  assert.match(executable,/v_txn\.remittance_id is not null/);
  assert.match(executable,/from savings_withdrawals where savings_txn_id = v_txn\.id/);
  assert.match(executable,/from transport_payments where id = p_payment_id for update/);
  assert.match(executable,/from savings_txns where id = v_pay\.savings_txn_id for update/);
  const audit = executable.indexOf("insert into transport_payment_voids");
  const paymentDelete = executable.indexOf("delete from transport_payments");
  const savingsDelete = executable.indexOf("delete from savings_txns");
  assert.ok(audit >= 0 && paymentDelete > audit && savingsDelete > paymentDelete);
  assert.match(executable,/return query select v_pay\.student_id, v_pay\.amount, v_pay\.method, v_removed/);
});

test("ปุ่มลบสองมุมมองใช้ canAdmin แยกจาก canFinance และไม่มีในประวัติ", () => {
  const render = sourceOf("renderTxnList");
  assert.equal((render.match(/data-void-txn=/g)||[]).length,2);
  assert.equal((render.match(/canAdmin && txn\.remittance_id == null \? `<button[^>]+data-void-txn=/g)||[]).length,2);
  assert.doesNotMatch(sourceOf("renderHistory"),/data-void-txn|txn-void/);
  for (const view of ["day","person"]) {
    for (const [admin,finance,edits,voids] of [[true,true,1,1],[false,true,1,0],[false,false,0,0],[true,false,0,1]]) {
      const h = harness({admin,finance});
      h.setView(view);
      const html = h.element("txn-list").innerHTML;
      assert.equal((html.match(/data-edit-txn=/g)||[]).length,edits);
      assert.equal((html.match(/data-void-txn=/g)||[]).length,voids);
      assert.match(html,/นักเรียน &lt;ทดสอบ&gt; &amp; &quot;หนึ่ง&quot;/);
      h.renderHistory();
      assert.doesNotMatch(h.element("history-list").innerHTML,/data-void-txn/);
    }
    const h = harness({txns:[fixtureTxn({id:'bad"<&',remittance_id:null})]});
    h.setView(view);
    assert.match(h.element("txn-list").innerHTML,/data-void-txn="bad&quot;&lt;&amp;"/);
    const remitted = harness({txns:[fixtureTxn({remittance_id:"locked"})]});
    remitted.setView(view);
    assert.doesNotMatch(remitted.element("txn-list").innerHTML,/data-void-txn=/);
  }
});

test("ไม่มีการลบค่ารถตรงจาก client และยังโหลดคิวเงินสดที่ไม่นำส่งเหมือนเดิม", () => {
  // จำกัดถึงจบ statement เพื่อไม่จับ expandedStudents.delete() ซึ่งเป็น Set ใน listener อื่น
  assert.doesNotMatch(page,/from\("transport_payments"\)[^;]*?\.delete\(/);
  assert.doesNotMatch(page,/sb\.from\([^)]*\)[^;]*?\.delete\(/);
  assert.match(page,/sb\.rpc\("void_transport_payment"/);
  assert.match(sourceOf("loadData"),/\.eq\("method", "เงินสด"\)\.is\("remittance_id", null\)/);
  assert.doesNotMatch(sourceOf("loadData"),/transport_payment_voids/);
});

test("เปิดลบซ่อนยอด ล้างเหตุผล และปิดแล้วเปิดแก้ยอดคืนช่องกับปุ่มเดิม", () => {
  const h = harness(), txn = fixtureTxn();
  h.clickTxn(txn);
  assert.equal(h.getState().actionMode,"void");
  assert.equal(h.element("amount-field").hidden,true);
  assert.equal(h.element("action-submit").className,"danger");
  assert.equal(h.element("action-reason-label").textContent,"เหตุผลที่ลบ");
  assert.equal(h.element("action-summary").textContent.includes(txn.student.name),true);
  h.element("action-reason").value = "เหตุผลเก่า";
  h.closeActionModal();
  assert.equal(h.getState().activeTxn,null);
  h.openEditModal(txn);
  assert.equal(h.getState().actionMode,"edit");
  assert.equal(h.element("amount-field").hidden,false);
  assert.equal(h.element("action-amount").value,"20");
  assert.equal(h.element("action-reason").value,"");
  assert.equal(h.element("action-submit").className,"primary");
  assert.equal(h.element("action-submit").textContent,"บันทึกยอดที่แก้");
  h.closeActionModal();
  h.openVoidModal(fixtureTxn({method:"หักออมทรัพย์"}));
  assert.match(h.element("action-summary").textContent,/คืนเข้าสมุดออมทรัพย์/);
});

test("เปิดกล่องลบไม่ได้เมื่อไม่ใช่ admin ไม่มีแถว หรือแถวถูกนำส่งแล้ว", () => {
  for (const h of [harness({admin:false}),harness()]) {
    for (const txn of [null,fixtureTxn({remittance_id:"remitted"})]) {
      h.openVoidModal(txn);
      assert.equal(h.getState().actionMode,"");
    }
  }
  const h = harness({admin:false});
  h.openVoidModal(fixtureTxn());
  assert.equal(h.getState().actionMode,"");
});

test("เหตุผลว่างเตือนข้อความโหมดลบ ไม่ถามยืนยันและไม่ส่ง RPC", async () => {
  const h = harness();
  h.openVoidModal(fixtureTxn());
  h.element("action-reason").value = "  \n ";
  await h.submit();
  assert.equal(h.element("action-error").textContent,"ต้องระบุเหตุผลที่ลบรายการ");
  assert.equal(h.calls.length,0);
  assert.equal(h.confirmations.length,0);
});

test("กล่องยืนยันบังคับพิมพ์ลบ บอกชื่อ ยอด วิธี ผลกระทบ และยกเลิกได้โดยไม่ยิง RPC", async () => {
  for (const method of ["เงินสด","หักออมทรัพย์"]) {
    const txn=fixtureTxn({method}), h=harness({txns:[txn],confirm:async()=>false});
    h.openVoidModal(txn);
    h.element("action-reason").value="ลงผิด";
    await h.submit();
    const options=h.confirmations[0];
    assert.equal(options.requireText,"ลบ");
    assert.equal(options.danger,true);
    assert.ok(options.message.includes(txn.student.name));
    assert.ok(options.message.includes("20.00 บาท · "+method));
    assert.match(options.message,/ลบแล้วกู้คืนไม่ได้ · ยอดค้างค่ารถของนักเรียนจะกลับมาเป็นค้างอีกครั้ง/);
    assert.match(options.message,method === "เงินสด" ? /ยอดค้างส่งของห้องจะลดลง/ : /คืนเข้าสมุดออมทรัพย์/);
    assert.equal(h.calls.length,0);
    assert.equal(h.element("action-submit").disabled,false);
    assert.equal(h.element("action-cancel").disabled,false);
    assert.equal(h.element("action-reason").readOnly,false);
    assert.equal(h.element("action-reason").value,"ลงผิด");
  }
});

test("ลบเงินสดใช้ RPC ครั้งเดียวกับ id/เหตุผล โหลดห้องเดิมแล้วคิวลดจาก 50 เหลือ 30", async () => {
  const txns=[fixtureTxn(),fixtureTxn({id:"payment-2",student_id:"student-2",amount:15}),fixtureTxn({id:"payment-3",student_id:"student-3",amount:15})];
  const h=harness({txns});
  h.openVoidModal(txns[0]);
  h.element("action-reason").value="  รายการทดสอบลงผิด  ";
  await h.submit();
  assert.deepEqual(h.calls,[{name:"void_transport_payment",args:{p_payment_id:txns[0].id,p_reason:"รายการทดสอบลงผิด"}}]);
  assert.equal(h.getState().selected.total,30);
  assert.equal(h.getState().selected.rows.length,2);
  assert.equal(h.getState().selected.grade_level,"ม.2");
  assert.equal(h.element("action-overlay").hidden,true);
  assert.equal(h.element("toast").textContent,"ลบรายการ 20.00 บาท แล้ว");
});

test("ผล RPC แบบ object ของหักออมทรัพย์แจ้งคืนเงินตามยอดตอบจริง", async () => {
  const txn=fixtureTxn({method:"หักออมทรัพย์"});
  const h=harness({txns:[txn],rpc:async()=>({data:{student_id:txn.student_id,amount:18.50,method:txn.method,savings_removed:true}})});
  h.openVoidModal(txn);
  h.element("action-reason").value="ลงผิด";
  await h.submit();
  assert.match(h.element("toast").textContent,/คืนเงิน 18.50 บาท เข้าสมุดออมทรัพย์แล้ว/);
  assert.equal(h.calls.length,1);
});

test("RPC error คงกล่อง เหตุผล และไม่ reload หรือแจ้งว่าลบสำเร็จ", async () => {
  const h=harness({rpc:async()=>({error:{message:"รายการนี้ส่งเงินและยืนยันยอดแล้ว ลบไม่ได้ · ต้องปลดล็อกรอบส่งเงินก่อน"}})});
  h.openVoidModal(fixtureTxn());
  h.element("action-reason").value="ลงผิด";
  await h.submit();
  assert.match(h.element("action-error").textContent,/ต้องปลดล็อกรอบส่งเงินก่อน/);
  assert.equal(h.element("action-overlay").hidden,false);
  assert.equal(h.element("action-reason").value,"ลงผิด");
  assert.equal(h.element("toast").textContent,"");
  assert.equal(h.queries.length,0);
  assert.equal(h.element("action-submit").disabled,false);
});

test("เน็ตขาดหรือ RPC ไม่คืนแถว ไม่อ้างว่าลบสำเร็จและคืนปุ่มจากสถานะรอ", async () => {
  for (const rpc of [async()=>{throw new Error("network")},async()=>({data:[]})]) {
    const h=harness({rpc});
    h.openVoidModal(fixtureTxn());
    h.element("action-reason").value="ลงผิด";
    await h.submit();
    assert.match(h.element("action-error").textContent,/ยังยืนยันผลการลบไม่ได้/);
    assert.equal(h.element("toast").textContent,"");
    assert.equal(h.element("action-submit").disabled,false);
    assert.equal(h.getState().voidBusy,false);
  }
});

test("ระหว่างยืนยัน/ลบกดซ้ำหรือปิดกล่องไม่ได้ และไม่ไหลไปปลดล็อกรอบ", async () => {
  let confirmDone, rpcDone;
  const h=harness({confirm:()=>new Promise(r=>{confirmDone=r}),rpc:()=>new Promise(r=>{rpcDone=r})});
  h.openVoidModal(fixtureTxn());
  h.element("action-reason").value="ลงผิด";
  const task=h.submit();
  await h.submit();
  assert.equal(h.confirmations.length,1);
  h.element("action-cancel").listeners.get("click")();
  h.documentEvents.get("keydown")({key:"Escape"});
  assert.equal(h.getState().actionMode,"void");
  confirmDone(true);
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.element("action-submit").textContent,"กำลังลบ…");
  await h.submit();
  assert.equal(h.calls.length,1);
  rpcDone({data:[{student_id:"student-1",amount:20,method:"เงินสด",savings_removed:false}]});
  await task;
  assert.equal(h.calls[0].name,"void_transport_payment");
  assert.equal(h.getState().voidBusy,false);
});

test("ลบสำเร็จแต่โหลดคิวล้ม แจ้งว่าลบแล้ว ไม่ใช้ข้อความว่าลบไม่สำเร็จ", async () => {
  const h=harness({loadError:{message:"offline"}});
  h.openVoidModal(fixtureTxn());
  h.element("action-reason").value="ลงผิด";
  await h.submit();
  assert.match(h.element("toast").textContent,/ลบแล้ว แต่โหลดคิวล่าสุดไม่สำเร็จ/);
});

test("module คอมไพล์ ไม่มี dialog ดิบและ cache-buster ทุกหน้าไม่ขยับ", () => {
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
