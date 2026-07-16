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

// ============================================================
// ปีการศึกษาที่ทำงานอยู่ (active year) — เก็บใน localStorage เพื่อให้ทุกหน้า "จำ" ปีเดียวกัน
// (ผู้ใช้เลือกปีครั้งเดียว แล้วทุกหน้ากรอง dropdown วิชาด้วยปีนั้นเหมือนกันหมด) — ยืนยันแล้ว
// สำคัญมาก: กันครูกรอกคะแนน/เช็คชื่อผิดปีเมื่อขึ้นปีการศึกษาใหม่แล้วมีวิชาชื่อซ้ำหลายปี
// ============================================================
const ACTIVE_YEAR_KEY = "crs_active_year";

// อ่านปีที่เลือกไว้ (คืน "" ถ้ายังไม่เคยเลือก = โหมด "ทุกปี")
export function getActiveYear() {
  return localStorage.getItem(ACTIVE_YEAR_KEY) || "";
}

// บันทึกปีที่เลือก (ส่ง "" มา = ล้างค่า กลับไปโหมด "ทุกปี")
export function setActiveYear(y) {
  if (y) localStorage.setItem(ACTIVE_YEAR_KEY, y);
  else localStorage.removeItem(ACTIVE_YEAR_KEY);
}

// รวบรวมปีการศึกษาที่มีจริงจากรายการวิชา (ไม่ซ้ำ เรียงจากใหม่ไปเก่า) — ใช้เติม dropdown ปี
export function distinctYears(subjects) {
  const years = [];
  for (const s of (subjects || [])) {
    if (s.year && years.indexOf(s.year) === -1) years.push(s.year);
  }
  years.sort();
  years.reverse();
  return years;
}

// ============================================================
// ค่าตั้งค่าส่วนกลาง (app_settings) + ตรรกะลำดับชั้น/เลื่อนชั้น — ใช้ที่หน้า rollover (ขึ้นปีใหม่)
// ============================================================

// ลำดับชั้นเรียนมาตรฐาน ป.1 → ม.6 (ใช้หา "ชั้นถัดไป" ตอนเลื่อนชั้น)
export const GRADE_ORDER = ["ป.1","ป.2","ป.3","ป.4","ป.5","ป.6","ม.1","ม.2","ม.3","ม.4","ม.5","ม.6"];

// ช่วงชั้นของนักเรียน ใช้เลือกองค์ประกอบสมรรถนะหลักมาตรฐาน
// โรงเรียนปัจจุบันเปิดถึง ม.3 แต่รองรับชั้นสูงกว่านี้ไว้เผื่อใช้ข้อมูลในอนาคต
export function competencyStageForGrade(grade) {
  const i = GRADE_ORDER.indexOf(grade);
  if (i >= 0 && i <= 2) return "ช่วงชั้น 1";
  if (i >= 3 && i <= 5) return "ช่วงชั้น 2";
  if (i >= 6) return "ช่วงชั้น 3";
  return "";
}

// ============================================================
// ตรรกะสรุปสมรรถนะ 3 แหล่ง ใช้ร่วมกันจากหน้ารายงาน
// แยกไว้ที่ไฟล์กลางเพื่อไม่ให้สูตรถ่วงน้ำหนัก/การเช็คข้อมูลครบกระจายหลายหน้า
// ============================================================

// สรุปคะแนนสมรรถนะจากรายวิชา 1 ด้าน:
// unitsTree ต้องเป็นหน่วย kind='สมรรถนะหลัก' พร้อม indicators > collections
// และ scoreRows เป็นคะแนนของนักเรียนคนเดียวเท่านั้น
export function computeSubjectCompetencySource(competencyId, unitsTree, scoreRows) {
  const units = (unitsTree || []).filter(u => u.core_competency_id === competencyId);
  const scoreByCollection = new Map((scoreRows || []).map(s => [s.collection_id, Number(s.raw_score)]));
  let expectedCount = 0, scoredCount = 0, scaledSum = 0, maxSum = 0;
  let structureComplete = units.length > 0;

  for (const unit of units) {
    const indicators = unit.indicators || [];
    if (!indicators.length) structureComplete = false;
    let unitRaw = 0, unitCap = 0;
    for (const indicator of indicators) {
      const collections = indicator.collections || [];
      if (!collections.length) structureComplete = false;
      let indicatorRaw = 0, indicatorCap = 0;
      for (const collection of collections) {
        expectedCount++;
        indicatorCap += Number(collection.max_score) || 0;
        if (scoreByCollection.has(collection.id)) {
          scoredCount++;
          indicatorRaw += scoreByCollection.get(collection.id);
        }
      }
      const indicatorScaled = indicatorCap > 0
        ? (indicatorRaw / indicatorCap) * Number(indicator.max_score)
        : 0;
      unitRaw += indicatorScaled;
      unitCap += Number(indicator.max_score) || 0;
    }
    const unitMax = Number(unit.max_score) || 0;
    const unitScaled = unitCap > 0 ? (unitRaw / unitCap) * unitMax : 0;
    scaledSum += unitScaled;
    maxSum += unitMax;
  }

  const complete = structureComplete && expectedCount > 0 && scoredCount === expectedCount && maxSum > 0;
  return {
    complete,
    percent: complete ? (scaledSum / maxSum) * 100 : null,
    expectedCount,
    scoredCount
  };
}

