// Pure helpers for the duty spreadsheet import. No database or DOM access here.
export function normalizeSourceName(value) {
  return String(value ?? '').normalize('NFC').replace(/^[\s\u00a0/]+|[\s\u00a0/]+$/gu, '')
    .replace(/[\s\u00a0]+/gu, ' ');
}

export function parseDutyTime(value) {
  const text = normalizeSourceName(value);
  const parts = [...text.matchAll(/(?:^|[^\d])(\d{1,2})[.:](\d{2})(?!\d)/g)]
    .map(match => ({ hour:Number(match[1]), minute:Number(match[2]) }))
    .filter(time => time.hour < 24 && time.minute < 60)
    .map(time => `${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}`);
  if (!parts.length || (!parts[1] && !/เป็นต้นไป/.test(text))) return { start:null, end:null };
  return { start:parts[0], end:parts[1] || null };
}

const DAYS = new Map([['จันทร์',1],['อังคาร',2],['พุธ',3],['พฤหัสบดี',4],['ศุกร์',5],['เสาร์',6],['อาทิตย์',7]]);
export function parseDutySheet(rows) {
  const activityIndex = rows.findIndex(row => normalizeSourceName(row?.[0]) === 'กิจกรรม');
  if (activityIndex < 0) throw new Error('ไม่พบแถว "กิจกรรม" — ตรวจว่าไฟล์มีแถวที่คอลัมน์ A เขียนว่า กิจกรรม');
  const timeRow = rows.find(row => normalizeSourceName(row?.[0]) === 'เวลา') || [];
  const columns = [];
  for (let index=1; index<(rows[activityIndex]?.length || 0); index++) {
    const header = String(rows[activityIndex][index] ?? '');
    if (!normalizeSourceName(header)) continue;
    const timeText = String(timeRow[index] ?? '');
    columns.push({ index, header, timeText, ...parseDutyTime(timeText) });
  }
  if (!columns.length) throw new Error('ไม่พบชื่องานในแถว "กิจกรรม" — ตรวจหัวคอลัมน์ของไฟล์');
  const weekdays = [], cells = [], names = new Set();
  for (const row of rows) {
    const weekday = DAYS.get(normalizeSourceName(row?.[0]));
    if (!weekday) continue;
    weekdays.push(weekday);
    for (const column of columns) {
      const parts = String(row[column.index] ?? '').split('/').map(normalizeSourceName).filter(Boolean);
      parts.forEach(name => names.add(name));
      cells.push({ weekday, column:column.index, names:parts });
    }
  }
  if (!weekdays.length) throw new Error('ไม่พบแถววัน — ตรวจว่าไฟล์มี จันทร์–ศุกร์ ในคอลัมน์ A');
  return { columns, cells, names:[...names], weekdays:[...new Set(weekdays)] };
}

export function foldThai(value) {
  return normalizeSourceName(value).replace(/\s+/g,'').replace(/[์ฺ็่้๊๋]/g,'')
    .replace(/ี/g,'ิ').replace(/[หฮ]$/u,'');
}
export function guessStaff(name, staff) {
  const source = foldThai(name);
  if (!source) return null;
  const matches = staff.filter(person => {
    const first = normalizeSourceName(person.full_name)
      .replace(/^(?:ว่าที่ร้อยตรี|นางสาว|นาย|นาง|ครู)\s*/u,'').split(' ')[0];
    const target = foldThai(first);
    return target === source || (source.length >= 3 && target.startsWith(source));
  });
  return matches.length === 1 ? matches[0] : null;
}

// typeMatches keys are column indexes; values: {mode:'existing'|'new'|'skip',code,rename,setTime}.
// staffMatches keys are normalized source names; values: {staff_id,skip}.
export function buildDutyImportPayload({parsed, typeMatches, staffMatches, dutyTypes, deactivate=[]}) {
  const selected = new Map(), types = [], maps = [], pattern = [], seenPattern = new Set();
  const oldTargets = new Map(), sourceTargets = new Map();
  const current = new Map(dutyTypes.map(type => [type.code,type]));
  const typeMap = new Map();
  for (const [order,column] of parsed.columns.entries()) {
    const choice = typeMatches.get(column.index);
    if (!choice?.mode) throw new Error(`ยังไม่เลือกงานสำหรับ ${normalizeSourceName(column.header)}`);
    const sourceName = normalizeSourceName(column.header);
    const skip = choice.mode === 'skip';
    const oldCode = choice.mode === 'existing' ? choice.code : null;
    const code = skip ? null : choice.mode === 'new' ? sourceName : choice.rename ? sourceName : oldCode;
    if (!skip && !code) throw new Error(`ยังไม่เลือกงานสำหรับ ${sourceName}`);
    if (choice.rename && code !== oldCode && current.has(code)) throw new Error(`ชื่องาน "${code}" มีอยู่แล้ว`);
    if (oldCode && oldTargets.has(oldCode) && oldTargets.get(oldCode)!==code) throw new Error(`งานเดิม "${oldCode}" ถูกเลือกทั้งชื่อเดิมและชื่อใหม่`);
    if (oldCode) oldTargets.set(oldCode,code);
    if (sourceTargets.has(sourceName) && sourceTargets.get(sourceName)!==code) throw new Error(`ชื่อคอลัมน์ "${sourceName}" ซ้ำแต่จับคู่ต่างกัน`);
    if (!sourceTargets.has(sourceName)) maps.push({kind:'งาน',source_name:sourceName,duty_type:code,staff_id:null,skip});
    sourceTargets.set(sourceName,code);
    typeMap.set(column.index,code);
    if (!skip && !selected.has(code)) {
      selected.set(code,true);
      types.push({code,rename_from:choice.rename ? oldCode : null,is_new:choice.mode === 'new',
        set_time:!!choice.setTime && !!column.start,start_time:choice.setTime ? column.start : null,
        end_time:choice.setTime ? column.end : null,sort_order:(order+1)*10});
    }
  }
  for (const name of parsed.names) {
    const sourceName = normalizeSourceName(name), choice = staffMatches.get(sourceName);
    if (!choice || (!choice.skip && !choice.staff_id)) throw new Error(`ยังไม่เลือกครูสำหรับ ${sourceName}`);
    maps.push({kind:'ครู',source_name:sourceName,staff_id:choice.skip ? null : choice.staff_id,duty_type:null,skip:!!choice.skip});
  }
  const staffMap = new Map(maps.filter(map => map.kind === 'ครู' && !map.skip).map(map => [map.source_name,map.staff_id]));
  for (const cell of parsed.cells) {
    const duty_type = typeMap.get(cell.column);
    if (!duty_type) continue;
    for (const name of cell.names) {
      const staff_id = staffMap.get(normalizeSourceName(name));
      if (!staff_id) continue;
      const key = `${staff_id}|${cell.weekday}|${duty_type}`;
      if (!seenPattern.has(key)) { seenPattern.add(key); pattern.push({staff_id,weekday:cell.weekday,duty_type}); }
    }
  }
  if (!pattern.length) throw new Error('ไม่มีรายชื่อเวรที่จะนำเข้า');
  const usedOld = new Set(types.map(type => type.rename_from || type.code));
  return {types,deactivate:deactivate.filter(code => !usedOld.has(code) && current.get(code)?.active && !current.get(code)?.affects_attendance),pattern,maps};
}
