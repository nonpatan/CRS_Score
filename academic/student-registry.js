export const STUDENT_PREFIXES = ["เด็กชาย",
  "เด็กหญิง",
  "นางสาว",
  "นาง",
  "นาย"];
export function normalizeNamePart(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}
export function splitPrefix(text, selectedPrefix = null) {
  const value = normalizeNamePart(text);
  // สระ/วรรณยุกต์เหล่านี้ขึ้นต้นคำไม่ได้: นายิกา ไม่ใช่ นาย + ิกา
  const invalidStart = /^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  const prefixes = selectedPrefix ? STUDENT_PREFIXES.filter(p => p === selectedPrefix) : STUDENT_PREFIXES;
  const prefix = prefixes.find(p =>
    value.startsWith(p) && !invalidStart.test(value.slice(p.length))
  );
  return prefix ? {
    prefix,
    rest: normalizeNamePart(value.slice(prefix.length))
  }
  : {
    prefix: null,
    rest: value
  };
}
export function genderFromPrefix(p) {
  if (p === "เด็กชาย" || p === "นาย") return "ชาย";
  if (p === "เด็กหญิง" || p === "นางสาว" || p === "นาง") return "หญิง";
  return null;
}
export function isValidCitizenId(s) {
  const value = String(s ?? "").toUpperCase().replace(/[^0-9G]/g, "");
  if (/^G[0-9]{12}$/.test(value)) return true;
  if (!/^[0-9]{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(value[i]) * (13 - i);
  return (11 - sum % 11) % 10 === Number(value[12]);
}
export function formatCitizenId(s) {
  const value = String(s ?? "").toUpperCase().replace(/[^0-9G]/g, "");
  return /^[0-9]{13}$/.test(value) ? `${value[0]}-${value.slice(1, 5)}-${value.slice(5, 10)}-${value.slice(10, 12)}-${value[12]}` : value;
}
export function normalizePhone(s) {
  return String(s ?? "").replace(/\D/g, "");
}
export function formatPhone(s) {
  const value = normalizePhone(s);
  if (value.length === 10) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  if (value.length === 9) return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
  return value;
}
export function parseStudentImportRows(raw) {
  return String(raw ?? "").split("\n").filter(line => line.trim()).map(line => {
    const cols = line.replace(/\r$/, "").split("\t");
    const hasPrefixColumn = STUDENT_PREFIXES.includes(normalizeNamePart(cols[3]));
    const [grade, classroom, studentNo] = cols;
    const columnPrefix = hasPrefixColumn ? normalizeNamePart(cols[3]) : null;
    const parsed = splitPrefix(hasPrefixColumn ? cols[4] : cols[3], columnPrefix);
    // มีคอลัมน์คำนำหน้าแล้ว ตัดจากช่องชื่อเฉพาะเมื่อซ้ำกับคอลัมน์นั้น
    const prefix = columnPrefix || parsed.prefix;
    const first = hasPrefixColumn && parsed.prefix !== columnPrefix
      ? normalizeNamePart(cols[4]) : normalizeNamePart(parsed.rest);
    const last = normalizeNamePart(cols[hasPrefixColumn ? 5 : 4]);
    const errors = [];
    if (!grade?.trim()) errors.push("ไม่มีชั้นปี");
    if (!classroom?.trim()) errors.push("ไม่มีห้อง");
    if (!studentNo?.trim() && grade?.trim() !== "เตรียมอนุบาล") errors.push("ไม่มีรหัสประจำตัว");
    if (!prefix) errors.push("ไม่มีคำนำหน้า");
    if (!first) errors.push("ไม่มีชื่อ");
    if (/\s/.test(first)) errors.push("ชื่อมีช่องว่าง");
    return {
      grade: grade?.trim() || "",
      classroom: classroom?.trim() || "",
      studentNo: studentNo?.trim() || "",
      prefix,
      first,
      last,
      errors
    };
  });
}
export function profileCompleteness(profile, guardians = [], status) {
  // ครูเพิ่มผู้ปกครองก่อนสร้างแถว student_profiles ได้ จึงนับข้อ 5–6 แยกจาก profile
  const present = v => v != null && String(v).trim() !== "";
  const address = prefix => ["house_no",
    "subdistrict",
    "district",
    "province",
    "postcode"]
  .every(field => present(profile?.[`${prefix}_${field}`]));
  const checks = [
    ["เพศ",
      present(profile?.gender)],
    ["วันเกิด",
      present(profile?.birth_date)],
    ["เลขประจำตัวประชาชน",
      present(profile?.citizen_id)],
    ["ศาสนา",
      present(profile?.religion)],
    ["ผู้ปกครองที่มีชื่อและเบอร์โทร",
      guardians.some(g => present(g.first_name) && present(g.phone))],
    ["ผู้ติดต่อหลัก",
      guardians.some(g => g.is_primary === true)],
    ["ที่อยู่ทะเบียนบ้าน",
      address("reg")],
    ["ที่อยู่ปัจจุบัน",
      profile?.cur_same_as_reg === true ? address("reg") : address("cur")],
    ["โรคประจำตัว",
      present(profile?.chronic_disease) || profile?.chronic_none === true],
    ["ยาที่แพ้",
      present(profile?.drug_allergy) || profile?.drug_allergy_none === true],
    ["อาหารที่แพ้",
      present(profile?.food_allergy) || profile?.food_allergy_none === true]
  ];
  const done = checks.filter(([,
    ok]) => ok).length;
  return {
    done,
    total: checks.length,
    percent: Math.round(done * 100 / checks.length),
    missing: checks.filter(([,
      ok]) => !ok).map(([label]) => label)
  };
}
