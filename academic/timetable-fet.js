// แปลงผลจัดตาราง FET โดยไม่พึ่ง DOM หรือฐานข้อมูล เพื่อใช้ทดสอบกับไฟล์จริงได้
const DAY_NUM = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };
const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
const decode = value => String(value ?? '').replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => entities[key]);
const blocks = (xml, tag) => [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(match => match[1]);
const one = (xml, tag) => decode(blocks(xml, tag)[0]?.trim() || '');
const many = (xml, tag) => blocks(xml, tag).map(value => decode(value.trim()));
const section = (xml, tag) => blocks(xml, tag)[0] || '';
const unique = values => [...new Set(values)];

export function defaultColumnKind(hourName, breakSet = new Set()) {
  if (breakSet.has(hourName)) return 'พัก';
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hourName);
  if (!match) throw new Error(`เวลา FET ไม่ถูกต้อง: ${hourName}`);
  const minutes = (+match[3] * 60 + +match[4]) - (+match[1] * 60 + +match[2]);
  if (minutes <= 0) throw new Error(`เวลา FET ไม่ถูกต้อง: ${hourName}`);
  return minutes >= 40 ? 'คาบเรียน' : 'กิจกรรม';
}

export function parseFet(xmlText) {
  const xml = String(xmlText ?? '').replace(/^\uFEFF/, '');
  if (!/^\s*<\?xml\b[\s\S]*?<fet\b/i.test(xml) || !xml.includes('</fet>')) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ของ FET — เลือกไฟล์ .fet ที่โปรแกรม FET สร้าง');
  const dayNames = blocks(section(xml, 'Days_List'), 'Day').map(row => one(row, 'Name'));
  const days = dayNames.map(name => {
    if (!DAY_NUM[name]) throw new Error(`ไม่รู้จักวันในไฟล์ FET: ${name}`);
    return DAY_NUM[name];
  });
  const hourNames = blocks(section(xml, 'Hours_List'), 'Hour').map(row => one(row, 'Name'));
  const breakSet = new Set(blocks(xml, 'ConstraintBreakTimes').flatMap(row => blocks(row, 'Break_Time').map(item => one(item, 'Hour'))));
  const columns = hourNames.map((name, index) => {
    defaultColumnKind(name, breakSet);
    const [start_time, end_time] = name.split('-');
    return { seq:index + 1, name, start_time, end_time, kind:defaultColumnKind(name, breakSet), lockedBreak:breakSet.has(name) };
  });
  if (!days.length || !columns.length) throw new Error('ไฟล์ FET ไม่มีวันหรือช่องเวลา');
  const studentGroups = new Map();
  const studentLevels = new Map();
  for (const year of blocks(section(xml, 'Students_List'), 'Year')) {
    const yearName = one(year, 'Name');
    const yearGroups = [];
    for (const group of blocks(year, 'Group')) {
      const groupName = one(group, 'Name');
      const subgroups = blocks(group, 'Subgroup').map(row => one(row, 'Name'));
      studentGroups.set(groupName, subgroups);
      studentLevels.set(groupName, 'Group');
      for (const name of subgroups) { studentGroups.set(name, [name]); studentLevels.set(name, 'Subgroup'); }
      yearGroups.push(...subgroups);
    }
    studentGroups.set(yearName, unique(yearGroups));
    studentLevels.set(yearName, 'Year');
  }
  const teachers = blocks(section(xml, 'Teachers_List'), 'Teacher').map(row => one(row, 'Name'));
  const facilities = blocks(section(xml, 'Rooms_List'), 'Room').map(row => one(row, 'Name'));
  const activities = blocks(section(xml, 'Activities_List'), 'Activity').map(row => ({
    id:one(row, 'Id'), groupId:one(row, 'Activity_Group_Id'), subject:one(row, 'Subject'),
    teachers:many(row, 'Teacher'), students:many(row, 'Students'), tags:many(row, 'Activity_Tag'),
    duration:Number(one(row, 'Duration')), totalDuration:Number(one(row, 'Total_Duration')),
    active:one(row, 'Active') !== 'false'
  })).filter(item => item.active);
  const starts = new Map();
  for (const row of blocks(xml, 'ConstraintActivityPreferredStartingTime')) {
    if (one(row, 'Active') === 'false') continue;
    starts.set(one(row, 'Activity_Id'), { day:one(row, 'Day'), hour:one(row, 'Hour') });
  }
  const found = activities.filter(item => starts.has(item.id)).length;
  if (found !== activities.length || !activities.length) throw new Error(`ไฟล์นี้ยังไม่มีผลการจัดตาราง (มีเวลา ${found} จาก ${activities.length} รายการ) — เลือกไฟล์ที่ลงท้าย _data_and_timetable.fet ในโฟลเดอร์ fet-results`);
  const rooms = new Map();
  for (const row of blocks(xml, 'ConstraintActivityPreferredRoom')) {
    if (one(row, 'Active') === 'false') continue;
    rooms.set(one(row, 'Activity_Id'), one(row, 'Room'));
  }
  return { days, dayNames, columns, breakSet, studentGroups, studentLevels, teachers, facilities, activities, starts, rooms };
}

