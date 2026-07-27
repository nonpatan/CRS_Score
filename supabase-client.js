// ============================================================
// ตั้งค่า Supabase ที่เดียว ใช้ร่วมกันทุกหน้า (index/attendance/summary/manage)
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://cbfblvsasamxuwgcpmtj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EEGLPPMa3fIX1aRR6GA3Xw_mF4mh5X0";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ไฟล์กลางนี้อยู่รากเว็บเสมอ ใช้เป็นฐาน URL เพื่อให้หน้าที่อยู่ในโฟลเดอร์ย่อย
// เด้งกลับ login ที่รากเว็บได้ถูกต้องทั้งบน GitHub Pages และ local server
const APP_ROOT_URL = new URL("./", import.meta.url);

function appRelativeLocation() {
  const rootPath = APP_ROOT_URL.pathname;
  if (location.pathname.startsWith(rootPath)) {
    return location.pathname.slice(rootPath.length) + location.search;
  }
  return location.pathname.split("/").pop() + location.search;
}

// เช็คว่าล็อกอินอยู่ไหม ถ้าไม่ได้ล็อกอิน เด้งไปหน้า login (จำหน้าปัจจุบันไว้ กลับมาได้หลังล็อกอิน)
// เรียกตอนต้นสคริปต์ของทุกหน้าที่ต้องล็อกอินก่อนใช้งาน
export async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const loginUrl = new URL("login.html", APP_ROOT_URL);
    loginUrl.searchParams.set("next", appRelativeLocation());
    location.href = loginUrl.href;
    return null;
  }
  return session;
}

// ออกจากระบบ แล้วเด้งกลับไปหน้า login
export async function signOut() {
  await sb.auth.signOut();
  location.href = new URL("login.html", APP_ROOT_URL).href;
}

// โปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ (มี role: admin/teacher)
export async function getProfile(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (error) return null;
  return data;
}

// ------------------------------------------------------------
// สิทธิ์ระดับฝ่าย (user_departments) — ต้องรัน migration "ระบบสิทธิ์ระดับฝ่าย" ท้าย schema.sql ก่อน
// โมเดล: (อยู่ฝ่ายไหน) + (admin กดอนุญาต granted=true) → มีอำนาจเท่า admin เฉพาะหน้าฝ่ายนั้น
// ⚠ ฟังก์ชันฝั่งนี้ใช้ "ซ่อน/แสดงปุ่ม" เท่านั้น ความจริงบังคับที่ RLS ในฐานข้อมูลเสมอ
// ------------------------------------------------------------
export const DEPARTMENTS = ["วิชาการ", "บุคลากร", "การเงิน", "บริหารทั่วไป"];

// ฝ่ายที่ผู้ใช้คนนี้ได้รับอนุญาตแล้วจริง (ยังไม่อนุญาต = ไม่คืนมา)
export async function getMyDepartments(userId) {
  const { data, error } = await sb
    .from("user_departments")
    .select("department")
    .eq("user_id", userId)
    .eq("granted", true);
  if (error) return [];
  return (data || []).map(r => r.department);
}

// admin ถือว่ามีสิทธิ์ทุกฝ่ายเสมอ (ตรงกับฟังก์ชัน has_department() ในฐานข้อมูล)
export async function canUseDepartment(userId, department, profile = null) {
  const p = profile || await getProfile(userId);
  if (p && p.role === "admin") return true;
  const mine = await getMyDepartments(userId);
  return mine.includes(department);
}

// ------------------------------------------------------------
// คุมการมองเห็นเมนู/หน้าของฝ่ายบุคคล
// app-shell.js ซ่อนลิงก์ที่เป็นงานฝ่ายบุคคลไว้ก่อนเสมอ (data-restricted + hidden)
// หน้าเว็บต้องเรียกฟังก์ชันนี้เพื่อเปิดให้คนที่มีสิทธิ์ — ถ้าไม่มีสิทธิ์จะถูกลบทิ้งจาก DOM
// ⚠ นี่คือชั้น "ซ่อนปุ่ม" เท่านั้น ตัวจริงที่กันข้อมูลคือ RLS (staff/work_attendance/staff_leaves
//   อ่านได้เฉพาะฝ่ายบุคคลหรือแถวของตัวเอง)
// ------------------------------------------------------------
export function applyPersonnelMenuAccess(canManageHr) {
  const links = document.querySelectorAll('header .nav a[data-restricted]');
  links.forEach(a => {
    if (canManageHr) a.removeAttribute("hidden");
    else a.remove();
  });
  if (canManageHr) return;
  // กลุ่มเมนูที่ไม่เหลือลิงก์แล้ว ต้องซ่อนด้วย ไม่งั้นจะเห็นหัวข้อกลุ่มลอย ๆ
  document.querySelectorAll("header .nav .nav-group").forEach(group => {
    if (!group.querySelector(".nav-group-links a")) group.remove();
  });
}

// การ์ดแจ้งเตือนสำหรับหน้าที่ครูทั่วไปเข้าไม่ได้ (ใช้ข้อความเดียวกันทุกหน้า)
export function personnelAccessDeniedHtml() {
  return '<div class="banner warn"><b>หน้านี้สำหรับฝ่ายบุคลากรเท่านั้น</b><br>' +
    'ข้อมูลของบุคลากรคนอื่นเป็นข้อมูลส่วนบุคคล จึงเปิดให้เฉพาะผู้ที่ได้รับสิทธิ์ฝ่ายบุคลากร<br>' +
    'ดูข้อมูลการทำงานของคุณเองได้ที่หน้า <a href="my-work.html">ข้อมูลการทำงานของฉัน</a></div>';
}

// ถามฐานข้อมูลตรง ๆ ว่ามีสิทธิ์ในฝ่ายนี้ไหม — ใช้ฟังก์ชันตัวเดียวกับที่ RLS ใช้ตัดสิน
// จึงตรงกับความจริงเสมอ (ต่างจาก canUseDepartment ที่ประกอบจากหลาย query ฝั่งเว็บ)
export async function checkDepartment(department) {
  const { data, error } = await sb.rpc("has_department", { p_department: department });
  if (error) return false;
  return data === true;
}

// สำหรับหน้าจัดการสิทธิ์ (admin): ดึงสิทธิ์ทุกคนมาแสดง
export async function listAllUserDepartments() {
  const { data, error } = await sb.from("user_departments").select("*");
  if (error) return [];
  return data || [];
}

// admin กำหนด/แก้สิทธิ์ของคนหนึ่งในฝ่ายหนึ่ง (มีอยู่แล้วให้ทับ)
export async function setUserDepartment(userId, department, granted, grantedBy) {
  return await sb.from("user_departments").upsert({
    user_id: userId,
    department,
    granted,
    granted_by: granted ? (grantedBy || null) : null,
    granted_at: granted ? new Date().toISOString() : null
  }, { onConflict: "user_id,department" });
}

// admin ถอดคนออกจากฝ่าย (ต่างจากตั้ง granted=false ตรงที่ลบแถวทิ้งเลย)
export async function removeUserDepartment(userId, department) {
  return await sb.from("user_departments")
    .delete()
    .eq("user_id", userId)
    .eq("department", department);
}

// ------------------------------------------------------------
// ซิงก์ข้อมูลจาก Jibble ผ่าน Edge Function "jibble-sync"
// key ของ Jibble อยู่ใน Supabase secrets ฝั่ง server — หน้าเว็บไม่เคยเห็น
// invoke() แนบ access token ของผู้ใช้ให้อัตโนมัติ ฝั่ง function จึงเช็ค has_department() ได้
// ------------------------------------------------------------
export async function syncJibble(scope, options = {}) {
  const { data, error } = await sb.functions.invoke("jibble-sync", {
    body: { scope, ...options }
  });
  if (error) {
    // ข้อความจริงของ error มักอยู่ในเนื้อ response ไม่ใช่ error.message ("non-2xx status")
    let detail = error.message || String(error);
    try {
      const body = await error.context?.json();
      if (body?.error) detail = body.error;
    } catch { /* อ่านเนื้อไม่ได้ก็ใช้ข้อความเดิม */ }
    throw new Error(detail);
  }
  if (data && data.ok === false) throw new Error(data.error || "ซิงก์ไม่สำเร็จ");
  return data;
}