// สรุปคะแนนจากกิจกรรมหรือกิจวัตร 1 ด้าน รายการหนึ่งแทนหนึ่งครั้งประเมินที่นักเรียนอยู่ใน snapshot
// raw_score=null แปลว่ายังไม่ได้กรอก (ต่างจาก 0 ซึ่งเป็นคะแนนจริงและถือว่ากรอกแล้ว)
export function computeAssessmentCompetencySource(competencyId, expectedItems) {
  const items = (expectedItems || []).filter(i => i.competency_id === competencyId);
  const scored = items.filter(i => i.raw_score !== null && i.raw_score !== undefined);
  const maxSum = items.reduce((sum, i) => sum + (Number(i.max_score) || 0), 0);
  const rawSum = scored.reduce((sum, i) => sum + Number(i.raw_score), 0);
  const complete = items.length > 0 && scored.length === items.length && maxSum > 0;
  return {
    complete,
    percent: complete ? (rawSum / maxSum) * 100 : null,
    expectedCount: items.length,
    scoredCount: scored.length
  };
}

// รวมแหล่งคะแนนตามน้ำหนักของสมรรถนะด้านนั้น โดยตรวจความครบเฉพาะแหล่งที่น้ำหนักมากกว่า 0
// (แหล่งน้ำหนัก 0% ไม่จำเป็นต้องมีคะแนน) จากนั้นเทียบช่วงคะแนนกับเกณฑ์กลางที่ตั้งไว้
export function computeCombinedCompetencyResult(weight, sources, levels) {
  if (!weight) return { complete: false, reason: "ยังไม่ได้กำหนดน้ำหนัก" };
  const weightedSources = [
    { source: sources.subject, weight: Number(weight.subject_weight) },
    { source: sources.activity, weight: Number(weight.activity_weight) },
    { source: sources.routine, weight: Number(weight.routine_weight) }
  ];
  const totalWeight = weightedSources.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 100) > 0.000001) {
    return { complete: false, reason: "น้ำหนักรวมไม่เท่ากับ 100%" };
  }
  const required = weightedSources.filter(item => item.weight > 0);
  if (required.some(item => !item.source || !item.source.complete)) {
    return { complete: false, reason: "ข้อมูลยังไม่ครบ — ไม่สามารถสรุปคะแนนได้" };
  }
  const score = required.reduce((sum, item) => sum + item.source.percent * item.weight / 100, 0);
  const level = (levels || []).find(l => score >= Number(l.min_score) && score <= Number(l.max_score));
  return {
    complete: true,
    score,
    level: level ? level.label : null,
    reason: level ? "" : "คะแนนไม่อยู่ในช่วงเกณฑ์แปลผลที่กำหนด"
  };
}

// อ่านค่าตั้งค่าส่วนกลาง 1 ตัว (เช่น highest_grade) — คืน null ถ้าไม่มี
export async function getSetting(key) {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return data.value;
}

// บันทึกค่าตั้งค่าส่วนกลาง (upsert ตาม key) — admin เท่านั้น (บังคับด้วย RLS)
export async function setSetting(key, value) {
  const { error } = await sb.from("app_settings").upsert({ key, value }, { onConflict: "key" });
  return !error;
}

