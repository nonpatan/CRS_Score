import { isValidCitizenId, normalizePhone, normalizeNamePart } from './student-registry.js?v=20261103-2';

const clean = value => {
  const text = normalizeNamePart(value);
  return text === '-' ? '' : text;
};
const digits = value => clean(value).replace(/\D/g, '');
const put = (target, key, value) => { if (value !== '' && value != null) target[key] = value; };
const HEADERS = new Map([
  [1,'เลขประจำตัวประชาชน'],[2,'เลขประจำตัวนักเรียน'],[3,'ชั้นเรียน'],
  [4,'คำนำหน้าชื่อ'],[5,'ชื่อ'],[6,'นามสกุล'],[9,'ชื่อภาษาอังกฤษ'],[10,'นามสกุลภาษาอังกฤษ'],
  [12,'ว.ด.ป. เกิด'],[13,'เพศ'],[14,'สัญชาติ'],[15,'ศาสนา'],[16,'สถานะนักเรียน'],
  [20,'บ้านเลขที่'],[21,'หมู่ที่'],[23,'ถนน'],[24,'ตำบล/แขวง'],[25,'อำเภอ/เขต'],[26,'จังหวัด'],[27,'รหัสไปรษณีย์'],
  [28,'เบอร์โทรศัพท์'],[29,'วันที่เข้าเรียน'],[30,'เลขประจำตัวประชาชน (บิดา)'],
  [31,'คำนำหน้าชื่อ (บิดา)'],[32,'ชื่อ (บิดา)'],[33,'นามสกุล (บิดา)'],
  [36,'เลขประจำตัวประชาชน (มารดา)'],[37,'คำนำหน้าชื่อ (มารดา)'],[38,'ชื่อ (มารดา)'],[39,'นามสกุล (มารดา)'],
  [42,'เลขประจำตัวประชาชน (ผู้ปกครอง)'],[43,'คำนำหน้าชื่อ'],[44,'ชื่อ - นามสกุล'],
  [45,'อาชีพของผู้ปกครอง'],[46,'เบอร์โทรศัพท์'],[47,'ความสัมพันธ์'],[50,'ชื่อโรงเรียนเดิม'],[51,'จังหวัดโรงเรียนเดิม']
]);
const normalizedHeader = value => clean(value).replace(/\s+/g,'');

export function findRegisHeader(rows) {
  const index = rows.findIndex(row => Array.isArray(row) && row.some(cell => normalizedHeader(cell) === normalizedHeader('เลขประจำตัวนักเรียน')) && row.some(cell => normalizedHeader(cell) === normalizedHeader('เลขประจำตัวประชาชน')));
  if (index < 0) throw new Error('ไม่พบหัวตาราง REGIS ที่มีเลขประจำตัวนักเรียนและเลขประจำตัวประชาชน');
  const row = rows[index];
  for (const [column, expected] of HEADERS) {
    if (normalizedHeader(row[column]) !== normalizedHeader(expected)) throw new Error(`รูปแบบไฟล์ไม่ตรงกับไฟล์ส่งออกจาก REGIS (คอลัมน์ที่ ${column + 1} ควรเป็น "${expected}")`);
  }
  return index;
}

