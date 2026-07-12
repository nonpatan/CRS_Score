// ============================================================
// ตั้งค่า Supabase ที่เดียว ใช้ร่วมกันทุกหน้า (index/attendance/summary/manage)
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://cbfblvsasamxuwgcpmtj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EEGLPPMa3fIX1aRR6GA3Xw_mF4mh5X0";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// เช็คว่าล็อกอินอยู่ไหม ถ้าไม่ได้ล็อกอิน เด้งไปหน้า login (จำหน้าปัจจุบันไว้ กลับมาได้หลังล็อกอิน)
// เรียกตอนต้นสคริปต์ของทุกหน้าที่ต้องล็อกอินก่อนใช้งาน
export async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const here = location.pathname.split("/").pop() + location.search;
    location.href = "login.html?next=" + encodeURIComponent(here);
    return null;
  }
  return session;
}

// ออกจากระบบ แล้วเด้งกลับไปหน้า login
export async function signOut() {
  await sb.auth.signOut();
  location.href = "login.html";
}

// โปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ (มี role: admin/teacher)
export async function getProfile(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (error) return null;
  return data;
}

// รายชื่อนักเรียนที่ลงทะเบียนในวิชานี้ (ผ่านตาราง enrollments) เรียงตามเลขที่
// ใช้แทนการดึง "นักเรียนทั้งหมด" แบบเดิม — วิชาไหนยังไม่มีใครลงทะเบียนจะได้ [] เปล่าๆ
export async function getRosterForSubject(subjectId) {
  const { data, error } = await sb
    .from("enrollments")
    .select("student:student_id(*)")
    .eq("subject_id", subjectId);
  if (error) return [];
  return (data || [])
    .map(e => e.student)
    .filter(Boolean)
    .sort((a, b) => (a.student_no || "").localeCompare(b.student_no || ""));
}

// ============================================================
// ตรรกะคิดเกรด/ร./มส. ใช้ร่วมกันทั้ง summary.html และ retention.html
// อยู่ที่เดียวกันเพื่อกัน "แก้ที่หนึ่งแล้วลืมอีกที่" ตามที่เคยพลาดมาก่อน (ดู CLAUDE.md)
// ============================================================

// เกณฑ์แปลงเปอร์เซ็นต์คะแนนเป็นเกรด (มาตรฐาน 8 ระดับ ตามที่ยืนยันแล้วใน CLAUDE.md)
export function percentToGrade(p) {
  if (p >= 80) return 4;
  if (p >= 75) return 3.5;
  if (p >= 70) return 3;
  if (p >= 65) return 2.5;
  if (p >= 60) return 2;
  if (p >= 55) return 1.5;
  if (p >= 50) return 1;
  return 0;
}

// โหลดข้อมูลเต็มของวิชา 1 ตัว (โครงสร้างคะแนน + ร. + เช็คชื่อ + ชั่วโมงชดเชย) — ใช้ได้ทั้งวิชาพื้นฐานเดี่ยว
// และวิชาพื้นฐานที่เป็นสมาชิกของวิชาบูรณาการ
export async function loadSubjectData(subjectId) {
  const { data: subj } = await sb.from("subjects").select("*").eq("id", subjectId).single();
  const { data: unitData } = await sb
    .from("units")
    .select("*, indicators(*, collections(*, scores(student_id, raw_score)))")
    .eq("subject_id", subjectId)
    .order("seq");
  const { data: remarks } = await sb.from("remarks").select("*").eq("subject_id", subjectId);
  const { data: sessionData } = await sb
    .from("attendance_sessions")
    .select("*, attendance_records(*)")
    .eq("subject_id", subjectId);
  const { data: makeupData } = await sb.from("makeup_hours").select("*").eq("subject_id", subjectId);
  return {
    subject: subj,
    units: unitData || [],
    remarksData: remarks || [],
    sessions: sessionData || [],
    makeupHours: makeupData || []
  };
}