// หาชั้นถัดไปตอนเลื่อนชั้น — คืน null ถ้าถึงชั้นสูงสุดที่เปิดสอนแล้ว (= จบการศึกษา)
// highestGrade มาจากค่าตั้งค่า highest_grade (เช่น 'ม.3' สำหรับโรงเรียนขยายโอกาส)
export function nextGrade(grade, highestGrade) {
  if (grade === highestGrade) return null; // ชั้นสูงสุด = จบ ไม่มีชั้นถัดไป
  const idx = GRADE_ORDER.indexOf(grade);
  if (idx === -1 || idx + 1 >= GRADE_ORDER.length) return null;
  return GRADE_ORDER[idx + 1];
}

// เลื่อน "ห้อง" ตามชั้นที่เลื่อนขึ้น เช่น 'ม.2/1' + เลื่อนเป็น 'ม.3' → 'ม.3/1'
// (ถ้าห้องขึ้นต้นด้วยชื่อชั้นเดิม ก็แทนที่ส่วนหน้าด้วยชั้นใหม่ ไม่งั้นคืนห้องเดิมไปเลย)
export function promoteClassroom(classroom, oldGrade, newGrade) {
  if (!classroom) return classroom;
  if (classroom.indexOf(oldGrade) === 0) return newGrade + classroom.slice(oldGrade.length);
  return classroom;
}

// รายชื่อนักเรียนที่ยัง active (ยังเรียนอยู่จริง) ทั้งหมด เรียงตามชั้น+ห้อง+เลขที่
// active = ยังไม่จบ (graduated=false) และ ยังไม่ย้ายออก/เลิกเรียน (left_school=false)
// ใช้ที่หน้าจัดการนักเรียน + ตัวจับคู่ลงทะเบียน (คนจบ/คนย้ายออกไม่โผล่ในรายชื่อใช้งาน)
export async function getActiveStudents() {
  const { data, error } = await sb
    .from("students")
    .select("*")
    .eq("graduated", false)
    .eq("left_school", false)
    .order("grade_level")
    .order("classroom")
    .order("student_no");
  if (error) return [];
  return data || [];
}

// รายชื่อนักเรียนที่ลงทะเบียนในวิชานี้ (ผ่านตาราง enrollments) เรียงตามเลขที่
// ใช้แทนการดึง "นักเรียนทั้งหมด" แบบเดิม — วิชาไหนยังไม่มีใครลงทะเบียนจะได้ [] เปล่าๆ
// หมายเหตุ: ไม่กรอง graduated ออก เพราะเป็น "รายชื่อในวิชานั้นๆ" (ผูกปีอยู่แล้ว) เด็กจบไปแล้ว
// แต่ต้องยังเห็นในวิชาปีเก่าที่เคยเรียน เพื่อดูคะแนนย้อนหลังได้
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

