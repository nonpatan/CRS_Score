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
export function applyRestrictedMenuAccess(allowed) {
  const links = document.querySelectorAll('a[data-restricted]');
  links.forEach(a => {
    if (allowed) a.removeAttribute("hidden");
    else a.remove();
  });
  if (allowed) return;
  // กลุ่มเมนูที่ไม่เหลือลิงก์แล้ว ต้องซ่อนด้วย ไม่งั้นจะเห็นหัวข้อกลุ่มลอย ๆ
  document.querySelectorAll("header .nav .nav-group").forEach(group => {
    if (!group.querySelector(".nav-group-links a")) group.remove();
  });
}

export function applyPersonnelMenuAccess(canManageHr) {
  applyRestrictedMenuAccess(canManageHr);
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

// ------------------------------------------------------------
// ปิด/เปิดการล็อกอินของบัญชีครูที่ลาออก ผ่าน Edge Function "disable-user"
// service_role key อยู่ฝั่ง server เท่านั้น — หน้าเว็บไม่เคยเห็น (repo เป็น public)
//
// การแบนเกิดที่ชั้น Auth ซึ่งอยู่ "ก่อน" RLS → ไม่ต้องแก้ policy ของตารางไหนเลย
// enabled = true  → เปิดให้ล็อกอินได้ตามปกติ
// enabled = false → ล็อกอินไม่ได้ทันที (กดคืนได้เสมอ ไม่ใช่การลบบัญชี)
// ------------------------------------------------------------
export async function setUserLoginEnabled(userId, enabled) {
  const { data, error } = await sb.functions.invoke("disable-user", {
    body: { userId, action: enabled ? "enable" : "disable" }
  });
  if (error) {
    // ข้อความจริงของ error อยู่ในเนื้อ response ไม่ใช่ error.message ("non-2xx status")
    let detail = error.message || String(error);
    try {
      const body = await error.context?.json();
      if (body?.error) detail = body.error;
    } catch { /* อ่านเนื้อไม่ได้ก็ใช้ข้อความเดิม */ }
    throw new Error(detail);
  }
  if (data && data.ok === false) throw new Error(data.error || "ทำรายการไม่สำเร็จ");
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

// ลำดับชั้นเรียน อ.1 → ม.6 (ใช้หา "ชั้นถัดไป" ตอนเลื่อนชั้น และใช้เรียงลำดับชั้นทุกหน้า)
// 🪤 ลำดับนี้ห้ามมีใครเอา index ไปแปลงความหมาย (เช่นช่วงชั้น) — ดู STAGE_BY_GRADE
export const GRADE_ORDER = ["อ.1","อ.2","อ.3","ป.1","ป.2","ป.3","ป.4","ป.5","ป.6","ม.1","ม.2","ม.3","ม.4","ม.5","ม.6"];

// ช่วงชั้นของนักเรียน ใช้เลือกองค์ประกอบสมรรถนะหลักมาตรฐาน
// รองรับถึง ม.6 แต่ช่วงชั้น 4 จะยังไม่มีองค์ประกอบจนกว่าจะได้เอกสาร สพฐ. ตัวจริง
// ผูกกับ "ชื่อชั้น" ตรง ๆ ห้ามกลับไปใช้ index ของ GRADE_ORDER อีก
// เหตุผล: GRADE_ORDER ขยายหัวแถวได้ (เพิ่ม อ.1–อ.3 เมื่อ 2026-08-20) การอิง index
// ทำให้ช่วงชั้นของทั้งโรงเรียนเลื่อนตามแบบเงียบ ๆ — พลาดแล้วคะแนนสมรรถนะผิดชั้นทั้งระบบ
const STAGE_BY_GRADE = {
  "ป.1":"ช่วงชั้น 1", "ป.2":"ช่วงชั้น 1", "ป.3":"ช่วงชั้น 1",
  "ป.4":"ช่วงชั้น 2", "ป.5":"ช่วงชั้น 2", "ป.6":"ช่วงชั้น 2",
  "ม.1":"ช่วงชั้น 3", "ม.2":"ช่วงชั้น 3", "ม.3":"ช่วงชั้น 3",
  "ม.4":"ช่วงชั้น 4", "ม.5":"ช่วงชั้น 4", "ม.6":"ช่วงชั้น 4"
};
export function competencyStageForGrade(grade) {
  return STAGE_BY_GRADE[grade] || "";
}

// ช่วงชั้นที่โรงเรียนเปิดสอนจริง — คำนวณจาก highest_grade ไม่ใช้รายการตายตัวในแต่ละหน้า
// ถ้ายังไม่ได้ตั้งค่า/ค่าไม่รู้จัก ให้คืนครบทุกช่วงชั้นเหมือน isGradeAllowed() เพื่อไม่ล็อกข้อมูลออก
export function availableCompetencyStages(highestGrade) {
  const stages = ["ช่วงชั้น 1", "ช่วงชั้น 2", "ช่วงชั้น 3", "ช่วงชั้น 4"];
  const highestStage = competencyStageForGrade(highestGrade);
  const lastIndex = stages.indexOf(highestStage);
  return lastIndex === -1 ? stages : stages.slice(0, lastIndex + 1);
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
  // เก็บว่าค้างที่วิชาไหนบ้าง — เกณฑ์ความครบเข้มโดยตั้งใจ (ผู้ใช้เลือกทางเลือก A)
  // แต่ถ้าไม่บอกว่าค้างที่ไหน ฝ่ายวิชาการจะตามครูไม่ถูก ทั้งโรงเรียนค้างโดยหาต้นตอไม่เจอ
  const bySubject = new Map();
  const subjectStat = subjectId => {
    if (!bySubject.has(subjectId)) bySubject.set(subjectId, { subjectId, expected: 0, scored: 0, structureIncomplete: false });
    return bySubject.get(subjectId);
  };

  for (const unit of units) {
    const stat = subjectStat(unit.subject_id);
    const indicators = unit.indicators || [];
    if (!indicators.length) { structureComplete = false; stat.structureIncomplete = true; }
    let unitRaw = 0, unitCap = 0;
    for (const indicator of indicators) {
      const collections = indicator.collections || [];
      if (!collections.length) { structureComplete = false; stat.structureIncomplete = true; }
      let indicatorRaw = 0, indicatorCap = 0;
      for (const collection of collections) {
        expectedCount++;
        stat.expected++;
        indicatorCap += Number(collection.max_score) || 0;
        if (scoreByCollection.has(collection.id)) {
          scoredCount++;
          stat.scored++;
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
    scoredCount,
    // เฉพาะวิชาที่ยังไม่ครบ — ผู้เรียกเอา subjectId ไปแปลงเป็นชื่อวิชาเอง
    pending: [...bySubject.values()].filter(s => s.structureIncomplete || s.scored < s.expected || s.expected === 0)
  };
}

// สรุปคะแนนจากกิจกรรมหรือกิจวัตร 1 ด้าน รายการหนึ่งแทนหนึ่งครั้งประเมินที่นักเรียนอยู่ใน snapshot
// raw_score=null แปลว่ายังไม่ได้กรอก (ต่างจาก 0 ซึ่งเป็นคะแนนจริงและถือว่ากรอกแล้ว)
//
// ⚠️ ต้อง normalize ที่ชั้น "องค์ประกอบ" ก่อนถ่วงน้ำหนัก — ห้ามบวกคะแนนดิบรวมทั้งด้านแล้วหาร
// (สูตรเดิมทำแบบนั้นจนถึง 2026-08) เพราะ**จำนวนครั้งที่ประเมินจะรั่วไปเป็นน้ำหนัก**:
//   องค์ประกอบ A เต็ม 10 ประเมิน 5 ครั้งได้เต็ม · B เต็ม 10 ประเมินครั้งเดียวได้ 0
//   → สูตรเดิม 50/60 = 83.3 ("เหนือความคาดหวัง") · ที่ถูกคือ 50.0 ("เริ่มต้น") ต่างกัน 2 ระดับ
// จัดกลุ่มด้วย element_id ไม่ใช่ target_id — target มี 1 แถวต่อ (กิจกรรม × องค์ประกอบ) แต่หน้าสรุป
// รวมทุกกิจกรรมในปีเข้าด้วยกัน ถ้าใช้ target_id องค์ประกอบที่ถูกเลือกไว้ใน 3 กิจกรรมจะได้น้ำหนัก
// 10+10+10 = 30 ทั้งที่ครูตั้งไว้ 10 (ผู้ใช้เคาะ 2026-08-07: ครูตั้ง 10 ต้องได้ 10 เสมอ)
export function computeAssessmentCompetencySource(competencyId, expectedItems) {
  const items = (expectedItems || []).filter(i => i.competency_id === competencyId);
  const scored = items.filter(i => i.raw_score !== null && i.raw_score !== undefined);

  const groups = new Map();
  for (const item of items) {
    const key = item.element_id ?? item.competency_id;  // ไม่มี element_id = ข้อมูลรุ่นเก่า ถอยไปพฤติกรรมเดิม
    if (!groups.has(key)) groups.set(key, { raw: 0, cap: 0, weights: [] });
    const group = groups.get(key);
    group.cap += Number(item.max_score) || 0;
    if (item.raw_score !== null && item.raw_score !== undefined) group.raw += Number(item.raw_score);
    // เก็บน้ำหนักที่แต่ละกิจกรรมตั้งไว้ แล้วเฉลี่ยตอนท้าย — ห้ามบวกสะสม ไม่งั้นบั๊กเดิมกลับมา
    group.weights.push(Number(item.element_weight ?? item.max_score) || 0);
  }

  let weightedSum = 0, weightSum = 0;
  for (const group of groups.values()) {
    const weight = group.weights.reduce((sum, w) => sum + w, 0) / group.weights.length;
    if (group.cap <= 0 || weight <= 0) continue;
    weightedSum += (group.raw / group.cap) * weight;
    weightSum += weight;
  }

  // ค้างที่กิจกรรม/กิจวัตรรายการไหน — จัดกลุ่มตามชื่อรายการเพื่อให้ครูตามได้ถูกตัว
  const byAssessment = new Map();
  for (const item of items) {
    const label = item.assessment_name || "ไม่ระบุชื่อรายการ";
    if (!byAssessment.has(label)) byAssessment.set(label, { label, expected: 0, scored: 0 });
    const stat = byAssessment.get(label);
    stat.expected++;
    if (item.raw_score !== null && item.raw_score !== undefined) stat.scored++;
  }

  const complete = items.length > 0 && scored.length === items.length && weightSum > 0;
  return {
    complete,
    percent: complete ? (weightedSum / weightSum) * 100 : null,
    expectedCount: items.length,   // ยังนับเป็น "ครั้ง" เหมือนเดิม — หน้าจอใช้โชว์ "กรอกแล้ว n/m"
    scoredCount: scored.length,
    pending: [...byAssessment.values()].filter(stat => stat.scored < stat.expected)
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
  // จับคู่ด้วยขอบล่างอย่างเดียว เรียงจากระดับสูงสุด แล้วเอาช่วงแรกที่คะแนนถึง
  // กันคะแนนทศนิยมตกร่องระหว่างช่วงจำนวนเต็ม; max_score เก็บไว้แสดงช่วงให้ครูอ่านเท่านั้น
  const orderedLevels = (levels || []).slice()
    .sort((a, b) => Number(b.min_score) - Number(a.min_score));
  const level = orderedLevels.find(item => score >= Number(item.min_score));
  return {
    complete: true,
    score,
    level: level ? level.label : null,
    reason: level ? "" : "คะแนนไม่อยู่ในช่วงเกณฑ์แปลผลที่กำหนด"
  };
}

// โหลดค่าตั้งสมรรถนะของปีเดียว — ไม่มี fallback ข้ามปีโดยตั้งใจ
// คืนค่าดิบให้หน้าเว็บตรวจความครบและบอกชื่อปี/ด้านที่ยังไม่ได้ตั้งเอง
export async function loadCompetencySettings(year) {
  const normalizedYear = String(year == null ? "" : year).trim();
  if (!normalizedYear) throw new Error("กรุณาเลือกปีการศึกษาก่อนโหลดค่าตั้งสมรรถนะ");
  const [weightResult, levelResult] = await Promise.all([
    sb.from("competency_source_weights").select("*").eq("year", normalizedYear),
    sb.from("competency_interpretation_levels").select("*").eq("year", normalizedYear).order("seq")
  ]);
  if (weightResult.error || levelResult.error) {
    throw new Error(
      "โหลดค่าตั้งสมรรถนะปีการศึกษา " + normalizedYear + " ไม่สำเร็จ: " +
      (weightResult.error || levelResult.error).message
    );
  }
  return { weights: weightResult.data || [], levels: levelResult.data || [] };
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

// รูปแบบจำนวนเงินกลาง — หน้าการเงินใช้ทศนิยม 2 ตำแหน่งตามค่าเริ่มต้น
// จุดที่ต้องการแบบกระชับ (เช่นงบประมาณบน dashboard) ส่ง minimumFractionDigits:0 ได้
export function formatMoney(value, {
  minimumFractionDigits = 2,
  maximumFractionDigits = 2
} = {}) {
  const amount = Number(value);
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(Number.isFinite(amount) ? amount : 0) + " บาท";
}

// ---------- ออมทรัพย์นักเรียน ----------
// ยอดคงเหลือ = ยอดยกมา + ฝาก − ถอน − หักค่ารถ
// รับ txns ทั้งก้อนของนักเรียนคนหนึ่ง (หรือทั้งห้องแล้วกรองเอง)
export function computeSavingsBalance(txns) {
  return (Array.isArray(txns) ? txns : []).reduce((balance, txn) => {
    const amount = Number(txn?.amount);
    if (!Number.isFinite(amount)) return balance;
    if (txn.kind === "ยอดยกมา" || txn.kind === "ฝาก") return balance + amount;
    if (txn.kind === "ถอน" || txn.kind === "หักค่ารถ") return balance - amount;
    return balance;
  }, 0);
}

// จัดกลุ่มยอดคงเหลือทั้งห้อง → Map(student_id -> ยอด) เรียกครั้งเดียวไม่ต้องวน query รายคน
export function summarizeSavingsByStudent(txns) {
  const grouped = new Map();
  for (const txn of (Array.isArray(txns) ? txns : [])) {
    if (!txn?.student_id) continue;
    if (!grouped.has(txn.student_id)) grouped.set(txn.student_id, []);
    grouped.get(txn.student_id).push(txn);
  }
  return new Map([...grouped].map(([studentId, rows]) => [studentId, computeSavingsBalance(rows)]));
}

// ---------- ค่ารถรับส่ง ----------
// ต้องแก้พร้อมชุดสถานะใน transport_payments_guard() ที่ schema.sql หากกติกาเปลี่ยน
export const TRANSPORT_CHARGE_STATUSES = ["มา", "มาสาย"];

function transportMonthStart(dateStr) {
  return String(dateStr || "").slice(0, 7) + "-01";
}

function nextTransportMonth(ym) {
  const date = new Date(ym + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + 1);
  return toDateStr(date).slice(0, 7) + "-01";
}

function transportRateKey(year, ym, zoneId, tripMode) {
  return [year, ym, zoneId, tripMode].join("\u0000");
}

// คำนวณยอดจากช่วงใช้รถ + เช็คชื่อ + override + ยอดเดือนที่ประกาศ โดยไม่แตะ DOM/ฐานข้อมูล
// monthRates ต้องมี year เสมอ เพราะเดือน พ.ค. เดียวกันอยู่ได้ใน 2 ปีการศึกษา
export function computeTransportCharges({
  periods = [], attendance = [], overrides = [], monthRates = [], from, to
} = {}) {
  if (!from || !to || from > to) {
    return { days:[], months:[], total:0, missingAttendanceDates:[], unannouncedMonths:[] };
  }

  const attendanceByDate = new Map(
    (attendance || []).map(row => [row.attend_date || row.date, row.status])
  );
  const overrideByDate = new Map(
    (overrides || []).map(row => [row.charge_date || row.date, row])
  );
  const rateByKey = new Map((monthRates || []).map(row => [
    transportRateKey(row.year, row.ym, row.zone_id, row.trip_mode), row
  ]));
  const missing = new Set();
  const unannounced = new Set();
  const days = [];
  const months = [];

  for (const period of (periods || [])) {
    const start = [period.start_date, from].sort().at(-1);
    const periodEnd = period.end_date || to;
    const end = [periodEnd, to].sort()[0];
    if (!start || start > end) continue;

    if (period.billing_mode === "รายวัน") {
      for (const date of eachDate(start, end)) {
        const override = overrideByDate.get(date);
        const status = attendanceByDate.get(date) ?? null;
        if (override) {
          days.push({ date, amount:Number(override.amount) || 0, source:"override", status });
          continue;
        }
        if (!attendanceByDate.has(date) && isoWeekday(date) <= 5) missing.add(date);
        days.push({
          date,
          amount:TRANSPORT_CHARGE_STATUSES.includes(status) ? (Number(period.rate_amount) || 0) : 0,
          source:"auto",
          status
        });
      }
      continue;
    }

    if (period.billing_mode !== "รายเดือน") continue;
    for (let ym = transportMonthStart(start); ym <= transportMonthStart(end); ym = nextTransportMonth(ym)) {
      const anchor = period.start_date > ym ? period.start_date : ym;
      const override = overrideByDate.get(anchor);
      if (override) {
        months.push({ ym, amount:Number(override.amount) || 0, announced:true, source:"override" });
        continue;
      }
      const rate = rateByKey.get(transportRateKey(period.year, ym, period.zone_id, period.trip_mode));
      if (!rate) {
        months.push({ ym, amount:0, announced:false, source:"month_rate" });
        unannounced.add(ym);
        continue;
      }
      months.push({ ym, amount:Number(rate.amount) || 0, announced:true, source:"month_rate" });
    }
  }

  const total = [...days, ...months].reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    days,
    months,
    total,
    missingAttendanceDates:[...missing].sort(),
    unannouncedMonths:[...unannounced].sort()
  };
}

export function computeTransportOutstanding(charges, payments) {
  const paid = (Array.isArray(payments) ? payments : []).reduce((sum, payment) => {
    const amount = Number(payment?.amount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  return (Number(charges?.total) || 0) - paid;
}

// ยอดที่เบิกได้จริง = ยอดคงเหลือ − คำขอที่ยังรอจ่าย
// รับรายการของนักเรียนคนเดียว; คำขอที่จ่ายแล้ว/ยกเลิกไม่กันยอดไว้
export function computeAvailableToWithdraw(txns, pendingRequests) {
  const pending = (Array.isArray(pendingRequests) ? pendingRequests : []).reduce((total, request) => {
    if (request?.status !== "รอจ่าย") return total;
    const amount = Number(request.amount);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
  return computeSavingsBalance(txns) - pending;
}

// ยอดค้างส่ง = เฉพาะเงินฝากที่ยังไม่ถูกผูกกับรอบส่งเงิน
// รายการถอน/ยอดยกมาไม่เกี่ยว เพราะฝ่ายการเงินเป็นผู้จ่ายเงินถอนเอง
export function computeUnremitted(txns) {
  return (Array.isArray(txns) ? txns : []).reduce((total, txn) => {
    if (txn?.kind !== "ฝาก" || txn.remittance_id != null) return total;
    const amount = Number(txn.amount);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
}

// สรุปรายงานออมทรัพย์: รายรับ/ถอนอิงช่วงวันที่ แต่ยอดคงเหลือและค้างส่งเป็นยอดสะสมตลอดกาล
export function summarizeSavingsReport(txns, { from, to } = {}) {
  const rows = Array.isArray(txns) ? txns : [];
  const inRange = txn => (!from || txn?.txn_date >= from) && (!to || txn?.txn_date <= to);
  let collectedInRange = 0;
  let withdrawnInRange = 0;

  for (const txn of rows) {
    const amount = Number(txn?.amount);
    if (!Number.isFinite(amount) || !inRange(txn)) continue;
    if (txn.kind === "ฝาก") collectedInRange += amount;
    if (txn.kind === "ถอน") withdrawnInRange += amount;
  }

  return {
    collectedInRange,
    withdrawnInRange,
    balanceLifetime: computeSavingsBalance(rows),
    unremitted: computeUnremitted(rows)
  };
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

// ---------- เกณฑ์ มส. — ประกาศที่เดียวเท่านั้น ห้ามพิมพ์ตัวเลขซ้ำที่อื่นอีก ----------
// เคยพิมพ์ซ้ำหลายจุดแล้วเกณฑ์เพี้ยนจนเด็กที่ต้องเรียนซ้ำหายจากหน้าเฝ้าระวัง (แก้ 2026-08)
export const MS_RETAKE_RATIO = 0.40;          // ขาดดิบเกินนี้ = เรียนซ้ำรายวิชา ชดเชยช่วยไม่ได้
export const MS_MAKEUP_RATIO = 0.20;          // ขาดสุทธิเกินนี้ = ต้องเรียนเพิ่มให้ครบเวลา
export const MS_WARN_PERCENT_SECONDARY = 10;  // มัธยม: ขาดสุทธิถึงเท่านี้ = ขึ้นหน้าเฝ้าระวัง
export const MS_WARN_PERCENT_PRIMARY = 5;     // ประถม: เตือนเร็วกว่าเพราะคาบทั้งปีมากกว่า

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
    // ครอบ Number() เสมอ — periods_covered เป็น numeric(4,1) ตั้งแต่ 2026-08-04 (รองรับครึ่งคาบ)
    // ถ้า client ได้ค่ามาเป็นสตริงเมื่อไหร่ การบวกดิบจะกลายเป็นต่อสตริง ("2" + "2.5" = "22.5")
    // แล้วคาบขาดจะพุ่งมั่วจนกระทบ มส. ของเด็กจริง
    const p = Number(sess.periods_covered) || 0;
    if (rec.status === "ขาด") missed += p;
    else if (rec.status === "ลาป่วย" || rec.status === "ลากิจ") missed += p * 0.5;
    // 'มา'/'มาสาย' ไม่นับ (ไม่ขาด)
  }
  return missed;
}

// คำนวณสถานะเฝ้าระวัง มส. จากวิชาพื้นฐาน 1 ตัว หรือหลายตัวที่ประกอบเป็นวิชาบูรณาการ
// ใช้ร่วมกันทั้ง dashboard.html, warning.html และ summary.html เพื่อให้เกณฑ์ไม่แยกกันหลายหน้า
// subjectDataList ใช้รูปเดียวกับผลจาก loadSubjectData(): [{ subject, sessions, makeupHours }, ...]
// เกณฑ์เตือนรับจากผู้เรียกเพราะประถม/มัธยมเตือนคนละจุด แต่เกณฑ์ มส. ใช้ค่ากลางชุดเดียวกันเสมอ
export function computeAttendanceRisk(studentId, subjectDataList, options = {}) {
  const warnPercent = Number(options.warnPercent ?? MS_WARN_PERCENT_SECONDARY);
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
  const has = totalBase > 0;
  const percent = has ? (netMissed / totalBase) * 100 : 0;
  const rawPercent = has ? (rawMissed / totalBase) * 100 : 0;
  // เรียนซ้ำต้องดูยอดขาดดิบให้ตรงกับ computeSubjectResult — ชดเชยไม่ลดระดับนี้
  const retake = has && rawMissed > totalBase * MS_RETAKE_RATIO;
  const critical = has && (retake || netMissed > totalBase * MS_MAKEUP_RATIO);
  return {
    totalBase,
    rawMissed,
    makeupTotal,
    netMissed,
    percent,
    rawPercent,
    retake,
    critical,
    risky: has && (critical || percent >= warnPercent),
    level: !has ? null : retake ? "retake" : critical ? "critical"
      : (percent >= warnPercent ? "warn" : null)
  };
}

// โหลดข้อมูลเต็มของวิชา 1 ตัว (โครงสร้างคะแนน + ร. + เช็คชื่อ + ชั่วโมงชดเชย) — ใช้ได้ทั้งวิชาพื้นฐานเดี่ยว
// และวิชาพื้นฐานที่เป็นสมาชิกของวิชาบูรณาการ
export async function loadGradeWeights() {
  const { data, error } = await sb.from("grade_weights")
    .select("year, level, collect_weight, exam_weight, updated_at")
    .order("year")
    .order("level");
  if (error) throw new Error("โหลดอัตราส่วนคะแนนไม่สำเร็จ: " + error.message);
  return data || [];
}

function gradeWeightFor(subj, gradeWeights) {
  const weight = (gradeWeights || []).find(row => row.year === subj.year && row.level === subj.level);
  if (!weight) throw new Error(
    "ยังไม่ได้ตั้งอัตราส่วนคะแนนของปีการศึกษา " + (subj.year || "(ไม่ระบุ)") +
    " ระดับ" + (subj.level || "(ไม่ระบุ)") + " — ให้ admin หรือฝ่ายวิชาการตั้งที่หน้า “จัดการโครงสร้าง” ก่อน"
  );
  return weight;
}

export async function loadSubjectData(subjectId, sharedGradeWeights = null) {
  const weightsPromise = sharedGradeWeights
    ? Promise.resolve({ data: sharedGradeWeights, error: null })
    : sb.from("grade_weights")
      .select("year, level, collect_weight, exam_weight, updated_at")
      .order("year")
      .order("level");
  const [subjectResult, unitResult, remarkResult, sessionResult, makeupResult, examResult, weightsResult] = await Promise.all([
    sb.from("subjects").select("*").eq("id", subjectId).single(),
    sb.from("units")
      .select("*, indicators(*, collections(*, scores(student_id, raw_score)))")
      .eq("subject_id", subjectId)
      .order("seq"),
    sb.from("remarks").select("*").eq("subject_id", subjectId),
    sb.from("attendance_sessions")
      .select("*, attendance_records(*)")
      .eq("subject_id", subjectId),
    sb.from("makeup_hours").select("*").eq("subject_id", subjectId),
    sb.from("exam_scores").select("id, subject_id, student_id, raw_score, updated_at").eq("subject_id", subjectId),
    weightsPromise
  ]);
  const namedResults = [
    ["รายวิชา", subjectResult],
    ["โครงสร้างคะแนน", unitResult],
    ["สถานะ ร.", remarkResult],
    ["การเข้าเรียน", sessionResult],
    ["ชั่วโมงชดเชย", makeupResult],
    ["คะแนนสอบ", examResult],
    ["อัตราส่วนคะแนน", weightsResult]
  ];
  const failed = namedResults.find(([, result]) => result.error);
  if (failed) throw new Error("โหลด" + failed[0] + "ไม่สำเร็จ: " + failed[1].error.message);
  const gradeWeights = weightsResult.data || [];
  return {
    subject: subjectResult.data,
    units: unitResult.data || [],
    remarksData: remarkResult.data || [],
    sessions: sessionResult.data || [],
    makeupHours: makeupResult.data || [],
    examScores: examResult.data || [],
    gradeWeight: gradeWeightFor(subjectResult.data, gradeWeights)
  };
}

// ---------- คำนวณคะแนนของนักเรียน 1 คน ในวิชา 1 ตัว จากข้อมูลที่โหลดไว้แล้ว ----------
// สูตรบัญญัติไตรยางศ์ไล่ล่างขึ้นบน ตามที่กำหนดใน CLAUDE.md (ไม่เก็บค่าที่เทียบแล้วลง database)
// รับพารามิเตอร์แยกจาก state กลาง เพื่อให้เรียกซ้ำได้ทั้งวิชาพื้นฐานเดี่ยว และวิชาพื้นฐาน
// แต่ละตัวที่เป็นสมาชิกของวิชาบูรณาการ
// skipMs = true เมื่อวิชานี้เป็นสมาชิกของวิชาบูรณาการ — มส. ของวิชาย่อยไม่ตัดสินรายตัว
// แต่ไปคิด "แบบรวม" ที่ระดับวิชาบูรณาการแทน (ยืนยันกับผู้ใช้แล้ว 2026-07 ดู computeIntegratedResult)
export function computeSubjectResult(studentId, subj, unitsTree, remarksArr, sessionsArr, makeupArr, options = {}) {
  const { skipMs = false, examScores = [], gradeWeight = null } = options || {};
  if (!gradeWeight || gradeWeight.level !== subj.level || gradeWeight.year !== subj.year) {
    throw new Error(
      "ยังไม่ได้ตั้งอัตราส่วนคะแนนของปีการศึกษา " + (subj.year || "(ไม่ระบุ)") +
      " ระดับ" + (subj.level || "(ไม่ระบุ)") + " — ให้ admin หรือฝ่ายวิชาการตั้งที่หน้า “จัดการโครงสร้าง” ก่อน"
    );
  }
  const collectWeight = Number(gradeWeight.collect_weight);
  const examWeight = Number(gradeWeight.exam_weight);
  if (!Number.isFinite(collectWeight) || !Number.isFinite(examWeight) || Math.abs(collectWeight + examWeight - 100) > 0.000001) {
    throw new Error("อัตราส่วนคะแนนของระดับ “" + subj.level + "” ไม่ถูกต้อง");
  }
  const examRow = (examScores || []).find(row => row.student_id === studentId) || null;
  const examPart = examRow ? Number(examRow.raw_score) : 0;
  const examOverCap = Boolean(examRow) && examPart > examWeight + 0.000001;
  const examUsable = Boolean(examRow) && !examOverCap;
  const subjectUnits = [];
  const competencyUnits = [];
  let subjectRaw = 0, subjectCap = 0;
  // partial คิดจากเฉพาะครั้งที่กรอกแล้ว ใช้แค่แสดงระหว่างเทอม ไม่ใช่เกรดทางการ
  let subjectPartialRaw = 0, subjectPartialCap = 0;
  let expectedCount = 0, scoredCount = 0;

  for (const unit of unitsTree) {
    let unitRaw = 0, unitCap = 0;
    let unitPartialRaw = 0, unitPartialCap = 0;
    let unitExpected = 0, unitScored = 0;
    for (const ind of (unit.indicators || [])) {
      let indRaw = 0, indCap = 0, indPartialCap = 0;
      for (const coll of (ind.collections || [])) {
        const collectionMax = Number(coll.max_score) || 0;
        indCap += collectionMax;
        unitExpected++;
        const row = (coll.scores || []).find(s => s.student_id === studentId);
        if (row) {
          indRaw += Number(row.raw_score);
          indPartialCap += collectionMax;
          unitScored++;
        }
      }
      const indScaled = indCap > 0 ? (indRaw / indCap) * ind.max_score : 0;
      unitRaw += indScaled;
      unitCap += ind.max_score;
      if (indPartialCap > 0) {
        unitPartialRaw += (indRaw / indPartialCap) * ind.max_score;
        unitPartialCap += ind.max_score;
      }
    }
    const unitScaled = unitCap > 0 ? (unitRaw / unitCap) * unit.max_score : 0;
    const unitPartialScaled = unitPartialCap > 0 ? (unitPartialRaw / unitPartialCap) * unit.max_score : 0;
    if (unit.kind === "วิชา") {
      subjectUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score });
      subjectRaw += unitScaled;
      subjectCap += unit.max_score;
      if (unitPartialCap > 0) {
        subjectPartialRaw += unitPartialScaled;
        subjectPartialCap += unit.max_score;
      }
      expectedCount += unitExpected;
      scoredCount += unitScored;
    } else {
      competencyUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score });
    }
  }

  const subjectScaled = subjectCap > 0 ? (subjectRaw / subjectCap) * subj.max_score : 0;
  const collectPercent = subj.max_score > 0 ? (subjectScaled / subj.max_score) * 100 : 0;
  const collectPart = collectPercent * collectWeight / 100;
  const collectExpectedCount = expectedCount;
  const hasCollectStructure = collectExpectedCount > 0;
  expectedCount += 1;
  if (examUsable) scoredCount += 1;
  const collectPartialPercent = subjectPartialCap > 0
    ? (subjectPartialRaw / subjectPartialCap) * 100
    : null;
  let partialEarned = 0, partialCap = 0;
  if (collectPartialPercent !== null) {
    partialEarned += collectPartialPercent * collectWeight / 100;
    partialCap += collectWeight;
  }
  if (examUsable) {
    partialEarned += examPart;
    partialCap += examWeight;
  }
  const scoring = {
    expectedCount,
    scoredCount,
    collectExpectedCount,
    hasCollectStructure,
    examScored: examUsable,
    examOverCap,
    complete: hasCollectStructure && scoredCount === expectedCount,
    partialPercent: partialCap > 0 ? (partialEarned / partialCap) * 100 : null
  };

  // 1) เช็ค ร. ก่อน
  const remark = remarksArr.find(r => r.student_id === studentId && r.code === "ร.");
  if (remark) {
    return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "ร.", reason: remark.reason } };
  }

  // ร. ที่ระบบคำนวณจากการไม่มีคะแนนสอบ — เกิดหลังครูปิดคะแนนสอบเท่านั้น
  // ไม่เขียนลง remarks เพื่อให้หายเองเมื่อเปิดคะแนนหรือกรอกคะแนนย้อนหลัง
  if (subj.exam_closed_at && !examRow) {
    return {
      subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring,
      result: { type: "ร.", reason: "ไม่มีคะแนนสอบปลายภาค/ปลายปี" }
    };
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
    const maxMissedRetake = subj.total_periods * MS_RETAKE_RATIO;
    const maxMissedMakeup = subj.total_periods * MS_MAKEUP_RATIO;

    if (rawMissed > maxMissedRetake) {
      // ขาดเกินเพดานเรียนซ้ำแล้ว — ชดเชยช่วยไม่ได้แล้ว ต้องเรียนซ้ำรายวิชา (ไม่หัก makeupTotal เข้าไปเลย)
      return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "มส.", subtype: "retake", missedPeriods: rawMissed, maxMissed: maxMissedRetake } };
    }
    if (rawMissed > maxMissedMakeup) {
      const netMissed = Math.max(0, rawMissed - makeupTotal);
      if (netMissed > maxMissedMakeup) {
        return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "มส.", subtype: "makeup", missedPeriods: rawMissed, netMissed, maxMissed: maxMissedMakeup, makeupTotal } };
      }
      // ชดเชยจนขาดสุทธิไม่เกินเพดานแล้ว — หลุด มส. ไปคิดเกรดต่อ (เก็บ makeupTotal ไว้โชว์ในผลเกรด)
    }
  }

  // 3) แปลงเป็นเกรด
  const percentScore = collectPart + examPart;
  const grade = percentToGrade(percentScore);
  return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "grade", grade, percentScore, makeupTotal } };
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
  const noPeriodSubjects = [];
  let hasR = false;
  let weightedSum = 0, weightSum = 0;
  let expectedCount = 0, scoredCount = 0;
  let hasCollectStructure = memberDataList.length > 0;
  let examOverCap = false;
  let partialWeightedSum = 0, partialWeightSum = 0;
  let totalBase = 0, rawMissed = 0, makeupTotal = 0, anySessions = false;

  for (const md of memberDataList) {
    // skipMs = true: วิชาย่อยไม่ตัดสิน มส. รายตัว (คิดรวมข้างล่างแทน) — ผลรายวิชาจึงมีแค่ ร./เกรด
    const r = computeSubjectResult(studentId, md.subject, md.units, md.remarksData, md.sessions, md.makeupHours, {
      skipMs: true,
      examScores: md.examScores,
      gradeWeight: md.gradeWeight
    });
    const weight = Number(md.subject.total_periods) || 0;
    const missed = computeMissedPeriods(studentId, md.sessions || []);
    // เก็บสมรรถนะหลักของวิชาย่อยนี้ไว้ด้วย (ถ้ามี) — แสดงแยกตามวิชาที่กรอกไว้จริง ไม่ถัวเฉลี่ยรวม
    // เพราะสมรรถนะหลักมักกรอกแค่บางวิชา ถัวเฉลี่ยรวมกับวิชาที่ไม่มีข้อมูลจะทำให้คะแนนต่ำลงผิดๆ
    // missedPeriods เก็บไว้โชว์รายวิชา ให้ครูเห็นว่าเด็กขาดหนักที่วิชาย่อยไหน
    memberResults.push({ subject: md.subject, result: r.result, weight, competencyUnits: r.competencyUnits, missedPeriods: missed, scoring: r.scoring });
    expectedCount += r.scoring.expectedCount;
    scoredCount += r.scoring.scoredCount;
    if (!r.scoring.hasCollectStructure) hasCollectStructure = false;
    if (r.scoring.examOverCap) examOverCap = true;
    if (r.scoring.partialPercent !== null && weight > 0) {
      partialWeightedSum += r.scoring.partialPercent * weight;
      partialWeightSum += weight;
    }
    if (r.result.type === "ร.") hasR = true;
    else { weightedSum += r.result.percentScore * weight; weightSum += weight; }

    // ถ้าไม่มีฐานเวลา ห้ามนับคาบขาดเข้ายอดรวมฝ่ายเดียว ไม่งั้นอัตราขาดจะพุ่งและติด มส. ผิด
    // ยัง push memberResults และคิดคะแนนตามปกติ — ตัดออกเฉพาะส่วนเวลาเรียน/มส.
    if (weight <= 0) {
      noPeriodSubjects.push(md.subject.name);
      continue;
    }

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
    const maxMissedRetake = totalBase * MS_RETAKE_RATIO;
    const maxMissedMakeup = totalBase * MS_MAKEUP_RATIO;
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

  const scoring = {
    expectedCount,
    scoredCount,
    hasCollectStructure,
    examOverCap,
    complete: hasCollectStructure && expectedCount > 0 && scoredCount === expectedCount,
    partialPercent: partialWeightSum > 0 ? partialWeightedSum / partialWeightSum : null
  };
  return { memberResults, overall, scoring, totalBase, rawMissed, makeupTotal, noPeriodSubjects };
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

  const gradeWeights = await loadGradeWeights();
  const loadedData = new Map();
  await Promise.all([...plainIdsToLoad].map(async id => { loadedData.set(id, await loadSubjectData(id, gradeWeights)); }));

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
        out.get(studentId).subjects.push({
          subject: subj,
          result: ir.overall,
          scoring: ir.scoring,
          noPeriodSubjects: ir.noPeriodSubjects
        });
      }
    } else {
      const data = loadedData.get(subj.id);
      const enrolledSet = enrolledBySubject.get(subj.id) || new Set();
      for (const studentId of enrolledSet) {
        if (!out.has(studentId)) continue;
        const r = computeSubjectResult(studentId, data.subject, data.units, data.remarksData, data.sessions, data.makeupHours, {
          examScores: data.examScores,
          gradeWeight: data.gradeWeight
        });
        out.get(studentId).subjects.push({ subject: subj, result: r.result, scoring: r.scoring });
      }
    }
  }

  return out;
}

