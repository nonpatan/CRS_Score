import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("finance/transport-entry.html");
const schema = read("schema.sql");
const marker = "-- ฝ่ายการเงิน ค่ารถรับส่ง — บันทึกรับเงินทั้งห้องในครั้งเดียว (2026-08-28)";
assert.ok(schema.includes(marker));
// 🪤 ต้องตัดท้ายที่บรรทัดย้อนกลับของ migration นี้ ไม่ใช่ปล่อยยาวถึงท้ายไฟล์ —
// migration ที่ถูกต่อท้ายภายหลัง (เช่น ลบรายการรับเงิน 2026-08-28) จะไหลเข้ามาในสไลซ์
// แล้วทำให้ assert "ไม่มี create policy / alter table" ของบล็อกนี้แดงทั้งที่บล็อกนี้ไม่ได้เปลี่ยน
const migrationEndMarker = "-- drop function if exists pay_transport_room_batch(text,text,text,jsonb);";
const migrationStart = schema.indexOf(marker);
const migrationEnd = schema.indexOf(migrationEndMarker, migrationStart);
assert.ok(migrationEnd > migrationStart, "หาบรรทัดย้อนกลับปิดท้าย migration ไม่พบ");
const migration = schema.slice(migrationStart, migrationEnd + migrationEndMarker.length);
const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
const sourceOf = name => {
  const start = page.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `ไม่พบฟังก์ชัน ${name}`);
  return page.slice(start, page.indexOf("\n}", start) + 2);
};
const today = "2026-08-28";
const currentYm = "2026-08-01";
const formatMoney = value => `${Number(value).toFixed(2)} บาท`;
const esc = new Function(`${page.match(/^const esc = .*;$/m)[0]}; return esc;`)();
const suggestedAmount = new Function("today", "currentYm", `${sourceOf("suggestedAmount")}; return suggestedAmount;`)(today, currentYm);
const makeState = (changes = {}) => ({
  period:{ billing_mode:"รายวัน", trip_mode:"ไป-กลับ" }, outstanding:300, balance:100,
  attendance:{ status:"มา" }, missingStudentRoomDates:[],
  charges:{ unannouncedMonths:[], days:[{ date:today, amount:30 }], months:[{ ym:currentYm, amount:300, announced:true }] },
  ...changes
});
const idOf = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function makeRow(index, value = "30", methodValue = "", stopped = false) {
  let typedValue = value;
  const input = { disabled:false, get value() { return typedValue; }, set value(_) { assert.fail("ระบบห้ามแตะช่องยอดหลัง render"); } };
  const options = { '[value="เงินสด"]':{ disabled:false }, '[value="หักออมทรัพย์"]':{ disabled:false } };
  const method = { value:methodValue, disabled:false, querySelector:selector => options[selector] };
  const note = { textContent:"" };
  return {
    dataset:{ studentId:idOf(index) }, input, method, note, options,
    type(value) { typedValue = value; },
    querySelector:selector => ({ ".amount":input, ".method":method, ".action-note":note })[selector],
    closest:selector => selector === "#stopped-list" && stopped ? {} : null
  };
}
function harness(rows, config = {}) {
  const elements = { "save-room":{ disabled:true, textContent:"บันทึกทั้งห้อง" }, "room-select":{ value:"0", disabled:false }, "stopped-group":{ open:false } };
  const states = config.states || new Map(rows.map(row => [row.dataset.studentId, makeState()]));
  const transportRoster = rows.map((row, index) => ({ student_id:row.dataset.studentId, student:{ name:`นักเรียนทดสอบ ${index + 1}` } }));
  const calls = [], confirmations = [], notices = [], reloads = [];
  const controls = [elements["room-select"], ...rows.flatMap(row => [row.input, row.method])];
  const document = { querySelectorAll:selector => selector.startsWith("#room-select") ? controls : rows };
  const env = {
    today, currentYm, formatMoney, esc, document, stateByStudent:states, transportRoster,
    TRANSPORT_CHARGE_STATUSES:["มา", "มาสาย"], currentYear:"2569", selectedRoom:{ grade_level:"ป.1", classroom:"1" },
    thaiDate:date => date, el:id => elements[id], toast:(...args) => notices.push(args),
    window:{ crsAskConfirm:async options => { confirmations.push(options); return config.confirm ? config.confirm(options) : true; } },
    sb:{ rpc:async (...args) => { calls.push(args); return config.rpc ? config.rpc(...args) : { data:[{ paid_count:rows.length, cash_total:30, savings_total:0 }], error:null }; } },
    reload:async index => { reloads.push(index); if (config.reload) await config.reload(index); }
  };
  const names = ["nameOf", "friendlyError", "actionAvailability", "suggestedAmount", "renderStudentRows", "collectIntents", "updateSaveRoom", "updateActionRow", "saveRoom"];
  const api = new Function("env", `
    const { ${Object.keys(env).join(",")} } = env;
    let savingRoom = false, roomNeedsReload = false;
    async function loadRoom(index) { await reload(index); roomNeedsReload = false; }
    ${names.map(sourceOf).join("\n")}
    return { ${names.join(",")} };
  `)(env);
  return { ...api, elements, states, calls, confirmations, notices, reloads, transportRoster };
}