export function groupLessons(raw) {
  const lessons = new Map();
  for (const activity of raw.activities) {
    const key = activity.groupId && activity.groupId !== '0' ? activity.groupId : activity.id;
    let lesson = lessons.get(key);
    if (!lesson) {
      const roomNames = unique(activity.students.flatMap(name => {
        if (!raw.studentGroups.has(name)) throw new Error(`ไม่พบห้องเรียน FET: ${name}`);
        return raw.studentGroups.get(name);
      }));
      const rooms = roomNames.map(name => {
        const slash = name.indexOf('/');
        if (slash < 1) throw new Error(`ชื่อห้องเรียน FET ไม่มี /: ${name}`);
        return { grade_level:name.slice(0, slash), classroom:name.slice(slash + 1) };
      });
      lesson = { title:activity.subject, subject:activity.subject, source_key:key,
        periods_per_week:activity.totalDuration, rooms, teachers:[...activity.teachers],
        note:activity.tags.join(' ') || null, facility:null, placements:[],
        studentSources:[...activity.students], allRoomsYear:activity.students.length > 0 && activity.students.every(name => raw.studentLevels.get(name) === 'Year') };
      lessons.set(key, lesson);
    }
    const facility = raw.rooms.get(activity.id) || null;
    if (facility && lesson.facility && facility !== lesson.facility) throw new Error(`กลุ่ม ${key} มีห้องปฏิบัติการต่างกัน`);
    if (facility) lesson.facility = facility;
    const start = raw.starts.get(activity.id);
    const weekday = DAY_NUM[start.day];
    const column_seq = raw.columns.find(column => column.name === start.hour)?.seq;
    if (!weekday || !column_seq) throw new Error(`ไม่พบวันหรือเวลาเริ่มของ activity ${activity.id}`);
    lesson.placements.push({ weekday, column_seq, span:activity.duration, source_key:activity.id });
  }
  return [...lessons.values()];
}

export function buildImportPayload({ header, columns, lessons, maps, replaceId = null }) {
  const teachers = maps.teachers || new Map();
  const subjects = maps.subjects || new Map();
  const facilities = maps.facilities || new Map();
  const get = (collection, key) => collection instanceof Map ? collection.get(key) : collection[key];
  return {
    replace_id:replaceId || null,
    timetable:{ ...header, term:header.term || null, source_note:header.source_note || null },
    columns:columns.map(({ seq, start_time, end_time, kind }) => ({ seq, start_time, end_time, kind })),
    lessons:lessons.map(lesson => {
      const choice = get(subjects, lesson.mapKey || lesson.subject);
      const subject = choice?.as_activity ? null : (choice?.subject || choice);
      const facility = get(facilities, lesson.facility);
      return {
        title:lesson.title, subject_id:subject?.id || null, periods_per_week:lesson.periods_per_week,
        facility_id:facility?.id || null, is_template:!subject?.id, note:lesson.note || null,
        source_key:lesson.source_key, rooms:lesson.rooms,
        teachers:lesson.teachers.map(name => {
          const staff = get(teachers, name);
          return { staff_id:staff?.id || null, display_name:staff?.full_name || name };
        }),
        placements:lesson.placements
      };
    }),
    maps:(maps.confirmed || []).map(row => ({
      kind:row.kind, source_name:row.source_name, staff_id:row.staff_id || null,
      subject_code:row.subject_code || null, subject_name:row.subject_name || null,
      subject_grade:row.subject_grade || null, facility_id:row.facility_id || null,
      as_activity:row.as_activity === true
    }))
  };
}