// สถานะการซิงก์ล่าสุด — serverless พังเงียบได้ หน้าเว็บต้องแสดงให้เห็น
export async function getLastSyncLog(scope = null) {
  let q = sb.from("jibble_sync_log").select("*").order("started_at", { ascending: false }).limit(1);
  if (scope) q = q.eq("scope", scope);
  const { data, error } = await q;
  if (error) return null;
  return (data && data[0]) || null;
}

// ข้อมูลส่วนตัวที่เจ้าของบัญชีแก้ได้เอง แยกจาก profiles เพื่อไม่ให้ครูแก้ role/email ได้
// ตารางนี้จะมีหลังรัน migration "ข้อมูลส่วนตัวและรูปโปรไฟล์" ท้าย schema.sql
export async function getMyProfileDetails(userId) {
  const { data, error } = await sb
    .from("user_profile_details")
    .select("user_id,display_name,avatar_path,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  return { data: data || null, error };
}

export function profileInitials(nameOrEmail) {
  const text = String(nameOrEmail || "ผู้ใช้").trim();
  if (!text) return "ผ";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

// รูปใน Storage เป็น private เสมอ จึงต้องสร้าง signed URL ก่อนแสดง และใช้เฉพาะของบัญชีที่ล็อกอิน
// ชื่อจากทะเบียนบุคลากร (ผูกผ่าน staff.user_id) — ใช้เป็น "ชื่อตั้งต้น" ของบัญชี
// ฝ่ายบุคคลกรอกชื่อจริงไว้แล้ว จึงไม่ควรให้ครูต้องมาพิมพ์ชื่อตัวเองซ้ำอีกรอบ
// ตารางนี้จะมีหลังรัน migration "โมดูลฝ่ายบุคคล" — ถ้ายังไม่มีก็คืนค่าว่างไป ไม่ทำให้หน้าพัง
export async function getStaffNameForUser(userId) {
  const { data, error } = await sb
    .from("staff").select("full_name").eq("user_id", userId).maybeSingle();
  if (error) return "";
  return (data && data.full_name) || "";
}

// ชื่อจากทะเบียนบุคลากรของหลายบัญชีพร้อมกัน (ใช้ที่หน้าจัดการสิทธิ์) → Map(userId → ชื่อ)
export async function getStaffNamesByUser() {
  const { data, error } = await sb
    .from("staff").select("user_id,full_name").not("user_id", "is", null);
  const map = new Map();
  if (error) return map;
  (data || []).forEach(r => map.set(r.user_id, r.full_name));
  return map;
}

export async function getMyProfilePresentation(user) {
  const [profile, detailResult, staffName] = await Promise.all([
    getProfile(user.id),
    getMyProfileDetails(user.id),
    getStaffNameForUser(user.id)
  ]);
  const details = detailResult.data;
  // ลำดับ: ชื่อที่เจ้าตัวตั้งเอง → ชื่อจากทะเบียนบุคลากร → profiles.name → metadata → อีเมล
  const displayName = (details && details.display_name) || staffName || (profile && profile.name) ||
    (user.user_metadata && user.user_metadata.full_name) || (user.email || "ผู้ใช้");
  let avatarUrl = "";

  if (details && details.avatar_path) {
    const { data } = await sb.storage.from("profile-avatars")
      .createSignedUrl(details.avatar_path, 60 * 60);
    avatarUrl = (data && data.signedUrl) || "";
  }

  return {
    profile,
    details,
    detailsError: detailResult.error,
    displayName,
    staffName,                  // หน้าโปรไฟล์ใช้เทียบว่าผู้ใช้แก้ชื่อเองหรือยัง
    initials: profileInitials(displayName),
    avatarUrl
  };
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

// ประวัติชั้น/ห้องของนักเรียนในปีการศึกษาที่ระบุ
// ไม่กรอง graduated/left_school เพราะรายงานย้อนหลังต้องเห็นรายชื่อในปีนั้นครบ
// studentIds ส่งมาเฉพาะเมื่ออยากอ่าน placement ของรายชื่อบางกลุ่ม (เช่น roster ของรายวิชา)
export async function getStudentPlacements(year, studentIds = null) {
  if (!year) return { data: [], error: null };

  let query = sb.from("student_year_placements")
    .select("id,student_id,year,grade_level,classroom,student:student_id(id,student_no,name,graduated,left_school)")
    .eq("year", year)
    .order("grade_level")
    .order("classroom");
  if (Array.isArray(studentIds)) {
    if (studentIds.length === 0) return { data: [], error: null };
    query = query.in("student_id", studentIds);
  }

  const { data, error } = await query;
  return { data: data || [], error };
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
// % ของคาบเต็มตามรอบวิชา (ประถมทั้งปี / มัธยมทั้งภาคเรียน) เพราะถ้าเทียบเป็น % ตั้งแต่ช่วงต้น
// (ที่เช็คชื่อไปแค่ไม่กี่ครั้ง) ตัวเลขจะเพี้ยนสูงเกินจริง ทำให้ติด มส. ง่ายเกินไปทั้งที่ยังเหลือเวลาแก้ตัวอีกเยอะ
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

// คำนวณสถานะเฝ้าระวัง มส. จากวิชาพื้นฐาน 1 ตัว หรือหลายตัวที่ประกอบเป็นวิชาบูรณาการ
// ใช้ร่วมกันทั้ง dashboard.html, warning.html และ summary.html เพื่อให้เกณฑ์ไม่แยกกันหลายหน้า
// subjectDataList ใช้รูปเดียวกับผลจาก loadSubjectData(): [{ subject, sessions, makeupHours }, ...]
// เกณฑ์ที่ยืนยันแล้ว: ขาดสุทธิหลังหักชั่วโมงชดเชย >= 10% = เสี่ยง, > 20% = วิกฤต
export function computeAttendanceRisk(studentId, subjectDataList) {
  const dataList = Array.isArray(subjectDataList) ? subjectDataList : [];
  let totalBase = 0;
  let rawMissed = 0;
  let makeupTotal = 0;

  for (const item of dataList) {
    if (!item || !item.subject) continue;
    totalBase += Number(item.subject.total_periods) || 0;
    rawMissed += computeMissedPeriods(studentId, item.sessions || []);
    makeupTotal += (item.makeupHours || [])
      .filter(row => row.student_id === studentId)
      .reduce((sum, row) => sum + (Number(row.periods) || 0), 0);
  }

  const netMissed = Math.max(0, rawMissed - makeupTotal);
  const percent = totalBase > 0 ? (netMissed / totalBase) * 100 : 0;
  return {
    totalBase,
    rawMissed,
    makeupTotal,
    netMissed,
    percent,
    risky: totalBase > 0 && percent >= 10,
    critical: totalBase > 0 && percent > 20
  };
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
  // เต็มตามรอบวิชาแบบเดิม — เปลี่ยนเพราะเทียบ % ตั้งแต่ช่วงต้นทำให้ติด มส. ง่ายเกินจริง ยืนยันแล้ว
  // 2026-07): เพดานคำนวณจาก total_periods ของรอบวิชาเสมอ (ประถมทั้งปี / มัธยมทั้งภาคเรียน)
  // ไม่ใช่คาบที่เช็คไปแล้ว จึงไม่ติด มส. ง่ายๆ ตอนที่ยังเช็คชื่อเพียงไม่กี่ครั้ง
  //   ขาดสะสม > 20% ของคาบเต็มตามรอบวิชา และ <= 40%  → "เรียนเพิ่มเติมให้ครบเวลา" ใช้ชั่วโมงชดเชย
  //     ลบยอดขาดสุทธิให้ไม่เกิน 20% ได้
  //   ขาดสะสม > 40% ของคาบเต็มตามรอบวิชา               → "เรียนซ้ำรายวิชา" ชั่วโมงชดเชยช่วยไม่ได้เลย
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

// ---------- รวมผลทุกวิชาของนักเรียนทุกคน ในชั้น + ปีการศึกษา (+ เทอม ถ้าส่งมา) ----------
// ใช้ร่วมกันระหว่าง retention.html (เกณฑ์เรียนซ้ำชั้น — ไม่ส่ง term = รวมทั้งปี) และ
// summary.html แท็บ "ผลการเรียนรายคน" (มัธยมส่ง term = คิดรายเทอม, ประถมไม่ส่ง = คิดรายปี)
// กติกาวิชาบูรณาการ: นับวิชาบูรณาการเป็น 1 รายวิชา ไม่นับวิชาพื้นฐานสมาชิกซ้ำอีกที (ยืนยันแล้ว)
// คืน Map<studentId, { student, subjects: [{ subject, result }] }>  (result รูปทรงเดียวกับ
// computeSubjectResult().result / computeIntegratedResult().overall) — โยน Error ถ้าโหลดไม่สำเร็จ
export async function computeStudentSubjectResults({ grade, year, term } = {}) {
  const out = new Map();
  if (!grade || !year) return out;

  const { data: allSubj, error: subjErr } = await sb
    .from("subjects").select("*").eq("grade_level", grade).eq("year", year);
  if (subjErr) throw new Error("โหลดวิชาไม่สำเร็จ: " + subjErr.message);
  if (!allSubj || allSubj.length === 0) return out;

  // มัธยมส่ง term มา = คิดเฉพาะวิชาของเทอมนั้น; ประถมไม่ส่ง term จึงรวมทั้งปี (ยืนยันแล้ว)
  const scopedSubj = term ? allSubj.filter(s => s.term === term) : allSubj;
  if (scopedSubj.length === 0) return out;

  // วิชาบูรณาการในชุดนี้ + วิชาพื้นฐานสมาชิกของมัน (นับที่วิชาบูรณาการตัวเดียว กันนับซ้ำ)
  const integratedIds = scopedSubj.filter(s => s.subject_type === "บูรณาการ").map(s => s.id);
  let memberLinks = [];
  if (integratedIds.length > 0) {
    const { data } = await sb.from("integration_members").select("*").in("integrated_subject_id", integratedIds);
    memberLinks = data || [];
  }
  const memberSubjectIds = new Set(memberLinks.map(m => m.member_subject_id));
  const countableSubjects = scopedSubj.filter(s => s.subject_type === "บูรณาการ" || !memberSubjectIds.has(s.id));

  // โหลดข้อมูลเต็มของวิชาพื้นฐานที่ต้องใช้จริง (นับตรง ๆ + ที่เป็นสมาชิกบูรณาการ)
  const plainIdsToLoad = new Set();
  for (const s of countableSubjects) if (s.subject_type === "พื้นฐาน") plainIdsToLoad.add(s.id);
  for (const id of memberSubjectIds) plainIdsToLoad.add(id);

  const loadedData = new Map();
  await Promise.all([...plainIdsToLoad].map(async id => { loadedData.set(id, await loadSubjectData(id)); }));

  const groupMembers = new Map(); // integrated_subject_id -> [member_subject_id, ...]
  for (const link of memberLinks) {
    if (!groupMembers.has(link.integrated_subject_id)) groupMembers.set(link.integrated_subject_id, []);
    groupMembers.get(link.integrated_subject_id).push(link.member_subject_id);
  }

  // รายชื่อนักเรียน = ผ่าน enrollments ของวิชาพื้นฐานเท่านั้น (วิชาบูรณาการไม่มี enrollments ของตัวเอง)
  const enrollSubjectIds = [...plainIdsToLoad];
  const { data: enrollRows, error: enrollErr } = enrollSubjectIds.length
    ? await sb.from("enrollments").select("student_id, subject_id, student:student_id(*)").in("subject_id", enrollSubjectIds)
    : { data: [], error: null };
  if (enrollErr) throw new Error("โหลดรายชื่อนักเรียนไม่สำเร็จ: " + enrollErr.message);

  const enrolledBySubject = new Map();
  const studentsMap = new Map();
  for (const row of (enrollRows || [])) {
    if (!enrolledBySubject.has(row.subject_id)) enrolledBySubject.set(row.subject_id, new Set());
    enrolledBySubject.get(row.subject_id).add(row.student_id);
    if (row.student) studentsMap.set(row.student_id, row.student);
  }
  if (studentsMap.size === 0) return out;

  for (const [studentId, student] of studentsMap) out.set(studentId, { student, subjects: [] });

  for (const subj of countableSubjects) {
    if (subj.subject_type === "บูรณาการ") {
      const members = groupMembers.get(subj.id) || [];
      const memberDataList = members.map(id => loadedData.get(id)).filter(Boolean);
      const enrolledSet = new Set();
      for (const id of members) for (const sid of (enrolledBySubject.get(id) || [])) enrolledSet.add(sid);
      for (const studentId of enrolledSet) {
        if (!out.has(studentId)) continue;
        const ir = computeIntegratedResult(studentId, memberDataList);
        out.get(studentId).subjects.push({ subject: subj, result: ir.overall });
      }
    } else {
      const data = loadedData.get(subj.id);
      const enrolledSet = enrolledBySubject.get(subj.id) || new Set();
      for (const studentId of enrolledSet) {
        if (!out.has(studentId)) continue;
        const r = computeSubjectResult(studentId, data.subject, data.units, data.remarksData, data.sessions, data.makeupHours);
        out.get(studentId).subjects.push({ subject: subj, result: r.result });
      }
    }
  }

  return out;
}

// ---------- คิดเกรดเฉลี่ย (GPA) จากผลรายวิชาของนักเรียน 1 คน ----------
// ถ่วงน้ำหนักด้วยหน่วยกิต (credits) — ไม่มีหน่วยกิต (ประถม) ถือเป็น 1 หน่วยเท่ากัน (ยืนยันแล้ว)
// มีวิชาติด ร./มส. ที่ยังไม่แก้แม้แต่วิชาเดียว → pending=true ("ยังสรุปไม่ได้") ไม่คิด GPA (ยืนยันแล้ว)
// รับ subjectResults = [{ subject, result }, ...]  คืน { gpa: number|null, pending, total }
export function computeGpa(subjectResults) {
  const list = subjectResults || [];
  const total = list.length;
  const pending = list.some(x => x.result.type === "มส." || x.result.type === "ร.");
  if (pending || total === 0) return { gpa: null, pending, total };
  let weightedSum = 0, weightSum = 0;
  for (const x of list) {
    const w = x.subject.credits && x.subject.credits > 0 ? Number(x.subject.credits) : 1;
    weightedSum += x.result.grade * w;
    weightSum += w;
  }
  return { gpa: weightSum > 0 ? weightedSum / weightSum : 0, pending: false, total };
}

// ============================================================
// ภาพรวมฝ่ายวิชาการ — ใช้ร่วมกันระหว่าง academic/index.html กับ dashboard.html
// ------------------------------------------------------------
// ก่อนหน้านี้ตรรกะ "ใครเสี่ยงขาดเรียน" ถูกเขียนแยกกัน 2 ชุด (dashboard.html กับ
// academic/warning.html) การเพิ่มหน้าภาพรวมจึงย้ายมารวมไว้ที่นี่ ไม่ก๊อปเป็นชุดที่ 3
//
// แบ่งเป็น 2 ส่วนตั้งใจ:
//   loadAcademicOverviewData(year)  = ยิง query อย่างเดียว (ต้องมี network)
//   buildAcademicOverview(raw, opt) = คำนวณล้วน ไม่แตะ sb/DOM เลย → เขียนสคริปต์ทดสอบได้
//
// เกณฑ์ (ยืนยันกับผู้ใช้ 2026-07-25):
//   มัธยม → เสี่ยงติด มส. เมื่อขาดสุทธิ >= 10% ของคาบวิชา (เกณฑ์เดิมของ computeAttendanceRisk)
//   ประถม → "ขาดบ่อย" เมื่อขาดสุทธิ >= 5% (เตือนเร็วกว่า เพราะอยากรู้ตั้งแต่ยังแก้ทัน)
//   ทั้งสองระดับ วิกฤตที่ > 20% เท่ากัน เพราะกฎ มส. ใช้กับทั้งประถมและมัธยม —
//   การแยกนี้เป็นแค่ "วิธีนำเสนอ" ไม่ได้เปลี่ยนกฎการตัดสิน มส. ที่ computeSubjectResult()
// ============================================================

// ชั้นประถมหรือไม่ — ดูจากคำนำหน้าชั้นของ "นักเรียน" (subjects.level ใช้กับวิชา ไม่ใช่คน)
export function isPrimaryGrade(grade) {
  return String(grade || "").startsWith("ป.");
}

// ⚠ Supabase/PostgREST คืนได้สูงสุด 1000 แถวต่อคำขอ — **เกินกว่านั้นถูกตัดทิ้งเงียบ ๆ ไม่มี error**
// ตารางที่โตตามจำนวน (นักเรียน × วิชา) เช่น enrollments/attendance_sessions ทะลุ 1000 ได้ง่ายมาก
// ถ้าไม่ไล่ดึงเป็นหน้า ๆ รายงานจะ "นับขาดน้อยกว่าจริง" แบบดูไม่ออก (เคยเจอกับดักนี้มาแล้วตอนดึงรายชื่อห้อง)
// ต้อง order ด้วยคีย์ที่ไม่ซ้ำเสมอ ไม่งั้นการแบ่งหน้าอาจได้แถวซ้ำ/ตกหล่น
const PAGE_SIZE = 1000;
export async function fetchAllRows(makeQuery, orderColumn = "id") {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await makeQuery()
      .order(orderColumn)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}

// ข้อมูลเช็คชื่อเป็นก้อนที่ใหญ่ที่สุดของหน้าภาพรวม (ครั้งที่เช็คทั้งปี × นักเรียนต่อครั้ง)
// แต่สูตรคิด "คาบขาด" ใช้แค่ 3 สถานะนี้ — 'มา'/'มาสาย' คิดเป็นขาด 0 คาบอยู่แล้ว และ
// computeMissedPeriods() ข้ามคนที่ "ไม่มีแถว" ด้วยผลเท่ากันเป๊ะ จึงกรองทิ้งตั้งแต่ฝั่งเซิร์ฟเวอร์ได้
// (ปกติ 'มา' เป็นสัดส่วนมากที่สุดของตาราง — ตัดออกแล้วข้อมูลที่ต้องโหลดลดลงมาก)
const ABSENCE_STATUSES = ["ขาด", "ลาป่วย", "ลากิจ"];

async function fetchAttendanceSessions(subjectIds) {
  const base = () => sb.from("attendance_sessions")
    .select("id,subject_id,periods_covered,attendance_records(student_id,status)")
    .in("subject_id", subjectIds);

  const filtered = await fetchAllRows(() => base().in("attendance_records.status", ABSENCE_STATUSES));
  if (!filtered.error) return filtered;
  // ถ้าเซิร์ฟเวอร์ไม่รับการกรองที่ตารางลูก ให้ถอยไปดึงทั้งหมด — ผลลัพธ์เท่ากัน แค่หนักกว่า
  // (ยอมช้าดีกว่าหน้าพังหรือได้ข้อมูลไม่ครบ)
  return fetchAllRows(base);
}

export async function loadAcademicOverviewData(year) {
  const empty = {
    year, subjects: [], enrollments: [], members: [], sessions: [],
    makeupRows: [], remarks: [], placements: [], yearlessSubjects: [], activeStudents: []
  };
  if (!year) return empty;

  const { data: subjects, error: subjErr } = await sb.from("subjects")
    .select("id,name,code,level,grade_level,subject_type,total_periods,owner_id,term")
    .eq("year", year);
  if (subjErr) throw new Error("โหลดรายวิชาไม่สำเร็จ: " + subjErr.message);
  if (!subjects || subjects.length === 0) return empty;

  const subjectIds = subjects.map(s => s.id);
  const [enrollRes, memberRes, sessionRes, makeupRes, remarkRes, placementRes, yearlessRes, activeStudents] =
    await Promise.all([
      // 4 ตารางนี้โตตามจำนวนนักเรียน × วิชา จึงต้องไล่ดึงเป็นหน้า ๆ (ดูหมายเหตุ 1000 แถวด้านบน)
      fetchAllRows(() => sb.from("enrollments").select("id,subject_id,student_id").in("subject_id", subjectIds)),
      sb.from("integration_members").select("integrated_subject_id,member_subject_id").in("integrated_subject_id", subjectIds),
      fetchAttendanceSessions(subjectIds),
      fetchAllRows(() => sb.from("makeup_hours").select("id,subject_id,student_id,periods").in("subject_id", subjectIds)),
      fetchAllRows(() => sb.from("remarks").select("id,student_id,subject_id,code,reason,created_at").in("subject_id", subjectIds)),
      getStudentPlacements(year),
      // วิชาที่ยังไม่กรอกปีการศึกษา — หาไม่เจอด้วย query ที่กรองด้วยปี จึงต้องถามแยก
      sb.from("subjects").select("id,name,code,grade_level").is("year", null),
      getActiveStudents()
    ]);

  for (const res of [enrollRes, memberRes, sessionRes, makeupRes, remarkRes, yearlessRes]) {
    if (res.error) throw new Error("โหลดข้อมูลภาพรวมไม่สำเร็จ: " + res.error.message);
  }

  return {
    year,
    subjects,
    enrollments: enrollRes.data || [],
    members: memberRes.data || [],
    sessions: sessionRes.data || [],
    makeupRows: makeupRes.data || [],
    remarks: remarkRes.data || [],
    placements: placementRes.data || [],
    yearlessSubjects: yearlessRes.data || [],
    activeStudents: activeStudents || []
  };
}

// คำนวณล้วน — รับผลจาก loadAcademicOverviewData() แล้วสรุปเป็นข้อมูลพร้อมแสดงผล
export function buildAcademicOverview(raw, options = {}) {
  const primaryWarn  = Number(options.primaryWarnPercent ?? 5);
  const secondaryWarn = Number(options.secondaryWarnPercent ?? 10);
  const criticalPercent = Number(options.criticalPercent ?? 20);

  const data = raw || {};
  const subjects = data.subjects || [];
  const subjectById = new Map(subjects.map(s => [s.id, s]));

  // ---------- วิชาบูรณาการกับสมาชิก (นับที่วิชาบูรณาการตัวเดียว กันนับซ้ำ เหมือน retention/summary) ----------
  const membersOf = new Map();
  const memberSubjectIds = new Set();
  for (const link of (data.members || [])) {
    const member = subjectById.get(link.member_subject_id);
    if (!member) continue;
    if (!membersOf.has(link.integrated_subject_id)) membersOf.set(link.integrated_subject_id, []);
    membersOf.get(link.integrated_subject_id).push(member);
    memberSubjectIds.add(member.id);
  }
  const countableSubjects = subjects.filter(s => s.subject_type === "บูรณาการ" || !memberSubjectIds.has(s.id));

  // ---------- จัดข้อมูลเป็น map เพื่อคำนวณต่อ ----------
  const enrolledBySubject = new Map();
  for (const row of (data.enrollments || [])) {
    if (!enrolledBySubject.has(row.subject_id)) enrolledBySubject.set(row.subject_id, new Set());
    enrolledBySubject.get(row.subject_id).add(row.student_id);
  }
  const sessionsBySubject = new Map();
  for (const row of (data.sessions || [])) {
    if (!sessionsBySubject.has(row.subject_id)) sessionsBySubject.set(row.subject_id, []);
    sessionsBySubject.get(row.subject_id).push(row);
  }
  const makeupBySubject = new Map();
  for (const row of (data.makeupRows || [])) {
    if (!makeupBySubject.has(row.subject_id)) makeupBySubject.set(row.subject_id, []);
    makeupBySubject.get(row.subject_id).push(row);
  }

  // ---------- รายชื่อนักเรียน + ชั้นของ "ปีที่เลือก" ----------
  // ใช้ student_year_placements เป็นหลักตามกติกาว่ารายงานต้องอิงชั้นของปีนั้น
  // (students.grade_level คือชั้นปัจจุบัน จะเพี้ยนทันทีเมื่อดูปีเก่าหลังเลื่อนชั้นไปแล้ว)
  const placements = data.placements || [];
  const activeStudents = data.activeStudents || [];
  const placementFallback = placements.length === 0;
  const roster = [];
  if (!placementFallback) {
    for (const p of placements) {
      const stu = p.student || { id: p.student_id };
      roster.push({ student: stu, grade: p.grade_level, classroom: p.classroom });
    }
  } else {
    for (const stu of activeStudents) {
      roster.push({ student: stu, grade: stu.grade_level, classroom: stu.classroom });
    }
  }
  const placedIds = new Set(placements.map(p => p.student_id));
  const studentsWithoutPlacement = placementFallback
    ? []
    : activeStudents.filter(s => !placedIds.has(s.id));

  // ---------- ความเสี่ยงรายคน ----------
  const subjectDataFor = (subject, studentId) => ({
    subject,
    sessions: sessionsBySubject.get(subject.id) || [],
    makeupHours: (makeupBySubject.get(subject.id) || []).filter(row => row.student_id === studentId)
  });

  const rows = [];
  for (const entry of roster) {
    const studentId = entry.student.id;
    const warnPercent = isPrimaryGrade(entry.grade) ? primaryWarn : secondaryWarn;
    const risky = [];

    for (const subject of countableSubjects) {
      let risk, enrolled;
      if (subject.subject_type === "บูรณาการ") {
        const members = membersOf.get(subject.id) || [];
        enrolled = members.some(m => enrolledBySubject.get(m.id)?.has(studentId));
        risk = computeAttendanceRisk(studentId, members.map(m => subjectDataFor(m, studentId)));
      } else {
        enrolled = Boolean(enrolledBySubject.get(subject.id)?.has(studentId));
        risk = computeAttendanceRisk(studentId, [subjectDataFor(subject, studentId)]);
      }
      // totalBase = 0 คือวิชาที่ยังไม่ตั้งจำนวนคาบ — ตัดสินความเสี่ยงไม่ได้ ไปขึ้นที่ "ความพร้อมข้อมูล" แทน
      if (!enrolled || risk.totalBase <= 0) continue;
      if (risk.percent >= warnPercent) {
        risky.push({
          subject,
          percent: risk.percent,
          netMissed: risk.netMissed,
          totalBase: risk.totalBase,
          critical: risk.percent > criticalPercent
        });
      }
    }

    if (risky.length === 0) continue;
    risky.sort((a, b) => b.percent - a.percent);
    rows.push({
      student: entry.student,
      grade: entry.grade,
      classroom: entry.classroom,
      isPrimary: isPrimaryGrade(entry.grade),
      warnPercent,
      subjects: risky,
      maxPercent: risky[0].percent,
      maxMissed: risky[0].netMissed,
      critical: risky.some(r => r.critical)
    });
  }
  rows.sort((a, b) => b.maxPercent - a.maxPercent || b.maxMissed - a.maxMissed);

  // ---------- ติด ร. ที่ยังค้างอยู่ (มีแถวใน remarks = ยังไม่ถูกถอด) ----------
  const gradeOfStudent = new Map(roster.map(r => [r.student.id, r.grade]));
  const studentOf = new Map(roster.map(r => [r.student.id, r.student]));
  const incompleteRemarks = (data.remarks || [])
    .filter(r => r.code === "ร.")
    .map(r => ({
      student: studentOf.get(r.student_id) || { id: r.student_id, name: "(ไม่พบชื่อนักเรียน)" },
      grade: gradeOfStudent.get(r.student_id) || "",
      subject: subjectById.get(r.subject_id) || null,
      reason: r.reason,
      created_at: r.created_at
    }));

  // ---------- ความพร้อมของข้อมูล ----------
  // เช็คที่ระดับ "วิชาพื้นฐาน" เป็นหลัก เพราะคาบเรียน/เช็คชื่อ/รายชื่อ อยู่ที่วิชาพื้นฐานทั้งหมด
  // (วิชาบูรณาการไม่มีของพวกนี้เป็นของตัวเองโดยการออกแบบ)
  const plainSubjects = subjects.filter(s => s.subject_type !== "บูรณาการ");
  const readiness = {
    noPeriods: plainSubjects.filter(s => !Number(s.total_periods)),
    noEnrollment: plainSubjects.filter(s => !(enrolledBySubject.get(s.id)?.size)),
    noSession: plainSubjects.filter(s => !(sessionsBySubject.get(s.id)?.length)),
    noOwner: subjects.filter(s => !s.owner_id),
    yearless: data.yearlessSubjects || [],
    noPlacement: studentsWithoutPlacement
  };

  // ---------- ความคืบหน้าการเช็คชื่อ (คาบที่เช็คไปแล้ว เทียบคาบทั้งรอบของวิชา) ----------
  const coverage = countableSubjects.map(subject => {
    const parts = subject.subject_type === "บูรณาการ" ? (membersOf.get(subject.id) || []) : [subject];
    let checked = 0, total = 0;
    for (const part of parts) {
      checked += (sessionsBySubject.get(part.id) || []).reduce((sum, s) => sum + (Number(s.periods_covered) || 0), 0);
      total += Number(part.total_periods) || 0;
    }
    return { subject, checked, total, percent: total > 0 ? (checked / total) * 100 : null };
  }).sort((a, b) => {
    if (a.percent === null && b.percent === null) return 0;
    if (a.percent === null) return -1;
    if (b.percent === null) return 1;
    return a.percent - b.percent;
  });

  // ---------- สรุปรายชั้น ----------
  const gradeMap = new Map();
  for (const entry of roster) {
    const grade = entry.grade || "(ไม่ระบุชั้น)";
    if (!gradeMap.has(grade)) {
      gradeMap.set(grade, {
        grade,
        isPrimary: isPrimaryGrade(grade),
        warnPercent: isPrimaryGrade(grade) ? primaryWarn : secondaryWarn,
        studentCount: 0, flagged: [], criticalCount: 0, remarkCount: 0
      });
    }
    gradeMap.get(grade).studentCount += 1;
  }
  for (const row of rows) {
    const group = gradeMap.get(row.grade || "(ไม่ระบุชั้น)");
    if (!group) continue;
    group.flagged.push(row);
    if (row.critical) group.criticalCount += 1;
  }
  for (const remark of incompleteRemarks) {
    const group = gradeMap.get(remark.grade || "(ไม่ระบุชั้น)");
    if (group) group.remarkCount += 1;
  }
  const gradeOrderIndex = grade => {
    const idx = GRADE_ORDER.indexOf(grade);
    return idx === -1 ? GRADE_ORDER.length : idx;
  };
  const grades = [...gradeMap.values()].sort((a, b) => gradeOrderIndex(a.grade) - gradeOrderIndex(b.grade));

  return {
    year: data.year,
    subjectCount: subjects.length,
    countableCount: countableSubjects.length,
    studentCount: roster.length,
    placementFallback,
    grades,
    flaggedRows: rows,
    remarks: incompleteRemarks,
    readiness,
    coverage,
    thresholds: { primaryWarn, secondaryWarn, criticalPercent }
  };
}

// ============================================================
// ข้อมูลกลางสำหรับ Dashboard ใหม่ + โมดูลวิชาการ/บริหารทั่วไป
// ------------------------------------------------------------
// แยกการโหลดข้อมูลออกจากการคำนวณ เพื่อให้สูตรสรุปทดสอบได้โดยไม่แตะฐานข้อมูลหรือ DOM
// ⛔ daily_attendance เป็นเช็คชื่อรายวันของครูประจำชั้น ไม่เกี่ยวกับ attendance_sessions
//    และห้ามนำไปคิดเกรด/มส. เด็ดขาด
// ============================================================

// จับ placement เป็นรายการห้องมาตรฐาน — ผู้เรียกทุกหน้าต้องได้ field และลำดับชุดเดียวกัน
export function roomsFromPlacements(placements, year) {
  const roomMap = new Map();
  for (const p of (placements || [])) {
    if (!p.grade_level || !p.classroom) continue;
    const key = p.grade_level + "\u0000" + p.classroom;
    if (!roomMap.has(key)) {
      roomMap.set(key, {
        year,
        grade_level: p.grade_level,
        classroom: p.classroom,
        studentCount: 0
      });
    }
    roomMap.get(key).studentCount += 1;
  }

  return [...roomMap.values()].sort((a, b) => {
    const gradeDiff = GRADE_ORDER.indexOf(a.grade_level) - GRADE_ORDER.indexOf(b.grade_level);
    if (gradeDiff) return gradeDiff;
    return String(a.classroom).localeCompare(String(b.classroom), "th");
  });
}

// เช็คชื่อรายวันของวันที่ระบุ + ห้องที่มีนักเรียนตาม placement ของปีนั้น
// isHoliday อิงตารางงาน/วันหยุดชุดเดียวกับฝ่ายบุคคล; ถ้ายังไม่มีตารางงานจะไม่เดาว่าเป็นวันหยุด
export async function loadDailyAttendanceToday(year, dateStr) {
  if (!year || !dateStr) {
    return { year, dateStr, rows: [], rooms: [], isHoliday: false };
  }

  const weekday = isoWeekday(dateStr);
  const [rowsRes, placementsRes, scheduleRes, holidayRes] = await Promise.all([
    fetchAllRows(() => sb.from("daily_attendance")
      .select("id,attend_date,year,grade_level,classroom,student_id,status,note,recorded_by,recorded_at,updated_at")
      .eq("year", year)
      .eq("attend_date", dateStr)),
    getStudentPlacements(year),
    sb.from("work_schedule")
      .select("weekday,is_working_day")
      .eq("weekday", weekday)
      .maybeSingle(),
    sb.from("work_holidays")
      .select("holiday_date")
      .eq("holiday_date", dateStr)
      .maybeSingle()
  ]);

  for (const res of [rowsRes, placementsRes, scheduleRes, holidayRes]) {
    if (res.error) throw new Error("โหลดข้อมูลเช็คชื่อรายวันไม่สำเร็จ: " + res.error.message);
  }

  const rooms = roomsFromPlacements(placementsRes.data, year);
  const hasSchedule = !!scheduleRes.data;
  const isHoliday = !!holidayRes.data || (hasSchedule && scheduleRes.data.is_working_day !== true);

  return {
    year,
    dateStr,
    rows: rowsRes.data || [],
    rooms,
    isHoliday
  };
}

// คำนวณล้วน — options.isHoliday ต้องมาจาก loadDailyAttendanceToday()
export function summarizeDailyAttendance(rows, rooms, options = {}) {
  const attendanceRows = Array.isArray(rows) ? rows : [];
  const roomRows = Array.isArray(rooms) ? rooms : [];
  const counts = { present: 0, late: 0, leave: 0, absent: 0 };
  const checkedRooms = new Set();

  for (const row of attendanceRows) {
    if (row.status === "มา") counts.present += 1;
    else if (row.status === "มาสาย") counts.late += 1;
    else if (row.status === "ลาป่วย" || row.status === "ลากิจ") counts.leave += 1;
    else if (row.status === "ขาด") counts.absent += 1;

    if (row.grade_level && row.classroom) {
      checkedRooms.add(row.grade_level + "\u0000" + row.classroom);
    }
  }

  const roomsTotal = roomRows.length;
  const validRoomKeys = new Set(
    roomRows.map(r => r.grade_level + "\u0000" + r.classroom)
  );
  const roomsChecked = [...checkedRooms].filter(key => validRoomKeys.has(key)).length;
  let state = "none";
  if (options.isHoliday === true) state = "holiday";
  else if (roomsTotal === 0) state = "no-rooms";
  else if (roomsChecked === 0) state = "none";
  else if (roomsChecked < roomsTotal) state = "partial";
  else state = "complete";

  return {
    ...counts,
    roomsChecked,
    roomsTotal,
    state
  };
}

export async function loadAcademicCalendar(year) {
  if (!year) return [];
  const { data, error } = await sb.from("academic_calendar")
    .select("*")
    .eq("year", year)
    .order("start_date")
    .order("title");
  if (error) throw new Error("โหลดปฏิทินฝ่ายวิชาการไม่สำเร็จ: " + error.message);
  return data || [];
}

export const DEFAULT_CALENDAR_LEAD_DAYS = 7;

// คำนวณล้วน — แสดงตั้งแต่วันแจ้งเตือนจนถึงวันสิ้นสุด พร้อมป้ายสถานะ
export function pickCalendarUpcoming(rows, dateStr, defaultLeadDays) {
  if (!dateStr) return [];
  const configuredLead = Number(defaultLeadDays);
  // app_settings ยังเป็นความจริงหลักและชนะเสมอ ค่าคงที่นี้ใช้เฉพาะตอนอ่านค่ากลางไม่ได้
  // เพื่อกันรายการที่ lead_days = NULL หายจาก dashboard แบบเงียบ ๆ ไม่ใช่ hardcode ค่าที่ตั้งได้
  const fallbackLead = defaultLeadDays !== null && defaultLeadDays !== "" &&
    Number.isFinite(configuredLead) && configuredLead >= 0
    ? configuredLead
    : DEFAULT_CALENDAR_LEAD_DAYS;
  return (rows || []).filter(row => {
    if (!row.start_date || !row.end_date) return false;
    const lead = row.lead_days == null ? fallbackLead : Number(row.lead_days);
    if (!Number.isFinite(lead) || lead < 0) return false;
    return addDaysStr(row.start_date, -lead) <= dateStr && dateStr <= row.end_date;
  }).map(row => {
    const daysUntil = Math.round(
      (new Date(row.start_date + "T00:00:00Z") - new Date(dateStr + "T00:00:00Z")) / 86_400_000
    );
    let timing = "กำลังดำเนินการ";
    if (daysUntil === 0) timing = "วันนี้";
    else if (daysUntil > 0) timing = `อีก ${daysUntil} วัน`;
    return { ...row, timing, daysUntil };
  }).sort((a, b) =>
    String(a.start_date).localeCompare(String(b.start_date)) ||
    String(a.title || "").localeCompare(String(b.title || ""), "th")
  );
}

// ชื่อผู้รับผิดชอบโครงการ: ใช้ชื่อสดจาก staff ก่อน ถ้า RLS ทำให้ครูทั่วไปอ่าน staff
// แถวนั้นไม่ได้ ให้ถอยมาใช้สำเนาที่เก็บไว้กับโครงการ ฟังก์ชันนี้ใช้ร่วมกันทั้งหน้ารายการ
// และการ์ด dashboard เพื่อไม่ให้สองหน้าตัดสินชื่อคนละแบบ
export function projectResponsibleName(project) {
  return project?.responsible_staff?.full_name || project?.responsible_name || "";
}

export async function loadAcademicProjects(year) {
  if (!year) return [];
  const { data: projects, error: projectError } = await sb.from("academic_projects")
    .select("*")
    .eq("year", year)
    .order("start_date")
    .order("name");
  if (projectError) throw new Error("โหลดโครงการฝ่ายวิชาการไม่สำเร็จ: " + projectError.message);
  if (!projects || projects.length === 0) return [];

  const projectIds = projects.map(p => p.id);
  const staffIds = [...new Set(projects.map(p => p.responsible_staff_id).filter(Boolean))];
  const [linksRes, okrLinksRes, okrsRes, staffRes] = await Promise.all([
    sb.from("academic_project_links")
      .select("*")
      .in("project_id", projectIds)
      .order("sort_order"),
    sb.from("academic_project_okrs")
      .select("project_id,okr_id")
      .in("project_id", projectIds),
    sb.from("school_okrs")
      .select("*")
      .eq("year", year)
      .order("sort_order"),
    staffIds.length
      ? sb.from("staff").select("id,full_name").in("id", staffIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  for (const res of [linksRes, okrLinksRes, okrsRes, staffRes]) {
    if (res.error) throw new Error("โหลดรายละเอียดโครงการไม่สำเร็จ: " + res.error.message);
  }

  const linksByProject = new Map();
  for (const link of (linksRes.data || [])) {
    if (!linksByProject.has(link.project_id)) linksByProject.set(link.project_id, []);
    linksByProject.get(link.project_id).push(link);
  }
  const okrById = new Map((okrsRes.data || []).map(okr => [okr.id, okr]));
  const okrsByProject = new Map();
  for (const link of (okrLinksRes.data || [])) {
    const okr = okrById.get(link.okr_id);
    if (!okr) continue;
    if (!okrsByProject.has(link.project_id)) okrsByProject.set(link.project_id, []);
    okrsByProject.get(link.project_id).push(okr);
  }
  const staffById = new Map((staffRes.data || []).map(staff => [staff.id, staff]));

  return projects.map(project => {
    const liveStaff = staffById.get(project.responsible_staff_id) || null;
    return {
      ...project,
      responsible_staff: liveStaff,
      responsible_display_name: projectResponsibleName({
        ...project,
        responsible_staff: liveStaff
      }),
      links: linksByProject.get(project.id) || [],
      okrs: okrsByProject.get(project.id) || []
    };
  });
}

// คำนวณล้วน — ช่วงโครงการคาบเกี่ยวเดือน และไม่แสดงรายการที่ยกเลิก
export function filterProjectsInMonth(rows, yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) return [];
  const [year, month] = yearMonth.split("-").map(Number);
  const monthStart = `${yearMonth}-01`;
  const monthEnd = toDateStr(new Date(Date.UTC(year, month, 0)));
  const statusOrder = new Map([
    ["กำลังดำเนินการ", 0],
    ["วางแผน", 1],
    ["เสร็จสิ้น", 2]
  ]);

  return (rows || []).filter(project => {
    if (project.status === "ยกเลิก" || !project.start_date) return false;
    const endDate = project.end_date || project.start_date;
    return project.start_date <= monthEnd && endDate >= monthStart;
  }).sort((a, b) =>
    (statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99) ||
    String(a.start_date).localeCompare(String(b.start_date)) ||
    String(a.name || "").localeCompare(String(b.name || ""), "th")
  );
}

// เรียก Jibble สดผ่าน Edge Function scope "today"
// basic: server คืนเฉพาะ checkedIn/total เท่านั้น · full: นับด้วย computeDayStatus() ตัวเดิม
export async function loadTodayStaffSummary() {
  const today = toDateStr(bangkokNow());
  const [result, scheduleRes, holidayRes, settings] = await Promise.all([
    syncJibble("today"),
    sb.from("work_schedule").select("*"),
    sb.from("work_holidays").select("*").eq("holiday_date", today),
    getHrSettings()
  ]);

  if (result?.isHoliday) {
    return { isHoliday: true, mode: result.mode || null, fetchedAt: result.fetchedAt || null };
  }
  if (result?.mode === "basic") {
    return {
      isHoliday: false,
      mode: "basic",
      total: Number(result.total) || 0,
      checkedIn: Number(result.checkedIn) || 0,
      fetchedAt: result.fetchedAt || null
    };
  }
  if (result?.mode !== "full" || !Array.isArray(result.rows)) {
    throw new Error("ข้อมูลครูมาวันนี้มีรูปแบบไม่ถูกต้อง");
  }
  if (scheduleRes.error) throw new Error("โหลดตารางงานไม่สำเร็จ: " + scheduleRes.error.message);
  if (holidayRes.error) throw new Error("โหลดวันหยุดไม่สำเร็จ: " + holidayRes.error.message);

  const schedule = new Map((scheduleRes.data || []).map(row => [row.weekday, row]));
  const attendance = new Map();
  const leaves = [];
  const latePermissions = [];
  const staffRows = result.rows.map((row, index) => {
    const id = `anonymous-${index}`;
    if (row.first_in_local) {
      attendance.set(id + "|" + today, {
        staff_id: id,
        work_date: today,
        first_in_local: row.first_in_local,
        auto_out: row.auto_out === true
      });
    }
    if (row.on_leave) {
      leaves.push({
        staff_id: id,
        start_date: today,
        end_date: today,
        day_portion: row.leave_portion || "full",
        leave_type: "ลา"
      });
    }
    if (row.permit_until) {
      latePermissions.push({
        staff_id: id,
        permit_date: today,
        until_time: row.permit_until
      });
    }
    return {
      id,
      exempt: row.exempt === true,
      allowed_late_time: row.allowed_late_time || null,
      is_active: true
    };
  });
  const ctx = {
    staff: staffRows,
    attendance,
    holidays: new Set((holidayRes.data || []).map(row => row.holiday_date)),
    schedule,
    leaves,
    latePermissions,
    settings
  };
  const counts = { present: 0, late: 0, leave: 0, absent: 0, pending: 0 };
  const statuses = staffRows.map(staff => computeDayStatus(staff, today, ctx));
  for (const row of statuses) {
    if (Object.hasOwn(counts, row.status)) counts[row.status] += 1;
  }
  const isHoliday = statuses.length > 0 && statuses.every(row => row.status === "holiday");

  return {
    isHoliday,
    mode: "full",
    total: staffRows.length,
    ...counts,
    fetchedAt: result.fetchedAt || null
  };
}

export async function listStaffPicker() {
  const { data, error } = await sb.rpc("staff_picker");
  if (error) throw new Error("โหลดรายชื่อผู้รับผิดชอบไม่สำเร็จ: " + error.message);
  return data || [];
}

// ============================================================
// ตรรกะเวลาทำงานของฝ่ายบุคคล — "แก้ที่นี่ที่เดียว"
// ------------------------------------------------------------
// ทุกหน้า (work-summary / my-work / index ของฝ่ายบุคคล) ต้องเรียกฟังก์ชันชุดนี้
// ห้ามคัดลอกตรรกะไปเขียนซ้ำในหน้าใดหน้าหนึ่ง — กันบัคแบบ "แก้ที่หนึ่งลืมอีกที่"
// (บทเรียนเดียวกับตอนย้ายสูตร มส./ร./เกรด มารวมไว้ที่ไฟล์นี้)
//
// ลำดับการตัดสินสถานะของ (คน × วัน) — ยืนยันกับผู้ใช้แล้ว:
//   1. ไม่ใช่วันทำงาน (ตารางงาน) หรือเป็นวันหยุด  → 'holiday'  ไม่นับอะไรเลย
//   2. วันในอนาคต                               → 'pending'  ยังไม่ถึงวันทำงาน
//   3. คนอนุโลม (exempt)                        → 'present'  ถือว่ามาเสมอ
//   4. มีใบลาครอบวันนั้น                         → 'leave'    (เต็มวัน 1.0 / ครึ่งวัน 0.5)
//   5. มีเวลาเข้า  → เทียบ cutoff → 'present' หรือ 'late'
//   6. วันนี้ที่ยังไม่ถึงเวลาปิดวัน (18:00)        → 'pending'  ยังไม่ครบวัน ห้ามนับว่าขาด
//   7. ไม่มีเวลาเข้าเลยหลังปิดวัน                 → 'absent'
//
//   normalCutoff = staff.allowed_late_time (ถ้ามี)  มิฉะนั้น  ตารางงาน.start_time + late_grace_minutes
//   cutoff = max(normalCutoff, เวลาในใบขออนุญาตเข้าสายรายวัน)
// ============================================================

export const WORK_STATUS_LABEL = {
  holiday: "วันหยุด", pending: "ยังไม่ครบวัน", present: "มา",
  late: "สาย", leave: "ลา", absent: "ขาด"
};

// อ่านค่าตั้งงานบุคคลทั้งหมดเป็น object เดียว
export async function getHrSettings() {
  const { data } = await sb.from("hr_settings").select("key,value");
  const map = {};
  (data || []).forEach(r => { map[r.key] = r.value; });
  return {
    lateGraceMinutes: Number(map.late_grace_minutes ?? 5),
    dayFinalTime: map.day_final_time || "18:00"
  };
}

// ---------- ตัวช่วยเรื่องวันที่ (คิดตามเวลาไทยเสมอ) ----------
const TH_OFFSET_MIN = 7 * 60;
export function bangkokNow() {
  return new Date(Date.now() + TH_OFFSET_MIN * 60_000);
}
export function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}
export function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}
// ไล่วันจาก from ถึง to (รวมปลายทั้งสองข้าง)
export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}
// 1=จันทร์ ... 7=อาทิตย์ (ตรงกับ work_schedule.weekday)
export function isoWeekday(dateStr) {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();  // 0=อาทิตย์
  return wd === 0 ? 7 : wd;
}
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

// ---------- โหลดข้อมูลที่ต้องใช้คำนวณทั้งช่วง ----------
export async function loadWorkContext(from, to) {
  const [staffRes, attRes, holRes, schedRes, leaveRes, permitRes, settings] = await Promise.all([
    sb.from("staff").select("*").order("full_name"),
    sb.from("work_attendance").select("*").gte("work_date", from).lte("work_date", to),
    sb.from("work_holidays").select("*").gte("holiday_date", from).lte("holiday_date", to),
    sb.from("work_schedule").select("*"),
    // ใบลาที่ "คาบเกี่ยว" ช่วงนี้ (เริ่มก่อนช่วงแต่ยังไม่จบ ก็ต้องเอามาด้วย)
    sb.from("staff_leaves").select("*").lte("start_date", to).gte("end_date", from),
    sb.from("late_permissions").select("*").gte("permit_date", from).lte("permit_date", to),
    getHrSettings()
  ]);

  const attendance = new Map();
  (attRes.data || []).forEach(r => attendance.set(r.staff_id + "|" + r.work_date, r));

  const schedule = new Map();
  (schedRes.data || []).forEach(r => schedule.set(r.weekday, r));

  return {
    staff: staffRes.data || [],
    attendance,
    holidays: new Set((holRes.data || []).map(r => r.holiday_date)),
    schedule,
    leaves: leaveRes.data || [],
    latePermissions: permitRes.data || [],
    settings
  };
}

// ---------- ตัดสินสถานะของคนหนึ่งในวันหนึ่ง ----------
export function computeDayStatus(staff, dateStr, ctx) {
  const sched = ctx.schedule.get(isoWeekday(dateStr));

  // 1) ไม่ใช่วันทำงาน หรือเป็นวันหยุดที่โรงเรียนประกาศ
  if (!sched || !sched.is_working_day || ctx.holidays.has(dateStr)) {
    return { status: "holiday", weight: 0 };
  }

  // 2) วันในอนาคตยังสรุปไม่ได้
  const now = bangkokNow();
  const today = toDateStr(now);
  if (dateStr > today) return { status: "pending", weight: 0 };

  // 3) คนที่ได้รับการอนุโลม ไม่ต้องลงเวลา ถือว่ามาทุกวันทำงาน
  if (staff.exempt) return { status: "present", weight: 1, exempt: true };

  // 4) ใบลา — ครึ่งวันนับ 0.5 (โครงสร้างบังคับให้ครึ่งวันเป็นวันเดียวอยู่แล้ว)
  const leave = ctx.leaves.find(l =>
    l.staff_id === staff.id && l.start_date <= dateStr && dateStr <= l.end_date);
  if (leave) {
    return {
      status: "leave", weight: leave.day_portion === "full" ? 1 : 0.5,
      leaveType: leave.leave_type, portion: leave.day_portion, reason: leave.reason
    };
  }

  // 5) มีเวลาเข้า → เทียบกับเวลาที่อนุญาต (วันนี้แสดงผลที่รู้แล้วได้ทันที ไม่ต้องรอปิดวัน)
  const rec = ctx.attendance.get(staff.id + "|" + dateStr);
  if (rec && rec.first_in_local) {
    const normalCutoff = staff.allowed_late_time
      ? timeToMinutes(staff.allowed_late_time)
      : timeToMinutes(sched.start_time) + ctx.settings.lateGraceMinutes;
    const permit = (ctx.latePermissions || []).find(p =>
      p.staff_id === staff.id && p.permit_date === dateStr);
    const permitUntil = permit ? timeToMinutes(permit.until_time) : null;
    const cutoff = permitUntil === null
      ? normalCutoff
      : Math.max(normalCutoff, permitUntil);
    const arrived = timeToMinutes(rec.first_in_local);
    const isLate = arrived > cutoff;
    return {
      status: isLate ? "late" : "present", weight: 1,
      firstIn: rec.first_in_local, autoOut: rec.auto_out,
      lateMinutes: isLate ? arrived - cutoff : 0,
      latePermissionUsed: !isLate && permitUntil !== null && arrived > normalCutoff
    };
  }

  // 6) วันนี้ยังไม่ปิดวันและยังไม่มีเวลาเข้า — รอก่อน ห้ามตัดสินว่าขาด
  if (dateStr === today) {
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (nowMin < timeToMinutes(ctx.settings.dayFinalTime)) {
      return { status: "pending", weight: 0 };
    }
  }

  // 7) ไม่มีร่องรอยการลงเวลาเลยหลังปิดวัน
  return { status: "absent", weight: 1 };
}

// ---------- สรุปของคนหนึ่งตลอดช่วง ----------
export function summarizeStaff(staff, from, to, ctx) {
  const days = eachDate(from, to);
  const sum = {
    staff, workDays: 0, present: 0, late: 0, lateMinutes: 0, absent: 0,
    leaveDays: 0, leaveByType: {}, pendingDays: 0,
    permitRequested: (ctx.latePermissions || []).filter(p =>
      p.staff_id === staff.id && from <= p.permit_date && p.permit_date <= to).length,
    permitUsed: 0, rows: []
  };
  for (const d of days) {
    const r = computeDayStatus(staff, d, ctx);
    sum.rows.push({ date: d, ...r });
    if (r.latePermissionUsed) sum.permitUsed++;
    if (r.status === "holiday") continue;
    if (r.status === "pending") { sum.pendingDays++; continue; }

    sum.workDays++;
    if (r.status === "present") sum.present++;
    else if (r.status === "late") {
      sum.late++;
      sum.lateMinutes += Number(r.lateMinutes) || 0;
      sum.present++;   // สายก็ถือว่ามาทำงาน
    }
    else if (r.status === "absent") sum.absent++;
    else if (r.status === "leave") {
      sum.leaveDays += r.weight;
      sum.leaveByType[r.leaveType] = (sum.leaveByType[r.leaveType] || 0) + r.weight;
      // ลาครึ่งวัน = มาอีกครึ่งวัน จึงนับเป็นมาด้วยครึ่งหนึ่ง
      if (r.weight === 0.5) sum.present += 0.5;
    }
  }
  return sum;
}

// สรุปทุกคน (ใช้ที่หน้าสรุปเวลาทำงานของผู้บริหาร)
export function summarizeAll(from, to, ctx, { activeOnly = true } = {}) {
  return ctx.staff
    .filter(s => !activeOnly || s.is_active)
    .map(s => summarizeStaff(s, from, to, ctx));
}

// ---------- ปีการศึกษา ----------
// รอบปี = [วันเริ่มปีนี้, วันเริ่มปีถัดไป) → เดือนเมษายนตกอยู่ในปีก่อนหน้าอัตโนมัติ
// ทำให้ทุกวันในปฏิทินมีปีการศึกษาสังกัดเสมอ ไม่มีวันไหนตกหล่น
export async function getAcademicYears() {
  const { data } = await sb.from("academic_years").select("*").order("year");
  return data || [];
}
export function academicYearRange(year, years) {
  const list = [...years].sort((a, b) => a.year.localeCompare(b.year));
  const idx = list.findIndex(y => y.year === year);
  if (idx < 0) return null;
  const start = list[idx].start_date;
  const next = list[idx + 1];
  // ไม่มีปีถัดไปในระบบ → ใช้ 1 ปีถัดจากวันเริ่ม ลบ 1 วัน
  const end = next ? addDaysStr(next.start_date, -1) : (() => {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return addDaysStr(toDateStr(d), -1);
  })();
  return { start, end };
}
// ปีการศึกษาที่วันที่นี้สังกัดอยู่
export function academicYearOf(dateStr, years) {
  const list = [...years].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const found = list.find(y => y.start_date <= dateStr);
  return found ? found.year : null;
}

// โควตาวันลาของปีการศึกษาหนึ่ง → { 'ลากิจ': 7, ... }
export async function getLeaveQuotas(year) {
  const { data } = await sb.from("leave_quotas").select("*").eq("year", year);
  const map = {};
  (data || []).forEach(r => { map[r.leave_type] = Number(r.days); });
  return map;
}
export async function getLeaveTypes() {
  const { data } = await sb.from("leave_types").select("*").eq("active", true).order("sort_order");
  return data || [];
}

// รายการตำแหน่งควบคุมกลาง — หน้าแก้ทะเบียนต้องขอรวมรายการที่ปิดใช้แล้วด้วย
// เพื่อให้ยังเห็นและถอดตำแหน่งเดิมของคนที่ถืออยู่ได้
export async function getStaffPositions(includeInactive = false) {
  let query = sb.from("staff_positions").select("*").order("sort_order").order("code");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error("โหลดรายการตำแหน่งไม่สำเร็จ");
  return data || [];
}