// ---------- คิดเกรดเฉลี่ย (GPA) จากผลรายวิชาของนักเรียน 1 คน ----------
// ถ่วงน้ำหนักด้วยหน่วยกิต (credits) — ไม่มีหน่วยกิต (ประถม) ถือเป็น 1 หน่วยเท่ากัน (ยืนยันแล้ว)
// pending = ยังสรุปของจริงไม่ได้เพราะมี ร./มส. หรือกรอกคะแนนไม่ครบ
// provisionalGpa คิดจากคะแนนเฉพาะที่กรอกแล้ว ใช้ดูระหว่างทางเท่านั้น ห้ามใช้ตัดสิน
export function computeGpa(subjectResults) {
  const list = subjectResults || [];
  const total = list.length;
  const hasBlocked = list.some(x => x.result.type === "มส." || x.result.type === "ร.");
  const hasIncomplete = list.some(x => x.scoring && !x.scoring.complete);
  const pending = hasBlocked || hasIncomplete;
  const reasons = [];
  if (hasBlocked) reasons.push("มีวิชาติด ร./มส.");
  if (hasIncomplete) reasons.push("ยังกรอกคะแนนไม่ครบ");

  let weightedSum = 0, weightSum = 0, countedSubjects = 0;
  for (const x of list) {
    if (x.result.type !== "grade") continue;
    const partial = x.scoring && x.scoring.partialPercent;
    // ⚠ วิชาที่ยังไม่มีคะแนนเลย (ไม่มีโครงสร้าง หรือมีแต่ยังไม่กรอกสักช่อง) ต้อง **ข้าม**
    // ห้ามนับเป็นเกรด 0 — ไม่งั้นเลข "ชั่วคราว" จะสร้างบั๊กเดิมของข้อ 3 ขึ้นมาใหม่ในตัวมันเอง
    // (เคสจริง: มีคะแนนวิชาเดียวได้ 100% อีก 4 วิชายังไม่มีโครงสร้าง → เคยขึ้น 1.33 ทั้งที่ควรเป็น 4.00)
    if (x.scoring && !x.scoring.complete && (partial === null || partial === undefined)) continue;
    const percent = partial !== null && partial !== undefined ? partial : x.result.percentScore;
    const w = x.subject.credits && x.subject.credits > 0 ? Number(x.subject.credits) : 1;
    weightedSum += percentToGrade(percent) * w;
    weightSum += w;
    countedSubjects++;
  }
  const value = weightSum > 0 ? weightedSum / weightSum : 0;
  return {
    gpa: pending || total === 0 ? null : value,
    pending,
    pendingReason: reasons.join(" · "),
    provisionalGpa: countedSubjects > 0 ? value : null,
    countedSubjects,
    total
  };
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
  // รับได้ทั้ง "id" และ ["duty_date","duty_type","staff_id"]
  // 🪤 ตารางที่ไม่มีคีย์เดี่ยว ต้องเรียงให้ครบคีย์หลัก ไม่งั้นแถวคาบรอยต่อหน้าจะหายหรือซ้ำ
  const columns = Array.isArray(orderColumn) ? orderColumn : [orderColumn];
  const out = [];
  for (let page = 0; ; page++) {
    let query = makeQuery();
    for (const col of columns) query = query.order(col);
    const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
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
//
// 🪤 เคยถูกถอดตัวกรองนี้ออกชั่วคราว (2026-08-20) ตอนทำเช็คชื่อแยกห้อง เพราะการ์ด
// "ความคืบหน้าการเช็คชื่อ" จะคิดคาบเฉลี่ยต่อห้อง จึงต้องเห็น record ของทุกคน
// วัดจริงแล้วโหลดจาก 1,959 เป็น 17,323 แถว (0.52 → 1.13 วิ) และโตตามทั้งปี
// **ผู้ใช้เคาะให้ถอดเรื่องห้องออกจากหน้าภาพรวมทั้งหมด** — หน้านี้มีไว้ดูว่าเด็กคนไหน
// ขาดเยอะใกล้ มส. ซึ่งเป็นตัวเลขรายคน ไม่เกี่ยวกับห้องเลย (computeMissedPeriods()
// ไม่มีคำว่าห้องในสูตร) ส่วนการ์ดความคืบหน้าเป็นแค่เครื่องมือตามครูที่ยังไม่เริ่มเช็คชื่อ
// → กลับมาใช้ผลรวมคาบตรง ๆ เหมือนเดิม **ห้ามกลับไปดึง record ทุกสถานะเพื่อหาห้องอีก**
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

function attendanceRoomKey(grade, classroom) {
  const g = String(grade || "").trim();
  const c = String(classroom || "").trim();
  return g && c ? g + "\u0000" + c : "";
}

export function attendanceRoomLabel(grade, classroom) {
  const g = String(grade || "").trim();
  const c = String(classroom || "").trim();
  if (!g && !c) return "ไม่ระบุห้อง";
  if (!g) return c;
  if (!c) return g;
  return c.startsWith(g) ? c : g + "/" + c;
}

// ห้องของ session อ่านจากห้องรายวันของวันนั้นก่อน แล้วค่อยถอยไป placement ของปี
// dailyRoomByDateStudent ใช้คีย์ `${session_date}\0${student_id}` · placementByStudent ใช้ student_id
export function attendanceSessionRooms(session, dailyRoomByDateStudent, placementByStudent) {
  const rooms = new Map();
  const date = String(session?.session_date || "");
  for (const record of (session?.attendance_records || [])) {
    const daily = dailyRoomByDateStudent?.get(date + "\u0000" + record.student_id);
    const placement = placementByStudent?.get(record.student_id);
    const source = attendanceRoomKey(daily?.grade_level, daily?.classroom) ? daily : placement;
    const key = attendanceRoomKey(source?.grade_level, source?.classroom);
    if (!key || rooms.has(key)) continue;
    rooms.set(key, {
      key,
      grade_level: String(source.grade_level || "").trim(),
      classroom: String(source.classroom || "").trim(),
      label: attendanceRoomLabel(source.grade_level, source.classroom)
    });
  }
  return [...rooms.values()].sort((a, b) => a.label.localeCompare(b.label, "th", { numeric: true }));
}

// คำนวณล้วน — รับผลจาก loadAcademicOverviewData() แล้วสรุปเป็นข้อมูลพร้อมแสดงผล
export function buildAcademicOverview(raw, options = {}) {
  const primaryWarn = Number(options.primaryWarnPercent ?? MS_WARN_PERCENT_PRIMARY);
  const secondaryWarn = Number(options.secondaryWarnPercent ?? MS_WARN_PERCENT_SECONDARY);

  const data = raw || {};
  const subjects = data.subjects || [];
  const subjectById = new Map(subjects.map(s => [s.id, s]));
  const gradeOrderIndex = grade => {
    const idx = GRADE_ORDER.indexOf(grade);
    return idx === -1 ? GRADE_ORDER.length : idx;
  };

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
  const allRoster = [];
  if (!placementFallback) {
    for (const p of placements) {
      const stu = p.student || { id: p.student_id };
      allRoster.push({ student: stu, grade: p.grade_level, classroom: p.classroom });
    }
  } else {
    for (const stu of activeStudents) {
      allRoster.push({ student: stu, grade: stu.grade_level, classroom: stu.classroom });
    }
  }
  // ภาพรวมวิชาการนับเฉพาะชั้นที่มีวิชาในปีนั้น — อนุบาลยังไม่มีวิชา/เกรด/มส.
  // ห้ามคัดด้วย enrollment เพราะจะกลืนสัญญาณ "มีวิชาแต่ยังไม่ลงทะเบียน" หายไป
  const subjectGrades = new Set(subjects.map(s => String(s.grade_level || "").trim()).filter(Boolean));
  const gradesWithoutSubjects = [...new Set(
    allRoster.map(entry => String(entry.grade || "").trim()).filter(grade => grade && !subjectGrades.has(grade))
  )].sort((a, b) => gradeOrderIndex(a) - gradeOrderIndex(b) || a.localeCompare(b, "th", { numeric: true }));
  const roster = allRoster.filter(entry => subjectGrades.has(String(entry.grade || "").trim()));

  // ตัวจับเวลาสำหรับระบบเช็คชื่อรายวิชา: ชั้นไหนมีห้องที่ 2 เมื่อไหร่ต้องเริ่มแยกเช็คตามห้อง
  const roomsPerGrade = new Map();
  for (const room of roomsFromPlacements(placements, data.year)) {
    roomsPerGrade.set(room.grade_level, (roomsPerGrade.get(room.grade_level) || 0) + 1);
  }
  const gradesWithManyRooms = [...roomsPerGrade.entries()]
    .filter(([, roomCount]) => roomCount > 1)
    .map(([grade, roomCount]) => ({ grade, roomCount }))
    .sort((a, b) => gradeOrderIndex(a.grade) - gradeOrderIndex(b.grade) || a.grade.localeCompare(b.grade, "th", { numeric: true }));
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
        risk = computeAttendanceRisk(studentId, members.map(m => subjectDataFor(m, studentId)), { warnPercent });
      } else {
        enrolled = Boolean(enrolledBySubject.get(subject.id)?.has(studentId));
        risk = computeAttendanceRisk(studentId, [subjectDataFor(subject, studentId)], { warnPercent });
      }
      // totalBase = 0 คือวิชาที่ยังไม่ตั้งจำนวนคาบ — ตัดสินความเสี่ยงไม่ได้ ไปขึ้นที่ "ความพร้อมข้อมูล" แทน
      if (!enrolled || risk.totalBase <= 0) continue;
      if (risk.risky) {
        risky.push({
          subject,
          percent: risk.percent,
          rawPercent: risk.rawPercent,
          rawMissed: risk.rawMissed,
          netMissed: risk.netMissed,
          totalBase: risk.totalBase,
          retake: risk.retake,
          critical: risk.critical,
          level: risk.level
        });
      }
    }

    if (risky.length === 0) continue;
    const riskRank = item => item.retake ? 2 : item.critical ? 1 : 0;
    risky.sort((a, b) => riskRank(b) - riskRank(a) || b.percent - a.percent);
    rows.push({
      student: entry.student,
      grade: entry.grade,
      classroom: entry.classroom,
      isPrimary: isPrimaryGrade(entry.grade),
      warnPercent,
      subjects: risky,
      maxPercent: risky[0].retake ? risky[0].rawPercent : risky[0].percent,
      maxMissed: risky[0].retake ? risky[0].rawMissed : risky[0].netMissed,
      retake: risky.some(r => r.retake),
      critical: risky.some(r => r.critical)
    });
  }
  const rowRiskRank = row => row.retake ? 2 : row.critical ? 1 : 0;
  rows.sort((a, b) => rowRiskRank(b) - rowRiskRank(a) || b.maxPercent - a.maxPercent || b.maxMissed - a.maxMissed);

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
    noPlacement: studentsWithoutPlacement,
    gradesWithoutSubjects,
    gradesWithManyRooms
  };

  // ---------- ความคืบหน้าการเช็คชื่อ (คาบที่เช็คไปแล้ว เทียบคาบทั้งรอบของวิชา) ----------
  // ⛔ ห้ามเอา "ห้อง" มาเกี่ยวกับหน้านี้ (ผู้ใช้เคาะ 2026-08-20) — ดูเหตุผลเต็มที่คอมเมนต์
  // ของ fetchAttendanceSessions() · การ์ดนี้เป็นเครื่องมือตามครูที่ยังไม่เริ่มเช็คชื่อ
  // ไม่ใช่ตัวเลขที่ตัดสินเด็ก · วันที่วิชาไหนมีเด็ก 2 ห้องจริง ตัวเลขจะเกิน 100% ได้
  // ซึ่งรับได้เพราะ readiness.gradesWithManyRooms เตือนอยู่แล้วว่าชั้นไหนมีห้องที่ 2
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
        studentCount: 0, flagged: [], retakeCount: 0, criticalCount: 0, remarkCount: 0
      });
    }
    gradeMap.get(grade).studentCount += 1;
  }
  for (const row of rows) {
    const group = gradeMap.get(row.grade || "(ไม่ระบุชั้น)");
    if (!group) continue;
    group.flagged.push(row);
    if (row.retake) group.retakeCount += 1;
    if (row.critical) group.criticalCount += 1;
  }
  for (const remark of incompleteRemarks) {
    const group = gradeMap.get(remark.grade || "(ไม่ระบุชั้น)");
    if (group) group.remarkCount += 1;
  }
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
    thresholds: {
      primaryWarn,
      secondaryWarn,
      makeupPercent: MS_MAKEUP_RATIO * 100,
      retakePercent: MS_RETAKE_RATIO * 100
    }
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
// เด็กที่จบ/ย้ายออกยังต้องอยู่ใน placement เพื่อดูประวัติย้อนหลัง
// แต่ปีการศึกษาปัจจุบันต้องตัดออกจากจำนวนคนที่เช็คชื่อได้จริง
export function isPlacementInactive(placement) {
  return placement?.student?.graduated === true || placement?.student?.left_school === true;
}