export function buildGrid({ columns, teachingDays, lessons, filter }) {
  const matches = lesson => {
    if (filter.kind === 'ห้อง') return lesson.rooms.some(room => room.grade_level === filter.grade_level && room.classroom === filter.classroom);
    if (filter.kind === 'ครู') return lesson.teachers.some(teacher => filter.staffId
      ? typeof teacher === 'object' && teacher.staff_id === filter.staffId
      : (typeof teacher === 'string' ? teacher : teacher.display_name) === filter.name);
    return lesson.facility === filter.facility || lesson.facility_id === filter.facility;
  };
  return teachingDays.map(weekday => {
    const cells = columns.map(column => column.kind === 'พัก' ? { break:true, items:[] } : { items:[] });
    const intervals = [];
    for (const lesson of lessons.filter(matches)) for (const placement of lesson.placements) {
      if (placement.weekday !== weekday) continue;
      const start = placement.column_seq - 1;
      if (!cells[start]) continue;
      intervals.push({ start, end:start + placement.span - 1, item:{ lesson, placement } });
    }
    intervals.sort((a,b) => a.start - b.start || a.end - b.end);
    const groups = [];
    for (const interval of intervals) {
      const last = groups.at(-1);
      if (last && interval.start <= last.end) {
        last.end = Math.max(last.end, interval.end);
        last.items.push(interval.item);
      } else groups.push({ start:interval.start, end:interval.end, items:[interval.item] });
    }
    for (const group of groups) {
      cells[group.start].items = group.items;
      cells[group.start].span = group.end - group.start + 1;
      for (let index=group.start+1; index<=group.end && index<cells.length; index++) cells[index].covered = true;
    }
    return { weekday, cells };
  });
}

// เลือกตารางที่ใช้วันนี้ก่อน แล้วจึงอนาคตที่ใกล้สุด หรืออดีตล่าสุด
export function chooseTimetable(rows, today) {
  const ordered = [...rows].sort((a,b) => a.start_date.localeCompare(b.start_date));
  return ordered.find(row => row.start_date <= today && today <= row.end_date)
    || ordered.find(row => row.start_date > today)
    || [...rows].sort((a,b) => b.end_date.localeCompare(a.end_date))[0]
    || null;
}

const cacheKey = id => `crs_tt_v1_${id}`;
function validTimetableData(data, id, updatedAt) {
  const has = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
  return data && data.id === id && data.updated_at === updatedAt
    && Array.isArray(data.teaching_days) && Array.isArray(data.timetable_columns)
    && Array.isArray(data.timetable_lessons)
    && data.timetable_columns.every(row => Number.isInteger(row.seq) && row.start_time && row.end_time && row.kind)
    && data.timetable_lessons.every(row => row.id && typeof row.title === 'string'
      && has(row, 'subject_id') && has(row, 'facility_id')
      && Array.isArray(row.timetable_lesson_rooms)
      && Array.isArray(row.timetable_lesson_teachers)
      && Array.isArray(row.timetable_placements)
      && row.timetable_lesson_rooms.every(room => room.grade_level && room.classroom)
      && row.timetable_lesson_teachers.every(teacher => has(teacher, 'staff_id') && teacher.display_name)
      && row.timetable_placements.every(placement => Number.isInteger(placement.weekday)
        && Number.isInteger(placement.column_seq) && Number.isInteger(placement.span)));
}

export function readTimetableCache(storage, id, updatedAt) {
  try {
    const data = JSON.parse(storage.getItem(cacheKey(id)) || 'null');
    return validTimetableData(data, id, updatedAt) ? data : null;
  } catch { return null; }
}

export function writeTimetableCache(storage, data) {
  try {
    if (!validTimetableData(data, data?.id, data?.updated_at)) return false;
    storage.setItem(cacheKey(data.id), JSON.stringify(data));
    return true;
  } catch { return false; }
}

export function pruneTimetableCache(storage, activeIds) {
  try {
    const allowed = new Set(activeIds.map(cacheKey));
    const stale = [];
    for (let i=0; i<storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith('crs_tt_v1_') && !allowed.has(key)) stale.push(key);
    }
    stale.forEach(key => storage.removeItem(key));
    return true;
  } catch { return false; }
}

const DETAIL_SELECT = 'id,updated_at,teaching_days,timetable_columns(seq,start_time,end_time,kind),timetable_lessons(id,title,subject_id,facility_id,note,facilities(name),timetable_lesson_rooms(grade_level,classroom),timetable_lesson_teachers(staff_id,display_name),timetable_placements(weekday,column_seq,span))';
const LESSON_SELECT = 'id,title,subject_id,facility_id,note,facilities(name),timetable_lesson_rooms(grade_level,classroom),timetable_lesson_teachers(staff_id,display_name),timetable_placements(weekday,column_seq,span)';
const queryData = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

export async function loadTimetableDetails({ sb, fetchAllRows, storage, timetable }) {
  const row = timetable;
  if (row.status !== 'ร่าง') {
    const cached = readTimetableCache(storage, row.id, row.updated_at);
    if (cached) return cached;
  }
  const data = queryData(await sb.from('timetables').select(DETAIL_SELECT).eq('id', row.id).maybeSingle(), 'โหลดรายละเอียดตารางสอน');
  if (!data) throw new Error('ไม่พบตารางนี้ หรือคุณไม่มีสิทธิ์ดู · ตรวจลิงก์แล้วรีเฟรชหน้า');
  if (data.updated_at !== row.updated_at) throw new Error('ตารางสอนเปลี่ยนระหว่างโหลด · รีเฟรชหน้าเพื่อตรวจเวอร์ชันล่าสุด');
  if (!Array.isArray(data.teaching_days) || !Array.isArray(data.timetable_columns) || !Array.isArray(data.timetable_lessons)) throw new Error('รายละเอียดตารางสอนไม่ครบ');
  if (data.timetable_lessons.length === 1000) {
    data.timetable_lessons = queryData(await fetchAllRows(() => sb.from('timetable_lessons').select(LESSON_SELECT).eq('timetable_id', row.id), 'id'), 'โหลดรายการคาบทั้งหมด');
  }
  if (row.status !== 'ร่าง') writeTimetableCache(storage, data);
  return data;
}