test("RPC ทั้งห้องเป็น invoker จำกัดสิทธิ์ execute มี rollback และไม่แก้ตารางหรือ policy", () => {
  assert.match(executable, /create or replace function pay_transport_room_batch\(/);
  assert.match(executable, /returns table \(cash_total numeric, savings_total numeric, paid_count integer\)/);
  assert.match(executable, /security invoker/);
  assert.doesNotMatch(executable, /security definer|create policy|alter table|create trigger/i);
  assert.match(executable, /revoke all on function pay_transport_room_batch\(text,text,text,jsonb\) from public, anon/);
  assert.match(executable, /grant execute on function pay_transport_room_batch\(text,text,text,jsonb\) to authenticated/);
  assert.match(migration, /-- drop function if exists pay_transport_room_batch\(text,text,text,jsonb\)/);
});

test("RPC กันรายการว่าง ซ้ำ เกิน 200 วิธีผิด ยอดไม่บวก และโยน error ระบุคนให้ล้มทั้งชุด", () => {
  assert.match(executable, /jsonb_typeof\(p_items\) <> 'array'[^]*?jsonb_array_length\(p_items\) = 0/);
  assert.match(executable, /jsonb_array_length\(p_items\) > 200/);
  assert.match(executable, /count\(distinct item->>'student_id'\)/);
  assert.match(executable, /v_method is null or v_method not in \('เงินสด', 'หักออมทรัพย์'\)/);
  assert.match(executable, /v_amount is null or v_amount <= 0/);
  assert.match(executable, /exception when others then\s+raise exception 'คนที่ % \[student_id=%\] บันทึกไม่ผ่าน: %'/);
  assert.match(executable, /insert into savings_txns[^]*?returning id into v_savings_id[^]*?insert into transport_payments/);
});

test("suggestedAmount ใช้ยอดวันนี้หรือเดือนนี้ และตัดยอดค้างเมื่อจ่ายบางส่วนหรือจ่ายครบแล้ว", () => {
  const daily = makeState();
  assert.equal(suggestedAmount(daily, daily.period), 30);
  assert.equal(suggestedAmount({ ...daily, outstanding:12.50 }, daily.period), 12.50);
  const monthly = makeState({ period:{ billing_mode:"รายเดือน" } });
  assert.equal(suggestedAmount(monthly, monthly.period), 300);
  assert.equal(suggestedAmount({ ...monthly, outstanding:80 }, monthly.period), 80);
  assert.equal(suggestedAmount({ ...monthly, outstanding:0 }, monthly.period), 0);
  assert.equal(suggestedAmount({ ...monthly, outstanding:-10 }, monthly.period), 0);
});

test("suggestedAmount คืนศูนย์เมื่อไม่ประกาศ เลิกใช้รถ ไม่มียอดวันนี้ หรือยอดเป็นศูนย์", () => {
  const state = makeState();
  assert.equal(suggestedAmount({ ...state, period:null }, state.period), 0);
  assert.equal(suggestedAmount({ ...state, charges:{ ...state.charges, unannouncedMonths:[currentYm] } }, state.period), 0);
  assert.equal(suggestedAmount({ ...state, charges:{ ...state.charges, days:[] } }, state.period), 0);
  assert.equal(suggestedAmount({ ...state, charges:{ ...state.charges, days:[{ date:today, amount:0 }] } }, state.period), 0);
  assert.equal(suggestedAmount({ ...state, charges:{ ...state.charges, months:[{ ym:currentYm, amount:300, announced:false }] } }, { billing_mode:"รายเดือน" }), 0);
});

test("render เติม value จริง เลือกวิธีว่างเป็นตัวแรก ไม่แสดงศูนย์ และ escape ชื่อกับ aria-label", () => {
  const row = makeRow(1), h = harness([row]);
  const placement = { student_id:row.dataset.studentId, student:{ name:'เด็ก <img src=x onerror="oops"> & ทดสอบ', student_no:'"<1>' } };
  const html = h.renderStudentRows([placement]);
  assert.match(html, /class="amount"[^>]*min="0"[^>]*value="30"/);
  assert.match(html, /<select class="method"[^>]*>\s*<option value=""><\/option>/);
  assert.match(html, /aria-label="วิธีรับเงินของ เด็ก &lt;img src=x onerror=&quot;oops&quot;&gt; &amp; ทดสอบ"/);
  assert.doesNotMatch(html, /<img|data-suggested/);
  h.states.get(row.dataset.studentId).outstanding = 0;
  assert.match(h.renderStudentRows([placement]), /class="amount"[^>]*value=""/);
  h.states.set(row.dataset.studentId, makeState({ period:null, lastPeriod:{ billing_mode:"รายวัน" } }));
  const stopped = h.renderStudentRows([placement]);
  assert.match(stopped, /class="amount"[^>]*value=""/);
  assert.doesNotMatch(stopped, /override-button/);
});

test("collectIntents ตัดวิธีว่าง ยอดว่าง ศูนย์ ติดลบ ไม่ใช่ตัวเลข และนับกลุ่มเลิกใช้รถด้วย", () => {
  const rows = [makeRow(1, "12.345", "เงินสด"), makeRow(2, "5", "หักออมทรัพย์", true),
    makeRow(3), makeRow(4, "", "เงินสด"), makeRow(5, "0", "เงินสด"), makeRow(6, "-2", "เงินสด"),
    makeRow(7, "NaN", "เงินสด"), makeRow(8, "Infinity", "เงินสด")];
  const h = harness(rows);
  assert.deepEqual(h.collectIntents(), [
    { student_id:idOf(1), amount:12.35, method:"เงินสด" }, { student_id:idOf(2), amount:5, method:"หักออมทรัพย์" }
  ]);
  h.updateSaveRoom();
  assert.equal(h.elements["save-room"].disabled, false);
  rows.forEach(row => { row.method.value = ""; });
  h.updateSaveRoom();
  assert.equal(h.elements["save-room"].disabled, true);
});

test("ครูลบหรือพิมพ์ยอดแล้วสลับวิธี ระบบไม่เขียนช่องยอดและไม่เติมกลับ", () => {
  const row = makeRow(1), h = harness([row]);
  h.updateActionRow(row);
  assert.equal(h.elements["save-room"].disabled, true);
  for (const value of ["", "12.50", "0"]) {
    row.type(value);
    for (const method of ["เงินสด", "หักออมทรัพย์", ""]) {
      row.method.value = method;
      h.updateActionRow(row);
      assert.equal(row.input.value, value);
      assert.equal(h.collectIntents().length, value === "12.50" && method ? 1 : 0);
    }
  }
  assert.doesNotMatch(sourceOf("updateActionRow"), /input\.value\s*=(?!=)|\.amount["']\)\.value\s*=(?!=)/);
  assert.doesNotMatch(page, /querySelector\(["']\.amount["']\)\.value\s*=/);
});

test("ปิดเงินสดเมื่อยังไม่เช็คชื่อ ปิดออมเมื่อไม่พอ รีเซ็ตวิธีพร้อมเหตุผล แต่คงยอดไว้", () => {
  const row = makeRow(1, "30", "เงินสด"), h = harness([row]);
  h.states.get(idOf(1)).attendance = null;
  h.updateActionRow(row);
  assert.equal(row.options['[value="เงินสด"]'].disabled, true);
  assert.equal(row.method.value, "");
  assert.match(row.note.textContent, /ยกเลิกวิธีที่เลือกไว้เพราะสถานะเช็คชื่อ/);
  row.method.value = "หักออมทรัพย์";
  row.type("101");
  h.updateActionRow(row);
  assert.equal(row.options['[value="หักออมทรัพย์"]'].disabled, true);
  assert.equal(row.method.value, "");
  assert.match(row.note.textContent, /ยกเลิกวิธีที่เลือกไว้เพราะยอดออมทรัพย์ไม่พอ/);
  assert.equal(row.input.value, "101");
  assert.equal(h.elements["save-room"].disabled, true);
  row.type("10");
  h.updateActionRow(row);
  assert.equal(row.options['[value="หักออมทรัพย์"]'].disabled, false);
  assert.equal(row.method.value, "");
});

test("ยอดไม่ประกาศล็อกช่องยอดกับวิธี และกลุ่มเลิกใช้รถกางเมื่อเลือกวิธี", () => {
  const row = makeRow(1, "10", "หักออมทรัพย์", true), h = harness([row]);
  h.updateActionRow(row);
  assert.equal(h.elements["stopped-group"].open, true);
  h.states.get(idOf(1)).charges.unannouncedMonths = [currentYm];
  h.updateActionRow(row);
  assert.equal(row.input.disabled, true);
  assert.equal(row.method.disabled, true);
  assert.equal(row.method.value, "");
  assert.equal(row.input.value, "10");
});

test("saveRoom สรุปเงินสด ออม จำนวนคน ยอดรวม แล้วเรียก RPC ครั้งเดียวและใช้ยอดตอบจริง", async () => {
  const rows = [makeRow(1, "10.10", "เงินสด"), makeRow(2, "20.20", "เงินสด"), makeRow(3, "5", "หักออมทรัพย์", true), makeRow(4)];
  const h = harness(rows, { rpc:async () => ({ data:[{ paid_count:3, cash_total:"30.30", savings_total:"5.00" }], error:null }) });
  await h.saveRoom();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.confirmations[0].message, "ป.1 · 1 · 2026-08-28\nลงใหม่ 35.30 บาท (3 คน)\nเงินสด 30.30 บาท (2 คน)\nหักออมทรัพย์ 5.00 บาท (1 คน)\nรวม 35.30 บาท จาก 3 คน");
  assert.deepEqual(h.calls, [["pay_transport_room_batch", { p_year:"2569", p_grade:"ป.1", p_classroom:"1", p_items:h.collectIntents() }]]);
  assert.deepEqual(h.notices[0], ["บันทึกแล้ว 3 คน · เงินสด 30.30 บาท · หักออมทรัพย์ 5.00 บาท"]);
  assert.deepEqual(h.reloads, ["0"]);
  assert.equal(h.elements["save-room"].textContent, "บันทึกทั้งห้อง");
});

test("กล่องยืนยันซ่อนหมวดที่ไม่มีรายการ แต่แสดงรวมทุกกรณี", async () => {
  const confirmMessage = async (rows, configure = () => {}) => {
    const h = harness(rows);
    configure(h);
    await h.saveRoom();
    assert.equal(h.confirmations.length, 1);
    assert.match(h.confirmations[0].message, /รวม \d+\.\d{2} บาท จาก \d+ คน$/);
    return h.confirmations[0].message;
  };

  const cashOnly = await confirmMessage([makeRow(1, "10", "เงินสด"), makeRow(2, "20", "เงินสด")]);
  assert.match(cashOnly, /ลงใหม่ 30\.00 บาท \(2 คน\)/);
  assert.match(cashOnly, /เงินสด 30\.00 บาท \(2 คน\)/);
  assert.doesNotMatch(cashOnly, /หักออมทรัพย์/);

  const overwriteOnly = await confirmMessage(
    [makeRow(1, "10", "เงินสด"), makeRow(2, "20", "เงินสด")],
    h => {
      h.states.get(idOf(1)).todayPayment = { amount:10, method:"เงินสด" };
      h.states.get(idOf(2)).todayPayment = { amount:20, method:"เงินสด" };
    }
  );
  assert.doesNotMatch(overwriteOnly, /ลงใหม่/);
  assert.match(overwriteOnly, /แก้ทับของเดิม 30\.00 บาท \(2 คน\)/);
  assert.match(overwriteOnly, /เงินสด 30\.00 บาท \(2 คน\)/);

  const bothMethods = await confirmMessage([makeRow(1, "10", "เงินสด"), makeRow(2, "20", "หักออมทรัพย์")]);
  assert.match(bothMethods, /ลงใหม่ 30\.00 บาท \(2 คน\)/);
  assert.match(bothMethods, /เงินสด 10\.00 บาท \(1 คน\)/);
  assert.match(bothMethods, /หักออมทรัพย์ 20\.00 บาท \(1 คน\)/);
});

test("saveRoom ยกเลิกได้ ไม่ยิง RPC และคืนฟอร์มเดิม", async () => {
  const row = makeRow(1, "12", "เงินสด"), h = harness([row], { confirm:async () => false });
  await h.saveRoom();
  assert.equal(h.calls.length, 0);
  assert.equal(row.input.value, "12");
  assert.equal(row.method.value, "เงินสด");
  assert.equal(row.method.disabled, false);
  assert.equal(h.elements["room-select"].disabled, false);
});

test("saveRoom ตรวจเกินค้าง เงินออมไม่พอ และเช็คชื่อซ้ำก่อนยืนยัน ไม่ยิงทั้งชุดที่มีคนผิด", async () => {
  for (const changes of [{ outstanding:5 }, { attendance:null }]) {
    const rows = [makeRow(1, "10", "เงินสด"), makeRow(2, "10", "เงินสด")], h = harness(rows);
    Object.assign(h.states.get(idOf(2)), changes);
    await h.saveRoom();
    assert.equal(h.calls.length, 0);
    assert.equal(h.confirmations.length, 0);
    assert.match(h.notices[0][0], /นักเรียนทดสอบ 2/);
  }
  const row = makeRow(1, "101", "หักออมทรัพย์"), h = harness([row]);
  await h.saveRoom();
  assert.equal(h.calls.length, 0);
  assert.equal(h.confirmations.length, 0);
});

test("RPC ปฏิเสธแล้วคงฟอร์ม ไม่ reload แปลชื่อและบอกว่ายังไม่มีรายการใดถูกบันทึก", async () => {
  const row = makeRow(1, "30", "เงินสด");
  const h = harness([row], { rpc:async () => ({ error:{ code:"P0001", message:`คนที่ 1 [student_id=${idOf(1)}] บันทึกไม่ผ่าน: ยอดออมไม่พอ` } }) });
  await h.saveRoom();
  assert.match(h.notices[0][0], /คนที่ 1 \(นักเรียนทดสอบ 1\) บันทึกไม่ผ่าน: ยอดออมไม่พอ · ยังไม่มีรายการใดถูกบันทึก/);
  assert.equal(row.input.value, "30");
  assert.equal(row.method.value, "เงินสด");
  assert.equal(h.reloads.length, 0);
  assert.equal(h.elements["save-room"].disabled, false);
  for (const [message, translated] of [["row-level security", "คุณไม่มีสิทธิ์"], ["transport_payments_amount_positive", "ยอดรับต้องมากกว่า 0"]]) {
    const error = h.friendlyError({ message:`คนที่ 1 [student_id=${idOf(1)}] บันทึกไม่ผ่าน: ${message}` }, { batch:true });
    assert.match(error, /\(นักเรียนทดสอบ 1\)/);
    assert.ok(error.includes(translated));
    assert.match(error, /ยังไม่มีรายการใดถูกบันทึก$/);
  }
  assert.doesNotMatch(h.friendlyError({ message:"โหลดข้อมูลไม่ได้" }), /ยังไม่มีรายการใดถูกบันทึก/);
});

test("ระหว่างยืนยันหรือส่ง RPC กดซ้ำไม่ได้ และล็อกห้องกับฟอร์มจนจบ", async () => {
  let finishConfirm, finishRpc;
  const row = makeRow(1, "30", "เงินสด"), h = harness([row], {
    confirm:() => new Promise(resolve => { finishConfirm = resolve; }),
    rpc:() => new Promise(resolve => { finishRpc = resolve; })
  });
  const saving = h.saveRoom();
  assert.equal(h.elements["save-room"].disabled, true);
  assert.equal(h.elements["room-select"].disabled, true);
  assert.equal(row.input.disabled, true);
  await h.saveRoom();
  assert.equal(h.confirmations.length, 1);
  finishConfirm(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.elements["save-room"].textContent, "กำลังบันทึก…");
  await h.saveRoom();
  assert.equal(h.calls.length, 1);
  finishRpc({ data:{ paid_count:1, cash_total:30, savings_total:0 } });
  await saving;
  assert.equal(row.input.disabled, false);
  assert.equal(h.elements["room-select"].disabled, false);
});

test("เน็ตขาดหรือผลตอบไม่ครบ ไม่เดาว่ายังไม่บันทึกและกันส่งซ้ำจนโหลดข้อมูลใหม่", async () => {
  for (const rpc of [async () => { throw new Error("Failed to fetch"); }, async () => ({ error:{ code:"", message:"Failed to fetch" } }), async () => ({ data:null })]) {
    const row = makeRow(1, "30", "เงินสด"), h = harness([row], { rpc });
    await h.saveRoom();
    assert.match(h.notices[0][0], /ยังยืนยันผลการบันทึกไม่ได้/);
    assert.doesNotMatch(h.notices[0][0], /ยังไม่มีรายการใดถูกบันทึก/);
    assert.equal(h.elements["save-room"].disabled, true);
    assert.equal(row.input.value, "30");
    await h.saveRoom();
    assert.equal(h.calls.length, 1);
  }
});

test("บันทึกสำเร็จแต่ reload ล้ม ต้องบอกผลที่บันทึกแล้วและห้ามส่งยอดเดิมซ้ำ", async () => {
  const h = harness([makeRow(1, "30", "เงินสด")], { reload:async () => { throw new Error("offline"); } });
  await h.saveRoom();
  assert.match(h.notices.at(-1)[0], /บันทึกแล้ว 1 คน[^]*?แต่โหลดข้อมูลใหม่ไม่สำเร็จ/);
  assert.equal(h.elements["save-room"].disabled, true);
  await h.saveRoom();
  assert.equal(h.calls.length, 1);
});

test("หน้าเหลือปุ่มทั้งห้อง ไม่มี summary ซ้ำ และผูก input/change/click กับสองกลุ่ม", () => {
  assert.doesNotMatch(page, /cash-button|savings-button|receiveCash|deductSavings|pay_transport_from_savings|room-summary|today-cash|ไม่เก็บวันนี้/);
  assert.match(page, /id="save-room"[^>]*disabled>บันทึกทั้งห้อง/);
  assert.match(page, /for \(const listId of \["student-list", "stopped-list"\]\)/);
  assert.match(page, /for \(const eventName of \["input", "change"\]\)/);
  assert.match(page, /el\("save-room"\)\.addEventListener\("click", saveRoom\)/);
  assert.match(page, /\.room-actions \{ position:sticky; bottom:0;/);
  assert.equal((page.match(/sb\.rpc\("pay_transport_room_batch"/g) || []).length, 1);
  assert.doesNotMatch(sourceOf("saveRoom"), /\.from\(/);
});

test("module คอมไพล์ผ่าน ไม่มี dialog ดิบ และ cache-buster ทุกตัวคงเดิม", () => {
  const body = page.match(/<script type="module">([^]*?)<\/script>/)[1].replace(/^import \{[^]*?\} from "[^"]+";\s*/m, "");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(body));
  assert.doesNotMatch(page, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  assert.match(page, /supabase-client\.js\?v=20260831-1/);
  assert.match(page, /app-shell\.js\?v=20260831-1/);
  assert.match(page, /app-shell\.css\?v=20260820-2/);
});

test("แก้ทับ: buildState แยกแถววันนี้เปิด/นำส่งจาก query เดิม ไม่เอาแถววันก่อนมาเติม", () => {
  const student_id = idOf(1);
  const records = [
    { id:"old", student_id, pay_date:"2026-08-27", amount:7, method:"เงินสด", remittance_id:null },
    { id:"sent", student_id, pay_date:today, amount:"10", method:"เงินสด", remittance_id:"r1" },
    { id:"sent2", student_id, pay_date:today, amount:"5", method:"เงินสด", remittance_id:"r2" },
    { id:"open", student_id, pay_date:today, amount:"20", method:"หักออมทรัพย์", remittance_id:null }
  ];
  const build = new Function("payments", `
    const today = '${today}', periods = [], overrides = [], attendance = [], roomAttendance = [], monthRates = [];
    const yearRange = { start:'2026-05-18' }, transportRoster = [{ student_id:'${student_id}' }];
    const balanceByStudent = new Map(), currentPeriod = () => null, missingStudentRoomDates = () => [];
    const computeTransportCharges = () => ({}), computeTransportOutstanding = () => 0;
    let stateByStudent, activeTransportRoster, stoppedTransportRoster;
    ${sourceOf("groupByStudent")}
    ${sourceOf("splitTransportRoster")}
    ${sourceOf("buildState")}
    buildState(); return { state:stateByStudent.get('${student_id}'), stoppedTransportRoster };
  `);
  const built = build(records);
  assert.equal(built.state.todayPayment, records[3]);
  assert.equal(built.state.todayRemitted, 15);
  assert.equal(built.stoppedTransportRoster.length, 1, "เลิกใช้รถแต่เพิ่งชำระครบวันนี้ ต้องยังเห็นแถวเพื่อแก้ทับ");
  assert.equal(build(records.slice(0, 3)).state.todayPayment, null);
  const load = sourceOf("loadRoom");
  assert.equal((load.match(/fetchAllRows\(/g) || []).length, 8, "เดิม 1 query ช่วงใช้รถ + 7 ใน Promise.all");
  assert.match(load, /from\("transport_payments"\)\.select\("id,student_id,pay_date,amount,method,remittance_id"\)/);
});

test("แก้ทับ: ยอดจริงชนะด่านไม่มีหนี้/เลิกใช้รถ/ยังไม่ประกาศ และเติมวิธีเดิมทั้งสองทาง", () => {
  for (const method of ["เงินสด", "หักออมทรัพย์"]) {
    const row = makeRow(1), h = harness([row]);
    const state = makeState({ outstanding:0, todayPayment:{ amount:"20", method } });
    h.states.set(idOf(1), state);
    assert.equal(suggestedAmount(state, state.period), 20);
    assert.equal(suggestedAmount({ ...state, period:null, charges:{ ...state.charges, unannouncedMonths:[currentYm] } }, null), 20);
    const html = h.renderStudentRows(h.transportRoster);
    assert.match(html, /class="amount"[^>]*value="20"/);
    assert.ok(html.includes(`<option value="${method}" selected>${method}</option>`));
    assert.equal((html.match(/ selected>/g) || []).length, 1);
    assert.ok(html.includes(`วันนี้บันทึกแล้ว 20.00 บาท · ${method}`));
  }
});

test("ล้างยอดเดิม: ป้ายอ่าน state ยังอยู่ ยอดไม่เติมกลับ และไม่นำแถวนั้นส่ง RPC", async () => {
  const rows = [makeRow(1, "20", "เงินสด"), makeRow(2, "10", "เงินสด")];
  const h = harness(rows);
  h.states.get(idOf(1)).todayPayment = { amount:20, method:"เงินสด" };
  const before = h.renderStudentRows(h.transportRoster);
  rows[0].type("");
  h.updateActionRow(rows[0]);
  assert.match(rows[0].note.textContent, /ล้างช่องไม่ได้ยกเลิกรายการที่บันทึกแล้ว · ต้องแจ้งฝ่ายการเงินให้ลบ/);
  assert.equal(rows[0].input.value, "");
  assert.equal(h.renderStudentRows(h.transportRoster), before);
  await h.saveRoom();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0][1].p_items, [{ student_id:idOf(2), amount:10, method:"เงินสด" }]);
  assert.doesNotMatch(h.confirmations[0].message, /แก้ทับของเดิม|เปลี่ยนวิธีรับเงิน/);
  assert.equal(h.states.get(idOf(1)).todayPayment.amount, 20);
});

test("นำส่งแล้ว: ไม่เติมยอด/วิธีของแถวปิด และป้ายแยกจากรายการเปิดที่แก้ทับ", () => {
  const row = makeRow(1), h = harness([row]);
  const state = makeState({ outstanding:0, todayPayment:null, todayRemitted:20 });
  h.states.set(idOf(1), state);
  let html = h.renderStudentRows(h.transportRoster);
  assert.match(html, /นำส่งแล้ว 20.00 บาท วันนี้ · แก้ไม่ได้ ยอดที่กรอกใหม่จะเป็นการรับเพิ่ม/);
  assert.match(html, /class="amount"[^>]*value=""/);
  assert.doesNotMatch(html, /วันนี้บันทึกแล้ว| selected>/);
  state.outstanding = 12;
  assert.equal(suggestedAmount(state, state.period), 12);
  state.todayPayment = { amount:5, method:"เงินสด" };
  html = h.renderStudentRows(h.transportRoster);
  assert.match(html, /วันนี้บันทึกแล้ว 5.00 บาท/);
  assert.match(html, /นำส่งแล้ว 20.00 บาท วันนี้ · แก้ไม่ได้ แก้ได้เฉพาะยอดที่ยังไม่นำส่ง/);
  assert.equal(h.actionAvailability(idOf(1), 17).cash, true);
  assert.equal(h.actionAvailability(idOf(1), 18).cash, false);
});

test("เพดานแก้ทับ = หนี้คงเหลือ + ยอดเดิม; ไม่เปิดรับเกินหนี้หรือคืนยอดนำส่งมาใช้", async () => {
  const row = makeRow(1, "20", "เงินสด"), h = harness([row]);
  const state = makeState({ outstanding:0, todayPayment:{ amount:20, method:"เงินสด" }, todayRemitted:50 });
  h.states.set(idOf(1), state);
  assert.equal(h.actionAvailability(idOf(1), 20).cash, true);
  assert.equal(h.actionAvailability(idOf(1), 40).cash, false);
  row.type("40"); h.updateActionRow(row);
  assert.match(row.note.textContent, /แก้ทับได้ไม่เกิน 20.00 บาท/);
  await h.saveRoom();
  assert.equal(h.calls.length, 0);
  state.outstanding = 20;
  await h.saveRoom();
  assert.equal(h.calls.length, 1);
  assert.match(h.confirmations[0].message, /แก้ทับของเดิม 40.00 บาท \(1 คน\)/);
  Object.assign(state, { outstanding:0.1, todayPayment:{ amount:0.2, method:"เงินสด" } });
  assert.equal(h.actionAvailability(idOf(1), 0.3).cash, true);
  assert.equal(h.actionAvailability(idOf(1), 0.31).cash, false);
});

test("แก้ออม: บวกยอดหักเดิมกลับเฉพาะรายการเปิด ไม่หักเงินเดิมซ้ำ ไม่ปล่อยยอดออมติดลบ", async () => {
  const row = makeRow(1, "20", "หักออมทรัพย์"), h = harness([row]);
  const state = makeState({ outstanding:20, balance:0, todayPayment:{ amount:"20", method:"หักออมทรัพย์" } });
  h.states.set(idOf(1), state);
  h.updateActionRow(row);
  assert.equal(row.method.value, "หักออมทรัพย์");
  assert.equal(row.options['[value="หักออมทรัพย์"]'].disabled, false);
  assert.equal(h.actionAvailability(idOf(1), 20).savings, true);
  await h.saveRoom();
  assert.equal(h.calls.length, 1);
  assert.equal(h.actionAvailability(idOf(1), 21).savings, false);
  row.type("21"); h.updateActionRow(row);
  assert.match(row.note.textContent, /รวมยอดหักเดิมแก้ได้ไม่เกิน 20.00 บาท/);
  state.balance = 5;
  assert.equal(h.actionAvailability(idOf(1), 25).savings, true);
  assert.equal(h.actionAvailability(idOf(1), 26).savings, false);
  state.todayPayment.method = "เงินสด";
  assert.equal(h.actionAvailability(idOf(1), 6).savings, false);
  state.todayPayment = null; state.todayRemitted = 20;
  assert.equal(h.actionAvailability(idOf(1), 6).savings, false);
});

test("เปลี่ยนวิธีทั้งสองทาง: เตือนยอดเดิม คงแถวในชุด ยืนยันนับแก้ทับและเปลี่ยนวิธี", async () => {
  for (const [from, to, warning] of [
    ["หักออมทรัพย์", "เงินสด", /จะยกเลิกการหักออมทรัพย์ 15.00 บาท และคืนเงินเข้าสมุดให้ก่อน แล้วลงเป็นเงินสดแทน/],
    ["เงินสด", "หักออมทรัพย์", /จะยกเลิกรายการเงินสด 15.00 บาท แล้วหักจากสมุดออมทรัพย์แทน/]
  ]) {
    const rows = [makeRow(1, "20", to), makeRow(2, "10", "เงินสด")], h = harness(rows);
    h.states.get(idOf(1)).todayPayment = { amount:15, method:from };
    h.updateActionRow(rows[0]);
    assert.match(rows[0].note.textContent, warning);
    assert.equal(h.collectIntents().length, 2);
    await h.saveRoom();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0][1].p_items[0], { student_id:idOf(1), amount:20, method:to });
    assert.match(h.confirmations[0].message, /ลงใหม่ 10.00 บาท \(1 คน\)\nแก้ทับของเดิม 20.00 บาท \(1 คน\)\nเปลี่ยนวิธีรับเงิน 1 คน\n/);
    assert.match(h.confirmations[0].message, /รวม 30.00 บาท จาก 2 คน/);
  }
});

test("แก้ทับยังต้องผ่านด่านเช็คชื่อ/ประกาศยอด และคืนเงินออมแล้วก็ไม่ได้รับเงินสดถ้าไม่มา", async () => {
  for (const changes of [{ attendance:null }, { attendance:{ status:"ขาด" } }, { charges:{ unannouncedMonths:[currentYm] } }]) {
    const row = makeRow(1, "20", "เงินสด"), h = harness([row]);
    h.states.set(idOf(1), makeState({ outstanding:0, todayPayment:{ amount:20, method:"หักออมทรัพย์" }, ...changes }));
    await h.saveRoom();
    assert.equal(h.calls.length, 0);
    assert.equal(h.confirmations.length, 0);
  }
});

test("วิธีเดิมยังแสดงแม้สถานะปัจจุบันปิดวิธีนั้น แต่กดบันทึกไม่ผ่านด่านเดิม", async () => {
  const row = makeRow(1, "20", "เงินสด"), h = harness([row]);
  h.states.set(idOf(1), makeState({ outstanding:0, attendance:null, todayPayment:{ amount:20, method:"เงินสด" } }));
  h.updateActionRow(row);
  assert.equal(row.method.value, "เงินสด", "อย่าซ่อนวิธีที่บันทึกอยู่จริงด้วยการรีเซ็ต select");
  assert.equal(row.options['[value="เงินสด"]'].disabled, true);
  await h.saveRoom();
  assert.equal(h.calls.length, 0);
  assert.equal(h.confirmations.length, 0);
});

// 🔴 ถอด "ปุ่ม" คือถอดทางที่ครูจะ *สร้าง* override ใหม่ — ไม่ใช่ถอด "สูตร"
// สูตรคิดเงินยังต้องเคารพ override ที่มีอยู่ เพราะทางแก้ยอดที่ตั้งค่าผิดย้อนหลังที่เหลืออยู่
// ทางเดียวคือให้ผู้ดูแลระบบ insert แถวผ่าน SQL · ถ้าลบคิวรี่ทิ้ง แถวที่ insert จะไม่มีผลเลย
// และเงินจะผิดต่อไปเงียบ ๆ ⟹ ห้าม "ทำความสะอาด" ลบคิวรี่นี้
test("ถอด UI แก้ยอดของวันแล้ว แต่สูตรยังเคารพ override ที่มีอยู่", () => {
  assert.doesNotMatch(page, /override-card|override-button|openOverride|refreshOverrideEditor|overrideContext|preset-row|แก้ยอดของวัน/);
  assert.match(page, /fetchAllRows\(\(\) => sb\.from\("transport_day_overrides"\)/);
  assert.match(page, /overrides:overridesByStudent\.get\(studentId\)/);
});

test("toast หลังบันทึกแสดงเฉพาะวิธีที่มียอดจริง ไม่ขึ้น \"เงินสด 0.00 บาท\"", async () => {
  const saved = async (method, result) => {
    const h = harness([makeRow(1, "20", method)], { rpc:async () => ({ data:[result], error:null }) });
    await h.saveRoom();
    return h.notices.map(args => args[0]);
  };
  assert.deepEqual(await saved("หักออมทรัพย์", { paid_count:1, cash_total:0, savings_total:20 }),
    ["บันทึกแล้ว 1 คน · หักออมทรัพย์ 20.00 บาท"]);
  assert.deepEqual(await saved("เงินสด", { paid_count:1, cash_total:20, savings_total:0 }),
    ["บันทึกแล้ว 1 คน · เงินสด 20.00 บาท"]);
  assert.deepEqual(await saved("เงินสด", { paid_count:2, cash_total:20, savings_total:10 }),
    ["บันทึกแล้ว 2 คน · เงินสด 20.00 บาท · หักออมทรัพย์ 10.00 บาท"]);
});