// ---------- คำนวณคะแนนของนักเรียน 1 คน ในวิชา 1 ตัว จากข้อมูลที่โหลดไว้แล้ว ----------
// สูตรบัญญัติไตรยางศ์ไล่ล่างขึ้นบน ตามที่กำหนดใน CLAUDE.md (ไม่เก็บค่าที่เทียบแล้วลง database)
// รับพารามิเตอร์แยกจาก state กลาง เพื่อให้เรียกซ้ำได้ทั้งวิชาพื้นฐานเดี่ยว และวิชาพื้นฐาน
// แต่ละตัวที่เป็นสมาชิกของวิชาบูรณาการ
export function computeSubjectResult(studentId, subj, unitsTree, remarksArr, sessionsArr, makeupArr) {
  const subjectUnits = [];
  const competencyUnits = [];
  let subjectRaw = 0, subjectCap = 0;

  for (const unit of unitsTree) {
    let unitRaw = 0, unitCap = 0;
    for (const ind of (unit.indicators || [])) {
      let indRaw = 0, indCap = 0;
      for (const coll of (ind.collections || [])) {
        indCap += coll.max_score;
        const row = (coll.scores || []).find(s => s.student_id === studentId);
        if (row) indRaw += Number(row.raw_score);
      }
      const indScaled = indCap > 0 ? (indRaw / indCap) * ind.max_score : 0;
      unitRaw += indScaled;
      unitCap += ind.max_score;
    }
    const unitScaled = unitCap > 0 ? (unitRaw / unitCap) * unit.max_score : 0;
    if (unit.kind === "วิชา") {
      subjectUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score });
      subjectRaw += unitScaled;
      subjectCap += unit.max_score;
    } else {
      competencyUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score });
    }
  }

  const subjectScaled = subjectCap > 0 ? (subjectRaw / subjectCap) * subj.max_score : 0;

  // 1) เช็ค ร. ก่อน
  const remark = remarksArr.find(r => r.student_id === studentId && r.code === "ร.");
  if (remark) {
    return { subjectUnits, competencyUnits, subjectScaled, result: { type: "ร.", reason: remark.reason } };
  }

  // ชั่วโมงชดเชย (ทำงาน/เรียนเสริม ฯลฯ) ของนักเรียนคนนี้ในวิชานี้ — บวกเข้า attended ตรงๆ
  // ไม่ใช่การข้ามเช็ค มส. แต่เป็นการเติมตัวเลขให้ถึงเกณฑ์ (ยืนยันกับผู้ใช้แล้ว)
  const makeupTotal = (makeupArr || [])
    .filter(m => m.student_id === studentId)
    .reduce((sum, m) => sum + Number(m.periods), 0);

  // 2) เช็ค มส. — ใช้ทั้งประถมและมัธยม (ยืนยันกับผู้ใช้แล้ว) ต้องมีทั้ง total_periods
  //    กับข้อมูลเช็คชื่ออย่างน้อย 1 ครั้ง ไม่งั้นข้ามไปคิดเกรดตามปกติ (ยัง เช็ค มส. ไม่ได้)
  // มส. มี 2 ระดับ ตาม % เวลาเรียนดิบ (ก่อนหักชั่วโมงชดเชย) — ยืนยันกับผู้ใช้แล้ว:
  //   >= 60% และ < 80%  → "เรียนเพิ่มเติมให้ครบเวลา" ใช้ชั่วโมงชดเชยดันให้ถึง 80% ได้
  //   <  60%             → "เรียนซ้ำรายวิชา" ชั่วโมงชดเชยช่วยไม่ได้เลย (ห้ามเด็ดขาด)
  if (subj.total_periods && sessionsArr.length > 0) {
    let rawAttended = 0;
    for (const sess of sessionsArr) {
      const rec = (sess.attendance_records || []).find(r => r.student_id === studentId);
      if (!rec) continue; // ยังไม่มีบันทึกของคนนี้ในครั้งนี้ ข้ามไป ไม่นับ
      if (rec.status === "มา" || rec.status === "มาสาย") rawAttended += sess.periods_covered;
      else if (rec.status === "ลาป่วย" || rec.status === "ลากิจ") rawAttended += sess.periods_covered * 0.5;
      // 'ขาด' ไม่นับ (น้ำหนัก 0)
    }
    const rawPercentAttend = (rawAttended / subj.total_periods) * 100;

    if (rawPercentAttend < 60) {
      // ต่ำกว่า 60% ดิบๆ — ชดเชยช่วยไม่ได้แล้ว ต้องเรียนซ้ำรายวิชา (ไม่บวก makeupTotal เข้าไปเลย)
      return { subjectUnits, competencyUnits, subjectScaled, result: { type: "มส.", subtype: "retake", percentAttend: rawPercentAttend } };
    }
    if (rawPercentAttend < 80) {
      const percentAttend = ((rawAttended + makeupTotal) / subj.total_periods) * 100;
      if (percentAttend < 80) {
        return { subjectUnits, competencyUnits, subjectScaled, result: { type: "มส.", subtype: "makeup", percentAttend, makeupTotal } };
      }
      // ชดเชยจนครบ 80% แล้ว — หลุด มส. ไปคิดเกรดต่อ (เก็บ makeupTotal ไว้โชว์ในผลเกรด)
    }
  }

  // 3) แปลงเป็นเกรด
  const percentScore = subj.max_score > 0 ? (subjectScaled / subj.max_score) * 100 : 0;
  const grade = percentToGrade(percentScore);
  return { subjectUnits, competencyUnits, subjectScaled, result: { type: "grade", grade, percentScore, makeupTotal } };
}

