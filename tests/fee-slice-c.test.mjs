import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const client=read("supabase-client.js");
const paymentPage=read("finance/fee-payment.html");
const receiptPage=read("finance/fee-receipt.html");
const reportPage=read("finance/fee-report.html");
const assignPage=read("finance/fee-assign.html");
const shell=read("app-shell.js");
const login=read("login.html");
const overview=read("finance/index.html");

function functionSource(source,name){
  const at=source.indexOf(`function ${name}(`);
  assert.ok(at>=0,`ไม่พบ ${name}`);
  const brace=source.indexOf("{",at);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==="{")depth++;
    if(source[index]==="}"&&--depth===0)return source.slice(at,index+1)
  }
  throw new Error(`ตัด ${name} ไม่สำเร็จ`)
}

const bahtStart=client.indexOf("const THAI_DIGITS");
const bahtEnd=client.indexOf("// ---------- ออมทรัพย์นักเรียน",bahtStart);
assert.ok(bahtStart>=0&&bahtEnd>bahtStart,"ตัด bahtText ไม่สำเร็จ");
const {bahtText}=new Function(client.slice(bahtStart,bahtEnd).replace("export function bahtText","function bahtText")+";return {bahtText};")();

const savingsStart=client.indexOf("export function computeSavingsBalance(");
const savingsEnd=client.indexOf("// จัดกลุ่มยอดคงเหลือทั้งห้อง",savingsStart);
const {computeSavingsBalance}=new Function(client.slice(savingsStart,savingsEnd).replace("export function","function")+";return {computeSavingsBalance};")();

const roundMoney=value=>Math.round((Number(value)||0)*100)/100;
const money=value=>`${Number(value).toFixed(2)} บาท`;
const paymentFns=new Function("roundMoney","money",
  functionSource(paymentPage,"allocateOldestFirst")+
  functionSource(paymentPage,"paymentDraftError")+
  functionSource(paymentPage,"paymentFailureState")+
  ";return {allocateOldestFirst,paymentDraftError,paymentFailureState};"
)(roundMoney,money);
const friendly=new Function("money",functionSource(paymentPage,"friendly")+";return friendly;")(money);

const chargeStart=client.indexOf("export function chargeLineRemaining(");
const chargeEnd=client.indexOf("export function summarizeFeeByRoom",chargeStart);
const chargeLineRemaining=new Function(client.slice(chargeStart,chargeEnd).replace("export function","function")+";return chargeLineRemaining;")();
const buildReceiptRows=new Function("chargeLineRemaining",functionSource(receiptPage,"buildReceiptRows")+";return buildReceiptRows;")(chargeLineRemaining);

test("bahtText อ่านจำนวนเงินไทยครบกรณีหลักของใบเสร็จ",()=>{
  const cases=[
    [0,"ศูนย์บาทถ้วน"],
    [1,"หนึ่งบาทถ้วน"],
    [21,"ยี่สิบเอ็ดบาทถ้วน"],
    [1120,"หนึ่งพันหนึ่งร้อยยี่สิบบาทถ้วน"],
    [100,"หนึ่งร้อยบาทถ้วน"],
    [1000000,"หนึ่งล้านบาทถ้วน"],
    [0.50,"ห้าสิบสตางค์"],
    [1.25,"หนึ่งบาทยี่สิบห้าสตางค์"]
  ];
  for(const [amount,expected] of cases)assert.equal(bahtText(amount),expected,String(amount))
});

test("computeSavingsBalance หักค่าใช้จ่ายและยังรักษาทิศทางรายการเดิม",()=>{
  assert.equal(computeSavingsBalance([
    {kind:"ยอดยกมา",amount:200},
    {kind:"ฝาก",amount:100},
    {kind:"ถอน",amount:20},
    {kind:"หักค่ารถ",amount:30},
    {kind:"หักค่าใช้จ่าย",amount:40}
  ]),210);
  assert.match(client,/txn\.kind === "ถอน" \|\| txn\.kind === "หักค่ารถ" \|\| txn\.kind === "หักค่าใช้จ่าย"/)
});

test("allocateOldestFirst เติมรายการเก่าสุดก่อนและหยุดกลางบรรทัดเมื่อเงินหมด",()=>{
  assert.deepEqual(paymentFns.allocateOldestFirst([
    {id:"new",charge_date:"2026-08-20",created_at:"2026-08-20T08:00:00Z",remaining:300},
    {id:"old",charge_date:"2026-08-01",created_at:"2026-08-01T08:00:00Z",remaining:100},
    {id:"middle",charge_date:"2026-08-10",created_at:"2026-08-10T08:00:00Z",remaining:200}
  ],250),[
    {charge_id:"old",amount:100},
    {charge_id:"middle",amount:150}
  ])
});