export function activePlacements(placements) {
  return (placements || []).filter(placement => !isPlacementInactive(placement));
}

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
export async function loadDailyAttendanceToday(year, dateStr, academicYears = null) {
  if (!year || !dateStr) {
    return { year, dateStr, rows: [], rooms: [], isHoliday: false };
  }

  const weekday = isoWeekday(dateStr);
  const yearsRequest = Array.isArray(academicYears)
    ? Promise.resolve({ data: academicYears, error: null })
    : sb.from("academic_years").select("year,start_date").order("year");
  const [rowsRes, placementsRes, scheduleRes, holidayRes, yearsRes] = await Promise.all([
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
      .maybeSingle(),
    yearsRequest
  ]);

  for (const res of [rowsRes, placementsRes, scheduleRes, holidayRes, yearsRes]) {
    if (res.error) throw new Error("โหลดข้อมูลเช็คชื่อรายวันไม่สำเร็จ: " + res.error.message);
  }

  const currentAcademicYear = academicYearOf(toDateStr(bangkokNow()), yearsRes.data || []);
  const roomPlacements = year === currentAcademicYear
    ? activePlacements(placementsRes.data)
    : placementsRes.data;
  const rooms = roomsFromPlacements(roomPlacements, year);
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

// ============================================================
// รายงานตรวจการเช็คชื่อประจำชั้น
// ------------------------------------------------------------
// หน้ารายงานเต็มต้องอ่านครู/คนแทนผ่าน RPC เฉพาะงานเท่านั้น ห้ามยิง staff หรือ
// coverage_assignments ตรง เพราะ RLS จะคืนแถวไม่ครบแบบไม่มี error
// ============================================================

function homeroomAuditRoomKey(row) {
  return String(row?.grade_level || "") + "\u0000" + String(row?.classroom || "");
}

function homeroomAuditRoomLabel(row) {
  const grade = String(row?.grade_level || "").trim();
  const classroom = String(row?.classroom || "").trim();
  if (!grade) return classroom || "ไม่ระบุห้อง";
  if (!classroom) return grade;
  return classroom.startsWith(grade) ? classroom : grade + "/" + classroom;
}

function homeroomAuditBangkokDate(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function collapseHomeroomAuditAttendance(rows, profileById = new Map()) {
  const byRoomDate = new Map();
  for (const row of rows || []) {
    if (!row?.attend_date || !row.grade_level || !row.classroom) continue;
    const key = row.attend_date + "\u0000" + homeroomAuditRoomKey(row);
    if (!byRoomDate.has(key)) {
      byRoomDate.set(key, {
        date: row.attend_date,
        year: row.year,
        grade_level: row.grade_level,
        classroom: row.classroom,
        recordedBy: new Set(),
        recordedAt: ""
      });
    }
    const entry = byRoomDate.get(key);
    entry.recordedBy.add(row.recorded_by || null);
    if (String(row.recorded_at || "") > entry.recordedAt) entry.recordedAt = row.recorded_at || "";
  }
  return [...byRoomDate.values()].map(entry => ({
    ...entry,
    recordedBy: [...entry.recordedBy],
    recorders: [...entry.recordedBy].map(userId => ({
      user_id: userId,
      name: userId ? (profileById.get(userId)?.name || "บัญชีผู้ใช้") : "ไม่ระบุผู้บันทึก"
    }))
  }));
}

// โหลดดิบสำหรับรายงานเต็ม — ครูและคนแทนต้องมาจาก RPC ที่มีด่านสิทธิ์ในตัวเท่านั้น
export async function loadHomeroomAuditData(year, from, to) {
  if (!year || !from || !to || from > to) {
    return {
      year, from, to, teachers: [], coverage: [], attendance: [], placements: [],
      homerooms: [], holidays: [], schedule: [], profiles: []
    };
  }

  const [teacherRes, coverageRes, attendanceRes, placementRes, homeroomRes, holidayRes, scheduleRes] = await Promise.all([
    sb.rpc("homeroom_audit_teachers", { p_year: year }),
    sb.rpc("homeroom_audit_coverage", { p_from: from, p_to: to }),
    fetchAllRows(() => sb.from("daily_attendance")
      .select("attend_date,year,grade_level,classroom,recorded_by,recorded_at")
      .eq("year", year).gte("attend_date", from).lte("attend_date", to),
      ["attend_date", "student_id"]),
    getStudentPlacements(year),
    sb.from("homeroom_teachers")
      .select("id,year,grade_level,classroom,created_at").eq("year", year),
    sb.from("work_holidays").select("holiday_date").gte("holiday_date", from).lte("holiday_date", to),
    sb.from("work_schedule").select("weekday,is_working_day")
  ]);

  const failed = [
    [teacherRes, "โหลดครูประจำชั้นจาก RPC"],
    [coverageRes, "โหลดคนแทนจาก RPC"],
    [attendanceRes, "โหลดผลเช็คชื่อ"],
    [placementRes, "โหลดห้องเรียน"],
    [homeroomRes, "ตรวจรายการครูประจำชั้น"],
    [holidayRes, "โหลดวันหยุด"],
    [scheduleRes, "โหลดตารางวันทำงาน"]
  ].find(([result]) => result.error);
  if (failed) throw new Error(failed[1] + "ไม่สำเร็จ: " + failed[0].error.message);

  const teachers = teacherRes.data || [];
  const homerooms = homeroomRes.data || [];
  if (teachers.length === 0 && homerooms.length > 0) {
    const error = new Error("ไม่มีสิทธิ์อ่านข้อมูลรายงานนี้");
    error.code = "HOMEROOM_AUDIT_DENIED";
    throw error;
  }

  const recorderIds = [...new Set((attendanceRes.data || []).map(row => row.recorded_by).filter(Boolean))];
  let profiles = [];
  if (recorderIds.length) {
    const profileRes = await sb.from("profiles").select("id,name").in("id", recorderIds);
    if (profileRes.error) throw new Error("โหลดชื่อผู้บันทึกไม่สำเร็จ: " + profileRes.error.message);
    profiles = profileRes.data || [];
  }
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  return {
    year, from, to,
    teachers,
    coverage: coverageRes.data || [],
    // ยุบรายนักเรียนทิ้งทันที เหลือเพียงห้อง × วัน เพื่อไม่ถือข้อมูลทั้งปีไว้ในหน่วยความจำ
    attendance: collapseHomeroomAuditAttendance(attendanceRes.data || [], profileById),
    placements: placementRes.data || [],
    homerooms,
    holidays: holidayRes.data || [],
    schedule: scheduleRes.data || [],
    profiles
  };
}

// โหลดข้อมูลเฉพาะเจ้าตัวสำหรับ my-work.html — ใช้ RLS แถวของตัวเอง ไม่เรียก RPC รายงานเต็ม
// ⛔ ผลที่ได้ใช้ได้เฉพาะ due / missed / missedDates และผลรวม (self + byOther) เท่านั้น
//    **ห้ามแสดง self กับ byOther แยกกันเด็ดขาด** — ฟังก์ชันนี้เห็นครูประจำชั้นแค่แถวของเจ้าตัว
//    เพราะ staff_select ปิด user_id ของคนอื่นไว้ พอครูคู่ชั้นเป็นคนเช็ค ระบบจะไม่รู้ว่าเป็น
//    "ผู้รับผิดชอบ" แล้วตกไปเป็น byOther ทั้งหมด
//    · เจอจริง 2026-08-20: ห้อง ป.3/1 (ครูประจำชั้น 2 คน) หน้ารายงานขึ้น self 12 / byOther 0
//      แต่การ์ดของครูคนเดียวกันขึ้น self 0 / byOther 12 — ยอดรวมเท่ากันแต่สลับข้าง
//    · อยากได้การแยกจริง ๆ ต้องใช้ loadHomeroomAuditData() ซึ่งอ่านผ่าน RPC (ครูทั่วไปเรียกไม่ได้)
export async function loadMyHomeroomAuditData(year, from, to, staff) {
  const staffId = staff?.id;
  const userId = staff?.user_id;
  if (!year || !from || !to || !staffId || !userId || from > to) {
    return {
      year, from, to, teachers: [], coverage: [], attendance: [], placements: [],
      homerooms: [], holidays: [], schedule: [], profiles: []
    };
  }

  const [ownHomeroomRes, homeroomRes, coverageRes, attendanceRes, holidayRes, scheduleRes] = await Promise.all([
    sb.from("homeroom_teachers")
      .select("id,year,grade_level,classroom,staff_id,created_at")
      .eq("year", year).eq("staff_id", staffId),
    sb.from("homeroom_teachers")
      .select("id,year,grade_level,classroom,staff_id,created_at").eq("year", year),
    sb.from("coverage_assignments")
      .select("cover_date,homeroom_id,absent_staff_id,substitute_staff_id,source")
      .gte("cover_date", from).lte("cover_date", to)
      .or(`absent_staff_id.eq.${staffId},substitute_staff_id.eq.${staffId}`),
    fetchAllRows(() => sb.from("daily_attendance")
      .select("attend_date,year,grade_level,classroom,recorded_by,recorded_at")
      .eq("year", year).gte("attend_date", from).lte("attend_date", to),
      ["attend_date", "student_id"]),
    sb.from("work_holidays").select("holiday_date").gte("holiday_date", from).lte("holiday_date", to),
    sb.from("work_schedule").select("weekday,is_working_day")
  ]);
  const failed = [
    [ownHomeroomRes, "โหลดห้องประจำชั้นของคุณ"],
    [homeroomRes, "โหลดข้อมูลห้องประจำชั้น"],
    [coverageRes, "โหลดงานแทนประจำชั้นของคุณ"],
    [attendanceRes, "โหลดผลเช็คชื่อ"],
    [holidayRes, "โหลดวันหยุด"],
    [scheduleRes, "โหลดตารางวันทำงาน"]
  ].find(([result]) => result.error);
  if (failed) throw new Error(failed[1] + "ไม่สำเร็จ: " + failed[0].error.message);

  const homeroomById = new Map((homeroomRes.data || []).map(row => [row.id, row]));
  const ownByHomeroomId = new Map((ownHomeroomRes.data || []).map(row => [row.id, row]));
  const coverage = (coverageRes.data || []).map(row => {
    const homeroom = homeroomById.get(row.homeroom_id) || {};
    return {
      ...row,
      year: homeroom.year || year,
      grade_level: homeroom.grade_level || "",
      classroom: homeroom.classroom || "",
      absent_name: row.absent_staff_id === staffId ? staff.full_name : "ครูประจำชั้น",
      substitute_name: row.substitute_staff_id === staffId ? staff.full_name : "คนแทน",
      substitute_user_id: row.substitute_staff_id === staffId ? userId : null
    };
  });

  // งานที่เจ้าตัวไปแทนอ้าง homeroom ของคนอื่น จึงเติมแถวต้นทางเฉพาะเพื่อให้สูตรรู้วันที่เริ่มของห้อง
  for (const row of coverage) {
    if (ownByHomeroomId.has(row.homeroom_id)) continue;
    const homeroom = homeroomById.get(row.homeroom_id);
    if (homeroom) ownByHomeroomId.set(row.homeroom_id, homeroom);
  }
  const teachers = [...ownByHomeroomId.values()].map(row => ({
    homeroom_id: row.id,
    year: row.year,
    grade_level: row.grade_level,
    classroom: row.classroom,
    staff_id: row.staff_id,
    full_name: row.staff_id === staffId ? staff.full_name : "ครูประจำชั้น",
    user_id: row.staff_id === staffId ? userId : null,
    is_active: row.staff_id === staffId ? staff.is_active : true,
    created_at: row.created_at
  }));

  return {
    year, from, to, teachers, coverage,
    attendance: collapseHomeroomAuditAttendance(attendanceRes.data || []),
    placements: [],
    homerooms: [...ownByHomeroomId.values()],
    holidays: holidayRes.data || [],
    schedule: scheduleRes.data || [],
    profiles: []
  };
}

// คำนวณล้วน — ไม่มี query/DOM เพื่อให้รายงานเต็มและการ์ดเจ้าตัวใช้สูตรเดียวกัน
export function buildHomeroomAudit(raw, { startDate } = {}) {
  const data = raw || {};
  const from = String(data.from || "");
  const to = String(data.to || "");
  const effectiveStart = String(startDate || from);
  const scheduleRows = Array.isArray(data.schedule) ? data.schedule : [];
  const schedule = new Map(scheduleRows.map(row => [Number(row.weekday), row.is_working_day === true]));
  const holidays = new Set((data.holidays || []).map(row => row.holiday_date));
  // ถ้าไม่มีตารางเลย จะไม่เดาว่าวันใดเป็นวันทำงาน ตัวหารจึงว่างและหน้าเว็บต้องขึ้นคำเตือน
  const scheduleConfigured = scheduleRows.length > 0;
  const schoolDates = (!from || !to || from > to || !scheduleConfigured) ? [] : eachDate(from, to).filter(date =>
    date >= effectiveStart && !holidays.has(date) && schedule.get(isoWeekday(date)) === true
  );

  const placements = Array.isArray(data.placements) ? data.placements : [];
  const teachers = (Array.isArray(data.teachers) ? data.teachers : []).map(row => ({
    ...row,
    homeroom_id: row.homeroom_id || row.id,
    createdDate: homeroomAuditBangkokDate(row.created_at)
  }));
  const coverage = Array.isArray(data.coverage) ? data.coverage : [];
  const homerooms = Array.isArray(data.homerooms) ? data.homerooms : [];
  const roomMap = new Map();
  const addRoom = row => {
    if (!row?.grade_level || !row?.classroom) return;
    const key = homeroomAuditRoomKey(row);
    if (!roomMap.has(key)) roomMap.set(key, {
      year: data.year,
      grade_level: row.grade_level,
      classroom: row.classroom,
      room: homeroomAuditRoomLabel(row)
    });
  };
  roomsFromPlacements(placements, data.year).forEach(addRoom);
  homerooms.forEach(addRoom);
  teachers.forEach(addRoom);
  coverage.forEach(addRoom);

  const gradeRank = grade => {
    const index = GRADE_ORDER.indexOf(grade);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const roomCompare = (a, b) =>
    gradeRank(a.grade_level) - gradeRank(b.grade_level) ||
    String(a.classroom).localeCompare(String(b.classroom), "th", { numeric: true });
  const roomList = [...roomMap.values()].sort(roomCompare);

  const teachersByRoom = new Map();
  for (const teacher of teachers) {
    const key = homeroomAuditRoomKey(teacher);
    if (!teachersByRoom.has(key)) teachersByRoom.set(key, []);
    teachersByRoom.get(key).push(teacher);
  }
  const coverageByAssignmentDate = new Map();
  for (const row of coverage) {
    coverageByAssignmentDate.set(String(row.homeroom_id) + "\u0000" + row.cover_date, row);
  }
  const attendanceByRoomDate = new Map();
  for (const row of (data.attendance || [])) {
    const date = row.date || row.attend_date;
    if (!date) continue;
    attendanceByRoomDate.set(date + "\u0000" + homeroomAuditRoomKey(row), {
      ...row,
      date,
      recordedBy: Array.isArray(row.recordedBy)
        ? row.recordedBy
        : [row.recorded_by].filter(value => value !== undefined)
    });
  }

  const roomStats = new Map(roomList.map(room => [homeroomAuditRoomKey(room), {
    ...room, checked: 0, byOther: 0, missed: 0, missedDates: [], due: 0,
    teachers: (teachersByRoom.get(homeroomAuditRoomKey(room)) || []).map(teacher => ({
      id: teacher.staff_id,
      full_name: teacher.full_name,
      user_id: teacher.user_id,
      created_at: teacher.created_at
    }))
  }]));
  const staffStats = new Map();
  const withoutTeacher = new Map();
  const coverRows = [];

  const ensureStaff = responsibility => {
    const id = responsibility.staff_id;
    if (!id) return null;
    if (!staffStats.has(id)) {
      staffStats.set(id, {
        staff: {
          id,
          full_name: responsibility.full_name || "ไม่ระบุชื่อ",
          user_id: responsibility.user_id || null
        },
        rooms: [], due: 0, self: 0, byOther: 0, missed: 0, missedDates: []
      });
    }
    return staffStats.get(id);
  };

  for (const room of roomList) {
    const roomKey = homeroomAuditRoomKey(room);
    const assignments = teachersByRoom.get(roomKey) || [];
    const stat = roomStats.get(roomKey);
    for (const date of schoolDates) {
      const activeAssignments = assignments.filter(teacher => !teacher.createdDate || teacher.createdDate <= date);
      const responsibilities = [];
      const coversToday = [];
      for (const teacher of activeAssignments) {
        const cover = coverageByAssignmentDate.get(String(teacher.homeroom_id) + "\u0000" + date);
        if (cover) {
          coversToday.push(cover);
          responsibilities.push({
            staff_id: cover.substitute_staff_id,
            full_name: cover.substitute_name,
            user_id: cover.substitute_user_id || null,
            kind: "คนแทน"
          });
        } else {
          responsibilities.push({
            staff_id: teacher.staff_id,
            full_name: teacher.full_name,
            user_id: teacher.user_id || null,
            kind: "ครูประจำชั้น"
          });
        }
      }

      const attendance = attendanceByRoomDate.get(date + "\u0000" + roomKey);
      const recorderIds = new Set((attendance?.recordedBy || []).filter(Boolean));
      const responsibleUserIds = new Set(responsibilities.map(item => item.user_id).filter(Boolean));
      const checkedByResponsible = [...responsibleUserIds].some(userId => recorderIds.has(userId));
      const hasAttendance = Boolean(attendance);

      if (!responsibilities.length) {
        if (!withoutTeacher.has(roomKey)) withoutTeacher.set(roomKey, { ...room, days: 0, dates: [] });
        const missing = withoutTeacher.get(roomKey);
        missing.days += 1;
        missing.dates.push(date);
        continue;
      }

      stat.due += 1;
      if (hasAttendance) {
        stat.checked += 1;
        if (!checkedByResponsible) stat.byOther += 1;
      } else {
        stat.missed += 1;
        stat.missedDates.push(date);
      }

      // คนเดียวอาจเป็นทั้งครูคู่ชั้นและคนแทนของอีกแถวในห้องเดียวกัน — หนึ่งห้อง×วันนับครั้งเดียว
      const uniqueResponsibilities = new Map();
      for (const item of responsibilities) {
        if (!item.staff_id) continue;
        if (item.kind === "คนแทน" && !item.user_id) continue; // คนแทนไม่มีบัญชีขึ้นป้าย ไม่ตัดเป็นไม่เช็ค
        if (!uniqueResponsibilities.has(item.staff_id)) uniqueResponsibilities.set(item.staff_id, item);
      }
      for (const item of uniqueResponsibilities.values()) {
        const staffStat = ensureStaff(item);
        if (!staffStat) continue;
        if (!staffStat.rooms.includes(room.room)) staffStat.rooms.push(room.room);
        staffStat.due += 1;
        if (checkedByResponsible) staffStat.self += 1;
        else if (hasAttendance) staffStat.byOther += 1;
        else {
          staffStat.missed += 1;
          staffStat.missedDates.push({ date, room: room.room });
        }
      }

      for (const cover of coversToday) {
        const hasLogin = Boolean(cover.substitute_user_id);
        const checked = hasLogin ? recorderIds.has(cover.substitute_user_id) : null;
        coverRows.push({
          date,
          room: room.room,
          absent: { id: cover.absent_staff_id, full_name: cover.absent_name || "ไม่ระบุชื่อ" },
          substitute: {
            id: cover.substitute_staff_id,
            full_name: cover.substitute_name || "ไม่ระบุชื่อ",
            user_id: cover.substitute_user_id || null
          },
          source: cover.source || "",
          checked,
          checkedByOther: hasAttendance && checked !== true,
          recorders: attendance?.recorders || []
        });
      }
    }
  }

  const rooms = [...roomStats.values()].filter(row => row.due > 0).sort(roomCompare);
  const staff = [...staffStats.values()].sort((a, b) => {
    const aRoom = roomList.findIndex(room => a.rooms.includes(room.room));
    const bRoom = roomList.findIndex(room => b.rooms.includes(room.room));
    return aRoom - bRoom || String(a.staff.full_name).localeCompare(String(b.staff.full_name), "th");
  });
  coverRows.sort((a, b) => a.date.localeCompare(b.date) ||
    roomList.findIndex(room => room.room === a.room) - roomList.findIndex(room => room.room === b.room));

  return {
    year: data.year || "",
    from,
    to,
    startDate: effectiveStart,
    scheduleConfigured,
    schoolDays: schoolDates.length,
    schoolDates,
    rooms,
    staff,
    covers: coverRows,
    roomsWithoutTeacher: [...withoutTeacher.values()].sort(roomCompare)
  };
}

// ---------- ค่าตั้งต้นของการเช็คชื่อรายวิชา จากผลเช็คของครูประจำชั้น ----------
// ⛔ ตัวนี้ใช้ "ตั้งค่าเริ่มต้นในช่องเลือก" เท่านั้น ห้ามเอาผลไปเข้าสูตร มส./เกรด โดยตรง
//    ตัวเลขที่เข้าสูตรต้องมาจาก attendance_records ที่ครูประจำวิชากดบันทึกเองเสมอ
//    (เส้นแบ่งเดิมที่ผู้ใช้ผ่อนให้เท่านี้ 2026-08-20 — ดู general-affairs/PLAN.md)
export const DAILY_TO_SUBJECT_STATUS = {
  "มา": "มา",
  "มาสาย": "มา",     // สายตอนเช้าไม่ใช่สายของคาบบ่าย (ผู้ใช้เคาะ 2026-08-20)
  "ขาด": "ขาด",
  "ลาป่วย": "ลาป่วย",
  "ลากิจ": "ลากิจ"
};

function emptyDailyPrefill(dateStr, failed = false) {
  return {
    dateStr: dateStr || "",
    anyChecked: false,
    byStudent: new Map(),
    roomByStudent: new Map(),
    absent: [],
    late: [],
    rooms: [],
    ...(failed ? { failed: true } : {})
  };
}

function dailyPrefillTime(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(iso)) + " น.";
}

function dailyPrefillRoomLabel(grade, classroom) {
  const g = String(grade || "").trim();
  const c = String(classroom || "").trim();
  if (!g && !c) return "ไม่ระบุห้อง";
  if (!g) return c;
  if (!c) return g;
  return c.startsWith(g) ? c : g + "/" + c;
}

export async function loadDailyPrefill(dateStr, students) {
  const roster = Array.isArray(students) ? students.filter(student => student && student.id) : [];
  if (!dateStr || roster.length === 0) return emptyDailyPrefill(dateStr);

  try {
    const chunks = [];
    for (let i = 0; i < roster.length; i += 200) chunks.push(roster.slice(i, i + 200).map(student => student.id));
    const results = await Promise.all(chunks.map(ids => sb.from("daily_attendance")
      .select("student_id,status,grade_level,classroom,recorded_by,recorded_at,updated_at")
      .eq("attend_date", dateStr)
      .in("student_id", ids)));
    const failedResult = results.find(result => result.error);
    if (failedResult) throw failedResult.error;
    const rows = results.flatMap(result => result.data || []);
    const rowByStudent = new Map(rows.map(row => [row.student_id, row]));

    const recorderIds = [...new Set(rows.map(row => row.recorded_by).filter(Boolean))];
    let profileById = new Map();
    if (recorderIds.length > 0) {
      const { data: profiles, error: profileError } = await sb.from("profiles")
        .select("id,name,email")
        .in("id", recorderIds);
      if (profileError) throw profileError;
      profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
    }

    const byStudent = new Map();
    const roomByStudent = new Map();
    const absent = [];
    const late = [];
    const roomMap = new Map();
    for (const student of roster) {
      const row = rowByStudent.get(student.id);
      const grade = row?.grade_level || student.grade_level;
      const classroom = row?.classroom || student.classroom;
      const roomKey = String(grade || "") + "\u0000" + String(classroom || "");
      if (!roomMap.has(roomKey)) {
        roomMap.set(roomKey, {
          room: dailyPrefillRoomLabel(grade, classroom), checked: false,
          checkedAt: "—", by: "ไม่ระบุผู้บันทึก", inRoster: 0,
          _latestAt: "", _recorderId: null
        });
      }
      const room = roomMap.get(roomKey);
      room.inRoster += 1;
      if (!row) continue;

      room.checked = true;
      roomByStudent.set(student.id, {
        grade_level: row.grade_level || "",
        classroom: row.classroom || ""
      });
      const effectiveAt = row.updated_at || row.recorded_at || "";
      if (!room._latestAt || effectiveAt > room._latestAt) {
        room._latestAt = effectiveAt;
        room._recorderId = row.recorded_by || null;
      }

      const mappedStatus = DAILY_TO_SUBJECT_STATUS[row.status];
      if (!mappedStatus) continue;
      byStudent.set(student.id, mappedStatus);
      const base = {
        id: student.id,
        name: student.name || "",
        student_no: student.student_no || ""
      };
      if (row.status === "มาสาย") late.push(base);
      else if (mappedStatus !== "มา") absent.push({ ...base, status: mappedStatus });
    }

    const studentCompare = (a, b) =>
      String(a.student_no || "").localeCompare(String(b.student_no || ""), "th", { numeric: true }) ||
      String(a.name || "").localeCompare(String(b.name || ""), "th");
    absent.sort(studentCompare);
    late.sort(studentCompare);
    const rooms = [...roomMap.values()].map(room => {
      const profile = room._recorderId ? profileById.get(room._recorderId) : null;
      return {
        room: room.room,
        checked: room.checked,
        checkedAt: room.checked ? dailyPrefillTime(room._latestAt) : "—",
        by: room.checked ? (profile?.name || profile?.email || "ไม่ระบุผู้บันทึก") : "ไม่ระบุผู้บันทึก",
        inRoster: room.inRoster
      };
    }).sort((a, b) => a.room.localeCompare(b.room, "th", { numeric: true }));

    return {
      dateStr,
      anyChecked: rows.length > 0,
      byStudent,
      roomByStudent,
      absent,
      late,
      rooms
    };
  } catch (error) {
    console.warn("อ่านผลเช็ครายวันสำหรับค่าตั้งต้นรายวิชาไม่สำเร็จ", error);
    return emptyDailyPrefill(dateStr, true);
  }
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

// ============================================================
// อนุมัติโครงการ/กิจกรรม — ตรรกะกลางสำหรับทุกหน้า
// ------------------------------------------------------------
// ป้ายสถานะและการเรียก RPC ต้องอยู่ไฟล์นี้ที่เดียว เพื่อไม่ให้หน้าโครงการ หน้าอนุมัติ
// งานของฉัน และ dashboard ตีความสถานะชุดเดียวกันคนละแบบ
// ============================================================

export async function isProjectApprover() {
  const { data, error } = await sb.rpc("is_project_approver");
  if (error) return false;
  return data === true;
}

function approvalHistoryOf(project) {
  const rows = project?.approval_history || project?.approvals || [];
  return Array.isArray(rows) ? rows : [];
}

function latestApprovalAction(project, action) {
  return approvalHistoryOf(project)
    .filter(row => row?.action === action)
    .sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")))[0] || null;
}

function formatApprovalDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

// คืน tone ที่ใส่ต่อท้ายคลาส chip เดิมได้ทันที: ค่าว่าง = ผ่าน, warn = ยังต้องทำต่อ,
// fail = ตัดสินไม่อนุมัติแล้ว (ตรงกับความหมายสีใน UI-STANDARD)
export function projectApprovalBadge(project) {
  const status = project?.approval_status || "ร่าง";
  const wasApproved = Boolean(project?.approved_at);

  if (status === "ร่าง" && !wasApproved) {
    return { label: "ร่าง — ยังไม่ได้ส่ง", tone: "warn", note: "" };
  }
  if (status === "ร่าง" && wasApproved) {
    const revision = latestApprovalAction(project, "ขอแก้ไขแผน");
    return {
      label: "อนุมัติแล้ว · กำลังแก้ไขแผน",
      tone: "warn",
      note: revision?.note || project?.revision_reason || ""
    };
  }
  if (status === "รออนุมัติ" && !wasApproved) {
    const submitted = formatApprovalDate(project?.submitted_at);
    return {
      label: "รออนุมัติ",
      tone: "warn",
      note: submitted ? `ส่งเมื่อ ${submitted}` : ""
    };
  }
  if (status === "รออนุมัติ" && wasApproved) {
    return { label: "อนุมัติแล้ว · ขอแก้ไข รอพิจารณา", tone: "warn", note: "" };
  }
  if (status === "อนุมัติ" && wasApproved) {
    const approved = latestApprovalAction(project, "อนุมัติ");
    const actor = approved?.acted_by_name || project?.approved_by_name || "ผู้อนุมัติ";
    const approvedAt = formatApprovalDate(project?.approved_at);
    return {
      label: "อนุมัติแล้ว",
      tone: "",
      note: approvedAt ? `อนุมัติโดย ${actor} เมื่อ ${approvedAt}` : `อนุมัติโดย ${actor}`
    };
  }
  if (status === "ส่งกลับให้แก้") {
    return { label: "ส่งกลับให้แก้", tone: "warn", note: project?.approval_note || "" };
  }
  if (status === "ไม่อนุมัติ" && !wasApproved) {
    return { label: "ไม่อนุมัติ", tone: "fail", note: project?.approval_note || "" };
  }

  // ข้อมูลที่ไม่ตรง constraint/ตารางความจริงให้แสดงค่าจริงแบบเตือน แทนการทำเหมือนอนุมัติแล้ว
  return { label: status, tone: "warn", note: project?.approval_note || "" };
}

async function enrichApprovalProjects(projects) {
  const rows = projects || [];
  if (rows.length === 0) return [];

  const projectIds = rows.map(row => row.id);
  const parentIds = [...new Set(rows.map(row => row.parent_id).filter(Boolean))];
  const staffIds = [...new Set(rows.map(row => row.responsible_staff_id).filter(Boolean))];
  const [parentsRes, staffRes, historyRes, linksRes] = await Promise.all([
    parentIds.length
      ? sb.from("academic_projects").select("id,name").in("id", parentIds)
      : Promise.resolve({ data: [], error: null }),
    staffIds.length
      ? sb.from("staff").select("id,full_name").in("id", staffIds)
      : Promise.resolve({ data: [], error: null }),
    sb.from("academic_project_approvals")
      .select("project_id,action,note,acted_by,acted_by_name,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false }),
    sb.from("academic_project_links")
      .select("*")
      .in("project_id", projectIds)
      .order("sort_order")
  ]);

  for (const res of [parentsRes, staffRes, historyRes, linksRes]) {
    if (res.error) throw new Error("โหลดรายละเอียดการอนุมัติโครงการไม่สำเร็จ: " + res.error.message);
  }

  const parentById = new Map((parentsRes.data || []).map(row => [row.id, row]));
  const staffById = new Map((staffRes.data || []).map(row => [row.id, row]));
  const historyByProject = new Map();
  for (const item of (historyRes.data || [])) {
    if (!historyByProject.has(item.project_id)) historyByProject.set(item.project_id, []);
    historyByProject.get(item.project_id).push(item);
  }
  const linksByProject = new Map();
  for (const link of (linksRes.data || [])) {
    if (!linksByProject.has(link.project_id)) linksByProject.set(link.project_id, []);
    linksByProject.get(link.project_id).push(link);
  }

  return rows.map(project => {
    const responsibleStaff = staffById.get(project.responsible_staff_id) || null;
    const parent = parentById.get(project.parent_id) || null;
    return {
      ...project,
      responsible_staff: responsibleStaff,
      responsible_display_name: projectResponsibleName({
        ...project,
        responsible_staff: responsibleStaff
      }),
      parent,
      parent_name: parent?.name || "",
      approval_history: historyByProject.get(project.id) || [],
      links: linksByProject.get(project.id) || []
    };
  });
}

export async function loadMyProjects(year, staffId) {
  if (!year || !staffId) return [];
  const { data, error } = await sb.from("academic_projects")
    .select("*")
    .eq("year", year)
    .eq("responsible_staff_id", staffId)
    .order("start_date")
    .order("name");
  if (error) throw new Error("โหลดโครงการ/กิจกรรมของฉันไม่สำเร็จ: " + error.message);
  return enrichApprovalProjects(data || []);
}

export async function loadPendingApprovals(year) {
  if (!year) return [];
  const { data, error } = await sb.from("academic_projects")
    .select("*")
    .eq("year", year)
    .eq("approval_status", "รออนุมัติ")
    .order("submitted_at")
    .order("name");
  if (error) throw new Error("โหลดคิวอนุมัติโครงการ/กิจกรรมไม่สำเร็จ: " + error.message);
  return enrichApprovalProjects(data || []);
}

export async function loadProjectApprovalHistory(projectId) {
  if (!projectId) return [];
  const { data, error } = await sb.from("academic_project_approvals")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("โหลดประวัติการอนุมัติโครงการไม่สำเร็จ: " + error.message);
  return data || [];
}

async function callProjectApprovalRpc(functionName, args, errorLabel) {
  const { data, error } = await sb.rpc(functionName, args);
  if (error) throw new Error(errorLabel + ": " + error.message);
  return data;
}

export async function submitProjectForApproval(id) {
  return callProjectApprovalRpc(
    "submit_project_for_approval", { p_project_id: id }, "ส่งขออนุมัติโครงการไม่สำเร็จ"
  );
}

export async function withdrawProjectApproval(id) {
  return callProjectApprovalRpc(
    "withdraw_project_approval", { p_project_id: id }, "ถอนคำขออนุมัติโครงการไม่สำเร็จ"
  );
}

export async function requestProjectRevision(id, reason) {
  return callProjectApprovalRpc(
    "request_project_revision",
    { p_project_id: id, p_reason: reason },
    "ขอแก้ไขแผนโครงการไม่สำเร็จ"
  );
}

export async function decideProjectApproval(id, decision, note) {
  return callProjectApprovalRpc(
    "decide_project_approval",
    { p_project_id: id, p_decision: decision, p_note: note || null },
    "บันทึกผลการอนุมัติโครงการไม่สำเร็จ"
  );
}

export async function reopenRejectedProject(id, reason) {
  return callProjectApprovalRpc(
    "reopen_rejected_project",
    { p_project_id: id, p_reason: reason },
    "ปลดล็อกรายการที่ไม่อนุมัติไม่สำเร็จ"
  );
}

export async function reportProjectProgress(id, status, budgetActual) {
  return callProjectApprovalRpc(
    "report_project_progress",
    {
      p_project_id: id,
      p_status: status,
      p_budget_actual: budgetActual === "" || budgetActual == null ? null : budgetActual
    },
    "รายงานผลโครงการไม่สำเร็จ"
  );
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

function projectMonthRange(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ""))) return null;
  const [year, month] = yearMonth.split("-").map(Number);
  return {
    start: `${yearMonth}-01`,
    end: toDateStr(new Date(Date.UTC(year, month, 0)))
  };
}

function projectOverlapsMonth(project, range) {
  if (!range || !project?.start_date) return false;
  const endDate = project.end_date || project.start_date;
  return project.start_date <= range.end && endDate >= range.start;
}

// คำนวณล้วน — ช่วงโครงการคาบเกี่ยวเดือน ผ่านการอนุมัติแล้ว และไม่ถูกยกเลิก
export function filterProjectsInMonth(rows, yearMonth) {
  const range = projectMonthRange(yearMonth);
  if (!range) return [];
  const statusOrder = new Map([
    ["กำลังดำเนินการ", 0],
    ["วางแผน", 1],
    ["เสร็จสิ้น", 2]
  ]);

  return (rows || []).filter(project => {
    if (project.status === "ยกเลิก" || !project.approved_at) return false;
    return projectOverlapsMonth(project, range);
  }).sort((a, b) =>
    (statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99) ||
    String(a.start_date).localeCompare(String(b.start_date)) ||
    String(a.name || "").localeCompare(String(b.name || ""), "th")
  );
}

export function countPendingProjectsInMonth(rows, yearMonth) {
  const range = projectMonthRange(yearMonth);
  if (!range) return 0;
  return (rows || []).filter(project =>
    project?.approval_status === "รออนุมัติ" &&
    project?.status !== "ยกเลิก" &&
    projectOverlapsMonth(project, range)
  ).length;
}

// ---------- OKR: สูตรล้วน (ห้ามยิง sb ในบล็อกนี้) ----------
export const OKR_PASS_DEFAULT = 0.7;
export const okrRound2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function compareOkrs(a, b) {
  return (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0) ||
    String(a?.code || "").localeCompare(String(b?.code || ""), "th", { numeric: true }) ||
    String(a?.created_at || "").localeCompare(String(b?.created_at || ""));
}

function compareProjects(a, b) {
  return String(a?.start_date || "").localeCompare(String(b?.start_date || "")) ||
    String(a?.name || "").localeCompare(String(b?.name || ""), "th");
}

function mapValue(mapLike, key) {
  return mapLike instanceof Map ? mapLike.get(key) : mapLike?.[key];
}

function projectOkrIds(project) {
  const links = Array.isArray(project?.okrs)
    ? project.okrs
    : (Array.isArray(project?.okr_ids) ? project.okr_ids : []);
  return links.map(item => typeof item === "object" ? item?.id : item).filter(Boolean);
}

export function buildOkrTree(rows) {
  const ordered = (rows || []).slice().sort(compareOkrs);
  const objectives = ordered
    .filter(row => !row.parent_id)
    .map(row => ({ ...row, keyResults: [] }));
  const objectiveById = new Map(objectives.map(row => [row.id, row]));
  const orphans = [];

  for (const row of ordered) {
    if (!row.parent_id) continue;
    const parent = objectiveById.get(row.parent_id);
    if (parent) parent.keyResults.push({ ...row });
    else orphans.push({ ...row });
  }
  return { objectives, orphans };
}

export function buildProjectTree(rows) {
  const ordered = (rows || []).slice().sort(compareProjects);
  const byId = new Map(ordered.filter(row => row?.id).map(row => [row.id, row]));
  const rootIdById = new Map();
  const orphanRootIds = new Set();

  function resolveRoot(start) {
    if (rootIdById.has(start.id)) return rootIdById.get(start.id);
    const path = [];
    const position = new Map();
    let current = start;
    let rootId = null;

    while (current) {
      if (rootIdById.has(current.id)) {
        rootId = rootIdById.get(current.id);
        break;
      }
      if (position.has(current.id)) {
        const cycle = path.slice(position.get(current.id)).sort(compareProjects);
        rootId = cycle[0].id;
        orphanRootIds.add(rootId);
        break;
      }
      position.set(current.id, path.length);
      path.push(current);
      if (!current.parent_id) {
        rootId = current.id;
        break;
      }
      const parent = byId.get(current.parent_id);
      if (!parent) {
        rootId = current.id;
        orphanRootIds.add(rootId);
        break;
      }
      current = parent;
    }

    for (const row of path) rootIdById.set(row.id, rootId);
    return rootId;
  }

  for (const row of ordered) {
    if (row?.id) resolveRoot(row);
  }

  const roots = new Map();
  for (const row of ordered) {
    if (!row?.id) continue;
    const rootId = rootIdById.get(row.id);
    if (rootId === row.id && !roots.has(rootId)) {
      roots.set(rootId, {
        ...row,
        ...(orphanRootIds.has(rootId) ? { isOrphan: true } : {}),
        children: []
      });
    }
  }
  for (const row of ordered) {
    if (!row?.id) continue;
    const rootId = rootIdById.get(row.id);
    if (rootId !== row.id) roots.get(rootId)?.children.push({ ...row, children: [] });
  }
  const result = [...roots.values()].sort(compareProjects);
  for (const root of result) root.children.sort(compareProjects);
  return result;
}

function budgetNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function projectBudgetOf(root) {
  const children = Array.isArray(root?.children) ? root.children : [];
  const ownPlanned = budgetNumber(root?.budget_planned);
  const ownActual = budgetNumber(root?.budget_actual);
  const childPlanned = okrRound2(children
    .map(row => budgetNumber(row.budget_planned))
    .filter(value => value != null)
    .reduce((sum, value) => sum + value, 0));
  const childActual = children.map(row => budgetNumber(row.budget_actual)).filter(value => value != null);
  const planned = ownPlanned != null ? ownPlanned : childPlanned;
  const fromChildren = ownPlanned == null && childPlanned > 0;
  const unallocated = ownPlanned != null ? Math.max(okrRound2(ownPlanned - childPlanned), 0) : 0;
  const overAllocated = ownPlanned != null && childPlanned > ownPlanned;
  const actual = childActual.length > 0
    ? childActual.reduce((sum, value) => sum + value, 0)
    : (ownActual ?? 0);
  return {
    planned: okrRound2(planned),
    actual: okrRound2(actual),
    ownPlanned,
    childPlanned,
    fromChildren,
    unallocated,
    overAllocated
  };
}

export function summarizeProjectBudget(tree) {
  const total = (tree || []).reduce((sum, root) => {
    const budget = projectBudgetOf(root);
    sum.planned += budget.planned;
    sum.actual += budget.actual;
    return sum;
  }, { planned: 0, actual: 0 });
  return { planned: okrRound2(total.planned), actual: okrRound2(total.actual) };
}

export function okrChipLabel(kr, okrById) {
  const code = String(kr?.code || "");
  if (!kr?.parent_id) return code;
  const parent = mapValue(okrById, kr.parent_id);
  return parent?.code ? `${parent.code} › ${code}` : code;
}

export function deriveProjectObjectives(project, okrById) {
  const found = new Map();
  for (const id of projectOkrIds(project)) {
    const kr = mapValue(okrById, id);
    if (!kr?.parent_id) continue;
    const objective = mapValue(okrById, kr.parent_id);
    if (objective) found.set(objective.id, objective);
  }
  return [...found.values()].sort(compareOkrs);
}

export function okrProgress(kr, checkin) {
  if (!checkin) return null;
  const target = Number(kr?.target_value);
  if (kr?.target_value == null || !Number.isFinite(target) || target <= 0) return null;

  const populationTotal = Number(checkin.population_total);
  const usePopulation = checkin.population_total != null &&
    Number.isFinite(populationTotal) && populationTotal > 0 && checkin.population_passed != null;
  let actual = null;
  if (usePopulation) {
    const populationPassed = Number(checkin.population_passed);
    if (!Number.isFinite(populationPassed)) return null;
    actual = okrRound2(populationPassed / populationTotal * 100);
  } else if (checkin.actual_value != null && checkin.actual_value !== "") {
    actual = Number(checkin.actual_value);
    if (!Number.isFinite(actual)) return null;
  }
  if (actual == null) return null;
  return {
    actual,
    target,
    ratio: okrRound2(actual / target),
    isPopulation: usePopulation
  };
}

export function okrScore(kr, checkin) {
  const progress = okrProgress(kr, checkin);
  return progress ? Math.min(okrRound2(progress.ratio), 1) : null;
}

export function okrObjectiveScore(objective, checkinsByKr, thresholds = null) {
  const keyResults = Array.isArray(objective?.keyResults) ? objective.keyResults : [];
  const thresholdValue = Number(thresholds?.oPass);
  const oPass = Number.isFinite(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 1
    ? thresholdValue
    : OKR_PASS_DEFAULT;
  let measured = 0;
  let textOnly = 0;
  let sum = 0;
  for (const kr of keyResults) {
    const checkin = mapValue(checkinsByKr, kr.id);
    const score = okrScore(kr, checkin);
    if (score == null) {
      if (checkin) textOnly += 1;
    } else {
      measured += 1;
      sum += score;
    }
  }
  const total = keyResults.length;
  const score = total > 0 ? okrRound2(sum / total) : null;
  return { score, measured, total, passed: score !== null && score >= oPass, textOnly };
}

export function indexCheckinsByOkr(checkins) {
  const result = new Map();
  for (const checkin of (checkins || [])) {
    if (!checkin?.okr_id) continue;
    const previous = result.get(checkin.okr_id);
    if (!previous || String(checkin.measured_on || "") > String(previous.measured_on || "")) {
      result.set(checkin.okr_id, checkin);
    }
  }
  return result;
}

export function okrCoverage(okrTree, projects) {
  const usableProjects = (projects || []).filter(project => project?.status !== "ยกเลิก");
  const result = new Map();
  for (const objective of (okrTree?.objectives || [])) {
    for (const kr of (objective.keyResults || [])) {
      const linked = usableProjects.filter(project => projectOkrIds(project).includes(kr.id));
      const linkedIds = new Set(linked.map(project => project.id));
      const budgetRows = linked.filter(project =>
        !usableProjects.some(child => child.parent_id === project.id && linkedIds.has(child.id))
      );
      const plannedBudget = budgetRows.reduce(
        (sum, project) => sum + (budgetNumber(project.budget_planned) ?? 0), 0
      );
      result.set(kr.id, {
        projects: linked,
        plannedBudget: okrRound2(plannedBudget),
        isUncovered: linked.length === 0
      });
    }
  }
  return result;
}

export function buildOkrTrend(chain, checkinsByOkr) {
  return (chain || []).slice()
    .sort((a, b) => String(a?.year || "").localeCompare(String(b?.year || ""), "th", { numeric: true }))
    .flatMap(kr => {
      const checkin = mapValue(checkinsByOkr, kr.id);
      if (!checkin) return [];
      const populationTotal = checkin.population_total == null ? null : Number(checkin.population_total);
      const hasPopulation = Number.isFinite(populationTotal) && populationTotal > 0 &&
        checkin.population_passed != null;
      const percent = hasPopulation
        ? okrRound2(Number(checkin.population_passed) / populationTotal * 100)
        : null;
      const value = checkin.actual_value == null ? null : Number(checkin.actual_value);
      const storedScore = checkin.score == null ? null : Number(checkin.score);
      return [{
        year: kr.year,
        value: Number.isFinite(value) ? value : null,
        percent,
        score: Number.isFinite(storedScore) ? storedScore : okrScore(kr, checkin),
        populationTotal: Number.isFinite(populationTotal) ? populationTotal : null
      }];
    });
}

export function suggestOkrValue(kr, ctx) {
  if (kr?.auto_source === "นับโครงการที่เสร็จสิ้น") {
    const range = ctx?.range;
    if (!range?.start || !range?.end) return { value: null, explain: "" };
    const matched = (ctx?.projects || []).filter(project =>
      project?.status === "เสร็จสิ้น" &&
      project?.approved_at &&
      project.start_date >= range.start && project.start_date <= range.end &&
      projectOkrIds(project).includes(kr.id)
    );
    const projectCount = matched.filter(row => row.kind === "โครงการ").length;
    const activityCount = matched.filter(row => row.kind === "กิจกรรม").length;
    return {
      value: matched.length,
      explain: `นับเฉพาะที่ผ่านการอนุมัติ: ${projectCount} โครงการ และ ${activityCount} กิจกรรมที่เสร็จสิ้นในช่วงปีการศึกษา`
    };
  }
  if (kr?.auto_source === "จำนวนนักเรียน") {
    const current = Number(ctx?.studentCounts?.current);
    const previous = Number(ctx?.studentCounts?.previous);
    if (ctx?.studentCounts?.previous == null || !Number.isFinite(previous) || previous <= 0) {
      return { value: null, explain: "ไม่มีข้อมูลนักเรียนปีก่อน จึงเทียบการเปลี่ยนแปลงไม่ได้" };
    }
    if (ctx?.studentCounts?.current == null || !Number.isFinite(current)) {
      return { value: null, explain: "ไม่มีข้อมูลนักเรียนปีปัจจุบัน จึงคำนวณการเปลี่ยนแปลงไม่ได้" };
    }
    return {
      value: okrRound2((current - previous) / previous * 100),
      explain: `เทียบนักเรียนปีปัจจุบัน ${current} คน กับปีก่อน ${previous} คน`
    };
  }
  return { value: null, explain: "" };
}
// ---------- จบสูตรล้วน OKR ----------

export async function loadSchoolOkrs(year) {
  const { data, error } = await sb.from("school_okrs")
    .select("*")
    .eq("year", year)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error("โหลด OKR ของโรงเรียนไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function loadOkrCheckins(okrIds) {
  const ids = [...new Set((okrIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await sb.from("okr_checkins").select("*").in("okr_id", ids);
  if (error) throw new Error("โหลดผลวัด OKR ไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function loadOkrLineage(krRows) {
  const starts = (krRows || []).filter(row => row?.id);
  const byId = new Map(starts.map(row => [row.id, row]));
  const seen = new Set(byId.keys());
  let frontier = [...new Set(starts.map(row => row.carried_from_id).filter(id => id && !seen.has(id)))];

  for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
    const { data, error } = await sb.from("school_okrs").select("*").in("id", frontier);
    if (error) throw new Error("โหลดสายสืบทอด OKR ไม่สำเร็จ: " + error.message);
    const fetched = data || [];
    for (const row of fetched) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      byId.set(row.id, row);
    }
    frontier = [...new Set(fetched
      .map(row => row?.carried_from_id)
      .filter(id => id && !seen.has(id)))];
  }

  const result = new Map();
  for (const start of starts) {
    const chain = [];
    const localSeen = new Set();
    let current = start;
    for (let depth = 0; current && depth <= 10 && !localSeen.has(current.id); depth += 1) {
      chain.push(current);
      localSeen.add(current.id);
      current = current.carried_from_id ? byId.get(current.carried_from_id) : null;
    }
    chain.sort((a, b) => String(a.year || "").localeCompare(String(b.year || ""), "th", { numeric: true }));
    result.set(start.id, chain);
  }
  return result;
}

export async function loadOkrThresholds() {
  try {
    const [krRaw, oRaw] = await Promise.all([
      getSetting("okr_kr_pass"),
      getSetting("okr_o_pass")
    ]);
    const valid = raw => {
      const value = Number(raw);
      return raw !== null && String(raw).trim() !== "" &&
        Number.isFinite(value) && value >= 0 && value <= 1
        ? value
        : OKR_PASS_DEFAULT;
    };
    return { krPass: valid(krRaw), oPass: valid(oRaw) };
  } catch (_) {
    return { krPass: OKR_PASS_DEFAULT, oPass: OKR_PASS_DEFAULT };
  }
}

// เรียก Jibble สดผ่าน Edge Function scope "today"
// basic: server คืนเฉพาะ checkedIn/total เท่านั้น · full: นับด้วย computeDayStatus() ตัวเดิม
export async function loadTodayStaffSummary() {
  const today = toDateStr(bangkokNow());
  const [result, scheduleRes, holidayRes, settings, dutyTypes] = await Promise.all([
    syncJibble("today"),
    sb.from("work_schedule").select("*"),
    sb.from("work_holidays").select("*").eq("holiday_date", today),
    getHrSettings(),
    getDutyTypes(true)
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
  const fieldDuties = [];
  const latePermissions = [];
  const dutyRoster = [];
  const attendanceDutyType = dutyTypes.find(row =>
    row.affects_attendance === true && row.start_time);
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
    if (row.on_field_duty === true) {
      fieldDuties.push({
        staff_id: id,
        start_date: today,
        end_date: today,
        kind: "ปฏิบัติหน้าที่นอกสถานที่",
        title: "ออกปฏิบัติหน้าที่"
      });
    }
    if (row.permit_until) {
      latePermissions.push({
        staff_id: id,
        permit_date: today,
        until_time: row.permit_until
      });
    }
    if (row.on_duty === true) {
      dutyRoster.push({
        staff_id: id,
        duty_date: today,
        duty_type: attendanceDutyType?.code || null
      });
    }
    return {
      id,
      exempt: row.exempt === true,
      allowed_late_time: row.allowed_late_time || null,
      is_active: true
    };
  });
  const attendanceDutyByKey = new Map();
  if (attendanceDutyType) {
    dutyRoster.forEach(row => attendanceDutyByKey.set(row.staff_id + "|" + row.duty_date, {
      ...row,
      start_time: attendanceDutyType.start_time
    }));
  }
  const ctx = {
    staff: staffRows,
    attendance,
    holidays: new Set((holidayRes.data || []).map(row => row.holiday_date)),
    schedule,
    leaves,
    fieldDuties,
    latePermissions,
    dutyRoster,
    dutyTypes,
    dutyTypeByCode: new Map(dutyTypes.map(row => [row.code, row])),
    attendanceDutyByKey,
    dutyByKey: new Set(attendanceDutyByKey.keys()),
    settings
  };
  const counts = { present: 0, late: 0, leave: 0, offsite: 0, absent: 0, pending: 0 };
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
// ตารางเวรหลายหน้าที่
// ------------------------------------------------------------
// duty_types = รายการงานและเวลา · duty_pattern = แม่แบบรายสัปดาห์
// duty_roster = ตารางจริงรายวันที่รายงานอ่าน
// การสร้างจากแม่แบบต้องข้ามวันหยุด/วันไม่ทำงาน และห้ามทับแถวที่สลับมือไว้แล้ว
// ============================================================
export async function getDutyTypes(includeInactive = false) {
  let query = sb.from("duty_types").select("*").order("sort_order").order("code");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error("โหลดรายการงานเวรไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function getDutyPattern() {
  const { data, error } = await sb.from("duty_pattern")
    .select("staff_id,weekday,duty_type")
    .order("weekday")
    .order("duty_type")
    .order("staff_id");
  if (error) throw new Error("โหลดรูปแบบเวรไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function getDutyRoster(from, to) {
  const { data, error } = await fetchAllRows(() => {
    let query = sb.from("duty_roster")
      .select("duty_date,duty_type,staff_id,note,created_by,created_at");
    if (from) query = query.gte("duty_date", from);
    if (to) query = query.lte("duty_date", to);
    return query;
  }, ["duty_date", "duty_type", "staff_id"]);
  if (error) throw new Error("โหลดตารางเวรไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function saveDutyPattern(staffId, weekday, dutyType) {
  const { error } = await sb.from("duty_pattern").upsert({
    staff_id: staffId,
    weekday: Number(weekday),
    duty_type: dutyType
  }, { onConflict: "staff_id,weekday,duty_type", ignoreDuplicates: true });
  if (error) throw new Error("บันทึกรูปแบบเวรไม่สำเร็จ: " + error.message);
}

export async function removeDutyPattern(staffId, weekday, dutyType) {
  const { error } = await sb.from("duty_pattern")
    .delete()
    .eq("staff_id", staffId)
    .eq("weekday", Number(weekday))
    .eq("duty_type", dutyType);
  if (error) throw new Error("ลบรูปแบบเวรไม่สำเร็จ: " + error.message);
}

export async function saveDutyRosterEntry(dutyDate, dutyType, staffId, createdBy, note = null) {
  const { error } = await sb.from("duty_roster").upsert({
    duty_date: dutyDate,
    duty_type: dutyType,
    staff_id: staffId,
    note: note || null,
    created_by: createdBy || null
  }, { onConflict: "duty_date,duty_type,staff_id", ignoreDuplicates: true });
  if (error) throw new Error("เพิ่มเวรไม่สำเร็จ: " + error.message);
}

export async function removeDutyRosterEntry(dutyDate, dutyType, staffId) {
  const { error } = await sb.from("duty_roster")
    .delete()
    .eq("duty_date", dutyDate)
    .eq("duty_type", dutyType)
    .eq("staff_id", staffId);
  if (error) throw new Error("ถอดเวรไม่สำเร็จ: " + error.message);
}

// ============================================================
// การสลับเวร (duty_swaps)
// ------------------------------------------------------------
// ⭐ ตารางเวรจริงยังมีใบเดียวคือ duty_roster — ตารางนี้คือใบคำขอ + ประวัติ
// ครูเปลี่ยนเวรได้ทางเดียวคือผ่าน rpc ด้านล่าง (RLS ไม่ให้ครูเขียน duty_roster ตรง)
// ข้อความ error จาก rpc เป็นภาษาไทยพร้อมแสดงให้ผู้ใช้อยู่แล้ว ห้ามกลืนทิ้ง
// ============================================================
export async function requestDutySwap(dutyDate, dutyType, toStaffId, reason = null,
                                      returnDutyDate = null, returnDutyType = null) {
  const { data, error } = await sb.rpc("request_duty_swap", {
    p_duty_date: dutyDate,
    p_duty_type: dutyType,
    p_to_staff_id: toStaffId,
    p_reason: reason || null,
    p_return_duty_date: returnDutyDate || null,
    p_return_duty_type: returnDutyType || null
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function listDutySwapReturnOptions(toStaffId) {
  const { data, error } = await sb.rpc("duty_swap_return_options", {
    p_to_staff_id: toStaffId
  });
  if (error) throw new Error("โหลดเวรของอีกฝ่ายไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function respondDutySwap(id, accept, note = null) {
  const { data, error } = await sb.rpc("respond_duty_swap", {
    p_id: id,
    p_accept: !!accept,
    p_note: note || null
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelDutySwap(id) {
  const { data, error } = await sb.rpc("cancel_duty_swap", { p_id: id });
  if (error) throw new Error(error.message);
  return data;
}

export async function listMyDutySwaps() {
  const { data, error } = await sb.rpc("my_duty_swaps");
  if (error) throw new Error("โหลดคำขอสลับเวรไม่สำเร็จ: " + error.message);
  return data || [];
}

// ⛔ ครูทั่วไปเรียกตัวนี้ไม่ได้ (join staff) — หน้าครูต้องใช้ listMyDutySwaps() เท่านั้น
export async function listDutySwaps(from, to) {
  const select = "*,from_staff:staff!duty_swaps_from_staff_id_fkey(full_name)," +
                 "to_staff:staff!duty_swaps_to_staff_id_fkey(full_name)";
  const page = column => fetchAllRows(() => {
    let query = sb.from("duty_swaps").select(select);
    if (from) query = query.gte(column, from);
    if (to) query = query.lte(column, to);
    return query;
  }, ["duty_date", "requested_at", "id"]);

  const [main, ret] = await Promise.all([page("duty_date"), page("return_duty_date")]);
  if (main.error) throw new Error("โหลดประวัติการสลับเวรไม่สำเร็จ: " + main.error.message);
  if (ret.error) throw new Error("โหลดประวัติการสลับเวรไม่สำเร็จ: " + ret.error.message);
  const byId = new Map([...(main.data || []), ...(ret.data || [])]
    .map(row => [row.id, row]));
  return [...byId.values()].sort((a, b) =>
    a.duty_date.localeCompare(b.duty_date) ||
    String(a.requested_at).localeCompare(String(b.requested_at)));
}

export async function logHrDutySwap(dutyDate, dutyType, fromStaffId, toStaffId) {
  // trigger เติม responded_at / responded_by / requested_by ให้เอง ไม่ต้องส่ง
  const { error } = await sb.from("duty_swaps").insert({
    duty_date: dutyDate,
    duty_type: dutyType,
    from_staff_id: fromStaffId,
    to_staff_id: toStaffId,
    source: "ฝ่ายบุคคล",
    status: "ตอบรับแล้ว"
  });
  if (error) throw new Error("บันทึกประวัติการสลับไม่สำเร็จ: " + error.message);
}

export async function generateDutyRosterFromPattern(from, to, createdBy) {
  const [pattern, existing, activeDutyTypes, scheduleRes, holidayRes] = await Promise.all([
    getDutyPattern(),
    getDutyRoster(from, to),
    getDutyTypes(),
    sb.from("work_schedule").select("weekday,is_working_day"),
    sb.from("work_holidays").select("holiday_date").gte("holiday_date", from).lte("holiday_date", to)
  ]);
  if (scheduleRes.error) throw new Error("โหลดวันทำงานไม่สำเร็จ: " + scheduleRes.error.message);
  if (holidayRes.error) throw new Error("โหลดวันหยุดไม่สำเร็จ: " + holidayRes.error.message);

  const workingWeekdays = new Set((scheduleRes.data || [])
    .filter(row => row.is_working_day)
    .map(row => Number(row.weekday)));
  const holidays = new Set((holidayRes.data || []).map(row => row.holiday_date));
  const activeDutyCodes = new Set(activeDutyTypes.map(row => row.code));
  const patternByWeekday = new Map();
  for (const row of pattern) {
    if (!activeDutyCodes.has(row.duty_type)) continue;
    const weekday = Number(row.weekday);
    if (!patternByWeekday.has(weekday)) patternByWeekday.set(weekday, []);
    patternByWeekday.get(weekday).push(row);
  }
  // ถ้า (วัน + งาน) มีคนอยู่แล้ว แปลว่าช่องนี้เคยสร้างหรือแก้มือแล้ว:
  // ข้ามทั้งช่องเพื่อไม่เติมคนที่ถูกสลับ/ถอดออกกลับมา
  const occupiedSlots = new Set(existing.map(row => row.duty_date + "|" + row.duty_type));

  const candidates = [];
  for (const dutyDate of eachDate(from, to)) {
    const weekday = isoWeekday(dutyDate);
    if (!workingWeekdays.has(weekday) || holidays.has(dutyDate)) continue;
    for (const row of (patternByWeekday.get(weekday) || [])) {
      if (occupiedSlots.has(dutyDate + "|" + row.duty_type)) continue;
      candidates.push({
        duty_date: dutyDate,
        duty_type: row.duty_type,
        staff_id: row.staff_id,
        created_by: createdBy || null
      });
    }
  }
  let inserted = 0;
  if (candidates.length) {
    // คีย์ใหม่ทำให้คนเดียวมีได้หลายงานในวันเดียว
    const { data, error } = await sb.from("duty_roster")
      .upsert(candidates, {
        onConflict: "duty_date,duty_type,staff_id",
        ignoreDuplicates: true
      })
      .select("duty_date,duty_type,staff_id");
    if (error) throw new Error("สร้างเวรจากรูปแบบไม่สำเร็จ: " + error.message);
    inserted = (data || []).length;
  }

  const yearMonth = from.slice(0, 7);
  const { error: syncError } = await sb.from("duty_month_sync").upsert({
    year_month: yearMonth,
    generated_at: new Date().toISOString(),
    generated_by: createdBy || null,
    rows_created: inserted
  }, { onConflict: "year_month" });
  if (syncError) throw new Error("บันทึกสถานะการสร้างเวรไม่สำเร็จ: " + syncError.message);
  return { candidates: candidates.length, inserted };
}

// ============================================================
// ออกปฏิบัติหน้าที่นอกสถานที่ / อบรม
// ------------------------------------------------------------
// รายละเอียดงานเป็นของฝ่ายบุคคล ส่วนลิงก์รายงานแยกตารางเพื่อให้ครูแก้ได้
// โดยไม่เปิดสิทธิ์ให้แก้วันที่ ประเภท หรือหัวข้อของงาน
// ============================================================
export async function getStaffFieldDuties({ from = null, to = null, staffId = null } = {}) {
  let query = sb.from("staff_field_duties")
    .select("*")
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });
  // ดึงแบบ "คาบเกี่ยวช่วง" เช่นเดียวกับใบลา ห้ามใช้ between
  if (to) query = query.lte("start_date", to);
  if (from) query = query.gte("end_date", from);
  if (staffId) query = query.eq("staff_id", staffId);
  const { data, error } = await query;
  if (error) throw new Error("โหลดรายการออกปฏิบัติหน้าที่ไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function createStaffFieldDuty(fields) {
  const { data, error } = await sb.from("staff_field_duties")
    .insert(fields)
    .select("*")
    .single();
  if (error) throw new Error("บันทึกการออกปฏิบัติหน้าที่ไม่สำเร็จ: " + error.message);
  return data;
}

export async function updateStaffFieldDuty(id, fields) {
  const { data, error } = await sb.from("staff_field_duties")
    .update(fields)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error("แก้ไขการออกปฏิบัติหน้าที่ไม่สำเร็จ: " + error.message);
  return data;
}

export async function deleteStaffFieldDuty(id) {
  const { error } = await sb.from("staff_field_duties").delete().eq("id", id);
  if (error) throw new Error("ลบการออกปฏิบัติหน้าที่ไม่สำเร็จ: " + error.message);
}

export async function getTrainingReports(fieldDutyIds = null) {
  if (Array.isArray(fieldDutyIds) && fieldDutyIds.length === 0) return [];
  let query = sb.from("training_reports")
    .select("field_duty_id,report_url,submitted_at,updated_at")
    .order("updated_at", { ascending: false });
  if (Array.isArray(fieldDutyIds)) query = query.in("field_duty_id", fieldDutyIds);
  const { data, error } = await query;
  if (error) throw new Error("โหลดลิงก์รายงานสรุปไม่สำเร็จ: " + error.message);
  return data || [];
}

export async function createTrainingReport(fieldDutyId, reportUrl) {
  const { data, error } = await sb.from("training_reports")
    .insert({ field_duty_id: fieldDutyId, report_url: reportUrl })
    .select("field_duty_id,report_url,submitted_at,updated_at")
    .single();
  if (error) throw new Error("บันทึกลิงก์รายงานสรุปไม่สำเร็จ");
  return data;
}

export async function updateTrainingReport(fieldDutyId, reportUrl) {
  const { data, error } = await sb.from("training_reports")
    .update({ report_url: reportUrl, updated_at: new Date().toISOString() })
    .eq("field_duty_id", fieldDutyId)
    .select("field_duty_id,report_url,submitted_at,updated_at")
    .single();
  if (error) throw new Error("แก้ไขลิงก์รายงานสรุปไม่สำเร็จ");
  return data;
}

export async function deleteTrainingReport(fieldDutyId) {
  const { error } = await sb.from("training_reports")
    .delete()
    .eq("field_duty_id", fieldDutyId);
  if (error) throw new Error("ลบลิงก์รายงานสรุปไม่สำเร็จ");
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
//   4.5 ออกปฏิบัติหน้าที่/อบรม                    → 'offsite'  ทำงานเต็มวันแต่ไม่ได้อยู่โรงเรียน
//   5. มีเวลาเข้า  → เทียบ cutoff → 'present' หรือ 'late'
//   6. วันนี้ที่ยังไม่ถึงเวลาปิดวัน (18:00)        → 'pending'  ยังไม่ครบวัน ห้ามนับว่าขาด
//   7. ไม่มีเวลาเข้าเลยหลังปิดวัน                 → 'absent'
//
//   normalCutoff = staff.allowed_late_time (ถ้ามี)  มิฉะนั้น  ตารางงาน.start_time + late_grace_minutes
//   วันปกติ: cutoff = max(normalCutoff, เวลาในใบขออนุญาตเข้าสายรายวัน)
//   งานที่ affects_attendance และมี start_time:
//             cutoff = เวลาของงานนั้นแบบแทนที่ทั้งหมด (ไม่ผ่อนผัน/ไม่อนุโลม/ไม่ใช้ใบขอ)
// ============================================================

export const WORK_STATUS_LABEL = {
  holiday: "วันหยุด", pending: "ยังไม่ครบวัน", present: "มา",
  late: "สาย", leave: "ลา", offsite: "ปฏิบัติหน้าที่นอกสถานที่", absent: "ขาด"
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
  const [staffRes, attRes, holRes, schedRes, leaveRes, fieldDutyRes, permitRes, dutyRes, dutyTypeRes, settings] = await Promise.all([
    sb.from("staff").select("*").order("full_name"),
    // 🪤 สองตารางนี้ทะลุ 1,000 แถวเมื่อดูสะสมทั้งรอบปี ห้ามกลับไปใช้ .select() ตรง ๆ
    fetchAllRows(() => sb.from("work_attendance").select("*")
      .gte("work_date", from).lte("work_date", to), "id"),
    sb.from("work_holidays").select("*").gte("holiday_date", from).lte("holiday_date", to),
    sb.from("work_schedule").select("*"),
    // ใบลาที่ "คาบเกี่ยว" ช่วงนี้ (เริ่มก่อนช่วงแต่ยังไม่จบ ก็ต้องเอามาด้วย)
    sb.from("staff_leaves").select("*").lte("start_date", to).gte("end_date", from),
    // งานนอกสถานที่ที่ "คาบเกี่ยว" ช่วงนี้ — ห้ามใช้ between เพราะรายการข้ามเดือนจะหาย
    sb.from("staff_field_duties").select("*").lte("start_date", to).gte("end_date", from),
    sb.from("late_permissions").select("*").gte("permit_date", from).lte("permit_date", to),
    fetchAllRows(() => sb.from("duty_roster").select("*")
      .gte("duty_date", from).lte("duty_date", to),
      ["duty_date", "duty_type", "staff_id"]),
    sb.from("duty_types").select("*").order("sort_order").order("code"),
    getHrSettings()
  ]);

  const attendance = new Map();
  const failed = [
    [staffRes, "โหลดทะเบียนบุคลากร"],
    [attRes, "โหลดเวลาเข้าออก"],
    [holRes, "โหลดวันหยุด"],
    [schedRes, "โหลดตารางวันทำงาน"],
    [leaveRes, "โหลดข้อมูลลา"],
    [fieldDutyRes, "โหลดข้อมูลออกปฏิบัติหน้าที่"],
    [permitRes, "โหลดใบขอเข้าสาย"],
    [dutyRes, "โหลดตารางเวร"],
    [dutyTypeRes, "โหลดรายการงานเวร"]
  ].find(([result]) => result.error);
  if (failed) throw new Error(`${failed[1]}ไม่สำเร็จ: ${failed[0].error.message}`);

  (attRes.data || []).forEach(r => attendance.set(r.staff_id + "|" + r.work_date, r));

  const schedule = new Map();
  (schedRes.data || []).forEach(r => schedule.set(r.weekday, r));

  const dutyTypes = dutyTypeRes.data || [];
  const dutyTypeByCode = new Map(dutyTypes.map(row => [row.code, row]));
  const attendanceDutyByKey = new Map();
  const dutySubstituteOnlyByKey = new Map();
  for (const row of (dutyRes.data || [])) {
    const type = dutyTypeByCode.get(row.duty_type);
    if (!type?.affects_attendance || !type.start_time) continue;
    const key = row.staff_id + "|" + row.duty_date;
    attendanceDutyByKey.set(key, {
      ...row,
      start_time: type.start_time
    });
    dutySubstituteOnlyByKey.set(key,
      (dutySubstituteOnlyByKey.get(key) ?? true) && isCoverageDutyRow(row));
  }
  const dutySubstituteOnlyKeys = new Set(
    [...dutySubstituteOnlyByKey].filter(([, substituteOnly]) => substituteOnly).map(([key]) => key)
  );

  return {
    staff: staffRes.data || [],
    attendance,
    holidays: new Set((holRes.data || []).map(r => r.holiday_date)),
    schedule,
    leaves: leaveRes.data || [],
    fieldDuties: fieldDutyRes.data || [],
    latePermissions: permitRes.data || [],
    dutyRoster: dutyRes.data || [],
    dutyTypes,
    dutyTypeByCode,
    attendanceDutyByKey,
    dutyByKey: new Set(attendanceDutyByKey.keys()),
    dutySubstituteOnlyKeys,
    settings
  };
}

// ---------- ตัดสินสถานะของคนหนึ่งในวันหนึ่ง ----------
export function computeDayStatus(staff, dateStr, ctx) {
  const sched = ctx.schedule.get(isoWeekday(dateStr));
  const dutyKey = staff.id + "|" + dateStr;
  const attendanceDuty = ctx.attendanceDutyByKey instanceof Map
    ? ctx.attendanceDutyByKey.get(dutyKey)
    : null;
  const onDuty = !!attendanceDuty;
  const dutyStartTime = attendanceDuty?.start_time || null;

  // 1) ไม่ใช่วันทำงาน หรือเป็นวันหยุดที่โรงเรียนประกาศ
  if (!sched || !sched.is_working_day || ctx.holidays.has(dateStr)) {
    return { status: "holiday", weight: 0, onDuty };
  }

  // 2) วันในอนาคตยังสรุปไม่ได้
  const now = bangkokNow();
  const today = toDateStr(now);
  if (dateStr > today) return { status: "pending", weight: 0, onDuty };

  // 3) คนที่ได้รับการอนุโลม ไม่ต้องลงเวลา ถือว่ามาทุกวันทำงาน
  if (staff.exempt) return { status: "present", weight: 1, exempt: true, onDuty };

  // 4) ใบลา — ครึ่งวันนับ 0.5 (โครงสร้างบังคับให้ครึ่งวันเป็นวันเดียวอยู่แล้ว)
  const leave = ctx.leaves.find(l =>
    l.staff_id === staff.id && l.start_date <= dateStr && dateStr <= l.end_date);
  if (leave) {
    return {
      status: "leave", weight: leave.day_portion === "full" ? 1 : 0.5,
      leaveType: leave.leave_type, portion: leave.day_portion, reason: leave.reason, onDuty
    };
  }

  // 4.5) ออกปฏิบัติหน้าที่/อบรม — เป็นการทำงานเต็มวัน ไม่ใช่ลา และไม่ต้องมีเวลาเข้า
  const fieldDuty = (ctx.fieldDuties || []).find(row =>
    row.staff_id === staff.id && row.start_date <= dateStr && dateStr <= row.end_date);
  if (fieldDuty) {
    return {
      status: "offsite", weight: 1,
      kind: fieldDuty.kind, title: fieldDuty.title, onDuty
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
    // วันเวรใช้เวลาเวร "แทนที่" ทั้งหมด: ไม่บวก grace · ไม่สนอนุโลมถาวร · ไม่สนใบขอรายวัน
    // วันปกติยังคง max() เดิม เพื่อไม่ลดสิทธิ์ของคนที่มี allowed_late_time ช้ากว่าใบขอ
    const cutoff = onDuty
      ? timeToMinutes(dutyStartTime)
      : permitUntil === null
        ? normalCutoff
        : Math.max(normalCutoff, permitUntil);
    const arrived = timeToMinutes(rec.first_in_local);
    const isLate = arrived > cutoff;
    return {
      status: isLate ? "late" : "present", weight: 1,
      firstIn: rec.first_in_local, autoOut: rec.auto_out,
      lateMinutes: isLate ? arrived - cutoff : 0,
      latePermissionUsed: onDuty
        ? false
        : !isLate && permitUntil !== null && arrived > normalCutoff,
      onDuty,
      dutyStartTime: onDuty ? dutyStartTime : null
    };
  }

  // 6) วันนี้ยังไม่ปิดวันและยังไม่มีเวลาเข้า — รอก่อน ห้ามตัดสินว่าขาด
  if (dateStr === today) {
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (nowMin < timeToMinutes(ctx.settings.dayFinalTime)) {
      return { status: "pending", weight: 0, onDuty };
    }
  }

  // 7) ไม่มีร่องรอยการลงเวลาเลยหลังปิดวัน
  return { status: "absent", weight: 1, onDuty };
}

// ---------- สรุปของคนหนึ่งตลอดช่วง ----------
export function summarizeStaff(staff, from, to, ctx) {
  const days = eachDate(from, to);
  const sum = {
    staff, workDays: 0, present: 0, late: 0, lateMinutes: 0, absent: 0,
    leaveDays: 0, leaveByType: {}, offsiteDays: 0, pendingDays: 0,
    dutyDays: 0, dutySubstituteDays: 0, dutyLate: 0, dutyMissed: 0,
    permitRequested: (ctx.latePermissions || []).filter(p =>
      p.staff_id === staff.id && from <= p.permit_date && p.permit_date <= to).length,
    permitUsed: 0, rows: []
  };
  for (const d of days) {
    const r = computeDayStatus(staff, d, ctx);
    sum.rows.push({ date: d, ...r });
    if (r.latePermissionUsed) sum.permitUsed++;
    // วันหยุดไม่นับเป็นวันเวร แม้แถวเวรจะยังค้างอยู่ (เช่นประกาศหยุดหลังสร้างเวรไปแล้ว)
    // ไม่งั้น "วันเวร N" จะบวกวันที่ไม่มีใครต้องมารับนักเรียนจริง
    if (r.onDuty && r.status !== "holiday") {
      sum.dutyDays++;
      if (ctx.dutySubstituteOnlyKeys?.has(staff.id + "|" + d)) sum.dutySubstituteDays++;
      if (r.status === "late") sum.dutyLate++;
      if (r.status === "leave" || r.status === "offsite" || r.status === "absent") sum.dutyMissed++;
    }
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
    else if (r.status === "offsite") sum.offsiteDays += r.weight;
    else if (r.status === "leave") {
      sum.leaveDays += r.weight;
      sum.leaveByType[r.leaveType] = (sum.leaveByType[r.leaveType] || 0) + r.weight;
      // ลาครึ่งวัน = มาอีกครึ่งวัน จึงนับเป็นมาด้วยครึ่งหนึ่ง
      if (r.weight === 0.5) sum.present += 0.5;
    }
  }
  return sum;
}

// ---------- วันลาที่ตัดโควตา ----------
// นับ "วันที่ลาจริง" ไม่ใช่ "จำนวนใบ" — ใบซ้ำหรือใบซ้อนวันกันจึงไม่ถูกนับซ้ำ
// 🪤 จงใจไม่ใช้ computeDayStatus()/summarizeStaff() เพราะตัวนั้นตอบ "pending" ให้วันในอนาคต
//    ก่อนจะดูใบลา ใบที่ลงล่วงหน้าจึงหายไปจากยอด
//    มติผู้ใช้ 2026-08-13: สิทธิ์ที่ผูกไปแล้วต้องตัดโควตาทันที
//    เหตุผลเต็ม: personnel/PLAN.md หัวข้อ "⭐ นิยาม วันลาที่ตัดโควตา"
export async function loadLeaveContext(from, to) {
  const [leaveRes, holRes, schedRes] = await Promise.all([
    sb.from("staff_leaves").select("staff_id,leave_type,day_portion,start_date,end_date")
      .lte("start_date", to).gte("end_date", from),
    sb.from("work_holidays").select("holiday_date").gte("holiday_date", from).lte("holiday_date", to),
    sb.from("work_schedule").select("weekday,is_working_day")
  ]);
  if (leaveRes.error) throw new Error("โหลดใบลาไม่สำเร็จ: " + leaveRes.error.message);
  if (holRes.error)   throw new Error("โหลดวันหยุดไม่สำเร็จ: " + holRes.error.message);
  if (schedRes.error) throw new Error("โหลดตารางงานไม่สำเร็จ: " + schedRes.error.message);
  const schedule = new Map();
  (schedRes.data || []).forEach(r => schedule.set(r.weekday, r));
  return {
    leaves: leaveRes.data || [],
    holidays: new Set((holRes.data || []).map(r => r.holiday_date)),
    schedule
  };
}

// → { 'ลากิจ': 3.5, 'ลาป่วย': 1, ... }
export function countLeaveDaysByType(staffId, from, to, ctx) {
  const out = {};
  for (const d of eachDate(from, to)) {
    const sched = ctx.schedule.get(isoWeekday(d));
    if (!sched || !sched.is_working_day || ctx.holidays.has(d)) continue;

    // ใบของวันเดียวกัน ยุบด้วยคู่ (ประเภท|ช่วงวัน) — ใบซ้ำเป๊ะ ๆ จึงเหลือใบเดียว
    const seen = new Map();
    for (const l of ctx.leaves) {
      if (l.staff_id !== staffId || l.start_date > d || d > l.end_date) continue;
      seen.set(l.leave_type + "|" + l.day_portion, l);
    }
    if (!seen.size) continue;

    const rows = [...seen.values()];
    const full = rows.find(l => l.day_portion === "full");
    if (full) {
      out[full.leave_type] = (out[full.leave_type] || 0) + 1;
      continue;
    }
    // ครึ่งวันหลายใบ (คนละประเภทได้) นับ 0.5 ต่อใบ แต่รวมทั้งวันต้องไม่เกิน 1 วัน
    let budget = 1;
    for (const l of rows) {
      const w = Math.min(0.5, budget);
      if (w <= 0) break;
      out[l.leave_type] = (out[l.leave_type] || 0) + w;
      budget -= w;
    }
  }
  return out;
}

// สรุปทุกคน (ใช้ที่หน้าสรุปเวลาทำงานของผู้บริหาร)
export function summarizeAll(from, to, ctx, { activeOnly = true } = {}) {
  return ctx.staff
    .filter(s => !activeOnly || s.is_active)
    .map(s => summarizeStaff(s, from, to, ctx));
}

// สรุปจำนวนงานที่บุคลากรถูกจัดให้ไปแทนในช่วงที่เลือก
// coverage_assignments เก็บ 1 แถวต่อ (วัน x งาน) จึงนับเป็น "งาน" ไม่ใช่จำนวนคาบ
export async function loadCoverageStats(from, to) {
  const { data, error } = await sb.from("coverage_assignments")
    .select("substitute_staff_id,kind,cover_date")
    .gte("cover_date", from)
    .lte("cover_date", to);
  if (error) throw new Error("โหลดข้อมูลงานแทนไม่สำเร็จ: " + error.message);

  const stats = new Map();
  for (const row of data || []) {
    if (!stats.has(row.substitute_staff_id)) {
      stats.set(row.substitute_staff_id, { "วิชา": 0, "ครูประจำชั้น": 0, "เวร": 0, total: 0 });
    }
    const sum = stats.get(row.substitute_staff_id);
    if (Object.prototype.hasOwnProperty.call(sum, row.kind)) sum[row.kind]++;
    sum.total++;
  }
  return stats;
}

// ---------- ปีการศึกษา ----------
// รอบปี = [วันเริ่มปีนี้, วันเริ่มปีถัดไป) → เดือนเมษายนตกอยู่ในปีก่อนหน้าอัตโนมัติ
// ทำให้ทุกวันในปฏิทินมีปีการศึกษาสังกัดเสมอ ไม่มีวันไหนตกหล่น
// ⚠️ ฝ่ายบุคคลใช้รอบของตัวเอง ดู getWorkYears() ด้านล่าง
export async function getAcademicYears() {
  const { data } = await sb.from("academic_years").select("*").order("year");
  return data || [];
}

// รอบปีทำงานของฝ่ายบุคคล — ครูเริ่มทำงานก่อนนักเรียนเปิดเรียนเพื่อเตรียมการ
// คืน "รูปแบบเดียวกับ getAcademicYears()" แต่สลับ start_date เป็นวันเริ่มรอบปีของครู
// → academicYearRange() / academicYearOf() ตัวเดิมใช้ต่อได้ทั้งดุ้น ไม่ต้องเขียนสูตรรอบปีซ้ำ
//   (จงใจไม่ทำ hrYearRange() ขึ้นมาใหม่ เพราะสูตรจะกลายเป็น 2 ชุดที่ต้องแก้คู่กัน)
// ปีที่ยังไม่ได้ตั้งวันเริ่มของฝ่ายบุคคล → ใช้วันเปิดเทอมเดิม ระบบเก่าจึงไม่พัง
export async function getWorkYears() {
  const [yearsRes, hrRes] = await Promise.all([
    sb.from("academic_years").select("*").order("year"),
    sb.from("hr_years").select("year,staff_start_date")
  ]);
  if (yearsRes.error) throw new Error("โหลดรายการปีไม่สำเร็จ: " + yearsRes.error.message);
  if (hrRes.error) throw new Error("โหลดวันเริ่มรอบปีทำงานไม่สำเร็จ: " + hrRes.error.message);

  const override = new Map((hrRes.data || []).map(r => [String(r.year), r.staff_start_date]));
  return (yearsRes.data || []).map(y => ({
    ...y,
    start_date: override.get(String(y.year)) || y.start_date,
    academic_start_date: y.start_date,
    hr_start_date: override.get(String(y.year)) || null
  }));
}

// บันทึกวันเริ่มรอบปีทำงานของฝ่ายบุคคล (หน้า personnel/hr-settings.html)
export async function saveHrYearStart(year, startDate) {
  const y = String(year == null ? "" : year).trim();
  const d = String(startDate == null ? "" : startDate).trim();
  if (!/^\d{4}$/.test(y)) throw new Error("ปีต้องเป็นตัวเลข 4 หลัก");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("กรุณาเลือกวันเริ่มรอบปีทำงาน");

  const { data, error } = await sb.from("hr_years")
    .upsert({ year: y, staff_start_date: d }, { onConflict: "year" })
    .select("year,staff_start_date")
    .single();
  if (error) throw new Error("บันทึกวันเริ่มรอบปีทำงานไม่สำเร็จ: " + error.message);
  return data;
}

// ล้างค่าที่ตั้งไว้ กลับไปใช้วันเปิดเทอมเดิม (ลบได้เฉพาะ admin ตาม RLS)
export async function clearHrYearStart(year) {
  const { error } = await sb.from("hr_years").delete().eq("year", String(year).trim());
  if (error) throw new Error("ล้างค่าไม่สำเร็จ: " + error.message);
}

// รายการปีสำหรับจุดที่สร้าง/แก้ข้อมูล = ปีที่ลงทะเบียนไว้ + ปีเก่าที่มีอยู่จริงในข้อมูล
// คืนค่าเรียงจากใหม่ไปเก่า และติด registered=false เพื่อให้หน้าจอเตือนโดยไม่ทำค่าปีเดิมหาย
export async function listSelectableYears(extraYears = []) {
  const { data, error } = await sb.from("academic_years").select("year,start_date").order("year");
  if (error) throw new Error("โหลดรายการปีการศึกษาไม่สำเร็จ: " + error.message);

  const byYear = new Map();
  for (const row of (data || [])) {
    if (!row.year) continue;
    byYear.set(String(row.year), {
      year: String(row.year),
      start_date: row.start_date || null,
      registered: true
    });
  }
  for (const item of (extraYears || [])) {
    const year = String(typeof item === "string" ? item : (item && item.year) || "").trim();
    if (!year || byYear.has(year)) continue;
    byYear.set(year, { year, start_date: null, registered: false });
  }
  return [...byYear.values()].sort((a, b) =>
    b.year.localeCompare(a.year, "th", { numeric: true })
  );
}

// เพิ่ม/แก้ปีการศึกษาจากจุดสร้างข้อมูล — วันเริ่มปีต้องมาจากปฏิทินโรงเรียนจริงเสมอ
export async function saveAcademicYear(year, startDate) {
  const normalizedYear = String(year == null ? "" : year).trim();
  const normalizedStartDate = String(startDate == null ? "" : startDate).trim();
  if (!/^\d{4}$/.test(normalizedYear)) {
    throw new Error("ปีการศึกษาต้องเป็นตัวเลข 4 หลัก เช่น 2570");
  }
  if (!normalizedStartDate) throw new Error("กรุณาเลือกวันเริ่มปี");

  const { data, error } = await sb.from("academic_years")
    .upsert({ year: normalizedYear, start_date: normalizedStartDate }, { onConflict: "year" })
    .select("year,start_date")
    .single();
  if (error) throw new Error("บันทึกปีการศึกษาไม่สำเร็จ: " + error.message);
  return data;
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
export async function getLeaveTypes(includeInactive = false) {
  let query = sb.from("leave_types").select("*").order("sort_order").order("code");
  if (!includeInactive) query = query.eq("active", true);
  const { data } = await query;
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

// ============================================================
// จัดคนแทนประจำวัน (coverage_assignments)
// เหตุผลและมติทั้งหมด: personnel/PLAN.md หัวข้อ "⭐ จัดคนแทนประจำวัน"
// ตรรกะ "วันนั้นใครไม่มา และแต่ละคนมีของค้างอะไรบ้าง" อยู่ที่นี่ที่เดียว
// (หน้า coverage.html เอาไปแสดงอย่างเดียว ไม่คิดเอง — กันแก้ที่หนึ่งลืมอีกที่)
// ============================================================

export const COVERAGE_KINDS = ["วิชา", "ครูประจำชั้น", "เวร"];

// คีย์ประจำตัวของ "ของค้าง 1 ชิ้น" — ใช้จับคู่รายการบนจอกับแถวที่บันทึกไว้แล้ว
// ต้องมี absent_staff_id อยู่ในคีย์ของเวร เพราะเวรระบุด้วย (คนที่ไม่มา + วัน + งาน)
// ส่วนวิชา/ครูประจำชั้นระบุด้วยตัวมันเองได้ (วิชาเดียวกันมีเจ้าของคนเดียว)
export function coverageItemKey(kind, ref, absentStaffId) {
  if (kind === "เวร") return "เวร:" + absentStaffId + ":" + ref;
  return kind + ":" + ref;
}
export function coverageRowKey(row) {
  if (row.kind === "เวร") return coverageItemKey("เวร", row.duty_type, row.absent_staff_id);
  if (row.kind === "วิชา") return coverageItemKey("วิชา", row.subject_id);
  return coverageItemKey("ครูประจำชั้น", row.homeroom_id);
}

// ---------- สิทธิ์เช็คชื่อของคนแทนในวันที่เลือก ----------
// ต้องกรอง substitute_staff_id เสมอ: ฝ่ายบุคคลอ่าน coverage_assignments ได้ทุกแถว
// ถ้าพึ่ง RLS อย่างเดียว หน้าจอของฝ่ายบุคคลจะปลดล็อกวิชา/ห้องของคนอื่นทั้งหมดผิด ๆ
export async function getMyCoverageFor(dateStr) {
  const empty = { subjectIds: new Set(), roomKeys: new Set() };
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError) throw new Error("ตรวจบัญชีผู้ใช้ไม่สำเร็จ: " + userError.message);
  const userId = userData.user?.id;
  if (!userId) return empty;

  const { data: ownStaff, error: staffError } = await sb.from("staff")
    .select("id").eq("user_id", userId).maybeSingle();
  if (staffError) throw new Error("โหลดข้อมูลบุคลากรของคุณไม่สำเร็จ: " + staffError.message);
  if (!ownStaff) return empty;

  const { data: rows, error: coverageError } = await sb.from("coverage_assignments")
    .select("kind,subject_id,homeroom_teachers(year,grade_level,classroom)")
    .eq("substitute_staff_id", ownStaff.id)
    .eq("cover_date", dateStr);
  if (coverageError) throw new Error("โหลดสิทธิ์คนแทนไม่สำเร็จ: " + coverageError.message);

  const subjectIds = new Set();
  const roomKeys = new Set();
  for (const row of rows || []) {
    if (row.kind === "วิชา" && row.subject_id) subjectIds.add(row.subject_id);
    if (row.kind !== "ครูประจำชั้น") continue;
    const homeroom = Array.isArray(row.homeroom_teachers)
      ? row.homeroom_teachers[0]
      : row.homeroom_teachers;
    if (homeroom?.grade_level && homeroom?.classroom) {
      roomKeys.add(homeroom.grade_level + "\u0000" + homeroom.classroom);
    }
  }
  return { subjectIds, roomKeys };
}

// ---------- โหลดทุกอย่างที่หน้าจัดคนแทนต้องใช้ของวันหนึ่ง ----------
// extraAbsentIds = คนที่ฝ่ายบุคคลเพิ่งกดเพิ่มแบบ "เหตุสุดวิสัย" แต่ยังไม่ได้เลือกคนแทน
// → ยังไม่มีแถวใน DB ให้จับได้ ถ้าไม่ส่งเข้ามา เขาจะโผล่บนจอแบบไม่มีของค้างให้เลือกเลย
export async function loadCoverageDay(dateStr, { extraAbsentIds = [] } = {}) {
  const [staffRes, years, leaveRes, fieldRes, dutyRes, dutyTypes, assignRes] = await Promise.all([
    sb.from("staff").select("id,full_name,is_active,user_id,exempt").order("full_name"),
    getAcademicYears(),
    // ใบลา/งานนอกสถานที่ที่ "คร่อม" วันนี้ — ต้องเทียบหัวท้าย ไม่ใช่ eq (รายการหลายวันจะหาย)
    sb.from("staff_leaves").select("*").lte("start_date", dateStr).gte("end_date", dateStr),
    sb.from("staff_field_duties").select("*").lte("start_date", dateStr).gte("end_date", dateStr),
    sb.from("duty_roster").select("*").eq("duty_date", dateStr),
    getDutyTypes(true),   // รวมงานที่ปิดใช้แล้ว ไม่งั้นเวรเก่าที่จัดไว้จะแสดงชื่องานไม่ออก
    sb.from("coverage_assignments").select("*").eq("cover_date", dateStr)
  ]);

  const failed = [
    [staffRes, "โหลดทะเบียนบุคลากร"],
    [leaveRes, "โหลดข้อมูลลา"],
    [fieldRes, "โหลดข้อมูลออกปฏิบัติหน้าที่"],
    [dutyRes, "โหลดตารางเวร"],
    [assignRes, "โหลดรายการจัดคนแทน"]
  ].find(([res]) => res.error);
  if (failed) throw new Error(`${failed[1]}ไม่สำเร็จ: ${failed[0].error.message}`);

  const staff = staffRes.data || [];
  const staffById = new Map(staff.map(s => [s.id, s]));
  const leaves = leaveRes.data || [];
  const fieldDuties = fieldRes.data || [];
  const duties = dutyRes.data || [];
  const assignments = assignRes.data || [];
  const year = academicYearOf(dateStr, years);

  // ---------- ใครไม่มา ----------
  // 3 ทาง: ใบลา · ออกปฏิบัติหน้าที่ · เหตุสุดวิสัย (ตัวหลังไม่มีใบอะไรรองรับ
  // รู้ได้ทางเดียวคือมีแถวที่ฝ่ายบุคคลบันทึกไว้แล้ว — ผู้ใช้เคาะว่าไม่ต้องมีใบลาก่อน)
  const absentMap = new Map();
  const addAbsent = (staffId, source, extra) => {
    const person = staffById.get(staffId);
    if (!person) return;                       // แถวค้างของคนที่ถูกลบไปแล้ว — ข้าม
    if (!absentMap.has(staffId)) {
      absentMap.set(staffId, { staff: person, source, leave: null, fieldDuty: null, items: [] });
    }
    Object.assign(absentMap.get(staffId), extra || {});
  };
  for (const row of leaves) addAbsent(row.staff_id, "ลา", { leave: row });
  for (const row of fieldDuties) addAbsent(row.staff_id, "ออกปฏิบัติหน้าที่", { fieldDuty: row });
  for (const row of assignments) {
    if (row.source === "เหตุสุดวิสัย") addAbsent(row.absent_staff_id, "เหตุสุดวิสัย", null);
  }
  for (const staffId of extraAbsentIds) addAbsent(staffId, "เหตุสุดวิสัย", null);
  const absentIds = [...absentMap.keys()];
  const absentUserIds = absentIds.map(id => staffById.get(id)?.user_id).filter(Boolean);

  // ---------- ของค้างของแต่ละคน ----------
  // 🪤 ไม่มีตารางสอนรายคาบในระบบ → เดาไม่ได้ว่าวันนั้นครูมีคาบไหนบ้าง
  //    จึงแสดง "ทุกวิชาที่เขาเป็นเจ้าของในปีนี้" แล้วให้ฝ่ายบุคคลเลือกเอง
  let subjects = [], homerooms = [];
  if (absentUserIds.length) {
    let query = sb.from("subjects")
      .select("id,name,code,year,term,grade_level,owner_id")
      .in("owner_id", absentUserIds);
    // ปีการศึกษาว่าง = ยังไม่ได้ตั้ง academic_years → ไม่กรอง ดีกว่าคืนค่าว่างแบบเงียบ ๆ
    if (year) query = query.eq("year", year);
    const res = await query;
    if (res.error) throw new Error("โหลดวิชาที่สอนไม่สำเร็จ: " + res.error.message);
    subjects = res.data || [];
  }
  if (absentIds.length && year) {
    const res = await sb.from("homeroom_teachers")
      .select("id,year,grade_level,classroom,staff_id")
      .eq("year", year).in("staff_id", absentIds);
    if (res.error) throw new Error("โหลดครูประจำชั้นไม่สำเร็จ: " + res.error.message);
    homerooms = res.data || [];
  }

  const typeByCode = new Map(dutyTypes.map(t => [t.code, t]));
  const subjectLabel = s => [s.code, s.name].filter(Boolean).join(" · ") || "(ไม่มีชื่อวิชา)";

  for (const s of subjects) {
    const person = staff.find(p => p.user_id === s.owner_id);
    const entry = person && absentMap.get(person.id);
    if (!entry) continue;
    entry.items.push({
      kind: "วิชา", key: coverageItemKey("วิชา", s.id), refId: s.id,
      label: subjectLabel(s),
      sub: [s.grade_level, s.term && ("ภาคเรียนที่ " + s.term)].filter(Boolean).join(" · ")
    });
  }
  for (const h of homerooms) {
    const entry = absentMap.get(h.staff_id);
    if (!entry) continue;
    entry.items.push({
      kind: "ครูประจำชั้น", key: coverageItemKey("ครูประจำชั้น", h.id), refId: h.id,
      label: h.grade_level + "/" + h.classroom, sub: "ปีการศึกษา " + h.year,
      room: { year: h.year, grade_level: h.grade_level, classroom: h.classroom }
    });
  }
  for (const d of duties) {
    const entry = absentMap.get(d.staff_id);
    if (!entry) continue;
    const type = typeByCode.get(d.duty_type);
    const start = String(type?.start_time || "").slice(0, 5);
    entry.items.push({
      kind: "เวร", key: coverageItemKey("เวร", d.duty_type, d.staff_id), refId: d.duty_type,
      label: d.duty_type, sub: start ? start + " น." : "ยังไม่ได้กำหนดเวลา"
    });
  }

  // แถวที่บันทึกไว้แล้วแต่ของต้นทางหายไป (ลบวิชา/ถอดเวรทีหลัง) ต้องยังเห็นบนจอ
  // ไม่งั้นจะมีแถวใน DB ที่ไม่มีใครแก้หรือลบได้เลยผ่านหน้าเว็บ
  for (const row of assignments) {
    const entry = absentMap.get(row.absent_staff_id);
    if (!entry) continue;
    const key = coverageRowKey(row);
    if (entry.items.some(i => i.key === key)) continue;
    entry.items.push({
      kind: row.kind, key, refId: row.subject_id || row.homeroom_id || row.duty_type,
      label: "(รายการเดิมที่ต้นทางถูกลบไปแล้ว)", sub: "ลบรายการนี้ได้ถ้าไม่ใช้แล้ว", orphan: true
    });
  }

  const ORDER = { "วิชา": 0, "ครูประจำชั้น": 1, "เวร": 2 };
  const absentees = [...absentMap.values()].sort((a, b) =>
    a.staff.full_name.localeCompare(b.staff.full_name, "th"));
  for (const entry of absentees) {
    entry.items.sort((a, b) => (ORDER[a.kind] - ORDER[b.kind]) ||
      a.label.localeCompare(b.label, "th"));
  }

  const byKey = new Map(assignments.map(row => [coverageRowKey(row), row]));
  // dutyRoster ของทั้งวัน (ไม่ใช่เฉพาะคนที่ไม่มา) — หน้าเว็บต้องรู้ว่าคนแทนมีเวรงานนั้น
  // อยู่ก่อนแล้วหรือเปล่า ไม่งั้นตอนยกเลิกการจัดคนแทนจะเผลอถอดเวรของเขาเองทิ้ง
  return { date: dateStr, year, staff, staffById, dutyTypes, dutyRoster: duties,
           absentees, assignments, byKey };
}

// แถวเวรที่เกิดจากการจัดคนแทนจะติดโน้ตนำหน้าด้วยคำนี้เสมอ — ใช้เป็นเครื่องหมายว่า
// "แถวนี้ระบบเพิ่มให้" จึงถอดคืนได้เมื่อยกเลิก · แถวที่ครูมีเวรอยู่แล้วจะไม่มีโน้ตนี้
// และต้องไม่ถูกแตะเด็ดขาด (ถอดทิ้ง = เวรจริงของเขาหายไปเงียบ ๆ)
export const COVERAGE_DUTY_NOTE = "มาแทน";
export function isCoverageDutyRow(row) {
  return String(row?.note || "").startsWith(COVERAGE_DUTY_NOTE);
}

// ---------- บันทึก/ลบรายการจัดคนแทน ----------
// ประกอบแถวจาก item + คนแทน ที่นี่ที่เดียว เพื่อให้ check constraint ฝั่ง DB
// (kind ไหนต้องมีคอลัมน์ไหน) กับฝั่งเว็บพูดตรงกันเสมอ
export function buildCoverageRow({ date, item, absentee, substituteStaffId, worksheetNote, createdBy }) {
  const row = {
    cover_date: date,
    kind: item.kind,
    subject_id: null, homeroom_id: null, duty_type: null,
    absent_staff_id: absentee.staff.id,
    substitute_staff_id: substituteStaffId,
    source: absentee.source,
    leave_id: absentee.source === "ลา" ? (absentee.leave?.id || null) : null,
    field_duty_id: absentee.source === "ออกปฏิบัติหน้าที่" ? (absentee.fieldDuty?.id || null) : null,
    worksheet_note: item.kind === "วิชา" ? (worksheetNote || null) : null,
    created_by: createdBy || null
  };
  if (item.kind === "วิชา") row.subject_id = item.refId;
  else if (item.kind === "ครูประจำชั้น") row.homeroom_id = item.refId;
  else row.duty_type = item.refId;
  return row;
}

export async function createCoverageAssignment(row) {
  const { data, error } = await sb.from("coverage_assignments").insert(row).select().single();
  if (error) throw new Error(error.code === "23505"
    ? "รายการนี้มีคนแทนอยู่แล้ว ลองรีเฟรชหน้าจอ"
    : "บันทึกคนแทนไม่สำเร็จ: " + error.message);
  return data;
}
export async function updateCoverageAssignment(id, fields) {
  const { data, error } = await sb.from("coverage_assignments")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error("แก้ไขคนแทนไม่สำเร็จ: " + error.message);
  return data;
}
export async function deleteCoverageAssignment(id) {
  const { error } = await sb.from("coverage_assignments").delete().eq("id", id);
  if (error) throw new Error("ลบรายการคนแทนไม่สำเร็จ: " + error.message);
}

// รายงาน "ใครถูกขอให้มาแทนบ่อย" — คำถามที่ผู้ใช้ระบุเองว่าต้องตอบได้
export async function getCoverageByRange(from, to) {
  const { data, error } = await sb.from("coverage_assignments")
    .select("*").gte("cover_date", from).lte("cover_date", to).order("cover_date");
  if (error) throw new Error("โหลดประวัติการจัดคนแทนไม่สำเร็จ: " + error.message);
  return data || [];
}
