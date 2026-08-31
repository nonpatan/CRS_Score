import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const client=read("supabase-client.js");
const paymentPage=read("finance/fee-payment.html");
const receiptPage=read("finance/fee-receipt.html");
const reportPage=read("finance/fee-report.html");

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

const computeFeeOutstanding=new Function(functionSource(client,"computeFeeOutstanding").replace("export ","")+";return computeFeeOutstanding;")();
const chargeLineRemaining=new Function(functionSource(client,"chargeLineRemaining").replace("export ","")+";return chargeLineRemaining;")();
const reportFns=new Function(
  functionSource(reportPage,"bangkokDateOf")+
  functionSource(reportPage,"summarizeFeeRevenue")+
  ";return {bangkokDateOf,summarizeFeeRevenue};"
)();
const receiptVoidError=new Function(functionSource(receiptPage,"receiptVoidError")+";return receiptVoidError;")();
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const money=value=>`${Number(value).toFixed(2)} บาท`;
const formatThaiDateTime=value=>String(value);
const renderPaymentHistory=new Function("esc","money","formatThaiDateTime",
  functionSource(paymentPage,"renderPaymentHistory")+";return renderPaymentHistory;"
)(esc,money,formatThaiDateTime);

test("ยอดคงเหลือและยอดชำระไม่นับ payment ที่ยกเลิกแล้ว",()=>{
  const charge={id:"charge-1",amount:100};
  const payments=[
    {id:"active",charge_id:"charge-1",amount:30,voided_at:null},
    {id:"voided",charge_id:"charge-1",amount:20,voided_at:"2026-08-30T10:00:00Z"}
  ];
  assert.equal(chargeLineRemaining(charge,payments),70);
  assert.deepEqual(computeFeeOutstanding([charge],payments),{charged:100,credited:0,paid:30,outstanding:70})
});

test("สรุปรายรับแยกเงินสด โอน และหักออมทรัพย์โดยไม่นับรายการยกเลิก",()=>{
  const rows=[
    {amount:100,method:"เงินสด",paid_at:"2026-08-30T01:00:00Z"},
    {amount:50,method:"โอน",paid_at:"2026-08-30T02:00:00Z"},
    {amount:25,method:"หักออมทรัพย์",paid_at:"2026-08-30T03:00:00Z"},
    {amount:999,method:"เงินสด",paid_at:"2026-08-30T04:00:00Z",voided_at:"2026-08-30T05:00:00Z"},
    {amount:888,method:"เงินสด",paid_at:"2026-08-30T04:00:00Z",receipt_voided_at:"2026-08-30T05:00:00Z"},
    {amount:777,method:"เงินสด",paid_at:"2026-08-29T04:00:00Z"}
  ];
  assert.deepEqual(reportFns.summarizeFeeRevenue(rows,"2026-08-30","2026-08-30"),{"เงินสด":100,"โอน":50,"หักออมทรัพย์":25,count:3})
});

test("ยกเลิกทั้งใบบังคับคืนหรือทำลายกระดาษเฉพาะเมื่อเคยพิมพ์",()=>{
  assert.equal(receiptVoidError(1,false,"ออกยอดผิด"),"กรุณายืนยันว่าได้ใบเดิมคืนหรือทำลายแล้ว");
  assert.equal(receiptVoidError(2,true,"ออกยอดผิด"),"");
  assert.equal(receiptVoidError(0,false,"ออกยอดผิด"),"");
  assert.equal(receiptVoidError(0,false,""),"กรุณากรอกเหตุผลการยกเลิก")
});

test("บรรทัดรับเงินที่ยกเลิกยังแสดงเหตุผลและผู้ยกเลิก",()=>{
  const html=renderPaymentHistory([
    {id:"active",charge_id:"charge-1",amount:30,method:"เงินสด",paid_at:"2026-08-30T01:00:00Z"},
    {id:"voided",charge_id:"charge-1",amount:20,method:"หักออมทรัพย์",paid_at:"2026-08-30T02:00:00Z",voided_at:"2026-08-30T03:00:00Z",void_reason:"ลงยอดผิด",voided_by:"user-1"}
  ],[{id:"charge-1",description:"ค่ากิจกรรม"}],new Map([["user-1","ครูการเงิน"]]));
  const voidedRow=html.slice(html.indexOf('data-payment-row="voided"'),html.indexOf('data-payment-row="active"'));
  assert.match(voidedRow,/ยกเลิกแล้ว/);
  assert.match(voidedRow,/เหตุผล: ลงยอดผิด/);
  assert.match(voidedRow,/ยกเลิกโดย ครูการเงิน/);
  assert.match(html,/data-void-payment="active"/);
  assert.doesNotMatch(html,/data-void-payment="voided"/)
});

test("สามหน้าเรียก RPC และคงเงื่อนไข audit ตาม brief",()=>{
  assert.match(paymentPage,/sb\.rpc\("void_fee_payment",\{p_payment_id:payment\.id,p_reason:reason\}\)/);
  assert.match(paymentPage,/result\.savings_returned/);
  assert.match(receiptPage,/sb\.rpc\("void_fee_receipt",\{p_receipt_id:receipt\.id,p_reason:reason,p_paper_returned:/);
  assert.match(receiptPage,/เลขที่ \$\{receipt\.receipt_no\} จะถูกนำกลับมาใช้กับใบถัดไป/);
  assert.match(receiptPage,/el\("print-button"\)\.hidden=voided/);
  assert.match(reportPage,/canFinance&&tab==="revenue"/);
  assert.match(reportPage,/payment\?\.voided_at\|\|payment\?\.receipt_voided_at/)
});

test("ไฟล์ Slice D คอมไพล์ ไม่มี dialog ดิบ และไม่บัมพ์ cache",()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const page of [paymentPage,receiptPage,reportPage]){
    const match=page.match(/<script type="module">([^]*?)<\/script>/);
    assert.ok(match,"หา module script ไม่พบ");
    const body=match[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m,"");
    assert.doesNotThrow(()=>new AsyncFunction(body));
    assert.doesNotMatch(page,/\b(?:alert|confirm|prompt)\s*\(/);
    assert.match(page,/app-shell\.js\?v=20260831-1/);
    assert.match(page,/supabase-client\.js\?v=20260831-1/);
    assert.match(page,/app-shell\.css\?v=20260820-2/)
  }
});