// ---------- คำนวณผลรวมวิชาบูรณาการของนักเรียน 1 คน ----------
// ถัวเฉลี่ยถ่วงน้ำหนักด้วยจำนวนคาบเรียน (total_periods) ของวิชาพื้นฐานแต่ละตัว (ยืนยันแล้ว)
// ถ้าวิชาย่อยตัวไหนติด มส. → บูรณาการติด มส. ทันที (มส. ชนะ ร. เมื่อขัดแย้งกัน ยืนยันแล้ว)
// ถ้าไม่มี มส. แต่มีวิชาย่อยติด ร. → บูรณาการติด ร.
// รับ memberDataList = [{ subject, units, remarksData, sessions, makeupHours }, ...] จาก loadSubjectData
export function computeIntegratedResult(studentId, memberDataList) {
  const memberResults = [];
  let hasMs = false, hasR = false;
  let weightedSum = 0, weightSum = 0;

  for (const md of memberDataList) {
    const r = computeSubjectResult(studentId, md.subject, md.units, md.remarksData, md.sessions, md.makeupHours);
    const weight = md.subject.total_periods || 0;
    // เก็บสมรรถนะหลักของวิชาย่อยนี้ไว้ด้วย (ถ้ามี) — แสดงแยกตามวิชาที่กรอกไว้จริง ไม่ถัวเฉลี่ยรวม
    // เพราะสมรรถนะหลักมักกรอกแค่บางวิชา ถัวเฉลี่ยรวมกับวิชาที่ไม่มีข้อมูลจะทำให้คะแนนต่ำลงผิดๆ
    memberResults.push({ subject: md.subject, result: r.result, weight, competencyUnits: r.competencyUnits });
    if (r.result.type === "มส.") hasMs = true;
    else if (r.result.type === "ร.") hasR = true;
    else { weightedSum += r.result.percentScore * weight; weightSum += weight; }
  }

  let overall;
  if (hasMs) overall = { type: "มส." };
  else if (hasR) overall = { type: "ร." };
  else {
    const percentScore = weightSum > 0 ? weightedSum / weightSum : 0;
    overall = { type: "grade", grade: percentToGrade(percentScore), percentScore, weightSum };
  }

  return { memberResults, overall };
}