test("paymentDraftError บล็อกเมื่อรวมที่เลือกไม่เท่ากับเงินที่รับและเมื่อรับเกินค้าง",()=>{
  assert.match(paymentFns.paymentDraftError(200,[{amount:150,remaining:300,description:"ค่าเรียน"}],500),/ไม่เท่ากับเงินที่รับ/);
  assert.match(paymentFns.paymentDraftError(600,[{amount:600,remaining:600,description:"ค่าเรียน"}],500),/มากกว่ายอดค้าง/);
  assert.equal(paymentFns.paymentDraftError(200,[{amount:200,remaining:300,description:"ค่าเรียน"}],500),"")
});

test("ฐานปฏิเสธการหักออมทรัพย์ขั้นแรกไม่บล็อกและไม่เตือนว่าผลไม่แน่ชัด",()=>{
  const failure=paymentFns.paymentFailureState(false,false,false);
  const message=failure.prefix+friendly({message:"ยอดคงเหลือ 2588 บาท ไม่พอสำหรับรายการ 5000 บาท"});
  assert.equal(failure.blocked,false);
  assert.doesNotMatch(message,/ไม่แน่ชัด/);
  assert.equal(message,"รับเงินไม่สำเร็จ: ยอดออมทรัพย์ไม่พอ (เหลือ 2588.00 บาท) · ยังไม่มีการบันทึก")
});

test("ล้มหลังหักออมทรัพย์สำเร็จหรือคำขอไม่มีคำตอบยังบล็อกและเตือนเหมือนเดิม",()=>{
  for(const state of [
    [false,true,false],
    [false,false,true]
  ]){
    const failure=paymentFns.paymentFailureState(...state);
    assert.equal(failure.blocked,true);
    assert.match(failure.prefix,/ผลการบันทึกไม่แน่ชัด[^]*ห้ามกดซ้ำ/)
  }
});

test("ตารางเอกสารรวมคงเหลือตรงยอดค้างและคงบรรทัดลดหรืออุดหนุนเป็นค่าลบ",()=>{
  const table=buildReceiptRows([
    {id:"charge",description:"ค่ากิจกรรม",amount:1000,charge_date:"2026-08-01"},
    {id:"credit",description:"เงินอุดหนุน",amount:-200,charge_date:"2026-08-02"}
  ],[{charge_id:"charge",amount:300}]);
  assert.deepEqual(table.rows.map(row=>({id:row.id,full:row.full,paid:row.paid,remaining:row.remaining})),[
    {id:"charge",full:1000,paid:300,remaining:700},
    {id:"credit",full:-200,paid:0,remaining:-200}
  ]);
  assert.deepEqual({full:table.full,paid:table.paid,remaining:table.remaining},{full:800,paid:300,remaining:500})
});

test("เอกสารจ่ายศูนย์บาทยังมีตาราง ยอดค้าง และตัวอักษรครบ",()=>{
  const table=buildReceiptRows([{id:"charge",description:"ค่ากิจกรรม",amount:1120,charge_date:"2026-08-01"}],[]);
  assert.equal(table.paid,0);
  assert.equal(table.remaining,1120);
  assert.equal(bahtText(table.paid),"ศูนย์บาทถ้วน");
  for(const id of ["receipt-table","paid-words","outstanding-total","receipt-no","student-name"])assert.match(receiptPage,new RegExp(`id="${id}"`))
});

