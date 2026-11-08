import { sb, fetchAllRows } from "../supabase-client.js?v=20261104-1";

export const HV_UTILITIES = ["ไฟฟ้า", "น้ำประปา", "ห้องน้ำในบ้าน", "อินเทอร์เน็ต", "มุมอ่านหนังสือ"];
export const HV_DEPENDENTS = ["ผู้สูงอายุ", "ผู้พิการ", "ผู้ป่วยเรื้อรัง/ติดเตียง", "เด็กเล็ก"];
export const HV_RISKS = ["ติดเกม/โทรศัพท์", "บุหรี่/บุหรี่ไฟฟ้า", "สุรา", "สารเสพติด", "การพนัน", "ความรุนแรงในครอบครัว", "ทะเลาะวิวาท", "คบเพื่อนกลุ่มเสี่ยง", "ออกนอกบ้านกลางคืน"];
export const HV_NEEDS = ["ทุนการศึกษา", "อาหารกลางวัน", "อุปกรณ์การเรียน/ชุดนักเรียน", "ติดตามการเรียน", "ดูแลพฤติกรรม", "ส่งต่อครูแนะแนว", "ส่งต่อหน่วยงานภายนอก"];
export const HV_OWNERSHIP = ["บ้านของตนเอง", "บ้านเช่า", "อาศัยอยู่กับผู้อื่น", "หอพัก", "อื่น ๆ"];
export const HV_CONDITION = ["มั่นคงแข็งแรง", "ชำรุดบางส่วน", "ชำรุดมาก/ไม่ปลอดภัย"];
export const HV_ENVIRONMENT = ["ปลอดภัย", "มีความเสี่ยง"];
export const HV_FAMILY = ["อบอุ่น", "ปกติ", "ห่างเหิน", "มีความขัดแย้ง"];
export const HV_MODES = ["ที่บ้าน", "ออนไลน์/โทรศัพท์"];
export const HV_RESULTS = ["ปกติ", "เสี่ยง", "มีปัญหา"];

