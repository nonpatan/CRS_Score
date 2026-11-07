import { sb, fetchAllRows } from "../supabase-client.js?v=20261104-1";

// The item text is copied verbatim from the approved Thai forms in docs/brief-sdq.md.
export const SDQ_ITEMS_ADULT = [
  "ใส่ใจกับความรู้สึกของผู้อื่น",
  "อยู่ไม่สุข เคลื่อนไหวมาก ไม่สามารถอยู่นิ่งได้นาน",
  "บ่นปวดศีรษะ ปวดท้องหรือคลื่นไส้บ่อยๆ",
  "เต็มใจแบ่งปันกับเด็กอื่น ( ขนม ของเล่น ดินสอ ฯลฯ )",
  "แผลงฤทธิ์บ่อย หรืออารมณ์ร้อน",
  "ค่อนข้างอยู่โดดเดี่ยว มักเล่นตามลำพัง",
  "โดยปกติแล้ว เชื่อฟัง ทำตามที่ผู้ใหญ่บอก",
  "มีความกังวลหลายเรื่อง ดูเหมือนกังวลบ่อย",
  "ช่วยเหลือถ้ามีใครบาดเจ็บ ไม่สบายใจหรือเจ็บป่วย",
  "หยุกหยิก หรือดิ้นไปดิ้นมาตลอดเวลา",
  "มีเพื่อนสนิทอย่างน้อยหนึ่งคน",
  "มีเรื่องต่อสู้หรือรังแกเด็กอื่นบ่อยๆ",
  "ไม่มีความสุข เศร้าหรือร้องไห้บ่อยๆ",
  "โดยทั่วไปเป็นที่ชอบพอของเด็กอื่น",
  "วอกแวกง่าย ไม่มีสมาธิ",
  "วิตกกังวลหรือติดแจเมื่ออยู่ในสถานการณ์ใหม่ เสียความมั่นใจง่าย",
  "ใจดีกับเด็กที่อายุน้อยกว่า",
  "พูดปดหรือขี้โกงบ่อยๆ",
  "ถูกเด็กคนอื่นแกล้งหรือรังแก",
  "มักอาสาช่วยเหลือผู้อื่น ( พ่อแม่ ครู เด็กอื่น )",
  "คิดก่อนทำ",
  "ขโมยของที่บ้าน ที่โรงเรียน หรือที่อื่น",
  "เข้ากับผู้ใหญ่ได้ดีกว่าเข้ากับเด็กอื่น",
  "มีความกลัวหลายเรื่อง หวาดกลัวง่าย",
  "มีสมาธิในการติดตามทำงานจนเสร็จ"
];
export const SDQ_ITEMS_SELF = [
  "ฉันพยายามทำดีต่อผู้อื่น ฉันใส่ใจความรู้สึกของผู้อื่น",
  "ฉันอยู่ไม่สุข ฉันไม่สามารถอยู่นิ่งได้นาน",
  "ฉันปวดศีรษะ ปวดท้องหรือคลื่นไส้บ่อยๆ",
  "โดยปกติแล้ว ฉันแบ่งปันกับผู้อื่น ( อาหาร เกมส์ ปากกา ฯลฯ )",
  "ฉันโกรธรุนแรงและมักควบคุมอารมณ์ไม่ได้",
  "ฉันมักอยู่กับตัวเอง ฉันมักเล่นคนเดียวหรืออยู่ตามลำพัง",
  "โดยปกติแล้ว ฉันทำตามที่คนอื่นบอก",
  "ฉันกังวลมาก",
  "ฉันช่วยเหลือถ้ามีใครบาดเจ็บ ไม่สบายใจหรือเจ็บป่วย",
  "ฉันหยุกหยิก หรือดิ้นไปดิ้นมาตลอดเวลา",
  "ฉันมีเพื่อนสนิทอย่างน้อยหนึ่งคน",
  "ฉันมีเรื่องต่อสู้บ่อยๆ ฉันบังคับให้ผู้อื่นทำตามที่ฉันต้องการได้",
  "ฉันมักไม่มีความสุข เศร้าหรือร้องไห้บ่อย",
  "คนอื่นในวัยเดียวกับฉันมักชอบฉัน",
  "ฉันวอกแวกง่าย ฉันมีความลำบากที่จะใช้สมาธิ",
  "ฉันวิตกกังวลเมื่ออยู่ในสถานการณ์ใหม่ๆ ฉันเสียความมั่นใจง่าย",
  "ฉันใจดีกับเด็กที่อายุน้อยกว่า",
  "ฉันถูกกล่าวหาว่า พูดปดหรือขี้โกงบ่อยๆ",
  "เด็กคนอื่นๆแกล้งหรือรังแกฉัน",
  "ฉันมักอาสาช่วยเหลือผู้อื่น ( พ่อแม่ ครู เด็ก )",
  "ฉันคิดก่อนทำ",
  "ฉันเอาของที่ไม่ใช่ของฉันออกไปจากบ้าน โรงเรียนหรือที่อื่น",
  "ฉันเข้ากับผู้ใหญ่ได้ดีกว่าเข้ากับเด็กวัยเดียวกัน",
  "ฉันมีความกลัวหลายอย่าง ฉันหวาดกลัวง่าย",
  "ฉันทำงานที่ทำอยู่ได้เสร็จ ฉันมีสมาธิดี"
];
export const SDQ_CHOICES = ["ไม่จริง", "จริงบ้าง", "จริงแน่นอน"];
export const SDQ_COPYRIGHT = "Copyright Robert Goodman 2003";
export const SDQ_FORMS = { T:"ครู", P:"ผู้ปกครอง", S:"นักเรียน" };
// ข้อความกระดาษเพิ่มเติม คัดจาก PDF ต้นฉบับทั้งสองหน้าของทั้ง 3 ฉบับใน docs/sdq/
// รวมไว้ที่เดียวเพื่อไม่ให้หน้าพิมพ์มีถ้อยคำแบบประเมินอีกชุดหนึ่ง
export const SDQ_PRINT_TEXT = {
  edition:"พ.ศ.2546",
  title:"แบบประเมินจุดแข็งและจุดอ่อน",
  subtitle:"Strengths and Difficulties Questionnaire (SDQ)",
  instructionBefore:"ทำเครื่องหมาย X ในช่อง",
  instructionAfter:"ใต้ข้อความ ไม่จริง จริงบ้าง จริงแน่นอน เพียงช่องเดียวในแต่ละข้อคำถาม กรุณาตอบทุกข้อ",
  comment:"โปรดกรอกเพิ่มเติมถ้าคุณมีความเห็นอื่น........",
  turn:"(โปรดพลิกหน้าถัดไป)",
  followup:'ถ้าคุณตอบ “มีปัญหา.......” โปรดตอบข้อ 1) - 4) ต่อไปนี้ด้วย',
  signature:"ลายเซ็น",
  date:"วันที่",
  check:"โปรดตรวจสอบอีกครั้งว่าท่านตอบครบทุกข้อ",
  male:"ชาย", female:"หญิง", ageUnit:"ปี", hoursUnit:"ชั่วโมง",
  meta:{ number:"เลขที่", year:"ปี", form:"ฉบับ" },
  T:{
    form:"ครู", name:"ชื่อเด็ก", gender:"เพศของเด็ก", birth:"วัน เดือน ปีเกิดของเด็ก", age:"อายุของเด็ก",
    instruction:"ให้ใกล้เคียงความเป็นจริงกับพฤติกรรมของเด็กที่เกิดขึ้นในช่วง 6 เดือนที่ผ่านมา หรือในช่วงปีการศึกษานี้",
    relation:"โปรดระบุความสัมพันธ์กับเด็ก ( ครูประจำชั้น/อื่นๆ )",
    thanks:"ขอบคุณที่ให้ความร่วมมือในการกรอกแบบประเมินนี้"
  },
  P:{
    form:"ผู้ปกครอง", name:"ชื่อ เด็ก", gender:"เพศของเด็ก", birth:"วัน เดือน ปีเกิดของเด็ก", age:"อายุของเด็ก",
    instruction:"ให้ใกล้เคียงความเป็นจริงกับพฤติกรรมของเด็กที่เกิดขึ้นในช่วง 6 เดือนที่ผ่านมา",
    relation:"โปรดระบุความสัมพันธ์กับเด็ก ( พ่อ/แม่/อื่นๆ )",
    thanks:"ขอบคุณที่ให้ความร่วมมือในการกรอกแบบประเมินนี้"
  },
  S:{
    form:"ตนเอง", name:"ชื่อ", gender:"เพศ", birth:"วัน เดือน ปีเกิด", age:"อายุ",
    instruction:"ให้ใกล้เคียงความเป็นจริงที่เกิดขึ้นในช่วง 6 เดือนที่ผ่านมา",
    thanks:"ขอบคุณที่ให้ความร่วมมือกรอกแบบประเมินนี้"
  }
};
export const SDQ_IMPACT_TEXT = {
  choices: {
    overall:["ไม่มีปัญหา","มีปัญหาเล็กน้อย","มีปัญหาชัดเจน","มีปัญหาอย่างรุนแรง"],
    chronic:["น้อยกว่า 1 เดือน","1 - 5 เดือน","6 - 12 เดือน","มากกว่า 1 ปี"],
    degree:["ไม่เลย","เล็กน้อย","ค่อนข้างมาก","มากที่สุด"]
  },
  chronic:"1) ปัญหาที่มี เกิดขึ้นมานานเท่าไรแล้ว",
  T:{
    overall:"โดยรวมคุณคิดว่าเด็กมีปัญหาในด้านอารมณ์ ด้านสมาธิ ด้านพฤติกรรม หรือความสามารถเข้ากับผู้อื่นด้านใดด้านหนึ่งหรือไม่",
    distress:"2) เด็กรู้สึกหงุดหงิดหรือไม่สบายใจกับปัญหาที่มีหรือไม่",
    daily:"3) ปัญหาที่มี รบกวนชีวิตประจำวันของเด็กในด้านต่างๆ ต่อไปนี้หรือไม่",
    areas:[["impact_peer","การคบเพื่อน"],["impact_class","การเรียนในห้องเรียน"]],
    burden:"4) ปัญหาที่มี ทำให้คุณหรือชั้นเรียนเกิดความยุ่งยากหรือไม่",
    teacherHours:"ในแต่ละสัปดาห์เด็กคนนี้อยู่กับคุณโดยเฉลี่ยกี่ชั่วโมง ( โปรดระบุ )"
  },
  P:{
    overall:"โดยรวมคุณคิดว่าเด็กมีปัญหาในด้านอารมณ์ ด้านสมาธิ ด้านพฤติกรรม หรือความสามารถเข้ากับผู้อื่นด้านใดด้านหนึ่งหรือไม่",
    distress:"2) เด็กรู้สึกหงุดหงิดหรือไม่สบายใจกับปัญหาที่มีหรือไม่",
    daily:"3) ปัญหาที่มี รบกวนชีวิตประจำวันของเด็กในด้านต่างๆ ต่อไปนี้หรือไม่",
    areas:[["impact_home","ความเป็นอยู่ที่บ้าน"],["impact_peer","การคบเพื่อน"],["impact_class","การเรียนในห้องเรียน"],["impact_leisure","กิจกรรมยามว่าง"]],
    burden:"4) ปัญหาที่มี ทำให้คุณหรือครอบครัวเกิดความยุ่งยากหรือไม่"
  },
  S:{
    overall:"โดยรวมคิดว่าตัวเองมีปัญหาในด้านอารมณ์ ด้านสมาธิ ด้านพฤติกรรม หรือความสามารถเข้ากับผู้อื่นด้านใดด้านหนึ่งหรือไม่",
    distress:"2) คุณรู้สึกหงุดหงิดหรือไม่สบายใจกับปัญหาที่มีหรือไม่",
    daily:"3) ปัญหาที่มี รบกวนชีวิตประจำวันของคุณในด้านต่างๆ ต่อไปนี้หรือไม่",
    areas:[["impact_home","ความเป็นอยู่ที่บ้าน"],["impact_peer","การคบเพื่อน"],["impact_class","การเรียนในห้องเรียน"],["impact_leisure","กิจกรรมยามว่าง"]],
    burden:"4) ปัญหาที่มี ทำให้คนรอบข้างเกิดความยุ่งยากหรือไม่ ( ครอบครัว เพื่อน ครู ฯลฯ )"
  }
};
export const SDQ_SCALES = {
  emotional:{ label:"อารมณ์", items:[3,8,13,16,24] },
  conduct:{ label:"ความประพฤติ/เกเร", items:[5,7,12,18,22] },
  hyper:{ label:"สมาธิสั้น/อยู่ไม่นิ่ง", items:[2,10,15,21,25] },
  peer:{ label:"ความสัมพันธ์กับเพื่อน", items:[6,11,14,19,23] },
  prosocial:{ label:"สัมพันธภาพทางสังคม (จุดแข็ง)", items:[1,4,9,17,20] }
};
export const SDQ_BANDS = {
  T:{ total:[13,16], emotional:[3,4], conduct:[3,4], hyper:[5,6], peer:[4,5] },
  P:{ total:[15,18], emotional:[4,5], conduct:[3,4], hyper:[5,6], peer:[4,5] },
  S:{ total:[15,18], emotional:[4,5], conduct:[4,5], hyper:[5,6], peer:[4,5] }
};
const REVERSED = new Set([7,11,14,21,25]);
const validAnswer = value => Number.isInteger(value) && value >= 0 && value <= 2;
export function sdqBand(form, scale, score) {
  if (score == null) return null;
  if (scale === "prosocial") return score >= 5 ? "มีจุดแข็ง" : "ไม่มีจุดแข็ง";
  if (scale === "impact") return score === 0 ? "ปกติ" : score === 1 ? "เสี่ยง" : "มีปัญหา";
  const limits = SDQ_BANDS[form]?.[scale];
  if (!limits) return null;
  return score <= limits[0] ? "ปกติ" : score <= limits[1] ? "เสี่ยง" : "มีปัญหา";
}
export function computeSdq(form, row = {}) {
  const answers = Array.isArray(row.answers) ? row.answers : [];
  const scales = {};
  for (const [key, spec] of Object.entries(SDQ_SCALES)) {
    const selected = spec.items.map(number => ({ number, value:answers[number - 1] })).filter(item => validAnswer(item.value));
    const sum = selected.reduce((n, item) => n + (REVERSED.has(item.number) ? 2 - item.value : item.value), 0);
    scales[key] = selected.length < 3 ? null : selected.length === 5 ? sum : Math.round(sum * 5 / selected.length);
  }
  const core = ["emotional","conduct","hyper","peer"];
  const total = core.every(key => scales[key] != null) ? core.reduce((n,key) => n + scales[key], 0) : null;
  let impact = null;
  if (row.impact_overall === 0) impact = 0;
  else if (row.impact_overall != null) {
    const keys = ["impact_distress","impact_peer","impact_class"];
    if (form !== "T") keys.push("impact_home","impact_leisure");
    impact = keys.reduce((n,key) => n + Math.max(0, (Number(row[key]) || 0) - 1), 0);
  }
  const bands = { total:sdqBand(form,"total",total), impact:sdqBand(form,"impact",impact) };
  for (const key of Object.keys(scales)) bands[key] = sdqBand(form,key,scales[key]);
  return { scales, total, impact, answered:answers.filter(validAnswer).length, bands };
}
export function sdqFormsForGrade(grade) {
  if (["อ.2","อ.3","ป.1","ป.2","ป.3","ป.4","ป.5"].includes(grade)) return ["T","P"];
  if (["ป.6","ม.1","ม.2","ม.3","ม.4","ม.5","ม.6"].includes(grade)) return ["T","P","S"];
  return [];
}
const SDQ_GRADE_ORDER = ["เตรียมอนุบาล","อ.1","อ.2","อ.3","ป.1","ป.2","ป.3","ป.4","ป.5","ป.6","ม.1","ม.2","ม.3","ม.4","ม.5","ม.6"];
export function sdqGradeRank(grade) {
  const rank = SDQ_GRADE_ORDER.indexOf(grade);
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}
export function sdqNextStudent(rosterIds, filledIds, currentId) {
  return rosterIds.slice(rosterIds.indexOf(currentId) + 1).find(id => !filledIds.has(id)) ?? null;
}
export function sdqCareList(placements, responsesByKey) {
  const people = new Map();
  for (const p of placements) {
    if (people.has(p.student_id)) continue;
    const totals = { T:null, P:null, S:null }, problemScales = new Set();
    let flagged = false;
    for (const form of sdqFormsForGrade(p.grade_level)) {
      const row = responsesByKey.get(`${p.student_id}:${form}`);
      if (!row) continue;
      const score = computeSdq(form, row);
      totals[form] = score.total;
      if (score.bands.total === "มีปัญหา") flagged = true;
      for (const scale of ["emotional", "conduct", "hyper", "peer"])
        if (score.bands[scale] === "มีปัญหา") problemScales.add(scale);
    }
    people.set(p.student_id, flagged ? { student_id:p.student_id, totals, problemScales:[...problemScales], maxTotal:Math.max(...Object.values(totals).filter(n => n != null)) } : null);
  }
  return [...people.values()].filter(Boolean).sort((a,b) => b.maxTotal - a.maxTotal);
}
const COLUMNS = "id,student_id,year,grade_level,classroom,form,answers,impact_overall,impact_chronic,impact_distress,impact_home,impact_peer,impact_class,impact_leisure,impact_burden,teacher_hours,relation,remark,assessed_on,updated_at";
export async function loadSdqRoom(year, grade, classroom) {
  const { data, error } = await sb.from("sdq_responses").select(COLUMNS).eq("year",year).eq("grade_level",grade).eq("classroom",classroom);
  if (error) throw new Error("โหลด SDQ ของห้องไม่สำเร็จ: " + error.message);
  return data || [];
}
export async function loadSdqYear(year) {
  const { data, error } = await fetchAllRows(() => sb.from("sdq_responses").select(COLUMNS).eq("year",year));
  if (error) throw new Error("โหลดรายงาน SDQ ไม่สำเร็จ: " + error.message);
  return data || [];
}
export async function saveSdq(row) {
  const { data, error } = await sb.from("sdq_responses").upsert(row,{ onConflict:"student_id,year,form" }).select(COLUMNS).single();
  if (error) throw new Error("บันทึก SDQ ไม่สำเร็จ: " + error.message);
  return data;
}
export async function deleteSdq(id) {
  const { data, error } = await sb.from("sdq_responses").delete().eq("id",id).select("id").maybeSingle();
  if (error) throw new Error("ลบ SDQ ไม่สำเร็จ: " + error.message);
  if (!data) throw new Error("ลบ SDQ ไม่สำเร็จ: ไม่พบแถวที่ลบได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง");
}