const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
export function parseRegisDate(value) {
  const match = clean(value).match(/^(\d{1,2})\s+(\S+)\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]) + 1;
  const buddhistYear = match[3].length === 2 ? 2500 + Number(match[3]) : Number(match[3]);
  const year = buddhistYear - 543, day = Number(match[1]);
  if (!month || year < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function citizen(value, label, warnings) {
  const raw = digits(value);
  if (!raw) return null;
  if (!isValidCitizenId(raw)) { warnings.push(`เลขบัตร${label}ไม่ถูกต้อง — ไม่ได้นำเข้าเลขบัตร`); return null; }
  return raw;
}
function contactPhone(row, warnings) {
  const candidate = normalizePhone(clean(row[46])) || normalizePhone(clean(row[28]));
  if (!candidate) return null;
  if (!/^\d{9,10}$/.test(candidate)) { warnings.push('เบอร์ผู้ติดต่อหลักไม่ถูกต้อง — ไม่ได้นำเข้าเบอร์'); return null; }
  return candidate;
}
export function buildGuardians(row, warnings = []) {
  const guardians = [];
  const parent = (relation, base) => {
    if (!clean(row[base + 2])) return;
    guardians.push({relation, prefix:clean(row[base + 1]) || null, first_name:clean(row[base + 2]), last_name:clean(row[base + 3]) || null,
      citizen_id:citizen(row[base], relation, warnings), is_primary:false, sort_order:relation === 'บิดา' ? 1 : 2});
  };
  parent('บิดา',30); parent('มารดา',36);
  const primaryId = digits(row[42]);
  const matched = primaryId && guardians.find(g => digits(row[g.relation === 'บิดา' ? 30 : 36]) === primaryId);
  const phone = contactPhone(row,warnings);
  const occupation = clean(row[45]) || null;
  if (matched) {
    matched.is_primary = true; matched.sort_order = 0; matched.phone = phone; matched.occupation = occupation;
  } else if (clean(row[44])) {
    const [first_name,...last] = clean(row[44]).split(' ');
    guardians.push({relation:'ผู้ปกครอง', prefix:clean(row[43]) || null, first_name, last_name:last.join(' ') || null,
      citizen_id:citizen(row[42],'ผู้ปกครอง',warnings), occupation, phone, is_primary:true, sort_order:0});
  } else warnings.push('ไม่มีผู้ติดต่อหลักใน REGIS');
  return guardians.sort((a,b) => a.sort_order - b.sort_order);
}

export function parseRegisRows(rows) {
  const header = findRegisHeader(rows), students = [], errors = [], byNo = new Map();
  for (let i=header+1;i<rows.length;i++) {
    const row = rows[i] || [], studentNo = clean(row[2]);
    if (!studentNo) continue;
    const warnings = [], profile = {};
    const rawCitizen = digits(row[1]);
    if (rawCitizen) put(profile,'citizen_id',citizen(row[1],'นักเรียน',warnings));
    put(profile,'name_en',clean(row[9]) ? `${clean(row[9])} ${clean(row[10])}`.trim() : '');
    for (const [column,key] of [[13,'gender'],[14,'nationality'],[20,'reg_house_no'],[21,'reg_moo'],[23,'reg_road'],[24,'reg_subdistrict'],[25,'reg_district'],[26,'reg_province']]) {
      const value = clean(row[column]);
      if (key === 'gender' && value && !['ชาย','หญิง'].includes(value)) { warnings.push('เพศไม่อยู่ในชุดที่รองรับ'); continue; }
      put(profile,key,key === 'reg_moo' && value === '0' ? '' : value);
    }
    if (clean(row[15])) profile.religion = ['อิสลาม','พุทธ','คริสต์'].includes(clean(row[15])) ? clean(row[15]) : 'อื่น ๆ';
    if (['นักเรียนเข้าใหม่','นักเรียนเก่าเข้าใหม่'].includes(clean(row[16]))) profile.admission_type = clean(row[16]);
    const postcode = clean(row[27]);
    if (postcode) /^\d{5}$/.test(postcode) ? profile.reg_postcode = postcode : warnings.push('รหัสไปรษณีย์ไม่ถูกต้อง — ไม่ได้นำเข้า');
    for (const [column,key] of [[12,'birth_date'],[29,'enrolled_date']]) {
      if (!clean(row[column])) continue;
      const date = parseRegisDate(row[column]);
      if (date) profile[key] = date; else warnings.push(`${key === 'birth_date' ? 'วันเกิด' : 'วันที่เข้าเรียน'}อ่านไม่ออก — ไม่ได้นำเข้า`);
    }
    if (clean(row[50])) profile.previous_school = `${clean(row[50])}${clean(row[51]) ? ` จ.${clean(row[51])}` : ''}`;
    const roomText = clean(row[3]), match = roomText.match(/^(.+)\/(.+)$/);
    const student = {rowNumber:i+1,studentNo,roomText,grade:match?.[1] || '',classroom:match?.[2] || '',prefix:clean(row[4]),first:clean(row[5]),last:clean(row[6]),profile,guardians:buildGuardians(row,warnings),warnings};
    students.push(student);
    if (!byNo.has(studentNo)) byNo.set(studentNo,[]);
    byNo.get(studentNo).push(student);
  }
  const duplicates = new Set([...byNo].filter(([,items]) => items.length > 1).map(([no]) => no));
  for (const no of duplicates) for (const item of byNo.get(no)) errors.push(`แถว ${item.rowNumber}: เลขประจำตัวนักเรียน ${no} ซ้ำในไฟล์`);
  return {students:students.filter(item => !duplicates.has(item.studentNo)),errors};
}

export function mergeFillEmpty(existing = {}, incoming = {}) {
  const row = {}, conflicts = [];
  for (const [field,value] of Object.entries(incoming)) {
    if (value == null || value === '') continue;
    const current = existing?.[field];
    if (current == null || current === '') row[field] = value;
    else if (String(current) !== String(value)) conflicts.push({field,current,regis:value});
  }
  return {row,conflicts};
}

export const REGIS_PROFILE_LABELS = {
  citizen_id:'เลขประจำตัวประชาชน', name_en:'ชื่อภาษาอังกฤษ', birth_date:'วันเกิด',
  gender:'เพศ', nationality:'สัญชาติ', religion:'ศาสนา', admission_type:'ประเภทการเข้าเรียน',
  reg_house_no:'บ้านเลขที่ทะเบียนบ้าน', reg_moo:'หมู่', reg_road:'ถนน',
  reg_subdistrict:'ตำบลทะเบียนบ้าน', reg_district:'อำเภอทะเบียนบ้าน',
  reg_province:'จังหวัดทะเบียนบ้าน', reg_postcode:'รหัสไปรษณีย์ทะเบียนบ้าน',
  enrolled_date:'วันที่เข้าเรียน', previous_school:'โรงเรียนเดิม'
};

export function buildProfileUpsertRows(items, existingProfiles = new Map()) {
  const fields = [...new Set(items.flatMap(item => Object.keys(item.profile)))];
  return items.flatMap(item => {
    const existing = existingProfiles.get(item.studentId) || {};
    const merged = mergeFillEmpty(existing,item.profile).row;
    if (!Object.keys(merged).length) return [];
    // PostgREST's bulk upsert needs a shared set of keys. Preserve the current
    // value of every included column for other students in the same room.
    return [Object.fromEntries([['student_id',item.studentId],...fields.map(field => [field,
      existing[field] != null && existing[field] !== '' ? existing[field] : merged[field] ?? (field === 'nationality' ? 'ไทย' : null)])])];
  });
}

export function classifyAgainstDb(parsed, dbStudents, placements) {
  const byNo = new Map(dbStudents.map(s => [String(s.student_no).trim(),s]));
  const byId = new Map(placements.map(p => [p.student_id,p]));
  const ready = [], missingInDb = [], mismatches = [], matched = new Set();
  for (const item of parsed.students) {
    const db = byNo.get(item.studentNo);
    if (!db) { missingInDb.push(item); continue; }
    ready.push({...item,studentId:db.id}); matched.add(db.id);
    const issues = [];
    for (const [key,label] of [['prefix','คำนำหน้า'],['first_name','ชื่อ'],['last_name','นามสกุล']]) {
      const source = key === 'first_name' ? item.first : key === 'last_name' ? item.last : item.prefix;
      if (normalizeNamePart(db[key]) !== normalizeNamePart(source)) issues.push(`${label}ต่าง`);
    }
    const placement = byId.get(db.id);
    if (!placement) issues.push('ไม่มีห้องในปีปัจจุบัน');
    else if (normalizeNamePart(placement.grade_level) !== item.grade || normalizeNamePart(placement.classroom) !== item.classroom) issues.push('ห้องต่าง');
    if (issues.length) mismatches.push({studentNo:item.studentNo,name:`${item.prefix}${item.first} ${item.last}`.trim(),roomText:item.roomText,issues});
  }
  const missingInFile = dbStudents.filter(s => s.status === 'กำลังศึกษา' && byId.has(s.id) && !matched.has(s.id));
  return {ready,missingInDb,missingInFile,mismatches};
}
