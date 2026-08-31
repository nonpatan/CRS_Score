import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(new URL(path, new URL("../", import.meta.url)), "utf8");
const client = read("supabase-client.js");
const shell = read("app-shell.js");
const myWork = read("personnel/my-work.html");
const board = read("personnel/duty-board.html");
const dashboard = read("personnel/index.html");
const summary = read("personnel/work-summary.html");
const duty = read("personnel/duty.html");
const schema = read("schema.sql");

test("helper การสลับเวรเรียก RPC ด้วยพารามิเตอร์ที่ฐานข้อมูลกำหนด", () => {
  for (const name of [
    "requestDutySwap", "respondDutySwap", "cancelDutySwap", "listMyDutySwaps",
    "listDutySwapReturnOptions", "listDutySwaps", "hrSwapDuty"
  ]) assert.match(client, new RegExp(`export async function ${name}\\(`));
  // logHrDutySwap ถูกแทนที่ด้วย hr_swap_duty ที่ย้ายเวรและบันทึกประวัติในทรานแซกชันเดียว
  assert.doesNotMatch(client, /logHrDutySwap/);
  assert.match(client, /sb\.rpc\("hr_swap_duty",\s*\{[^}]*p_duty_date:[^}]*p_duty_type:[^}]*p_from_staff_id:[^}]*p_to_staff_id:[^}]*p_return_duty_date:[^}]*p_return_duty_type:/s);
  assert.match(client, /sb\.rpc\("request_duty_swap",\s*\{[^}]*p_duty_date:[^}]*p_duty_type:[^}]*p_to_staff_id:[^}]*p_reason:[^}]*p_return_duty_date:[^}]*p_return_duty_type:/s);
  assert.match(client, /sb\.rpc\("duty_swap_return_options",\s*\{[^}]*p_to_staff_id:/s);
  assert.match(client, /sb\.rpc\("respond_duty_swap",\s*\{[^}]*p_id:[^}]*p_accept:[^}]*p_note:/s);
  assert.match(client, /sb\.rpc\("cancel_duty_swap", \{ p_id: id \}\)/);
  assert.match(client, /sb\.rpc\("my_duty_swaps"\)/);
});