export async function loadTimetableForDate({ sb, fetchAllRows, storage, dateStr }) {
  const timetable = queryData(await sb.from('timetables')
    .select('id,year,term,name,start_date,end_date,updated_at')
    .eq('status', 'ใช้งาน').lte('start_date', dateStr).gte('end_date', dateStr).maybeSingle(), 'โหลดตารางสอนของวัน');
  if (!timetable) return { timetable: null };
  const details = await loadTimetableDetails({ sb, fetchAllRows, storage, timetable });
  return { timetable, details };
}

export function normalizeDetails(data) {
  const columns = [...(data.timetable_columns || [])].sort((a, b) => a.seq - b.seq);
  const lessons = (data.timetable_lessons || []).map(row => ({
    id: row.id, title: row.title, subject_id: row.subject_id, facility_id: row.facility_id,
    facility: row.facilities?.name || null, note: row.note,
    rooms: row.timetable_lesson_rooms || [], teachers: row.timetable_lesson_teachers || [],
    placements: row.timetable_placements || []
  }));
  return { columns, lessons };
}

const clock = value => String(value || '').slice(0, 5);
const roomLabels = rooms => [...new Set(rooms.map(room => `${room.grade_level}/${room.classroom}`))];

export function staffDaySchedule(details, weekday, staffId, { portion = 'full' } = {}) {
  const { columns, lessons } = normalizeDetails(details);
  const bySeq = new Map(columns.map(column => [column.seq, column]));
  const result = [];
  for (const lesson of lessons) {
    if (!lesson.teachers.some(teacher => teacher.staff_id === staffId)) continue;
    for (const placement of lesson.placements) {
      if (placement.weekday !== weekday) continue;
      const first = bySeq.get(placement.column_seq);
      if (!first) continue;
      const startTime = clock(first.start_time);
      if (portion === 'morning' && startTime >= '12:00') continue;
      if (portion === 'afternoon' && startTime < '12:00') continue;
      const span = Array.from({ length: placement.span }, (_, index) => bySeq.get(placement.column_seq + index)).filter(Boolean);
      const periods = span.filter(column => column.kind === 'คาบเรียน').length;
      const rooms = roomLabels(lesson.rooms);
      if (!periods && !rooms.length) continue;
      result.push({ lessonId: lesson.id, subjectId: lesson.subject_id, title: lesson.title,
        rooms, startSeq: placement.column_seq, endSeq: placement.column_seq + placement.span - 1,
        startTime, endTime: clock(span.at(-1)?.end_time), periods, isTeaching: periods > 0 });
    }
  }
  return result.sort((a, b) => a.startSeq - b.startSeq || a.title.localeCompare(b.title, 'th'));
}

export function subjectPeriodsFromSchedule(schedule) {
  const result = new Map();
  for (const slot of schedule) {
    if (!slot.subjectId || !slot.isTeaching) continue;
    if (!result.has(slot.subjectId)) result.set(slot.subjectId, { periods: 0, slots: [] });
    const subject = result.get(slot.subjectId);
    subject.periods += slot.periods;
    subject.slots.push({ startTime: slot.startTime, endTime: slot.endTime, rooms: slot.rooms,
      startSeq: slot.startSeq, endSeq: slot.endSeq });
  }
  return result;
}

export function busyStaffIds(details, weekday, seqRanges) {
  const { columns, lessons } = normalizeDetails(details);
  const bySeq = new Map(columns.map(column => [column.seq, column]));
  const busy = new Map();
  for (const lesson of lessons) for (const placement of lesson.placements) {
    if (placement.weekday !== weekday || !seqRanges.some(range =>
      placement.column_seq <= range.endSeq && placement.column_seq + placement.span - 1 >= range.startSeq)) continue;
    const room = roomLabels(lesson.rooms)[0];
    const reason = `${room ? `สอน ${room}` : lesson.title} ${clock(bySeq.get(placement.column_seq)?.start_time)}`.trim();
    for (const teacher of lesson.teachers) if (teacher.staff_id && !busy.has(teacher.staff_id)) busy.set(teacher.staff_id, reason);
  }
  return busy;
}
