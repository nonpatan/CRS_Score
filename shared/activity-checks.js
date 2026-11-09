// ตรวจข้อมูลล้วน ๆ ไม่แก้ข้อมูลและไม่ผูกกับการเชื่อมต่อฐานข้อมูล
export function findActivityDataIssues({
  assessments = [], members = [], sessions = [], passResults = [],
  students = [], termDates = {}, today = "", requiredGrades = [], requiredCategories = []
} = {}) {
  const compare = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), "th", { numeric: true });
  const rows = [...assessments].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
  const studentsById = new Map(students.map(student => [student.id, student]));
  const membersById = new Map(rows.map(row => [row.id, new Set()]));
  for (const member of members) {
    if (studentsById.get(member.student_id)?.left_school === true) continue;
    membersById.get(member.assessment_id)?.add(member.student_id);
  }
  const sessionIds = new Set(sessions.map(row => row.assessment_id));
  const passById = new Map();
  for (const row of passResults) {
    if (!passById.has(row.assessment_id)) passById.set(row.assessment_id, new Set());
    passById.get(row.assessment_id).add(row.student_id);
  }
  const issues = [];
  const category = row => String(row.activity_category ?? "").trim();
  const term = row => row.term == null ? null : String(row.term);
  const ended = row => {
    const end = term(row) === "1" ? termDates.term1End : termDates.term2End;
    return !!(today && end && today > end);
  };
  function add(code, severity, row, studentIds, detail, extra = {}) {
    issues.push({ code, severity, assessmentId: row?.id ?? null,
      assessmentName: row?.name ?? "", term: row ? term(row) : null,
      studentIds: [...studentIds].sort(compare), detail, ...extra });
  }
  for (const row of rows) {
    const ids = membersById.get(row.id);
    if (!ids.size) continue;
    if (!sessionIds.has(row.id)) add("NO_SESSION", ended(row) ? "error" : "info", row, ids,
      ended(row) ? `ยังไม่ได้ประเมินสมรรถนะเลย (มีนักเรียน ${ids.size} คน)` : "ยังไม่เริ่มประเมินในภาคนี้");
    if (category(row) && ended(row)) {
      const missing = [...ids].filter(id => !passById.get(row.id)?.has(id));
      if (missing.length) add("MISSING_PASS", "error", row, missing,
        `ยังไม่ลงผลผ่าน/ไม่ผ่าน ${missing.length} คน — ปพ. จะขึ้น 'รอผล'`);
    }
    if (row.source_type === "กิจกรรม" && !category(row)) add("NO_CATEGORY", "info", row, ids,
      "ไม่ได้ตั้งประเภท — ไม่ขึ้นใน ปพ. (ถ้าตั้งใจให้ขึ้น ให้เลือกประเภทที่ 'แก้ไข')");
  }

  // รายการรายปีเก่าไม่เข้ากฎที่ต้องแยกภาคเรียน
  const groups = new Map();
  for (const row of rows) {
    if (!category(row) || !["1", "2"].includes(term(row))) continue;
    const key = JSON.stringify([category(row), term(row)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const aIds = membersById.get(a.id), bIds = membersById.get(b.id);
        const overlap = [...aIds].filter(id => bIds.has(id));
        if (overlap.length) add("DUP_CATEGORY", "warn", aIds.size <= bIds.size ? a : b, overlap,
          `นักเรียน ${overlap.length} คนอยู่ทั้ง ${a.name} และ ${b.name} — ต้องผ่านทุกรายการ ถ้าไม่ได้ตั้งใจให้เอาออก 1 รายการ`,
          { relatedIds: [a.id, b.id] });
      }
    }
  }
  const term2Started = !!(today && termDates.term2Start && today >= termDates.term2Start);
  const missingTerm2ByCategory = new Map();
  if (term2Started) {
    const assigned = new Map();
    for (const row of rows) {
      if (term(row) !== "1" || !category(row)) continue;
      const type = category(row);
      if (!assigned.has(type)) assigned.set(type, new Set());
      const seen = assigned.get(type);
      const next = groups.get(JSON.stringify([type, "2"])) || [];
      const nextIds = new Set(next.flatMap(other => [...membersById.get(other.id)]));
      const missing = [...membersById.get(row.id)].filter(id => !seen.has(id) && !nextIds.has(id));
      for (const id of membersById.get(row.id)) seen.add(id);
      if (missing.length) add("MISSING_TERM2", "error", row, missing,
        `นักเรียน ${missing.length} คนยังไม่มี${type}ภาค 2 — ปพ.6 ปลายปีจะยึดผลภาค 1 อย่างเดียว`);
      if (!missingTerm2ByCategory.has(type)) missingTerm2ByCategory.set(type, new Set());
      for (const id of missing) missingTerm2ByCategory.get(type).add(id);
    }
  }
  for (const type of [...new Set(requiredCategories)].sort(compare)) {
    for (const currentTerm of term2Started ? ["1", "2"] : ["1"]) {
      const group = groups.get(JSON.stringify([type, currentTerm])) || [];
      const represented = new Set(group.flatMap(row => [...membersById.get(row.id)]));
      const alreadyReported = currentTerm === "2" ? missingTerm2ByCategory.get(type) : null;
      for (const grade of [...new Set(requiredGrades)].sort(compare)) {
        const missing = students.filter(student => student.left_school !== true &&
          student.grade_level === grade && !represented.has(student.id) &&
          !alreadyReported?.has(student.id)).map(student => student.id);
        if (missing.length) add("NOT_IN_CATEGORY", "error", null, missing,
          `นักเรียนชั้น ${grade} ${missing.length} คนไม่อยู่${type}ใดเลยในภาค ${currentTerm} — ปพ. จะไม่มีผล${type}`,
          { assessmentName: type, term: currentTerm, gradeLevel: grade });
      }
    }
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || compare(a.term, b.term) ||
    compare(a.assessmentName, b.assessmentName) || compare(a.code, b.code));
}