test("หน้ารับเงินใช้ RPC ออกเอกสาร ผูกหักออมทรัพย์ และไม่สร้าง fee_receipts ตรง",()=>{
  assert.match(paymentPage,/sb\.rpc\("get_or_create_fee_receipt"/);
  assert.doesNotMatch(paymentPage,/from\("fee_receipts"\)\.insert/);
  assert.match(paymentPage,/kind:"หักค่าใช้จ่าย"/);
  assert.match(paymentPage,/savings_txn_id:method==="หักออมทรัพย์"/);
  assert.ok(paymentPage.indexOf('from("savings_txns").insert(payloads)')<paymentPage.indexOf('from("fee_payments").insert(paymentRows)'))
  assert.match(paymentPage,/submissionBlocked=failure\.blocked/);
  assert.match(paymentPage,/requestUncertain=false;\s*if\(savingsRes\.error\)throw savingsRes\.error;\s*savingsWritten=true/);
  assert.match(paymentPage,/if\(submissionBlocked\)return toast\("ผลการบันทึกครั้งก่อนยังไม่แน่ชัด/)
});

test("หน้าเอกสารอ่าน snapshot กับหัวกระดาษ และนับพิมพ์ที่ฐานก่อน window.print",()=>{
  assert.match(receiptPage,/from\("student_charges"\)\.select\("\*"\)/);
  assert.doesNotMatch(receiptPage,/fee_admin_rates|fee_product_prices|fee_items/);
  for(const key of ["receipt_school_name","receipt_address","receipt_doc_title"])assert.match(receiptPage,new RegExp(key));
  const markAt=receiptPage.indexOf('sb.rpc("mark_fee_receipt_printed"');
  assert.ok(markAt>=0&&markAt<receiptPage.indexOf("window.print()",markAt));
  assert.match(receiptPage,/@page \{ size:A4 portrait; margin:12mm; \}/);
  assert.match(receiptPage,/id="print-button" class="primary no-print"/);
  assert.match(receiptPage,/\.nav, \.app-shell, \.app-sidebar, \.workflow, \.toast, \.no-print \{ display:none!important; \}/)
});

test("รายงานแสดงปุ่มพิมพ์ตามปีและเทอมเฉพาะฝ่ายการเงิน",()=>{
  const source=functionSource(reportPage,"renderLines");
  assert.match(source,/canFinance&&periods\.length/);
  assert.match(source,/fee-receipt\.html\?student=/);
  assert.match(source,/พิมพ์ใบแจ้งหนี้/);
  assert.match(reportPage,/from\("fee_payments"\)/)
});

test("fee-assign ส่ง term ครบ 4 โหมดหลังข้ามข้อ 1",()=>{
  const adminStart=assignPage.indexOf('el("save-admin").onclick=');
  const adminEnd=assignPage.indexOf('// เหตุผล: trigger ของ student_charges',adminStart);
  assert.ok(adminStart>=0&&adminEnd>adminStart,"ตัด payload โหมด 1 ไม่สำเร็จ");
  const handlers=[
    assignPage.slice(adminStart,adminEnd),
    functionSource(assignPage,"saveProductFromCurrentForm"),
    functionSource(assignPage,"saveSubsidyFromRoster"),
    functionSource(assignPage,"savePromoFromRoster")
  ];
  for(let index=0;index<handlers.length;index++){
    const insertAt=handlers[index].indexOf("await insertRows(");
    assert.ok(insertAt>=0,`ตัด payload โหมด ${index+1} ไม่สำเร็จ`);
    assert.match(handlers[index].slice(insertAt),/term:Number\(el\("term"\)\.value\),/)
  }
});

test("เมนู ทางเข้า และการ์ดเปิดหน้ารับเงินโดยไม่ใส่หน้าเอกสารในเมนู",()=>{
  assert.match(shell,/financeOnly: \[[^\]]*"fee-payment\.html"/);
  assert.match(shell,/\["fee-payment\.html", "รับเงินค่าใช้จ่ายนักเรียน"\]/);
  assert.doesNotMatch(shell,/\["fee-receipt\.html", "[^\]]+"\]/);
  assert.match(login,/"fee-payment\.html", "fee-receipt\.html"/);
  assert.match(overview,/href="fee-payment\.html" data-restricted="1" hidden/)
});

test("หน้าใหม่ใช้ cache-buster รุ่น Slice C และไม่ขยับ app-shell.css",()=>{
  for(const page of [paymentPage,receiptPage]){
    assert.match(page,/app-shell\.js\?v=20260831-1/);
    assert.match(page,/supabase-client\.js\?v=20260831-1/);
    assert.match(page,/app-shell\.css\?v=20260820-2/);
    assert.doesNotMatch(page,/\b(?:alert|confirm|prompt)\s*\(/)
  }
});

test("module scripts ของสองหน้าใหม่คอมไพล์ผ่าน",()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const page of [paymentPage,receiptPage]){
    const match=page.match(/<script type="module">([^]*?)<\/script>/);
    assert.ok(match,"หา module script ไม่พบ");
    const body=match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m,"");
    assert.doesNotThrow(()=>new AsyncFunction(body))
  }
});