test("ประวัติฝ่ายบุคคลแบ่งชื่อสอง FK และไล่หน้าป้องกันเพดาน 1000 แถว", () => {
  assert.match(client, /staff!duty_swaps_from_staff_id_fkey\(full_name\)/);
  assert.match(client, /staff!duty_swaps_to_staff_id_fkey\(full_name\)/);
  assert.match(client, /page\("duty_date"\)/);
  assert.match(client, /page\("return_duty_date"\)/);
  assert.match(client, /new Map\(\[\.\.\.\(main\.data \|\| \[\]\), \.\.\.\(ret\.data \|\| \[\]\)\][\s\S]*?\[row\.id, row\]/);
  // ใบประวัติของฝ่ายบุคคลย้ายไปเขียนใน hr_swap_duty แล้ว หน้าเว็บไม่ insert duty_swaps เองอีก
  assert.doesNotMatch(client, /from\("duty_swaps"\)\s*\.insert/);
});

test("หน้า my-work ซ่อนปุ่มตามเส้นตาย แถวมาแทน และสถานะงาน", () => {
  assert.match(myWork, /row\.duty_date > today/);
  assert.match(myWork, /!String\(row\.note \|\| ""\)\.startsWith\("มาแทน"\)/);
  assert.match(myWork, /dutyTypeByCode\.get\(row\.duty_type\)\?\.active === true/);
  assert.match(myWork, /วันนี้สลับเองไม่ได้แล้ว ถ้าติดธุระกะทันหันให้แจ้งฝ่ายบุคคล/);
  assert.match(myWork, /person\.id !== me\.id[\s\S]*person\.has_login === true[\s\S]*!assigned\.has\(person\.id\)/);
  assert.match(myWork, /คนที่ยังไม่มีบัญชีในระบบจะไม่อยู่ในรายการ เพราะกดยอมรับไม่ได้/);
  assert.doesNotMatch(myWork, /scrollIntoView/);
});

test("หน้า my-work แบ่งคำขอสามกลุ่มและไม่ให้รับรายการหมดอายุ", () => {
  for (const label of ["รอคุณตอบ", "คำขอที่คุณส่ง", "ที่ปิดไปแล้ว", "ยังไม่มีคำขอสลับเวร"]) {
    assert.match(myWork, new RegExp(label));
  }
  assert.match(myWork, /หมดอายุแล้ว เพราะวันเวรมาถึงแล้ว/);
  assert.match(myWork, /row\.direction === "รับ" && row\.status === "รอตอบรับ" && !row\.is_expired/);
  assert.match(myWork, /row\.source !== "ฝ่ายบุคคล"/);
  assert.match(myWork, /ฝ่ายบุคคลเป็นคนย้ายเวรให้ รายการนี้ไม่ต้องตอบกลับ/);
});

test("คำยืนยันรับเวรใช้ข้อมูลจริงและ await ทุกครั้ง", () => {
  assert.match(myWork, /if \(!await window\.crsAskConfirm\(\{/g);
  assert.match(myWork, /หลังจากนี้ตารางเวรของทั้งสองฝ่ายจะเปลี่ยนทันที/);
  assert.match(myWork, /วันนั้นคุณต้องลงเวลาไม่เกิน \$\{start\} น\. และขออนุญาตเข้าสายไม่ได้/);
  assert.match(myWork, /คุณได้รับการอนุโลมไม่ต้องลงเวลา ระบบจึงตรวจการเข้าเวรของคุณไม่ได้/);
  assert.match(myWork, /คุณมีการอนุโลมเวลาเข้างาน แต่วันเวรจะไม่ใช้ค่านั้น/);
  assert.doesNotMatch(myWork, /late_permissions[\s\S]{0,500}รับเวรนี้/);
});

test("ตารางเวรของทุกคนเป็นหน้าอ่านอย่างเดียวและเปิดแก่ผู้ล็อกอินทุกคน", () => {
  assert.match(board, /<title>ตารางเวรของทุกคน — CRS MIS<\/title>/);
  assert.match(board, /<h1>ตารางเวรของทุกคน<\/h1>/);
  assert.match(board, /applyPersonnelMenuAccess\(await checkDepartment\("บุคลากร"\)\)/);
  assert.match(board, /getDutyRoster[\s\S]*getDutyTypes[\s\S]*listStaffPicker/);
  assert.match(board, /work_schedule/);
  assert.match(board, /work_holidays/);
  assert.match(board, /staff_id === me\?\.id/);
  assert.doesNotMatch(board, /saveDutyRosterEntry|removeDutyRosterEntry/);
  assert.doesNotMatch(board, /วันนี้ยังไม่มีเวร/);

  assert.match(shell, /\["duty-board\.html", "ตารางเวรของทุกคน"\]/);
  assert.match(shell, /"duty-board\.html": \{\s*title: "ตารางเวรของทุกคน"/);
  const hrOnly = shell.match(/hrOnly:\s*\[[^\]]*\]/)?.[0] || "";
  assert.doesNotMatch(hrOnly, /duty-board\.html/);
});

test("หน้า HR ทั้งสามอ่านประวัติชุดเดียวและหน้า duty บันทึกหลังย้ายเวร", () => {
  assert.match(dashboard, /listDutySwaps\(today, today\)/);
  assert.match(dashboard, /วันนี้ไม่มีการสลับเวร/);
  assert.match(dashboard, /เป็นเรื่องระหว่างครู ฝ่ายบุคคลไม่ต้องทำอะไร/);
  assert.match(summary, /listDutySwaps\(range\.from, range\.to\)/);
  assert.match(summary, /การสลับเวรในช่วงที่เลือก/);
  assert.match(duty, /listDutySwaps\(range\.from, range\.to\)/);
  assert.match(duty, /listDutySwaps\(range\.from, range\.to\)\.catch\(/);
  assert.match(duty, /สลับกับ \$\{esc\(swapHistory\.partner/);
  assert.match(duty, /row\.note && !swapHistory/);
  assert.match(duty, /`\$\{row\.return_duty_date\}\|\$\{row\.return_duty_type\}\|\$\{row\.from_staff_id\}`/);

  // 🔻 เส้นทางสลับของฝ่ายบุคคลต้องเป็นคำสั่งเดียว ห้ามกลับไปแตะ duty_roster ตรง ๆ
  //    ไม่งั้นการแลก 2 ทางจะหลุดทรานแซกชัน แล้วเวรของอีกวันหายเงียบเมื่อพังกลางคัน
  assert.match(duty, /await hrSwapDuty\(/);
  assert.doesNotMatch(duty, /await saveDutyRosterEntry\(swapState\.date/);
  assert.doesNotMatch(duty, /await removeDutyRosterEntry\(swapState\.date/);
  assert.doesNotMatch(duty, /logHrDutySwap/);
  assert.doesNotMatch(duty, /สลับเวรแล้ว แต่บันทึกประวัติไม่สำเร็จ/);
});

test("cache-buster กลางเหลือค่าเดียวและ app-shell.css ไม่ถูกบัมพ์", () => {
  const grep = pattern => execFileSync("sh", ["-c", `grep -rho '${pattern}' --include='*.html' . | sort -u`], {
    cwd: root, encoding: "utf8"
  }).trim().split("\n").filter(Boolean);
  assert.deepEqual(grep("supabase-client\\.js?v=[0-9a-z-]*"), ["supabase-client.js?v=20260831-1"]);
  assert.deepEqual(grep("app-shell\\.js?v=[0-9a-z-]*"), ["app-shell.js?v=20260831-1"]);
  assert.deepEqual(grep("app-shell\\.css?v=[0-9a-z-]*"), ["app-shell.css?v=20260820-2"]);

  // 🪤 ตาราง §7 ของ UI-STANDARD.md เคยค้างที่เลขเก่ามาแล้ว 2 ครั้ง — รอบหน้าคนอ่านตารางนี้
  // เพื่อตัดสินใจว่าจะบัมพ์เป็นเลขอะไร ถ้ามันโกหกจะบัมพ์ผิดทั้งโครงการ จึงล็อกให้ตรงกันเสมอ
  const standard = read("docs/UI-STANDARD.md");
  for (const [file, version] of [
    ["app-shell.js", "20260831-1"],
    ["app-shell.css", "20260820-2"],
    ["supabase-client.js", "20260831-1"]
  ]) {
    const row = standard.split("\n").find(line => line.startsWith(`| \`${file}\` |`));
    assert.ok(row, `หาแถวของ ${file} ในตาราง §7 ไม่พบ`);
    assert.ok(row.includes(`\`${version}\``),
      `docs/UI-STANDARD.md §7 บอกว่า ${file} เป็นเลขอื่น แต่ของจริงคือ ${version}`);
  }
});

test("hr_swap_duty รัดสิทธิ์ฝ่ายบุคคล และจงใจไม่มีด่านวันที่", () => {
  // 🪤 ตัดขอบท้ายที่บล็อกตรวจ/ย้อนกลับ ห้าม slice ยาวถึงท้ายไฟล์ — migration ใหม่ต่อท้ายเรื่อย ๆ
  const start = schema.indexOf("create or replace function hr_swap_duty(");
  const end = schema.indexOf("\n$$;", start);
  assert.ok(start >= 0 && end > start, "หา hr_swap_duty ไม่พบ");
  const fn = schema.slice(start, end);

  assert.match(fn, /if not has_department\('บุคลากร'\) then/);
  // ⛔ ฝ่ายบุคคลต้องแก้ตารางย้อนหลังได้ ด่านวันที่อยู่ที่หน้าเว็บ (คำเตือน) ไม่ใช่ที่ฐาน
  assert.doesNotMatch(fn, /<= v_today/);
  // ย้ายเวรครบ 4 คำสั่ง: insert/delete ทั้งขาไปและขาคืน
  assert.equal((fn.match(/insert into duty_roster/g) || []).length, 2);
  assert.equal((fn.match(/delete from duty_roster/g) || []).length, 2);
  // แถว "มาแทน …" ต้องยกโน้ตเดิมไป ไม่งั้นตัวนับ "เวรที่ไปแทน" ลดลงเงียบ ๆ
  assert.equal((fn.match(/like 'มาแทน%'/g) || []).length, 2);
  // ใบประวัติเขียนในทรานแซกชันเดียวกับการย้ายเวร
  assert.match(fn, /insert into duty_swaps/);

  // ข้อห้ามเดิมต้องถูกปลด · schema.sql เป็นบันทึกต่อท้าย บรรทัด add ของ migration เก่า
  // ยังอยู่เป็นประวัติ จึงต้องดูว่า "คำสั่งที่รันจริงตัวท้ายสุด" คือ drop ไม่ใช่ add
  const liveLines = schema.split("\n")
    .map((line, index) => ({ line, index }))
    .filter(row => !row.line.trimStart().startsWith("--"));
  const lastAdd = liveLines.findLast(row => row.line.includes("add constraint duty_swaps_hr_one_way"));
  const lastDrop = liveLines.findLast(row => row.line.includes("drop constraint if exists duty_swaps_hr_one_way"));
  assert.ok(lastDrop, "ไม่มีคำสั่ง drop duty_swaps_hr_one_way ที่รันจริง");
  assert.ok(lastDrop.index > lastAdd.index,
    "duty_swaps_hr_one_way ถูกสร้างกลับมาหลังคำสั่ง drop — ฝ่ายบุคคลจะมีขาคืนไม่ได้");
});

test("ตัวเลือกเวรแลกคืนของฝ่ายบุคคลกรองถูกและเรียงตามวัน", () => {
  const from = duty.indexOf("function hrReturnDutyOptions");
  const to = duty.indexOf("function pastDutyWarning", from);
  assert.ok(from >= 0 && to > from, "หา hrReturnDutyOptions ไม่พบ");
  const hrReturnDutyOptions = new Function(
    `${duty.slice(from, to)}; return hrReturnDutyOptions;`
  )();

  const roster = [
    { duty_date:"2026-09-08", duty_type:"เวรเช้า", staff_id:"A" },  // ช่องที่กำลังสลับ
    { duty_date:"2026-09-15", duty_type:"เวรบ่าย", staff_id:"B" },
    { duty_date:"2026-09-02", duty_type:"เวรบ่าย", staff_id:"B" },
    { duty_date:"2026-09-20", duty_type:"เวรเช้า", staff_id:"B" },  // A มีช่องนี้แล้ว → ต้องตัด
    { duty_date:"2026-09-20", duty_type:"เวรเช้า", staff_id:"A" },
    { duty_date:"2026-09-08", duty_type:"เวรเช้า", staff_id:"C" }
  ];
  const types = new Map([["เวรเช้า", { sort_order:1 }], ["เวรบ่าย", { sort_order:2 }]]);
  const keys = hrReturnDutyOptions(roster, "B", "A", "2026-09-08", "เวรเช้า", types)
    .map(row => `${row.duty_date}|${row.duty_type}`);

  assert.deepEqual(keys, ["2026-09-02|เวรบ่าย", "2026-09-15|เวรบ่าย"]);
  // 🔻 ช่องที่เจ้าของเวรเดิมมีอยู่แล้วต้องไม่โผล่ ไม่งั้นกดแล้วไปตายที่ฐานแทนที่จะไม่เห็นตัวเลือก
  assert.ok(!keys.includes("2026-09-20|เวรเช้า"));
  assert.equal(hrReturnDutyOptions(roster, "C", "A", "2026-09-08", "เวรเช้า", types).length, 0);
});

test("แผงสลับของฝ่ายบุคคลล้างขาคืนเมื่อเปลี่ยนคน และเตือนย้อนหลังทั้งสองขา", () => {
  // เปลี่ยนคนแล้วต้องล้าง returnKey — หน้าครูเคยพลาดตรงนี้จนขาคืนของคนก่อนค้าง
  assert.match(duty, /swapState\.selectedStaffId = staffSelect\.value;\s*swapState\.returnKey = "";/);
  // คำเตือนย้อนหลังต้องเช็คทั้งขาไปและขาคืน
  assert.match(duty, /const mainPastWarning = pastDutyWarning\(swapState\.date, type\)/);
  assert.match(duty, /pastDutyWarning\(returnRow\.duty_date, returnType\)/);
  // คำเตือนของทั้งสองฝ่าย — ของเดิมเตือนแค่คนที่รับเวรขาไป
  assert.match(duty, /warningsFor\(newStaff, type, swapState\.date\)/);
  assert.match(duty, /warningsFor\(oldStaff, returnType, returnRow\.duty_date\)/);
  // กล่องยืนยันของเส้นทางสลับต้องมีกล่องเดียว ห้ามเด้งซ้อนจนผู้ใช้กดผ่านโดยไม่อ่าน
  const handlerStart = duty.indexOf('const confirmSwap = event.target.closest("[data-confirm-swap]")');
  const handlerEnd = duty.indexOf("await hrSwapDuty(", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "หา handler ของปุ่มยืนยันไม่พบ");
  const handler = duty.slice(handlerStart, handlerEnd);
  assert.equal((handler.match(/crsAskConfirm/g) || []).length, 1);
  assert.doesNotMatch(handler, /confirmWarnings\(/);
  assert.match(duty, /ยืนยันการแลกเวร/);
  assert.match(duty, /ยืนยันการเปลี่ยนคน/);
});

test("หน้า my-work แสดงและส่งขาแลกคืนโดยไม่บังคับ", () => {
  assert.match(myWork, /listDutySwapReturnOptions\(staffId\)/);
  assert.match(myWork, /คุณให้:/);
  assert.match(myWork, /คุณได้:/);
  assert.match(myWork, /ยกเวรให้ \(ไม่ได้แลกคืน\)/);
  assert.match(myWork, /requestDutySwap\([\s\S]*?returnDate, returnType\)/);
});

test("respond_duty_swap ตรวจว่างานเวรยังเปิดใช้อยู่ทั้งสองขา", () => {
  // 🪤 ตัวล่าสุดอยู่ท้ายไฟล์ — ต้อง lastIndexOf ไม่ใช่ indexOf ไม่งั้นจะไปจับตัวเก่า
  const start = schema.lastIndexOf("create or replace function respond_duty_swap(");
  const end = schema.indexOf("\n$$;", start);
  assert.ok(start >= 0 && end > start, "หา respond_duty_swap ตัวล่าสุดไม่พบ");
  const fn = schema.slice(start, end);
  assert.match(fn, /duty_types where code = r\.duty_type and active/);
  assert.match(fn, /duty_types where code = r\.return_duty_type and active/);
  // ด่านใหม่ต้องอยู่หลังทางออก "ปฏิเสธ" — ใบของงานเวรที่ปิดแล้วยังต้องกดปฏิเสธได้
  assert.ok(fn.indexOf("return 'ปฏิเสธ';") < fn.indexOf("and active"),
    "ด่าน active ต้องไม่ขวางการกดปฏิเสธ");
});

test("ผู้ขอรู้ทันทีเมื่ออีกฝ่ายตอบ — Realtime ต่อครบสองฝั่งและไม่เชื่อ payload", () => {
  // 🪤 postgres_changes ใส่ filter ได้ครั้งละเงื่อนไขเดียว · ผู้ขออยู่ฝั่ง from ผู้รับอยู่ฝั่ง to
  //    ถ้าดักฝั่งเดียว คนที่ยื่นคำขอจะไม่รู้เลยว่าถูกตอบรับ ซึ่งคือบั๊กที่รอบนี้มาแก้พอดี
  for (const column of ["from_staff_id", "to_staff_id"]) {
    assert.ok(myWork.includes(`\`${column}=eq.\${me.id}\``) ||
      myWork.includes('for (const column of ["from_staff_id", "to_staff_id"]'),
      `ต้องดัก ${column}`);
  }
  assert.match(myWork, /table: "duty_swaps"/);
  assert.match(myWork, /sb\.channel\(/);
  assert.match(myWork, /\.subscribe\(\)/);
  // ดึงของจริงผ่าน RPC เสมอ ห้ามเอา payload ของ event มาแสดงตรง ๆ (ข้าม RLS ไม่ได้ + ไม่มีชื่อคน)
  assert.doesNotMatch(myWork, /payload\.new/);
  assert.match(myWork, /await loadDutySwapRequests\(\)/);
  // ห้ามดึงทับตอนผู้ใช้กำลังกดรับ/ปฏิเสธ ไม่งั้นสถานะบนจอสลับไปมา
  assert.match(myWork, /if \(swapActionBusy \|\| swapSyncPending\) return;/);
  // รวบหลาย event ของการตอบรับครั้งเดียวให้เหลือการดึงครั้งเดียว
  assert.match(myWork, /clearTimeout\(swapSyncTimer\)/);
  // ต้องคืนช่องทางเมื่อออกจากหน้า ไม่ปล่อย channel ค้าง
  assert.match(myWork, /sb\.removeChannel\(dutySwapChannel\)/);
  // 🛟 กันเหนียวเมื่อ WebSocket ต่อไม่ติด — กลับมาที่แท็บแล้วต้องดึงใหม่อยู่ดี
  assert.match(myWork, /visibilitychange/);
});

test("ข้อความแจ้งผู้ขอบอกถูกว่าใครทำอะไร และเงียบเมื่อไม่มีอะไรเปลี่ยน", () => {
  const from = myWork.indexOf("function describeSwapChange");
  const to = myWork.indexOf("let swapSyncPending", from);
  assert.ok(from >= 0 && to > from, "หา describeSwapChange ไม่พบ");
  const describeSwapChange = new Function(
    `${myWork.slice(from, to)}; return describeSwapChange;`
  )();

  const pending = { id:"1", status:"รอตอบรับ", direction:"ส่ง", to_name:"คอดียะฮ์", from_name:"กาญจนา" };
  const accepted = { ...pending, status:"ตอบรับแล้ว" };

  assert.match(describeSwapChange([pending], [accepted]), /คอดียะฮ์ รับเวรของคุณแล้ว/);
  assert.match(describeSwapChange([pending], [{ ...pending, status:"ปฏิเสธ" }]), /คอดียะฮ์ ปฏิเสธ/);
  // ฝั่งผู้รับต้องพลิกข้างชื่อ — ไม่งั้นขึ้นชื่อตัวเองว่ามารับเวรของตัวเอง
  const asReceiver = { ...pending, direction:"รับ" };
  assert.match(describeSwapChange([asReceiver], [{ ...asReceiver, status:"ตอบรับแล้ว" }]), /กาญจนา รับเวร/);
  // ไม่มีอะไรเปลี่ยน = ต้องเงียบ ห้ามเด้งข้อความรบกวนทุกครั้งที่กลับมาที่แท็บ
  assert.equal(describeSwapChange([pending], [pending]), "");
  assert.equal(describeSwapChange([], [accepted]), "", "ใบที่เพิ่งโผล่มาไม่ใช่การเปลี่ยนสถานะ");
  // ใบที่ปิดไปแล้วก่อนหน้านี้ ห้ามประกาศซ้ำ
  assert.equal(describeSwapChange([accepted], [accepted]), "");
});

test("migration Realtime ใส่ครบทั้ง publication และ replica identity", () => {
  const start = schema.lastIndexOf("-- Migration: เปิด Realtime ให้ใบคำขอสลับเวร");
  assert.ok(start >= 0, "หา migration Realtime ไม่พบ");
  const ddl = schema.slice(start);
  assert.match(ddl, /alter table duty_swaps replica identity full;/);
  assert.match(ddl, /alter publication supabase_realtime add table duty_swaps;/);
  // 🪤 ขาด replica identity full = RLS ตรวจแถวตอน UPDATE ไม่ได้ ครูจะไม่ได้รับ event เลย
  assert.ok(ddl.indexOf("replica identity full") < ddl.indexOf("add table duty_swaps"),
    "ตั้ง replica identity ก่อนใส่ publication");
  assert.match(ddl, /-- alter publication supabase_realtime drop table duty_swaps;/);
});

test("หน้าที่แตะไม่เพิ่ม native dialog", () => {
  for (const [name, source] of [["my-work", myWork], ["board", board], ["index", dashboard], ["summary", summary], ["duty", duty]]) {
    assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/, name);
  }
});
