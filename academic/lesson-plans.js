// ต้องตรงกับ check constraint lesson_plans_plan_url_ok ใน schema.sql ทุกตัวอักษร
export const PLAN_PDF_URL_RE = /^https:\/\/(drive\.google\.com\/(file\/d\/[A-Za-z0-9_-]+|open\?id=[A-Za-z0-9_-]+)|\S+\.pdf([?#]\S*)?$)/i;
export function pdfUrlError(url) {
  const value = String(url || '').trim();
  if (!value) return 'ใส่ลิงก์';
  if (!/^https:\/\//i.test(value)) return 'ต้องขึ้นต้นด้วย https://';
  if (/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)(\/|$)/i.test(value)) return 'ลิงก์นี้เป็น Google Docs/Slides/Sheets ไม่ใช่ไฟล์ PDF — ดาวน์โหลดเป็น PDF แล้วอัปขึ้น Drive ก่อน';
  if (/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders(?:\/|$)/i.test(value)) return 'ลิงก์นี้เป็นโฟลเดอร์ ให้ใช้ลิงก์ของไฟล์ PDF';
  return PLAN_PDF_URL_RE.test(value) ? null : 'ใช้ลิงก์ไฟล์ Google Drive หรือลิงก์ที่ลงท้าย .pdf';
}
export function planOverallStatus(plan) {
  if ([plan.plan_status, plan.assessment_status].includes('ขอให้แก้')) return 'ขอให้แก้';
  return plan.plan_status === 'ผ่าน' && plan.assessment_status === 'ผ่าน' ? 'ผ่าน' : 'รอตรวจ';
}
export function isIntegratedParent(subject, integrationMembers = []) {
  return subject.subject_type === 'บูรณาการ' || integrationMembers.some(row => String(row.integrated_subject_id) === String(subject.id));
}
export function summarizeSubjectPlans({ target, plans = [] }) {
  const count = Number(target?.plan_count ?? target) || 0;
  const submitted = plans.length;
  const passed = plans.filter(plan => planOverallStatus(plan) === 'ผ่าน').length;
  const fix = plans.filter(plan => planOverallStatus(plan) === 'ขอให้แก้').length;
  const waiting = submitted - passed - fix;
  const complete = count > 0 && submitted >= count;
  return { target:count, submitted, passed, waiting, fix, missing:Math.max(0, count - submitted),
    state:!submitted ? 'none' : complete ? passed === submitted ? 'allPassed' : 'complete' : 'partial' };
}
export function planSlots(target, plans = []) {
  const count = Math.max(Number(target?.plan_count ?? target) || 0, ...plans.map(plan => Number(plan.seq)), 0);
  const bySeq = new Map(plans.map(plan => [Number(plan.seq), plan]));
  return Array.from({ length:count }, (_, i) => ({ seq:i + 1, plan:bySeq.get(i + 1) || null }));
}
export function sortPlansForTeacher(slots) {
  const rank = slot => !slot.plan ? 2 : planOverallStatus(slot.plan) === 'ขอให้แก้' ? 0 : 1;
  return [...slots].sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
}
export function queueLabel(plan) {
  const docs = [];
  if (plan.plan_status === 'รอตรวจ' && plan.plan_reviewed_at) docs.push('แผน');
  if (plan.assessment_status === 'รอตรวจ' && plan.assessment_reviewed_at) docs.push('วัดผล');
  return docs.length ? 'ส่งแก้: ' + docs.join(' + ') : 'ใหม่';
}
export function subjectsForPlanTerm(subjects, { year, term }) {
  return subjects.filter(subject => String(subject.year) === String(year) && (subject.term == null || String(subject.term) === String(term)));
}
export const PLAN_COLUMNS = 'id,subject_id,seq,title,planned_periods,plan_url,assessment_url,plan_status,plan_stars,plan_comment,plan_reviewed_at,assessment_status,assessment_stars,assessment_comment,assessment_reviewed_at,submitted_at,created_by,created_by_name';
export const SUBJECT_COLUMNS = 'id,name,code,level,grade_level,term,year,subject_type,owner_id';