// นับจำนวนคาบที่ขาดสะสมจริงของนักเรียน 1 คน (ถ่วงน้ำหนักแบบเดียวกับเช็ค มส.: ขาด = เต็ม 1,
// ลาป่วย/ลากิจ = ครึ่งเดียว, มา/มาสาย = ไม่นับ) จาก session ที่เช็คชื่อไปแล้วเท่านั้น — ไม่ใช่
// % ของคาบทั้งเทอม เพราะถ้าเทียบเป็น % ตั้งแต่ต้นเทอม (ที่เช็คชื่อไปแค่ไม่กี่ครั้ง) ตัวเลขจะ
// เพี้ยนสูงเกินจริง ทำให้ต้นเทอมติด มส. ง่ายเกินไปทั้งที่ยังเหลือเวลาทั้งเทอมให้แก้ตัวอีกเยอะ
// (บั๊กที่ผู้ใช้เจอจริงตอนเปิดเทอมใหม่ — ยืนยันแก้แล้ว 2026-07)
export function computeMissedPeriods(studentId, sessionsArr) {
  let missed = 0;
  for (const sess of sessionsArr) {
    const rec = (sess.attendance_records || []).find(r => r.student_id === studentId);
    if (!rec) continue; // ยังไม่มีบันทึกของคนนี้ในครั้งนี้ ข้ามไป ไม่นับ
    if (rec.status === "ขาด") missed += sess.periods_covered;
    else if (rec.status === "ลาป่วย" || rec.status === "ลากิจ") missed += sess.periods_covered * 0.5;
    // 'มา'/'มาสาย' ไม่นับ (ไม่ขาด)
  }
  return missed;
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
// skipMs = true เมื่อวิชานี้เป็นสมาชิกของวิชาบูรณาการ — มส. ของวิชาย่อยไม่ตัดสินรายตัว
// แต่ไปคิด "แบบรวม" ที่ระดับวิชาบูรณาการแทน (ยืนยันกับผู้ใช้แล้ว 2026-07 ดู computeIntegratedResult)
export function computeSubjectResult(studentId, subj, unitsTree, remarksArr, sessionsArr, makeupArr, skipMs) {
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
  // มส. มี 2 ระดับ ตาม "จำนวนคาบขาดสะสมจริง" เทียบกับเพดานคาบที่ขาดได้สูงสุด (ไม่ใช่ % ของคาบ
  // ทั้งเทอมแบบเดิม — เปลี่ยนเพราะเทียบ % ตั้งแต่ต้นเทอมทำให้ติด มส. ง่ายเกินจริง ยืนยันแล้ว
  // 2026-07): เพดานคำนวณจาก total_periods ทั้งเทอมเสมอ (ไม่ใช่คาบที่เช็คไปแล้ว) เพราะงั้นต้น
  // เทอมที่ยังเช็คไม่กี่ครั้ง คาบขาดสะสมจะยังน้อยกว่าเพดานเยอะ ไม่ติด มส. ง่ายๆ
  //   ขาดสะสม > 20% ของคาบทั้งเทอม และ <= 40%  → "เรียนเพิ่มเติมให้ครบเวลา" ใช้ชั่วโมงชดเชย
  //     ลบยอดขาดสุทธิให้ไม่เกิน 20% ได้
  //   ขาดสะสม > 40% ของคาบทั้งเทอม             → "เรียนซ้ำรายวิชา" ชั่วโมงชดเชยช่วยไม่ได้เลย
  if (!skipMs && subj.total_periods && sessionsArr.length > 0) {
    const rawMissed = computeMissedPeriods(studentId, sessionsArr);
    const maxMissedRetake = subj.total_periods * 0.40;
    const maxMissedMakeup = subj.total_periods * 0.20;

    if (rawMissed > maxMissedRetake) {
      // ขาดเกินเพดานเรียนซ้ำแล้ว — ชดเชยช่วยไม่ได้แล้ว ต้องเรียนซ้ำรายวิชา (ไม่หัก makeupTotal เข้าไปเลย)
      return { subjectUnits, competencyUnits, subjectScaled, result: { type: "มส.", subtype: "retake", missedPeriods: rawMissed, maxMissed: maxMissedRetake } };
    }
    if (rawMissed > maxMissedMakeup) {
      const netMissed = Math.max(0, rawMissed - makeupTotal);
      if (netMissed > maxMissedMakeup) {
        return { subjectUnits, competencyUnits, subjectScaled, result: { type: "มส.", subtype: "makeup", missedPeriods: rawMissed, netMissed, maxMissed: maxMissedMakeup, makeupTotal } };
      }
      // ชดเชยจนขาดสุทธิไม่เกินเพดานแล้ว — หลุด มส. ไปคิดเกรดต่อ (เก็บ makeupTotal ไว้โชว์ในผลเกรด)
    }
  }

  // 3) แปลงเป็นเกรด
  const percentScore = subj.max_score > 0 ? (subjectScaled / subj.max_score) * 100 : 0;
  const grade = percentToGrade(percentScore);
  return { subjectUnits, competencyUnits, subjectScaled, result: { type: "grade", grade, percentScore, makeupTotal } };
}

// ---------- คำนวณผลรวมวิชาบูรณาการของนักเรียน 1 คน ----------
// คะแนน: ถัวเฉลี่ยถ่วงน้ำหนักด้วยจำนวนคาบเรียน (total_periods) ของวิชาพื้นฐานแต่ละตัว (ยืนยันแล้ว)
// มส.: คิด "แบบรวม" ที่ระดับวิชาบูรณาการ (ยืนยันกับผู้ใช้แล้ว 2026-07) — ไม่ใช่แยกรายวิชาย่อย:
//   ฐานเวลาเรียนรวม = SUM(total_periods ของวิชาย่อยทุกตัว)  เช่น สังคม 20 + การงาน 20 = 40 คาบ
//   คาบขาดสะสมรวม  = SUM(คาบขาดของนักเรียนคนนี้ในทุกวิชาย่อย)  (เช็คชื่อยังทำรายวิชาย่อย
//                     เหมือนเดิม — ครูจะได้เห็นว่าเด็กขาดหนักที่วิชาไหน แล้วไปตามแก้ที่วิชานั้น)
//   ชั่วโมงชดเชยรวม = SUM(makeup_hours ของทุกวิชาย่อย)
//   เพดาน 20%/40% คิดจากฐานรวม — ตรรกะ 2 ระดับ (เรียนเพิ่ม/เรียนซ้ำ) เหมือนวิชาพื้นฐานทุกอย่าง
// มส. (รวม) ชนะ ร. เมื่อขัดแย้งกัน (ยืนยันแล้ว) — ไม่มี มส. แต่มีวิชาย่อยติด ร. → บูรณาการติด ร.
// รับ memberDataList = [{ subject, units, remarksData, sessions, makeupHours }, ...] จาก loadSubjectData
export function computeIntegratedResult(studentId, memberDataList) {
  const memberResults = [];
  let hasR = false;
  let weightedSum = 0, weightSum = 0;
  let totalBase = 0, rawMissed = 0, makeupTotal = 0, anySessions = false;

  for (const md of memberDataList) {
    // skipMs = true: วิชาย่อยไม่ตัดสิน มส. รายตัว (คิดรวมข้างล่างแทน) — ผลรายวิชาจึงมีแค่ ร./เกรด
    const r = computeSubjectResult(studentId, md.subject, md.units, md.remarksData, md.sessions, md.makeupHours, true);
    const weight = md.subject.total_periods || 0;
    const missed = computeMissedPeriods(studentId, md.sessions || []);
    // เก็บสมรรถนะหลักของวิชาย่อยนี้ไว้ด้วย (ถ้ามี) — แสดงแยกตามวิชาที่กรอกไว้จริง ไม่ถัวเฉลี่ยรวม
    // เพราะสมรรถนะหลักมักกรอกแค่บางวิชา ถัวเฉลี่ยรวมกับวิชาที่ไม่มีข้อมูลจะทำให้คะแนนต่ำลงผิดๆ
    // missedPeriods เก็บไว้โชว์รายวิชา ให้ครูเห็นว่าเด็กขาดหนักที่วิชาย่อยไหน
    memberResults.push({ subject: md.subject, result: r.result, weight, competencyUnits: r.competencyUnits, missedPeriods: missed });
    if (r.result.type === "ร.") hasR = true;
    else { weightedSum += r.result.percentScore * weight; weightSum += weight; }

    totalBase += weight;
    rawMissed += missed;
    if ((md.sessions || []).length > 0) anySessions = true;
    makeupTotal += (md.makeupHours || [])
      .filter(m => m.student_id === studentId)
      .reduce((sum, m) => sum + Number(m.periods), 0);
  }

  // 1) เช็ค มส. รวมก่อน (มส. ชนะ ร.) — ต้องมีฐานเวลากับข้อมูลเช็คชื่ออย่างน้อย 1 ครั้งถึงเช็คได้
  let overall = null;
  if (totalBase > 0 && anySessions) {
    const maxMissedRetake = totalBase * 0.40;
    const maxMissedMakeup = totalBase * 0.20;
    if (rawMissed > maxMissedRetake) {
      overall = { type: "มส.", subtype: "retake", missedPeriods: rawMissed, maxMissed: maxMissedRetake, totalBase };
    } else if (rawMissed > maxMissedMakeup) {
      const netMissed = Math.max(0, rawMissed - makeupTotal);
      if (netMissed > maxMissedMakeup) {
        overall = { type: "มส.", subtype: "makeup", missedPeriods: rawMissed, netMissed, maxMissed: maxMissedMakeup, makeupTotal, totalBase };
      }
    }
  }

  // 2) ไม่มี มส. → เช็ค ร. ของวิชาย่อย
  if (!overall && hasR) overall = { type: "ร." };

  // 3) แปลงเป็นเกรด (ถัวเฉลี่ยถ่วงน้ำหนัก)
  if (!overall) {
    const percentScore = weightSum > 0 ? weightedSum / weightSum : 0;
    overall = { type: "grade", grade: percentToGrade(percentScore), percentScore, weightSum, makeupTotal };
  }

  return { memberResults, overall, totalBase, rawMissed, makeupTotal };
}