// นิยามช่องร่วมสำหรับฟอร์ม การตรวจค่า และรายละเอียดอ่านอย่างเดียว ป้องกันสองหน้าเหลื่อมกัน
export const HV_SECTIONS = [
  { title:"การเยี่ยม", required:true, fields:[
    ["visited_on","วันที่เยี่ยม","date"], ["visit_mode","รูปแบบการเยี่ยม","radio",HV_MODES],
    ["visitors","ครูผู้เยี่ยม","text",200], ["informant_name","ผู้ให้ข้อมูล","text",120], ["informant_relation","เกี่ยวข้องเป็น","text",60]
  ]},
  { title:"ที่อยู่อาศัย", fields:[
    ["housing_ownership","กรรมสิทธิ์บ้าน","radio",HV_OWNERSHIP], ["housing_condition","สภาพบ้าน","radio",HV_CONDITION],
    ["utilities","ในบ้านมี (เลือกได้หลายข้อ)","checks",HV_UTILITIES], ["environment","สภาพแวดล้อม","radio",HV_ENVIRONMENT],
    ["environment_note","รายละเอียดความเสี่ยงของสภาพแวดล้อม","area",500],
    ["travel_distance_km","ระยะทางถึงโรงเรียน (กม.)","number",0,500,0.1], ["travel_minutes","ใช้เวลาเดินทาง (นาที)","number",0,600,1]
  ]},
  { title:"เศรษฐกิจครอบครัว", fields:[
    ["household_size","สมาชิกในครัวเรือน (คน)","number",1,40,1], ["household_income_month","รายได้ครัวเรือนต่อเดือน (บาท)","money",0,10000000,1],
    ["daily_allowance","ค่าใช้จ่ายไปเรียนต่อวัน (บาท)","number",0,10000,1], ["dependents","ผู้พึ่งพิงในบ้าน (เลือกได้หลายข้อ)","checks",HV_DEPENDENTS]
  ]},
  { title:"ครอบครัว · พฤติกรรม", fields:[
    ["family_relation","ความสัมพันธ์ในครอบครัว","radio",HV_FAMILY], ["home_duties","หน้าที่ในบ้าน","area",500], ["leisure","กิจกรรมยามว่าง","area",500],
    ["risk_behaviors","พฤติกรรมเสี่ยง (เลือกได้หลายข้อ)","checks",HV_RISKS], ["risk_note","รายละเอียดพฤติกรรมเสี่ยง","area",500]
  ]},
  { title:"ผู้ปกครองต้องการ", fields:[
    ["guardian_needs","ความต้องการ (เลือกได้หลายข้อ)","checks",HV_NEEDS], ["guardian_comment","ความเห็นผู้ปกครอง","area",1000]
  ]},
  { title:"สรุปผล + หลักฐาน", required:true, fields:[
    ["result","ผลการเยี่ยม","radio",HV_RESULTS], ["help_plan","แนวทางช่วยเหลือ","area",1000], ["teacher_note","ข้อสังเกตของครู","area",1000], ["photo_url","ลิงก์รูปถ่าย (Google Drive)","url",1000]
  ]}
];
export const HV_FIELDS = HV_SECTIONS.flatMap(section => section.fields);
const required = new Set(["visited_on","visit_mode","visitors","result"]);
export const hvRoomKey = p => `${p.grade_level}|${p.classroom}`;
export const hvIsActive = p => !p.student?.graduated && !p.student?.left_school;
export function homeVisitTargets({ placements, profilesById, sdqCareIds, target }) {
  const out = new Map();
  for (const p of placements) {
    if (!hvIsActive(p)) continue;
    if (!target || target.all_students) { out.set(p.student_id, []); continue; }
    const reasons = [];
    if (target.include_new && profilesById.get(p.student_id)?.admission_type?.trim()) reasons.push("นักเรียนใหม่");
    if (target.include_sdq_care && sdqCareIds.has(p.student_id)) reasons.push("SDQ ควรดูแล");
    if ((target.rooms || []).includes(hvRoomKey(p))) reasons.push("ห้องที่เลือก");
    if (reasons.length) out.set(p.student_id, reasons);
  }
  return out;
}
export function latestHomeVisits(rows) {
  const latest = new Map();
  for (const row of [...rows].sort(compareHomeVisits)) if (!latest.has(row.student_id)) latest.set(row.student_id, row);
  return latest;
}
export function compareHomeVisits(a,b) {
  return String(b.visited_on).localeCompare(String(a.visited_on)) || String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id).localeCompare(String(a.id));
}
export function medianHomeIncome(rows) {
  const nums = rows.map(r => r.household_income_month).filter(n => n !== null && n !== undefined && Number.isFinite(Number(n))).map(Number).sort((a,b) => a-b);
  const middle = Math.floor(nums.length / 2);
  return { count:nums.length, value:nums.length ? (nums.length % 2 ? nums[middle] : (nums[middle-1]+nums[middle])/2) : null };
}
const clean = value => value == null ? null : String(value).trim() || null;
export function validateHomeVisit(form) {
  const row = {}, errors = {};
  for (const [name,label,type,a,b,step] of HV_FIELDS) {
    let value = clean(form[name]);
    if (type === "checks") {
      row[name] = Array.isArray(form[name]) ? [...new Set(form[name].map(clean).filter(Boolean))] : [];
      continue;
    }
    if (required.has(name) && value === null) errors[name] = `กรุณา${type === "radio" ? "เลือก" : "กรอก"}${label}`;
    if ((type === "number" || type === "money") && value !== null) {
      if (type === "money") value = value.replace(/,/g, "");
      const number = Number(value);
      if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number) || number < a || number > b || (step === 1 && !Number.isInteger(number)) || (step === 0.1 && Math.abs(number * 10 - Math.round(number * 10)) > 1e-7)) {
        errors[name] = `กรอก${label} ${a.toLocaleString("th-TH")}–${b.toLocaleString("th-TH")}${step === 1 ? " เป็นจำนวนเต็ม" : " ทศนิยมไม่เกิน 1 ตำแหน่ง"}`;
      } else value = number;
    } else if (type === "radio" && value !== null && !a.includes(value)) errors[name] = `กรุณาเลือก${label}จากตัวเลือกที่แสดง`;
    else if (["text","area","url"].includes(type) && value !== null && [...value].length > a) errors[name] = `กรอก${label}ไม่เกิน ${a} ตัวอักษร`;
    if (type === "url" && value !== null) {
      try { const url = new URL(value); if (url.protocol !== "https:" || !url.hostname || /\s/.test(value)) throw new Error(); }
      catch { errors[name] = "กรอกลิงก์ที่ขึ้นต้น https:// และไม่มีช่องว่าง"; }
    }
    if (type === "date" && value !== null) {
      const date = new Date(value + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) errors[name] = "เลือกวันที่เยี่ยมที่ถูกต้องจากปฏิทิน";
    }
    row[name] = value;
  }
  for (const field of ["student_id","year","grade_level","classroom"]) row[field] = clean(form[field]);
  for (const [name,min,max] of [["gps_lat",-90,90],["gps_lng",-180,180],["gps_accuracy_m",0,999999.9]]) {
    const raw = clean(form[name]);
    row[name] = raw === null ? null : Number(raw);
    if (raw !== null && (!Number.isFinite(row[name]) || row[name] < min || row[name] > max)) errors[name] = "พิกัดไม่ถูกต้อง กรุณาลบพิกัดแล้วบันทึกตำแหน่งใหม่";
  }
  row.gps_at = clean(form.gps_at);
  if (row.visit_mode === "ออนไลน์/โทรศัพท์") {
    for (const name of ["gps_lat","gps_lng","gps_accuracy_m","gps_at"]) { row[name] = null; delete errors[name]; }
  } else {
    const has = [row.gps_lat,row.gps_lng,row.gps_at].map(v => v !== null);
    if ((has.some(Boolean) && !has.every(Boolean)) || (row.gps_accuracy_m !== null && !has.every(Boolean)) || (row.gps_at !== null && !Number.isFinite(Date.parse(row.gps_at)))) errors.gps_at = "พิกัดต้องมีละติจูด ลองจิจูด และเวลาครบชุด กรุณาลบพิกัดแล้วบันทึกใหม่";
  }
  return { row, errors };
}
export const HV_LIST_COLUMNS = "id,student_id,year,grade_level,classroom,visited_on,visit_mode,visitors,result,created_at,updated_at";
const COLUMNS = [...new Set([...HV_LIST_COLUMNS.split(","),...HV_FIELDS.map(f => f[0]),"gps_lat","gps_lng","gps_accuracy_m","gps_at"])].join(",");
const TARGET_COLUMNS = "year,all_students,include_new,include_sdq_care,rooms";
async function rows(query, label) {
  const {data,error} = await query;
  if (error) throw new Error(label + ": " + error.message);
  return data || [];
}
export function loadVisitsRoom(year,grade,classroom) { return rows(sb.from("home_visits").select(COLUMNS).eq("year",year).eq("grade_level",grade).eq("classroom",classroom),"โหลดบันทึกเยี่ยมบ้านไม่สำเร็จ"); }
export function loadVisitsYear(year) { return rows(fetchAllRows(() => sb.from("home_visits").select(COLUMNS).eq("year",year)),"โหลดรายงานเยี่ยมบ้านไม่สำเร็จ"); }
export function loadStudentHistory(studentId) { return rows(fetchAllRows(() => sb.from("home_visits").select(COLUMNS).eq("student_id",studentId)),"โหลดประวัติเยี่ยมบ้านไม่สำเร็จ").then(data => data.sort(compareHomeVisits)); }
async function mutate(query) {
  const {data,error} = await query.select(HV_LIST_COLUMNS).maybeSingle();
  if (error) throw new Error("บันทึกเยี่ยมบ้านไม่สำเร็จ: " + error.message);
  if (!data) throw new Error("บันทึกไม่สำเร็จ ไม่พบแถวที่แก้ไขได้ กรุณาตรวจสิทธิ์หรือเข้าสู่ระบบใหม่");
  return data;
}
export function insertVisit(row) { return mutate(sb.from("home_visits").insert(row)); }
export function updateVisit(id,row) { return mutate(sb.from("home_visits").update(row).eq("id",id)); }
export async function deleteVisit(id) {
  const {data,error} = await sb.from("home_visits").delete().eq("id",id).select("id").maybeSingle();
  if (error) throw new Error("ลบบันทึกไม่สำเร็จ: " + error.message);
  if (!data) throw new Error("ลบบันทึกไม่สำเร็จ: ไม่พบแถวที่ลบได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง");
}
export async function loadTarget(year) {
  const {data,error} = await sb.from("home_visit_targets").select(TARGET_COLUMNS).eq("year",year).maybeSingle();
  if (error) throw new Error("โหลดขอบเขตไม่สำเร็จ: " + error.message);
  return data;
}
export async function saveTarget(row) {
  const {data,error} = await sb.from("home_visit_targets").upsert(row,{onConflict:"year"}).select(TARGET_COLUMNS).single();
  if (error) throw new Error("บันทึกขอบเขตไม่สำเร็จ: " + error.message);
  return data;
}
