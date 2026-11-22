import { sb, fetchAllRows, getStudentPlacements, isRegularStudent, GRADE_ORDER,
  getActiveYear, getAcademicYears, academicYearOf, academicTermOf, bangkokNow, toDateStr } from "../supabase-client.js?v=20261121-2";
import { gradeDate, gradeEscape, gradeRpc, installGradeStyles } from "./grade-lock.js?v=1";

const today = () => toDateStr(bangkokNow());
const annual = grade => grade.startsWith("ป.");
const roomName = room => room.grade + "/" + room.room;
const roomKey = room => [room.grade, room.room].join("|");

export function releaseRooms(placements) {
  const rooms = new Map();
  for (const p of placements) {
    if (!p.grade_level || !p.classroom || !p.student || !/^[ปม]\./.test(p.grade_level)) continue;
    const room = { grade:p.grade_level, room:p.classroom };
    const key = roomKey(room);
    if (!rooms.has(key)) rooms.set(key, { ...room, students:[] });
    if (isRegularStudent(p.student)) rooms.get(key).students.push({ ...p.student, grade_level:room.grade, classroom:room.room });
  }
  return [...rooms.values()].sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) ||
    String(a.room).localeCompare(String(b.room), "th", { numeric:true }));
}

export function gradeRepairCandidates(results, blockedSubjectsFor, parentByMember) {
  const pairs = new Map();
  for (const [student_id, student] of results) {
    for (const [subject_id, { code }] of blockedSubjectsFor(student, parentByMember)) {
      const key = subject_id + "|" + student_id;
      if (!pairs.has(key) || code === "มส.") pairs.set(key, { subject_id, student_id, code });
    }
  }
  return [...pairs.values()];
}

export function staleCompetencyRooms(rooms, placements, logs, published) {
  const byStudent = new Map(placements.map(p => [p.student_id, roomKey({ grade:p.grade_level, room:p.classroom })]));
  const latest = new Map();
  for (const row of published) {
    const room = byStudent.get(row.student_id);
    if (room) latest.set(room, Math.max(latest.get(room) || 0, Date.parse(row.published_at)));
  }
  const stale = new Set();
  for (const row of logs) {
    const room = byStudent.get(row.student_id);
    if (room && Date.parse(row.created_at) > (latest.get(room) || 0)) stale.add(room);
  }
  return rooms.filter(room => stale.has(roomKey(room)));
}

export function competencyPublishRows(perStudent) {
  return perStudent.flatMap(entry => entry.results.map(({ competency, combined }) => ({
    student_id:entry.student.id,
    competency_id:competency.id,
    complete:!!combined?.complete,
    score:combined?.complete ? combined.score : null,
    level:combined?.complete ? combined.level : null
  })));
}

export async function runGradeRelease({ rooms, cancelled, progress, compute, publish, repairs, approve }) {
  let published = 0;
  for (const [index, room] of rooms.entries()) {
    if (cancelled()) return { cancelled:true, published };
    progress(`ห้อง ${index + 1}/${rooms.length} · ${roomName(room)}`, index, rooms.length);
    if (!room.students.length) continue;
    try {
      const rows = await compute(room);
      if (cancelled()) return { cancelled:true, published };
      if (rows.length) { await publish(rows); published++; }
    } catch (error) {
      throw new Error(`ห้อง ${roomName(room)} · ${error.message}`);
    }
  }
  if (cancelled()) return { cancelled:true, published };
  if (!approve) return { published };
  progress("กำลังรวบรวมรายชื่อนักเรียนที่ติด ร./มส.", rooms.length, rooms.length);
  const repairRows = await repairs();
  if (cancelled()) return { cancelled:true, published };
  progress("กำลังอนุมัติและล็อกคะแนน");
  await approve(repairRows);
  return { published, repairs:repairRows.length };
}

const read = async promise => {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
};

const openRequests = (year, term) => read(fetchAllRows(() => {
  const query = sb.from("grade_edit_requests")
    .select("id,kind,term,subject:subjects(name),assessment:competency_assessments(name),grade_edit_request_students(student_id)")
    .eq("year", year).eq("status", "เปิดให้แก้");
  return term === "2" ? query.in("term", ["1", "2"]) : query.eq("term", term);
}));

async function loadLockedRelease(year, term) {
  const [requests, repairs, placements, logs, published] = await Promise.all([
    openRequests(year, term),
    read(fetchAllRows(() => sb.from("grade_release_repairs")
      .select("id,subject_id,subject:subjects(name)").eq("year", year).eq("term", term).is("done_at", null))),
    read(getStudentPlacements(year)),
    read(fetchAllRows(() => {
      const query = sb.from("grade_edit_log").select("id,student_id,created_at,term").eq("year", year);
      return term === "2" ? query.or("term.eq.2,term.is.null,term.eq.1") : query.eq("term", term);
    })),
    read(fetchAllRows(() => sb.from("competency_published").select("student_id,competency_id,published_at")
      .eq("year", year).eq("term", term), ["student_id", "competency_id"]))
  ]);
  // ปลายปีประถมใช้คะแนนกลางปีร่วมด้วย
  const primary = new Set(placements.filter(p => annual(p.grade_level || "")).map(p => p.student_id));
  const relevant = term === "2" ? logs.filter(row => row.term !== "1" || primary.has(row.student_id)) : logs;
  return { requests, repairs, stale:staleCompetencyRooms(releaseRooms(placements), placements, relevant, published) };
}

const list = (items, empty) => items.length
  ? `<ul>${items.map(item => `<li>${gradeEscape(item)}</li>`).join("")}</ul>`
  : `<p class="hint">${gradeEscape(empty)}</p>`;

export async function initGradeReleaseTab(host, { admin, prepareRun }) {
  installGradeStyles();
  const find = id => host.querySelector("#release-" + id);
  const query = new URLSearchParams(location.search);
  const status = find("status"), errorBox = find("error"), progress = find("progress");
  const content = find("content"), yearInput = find("year"), termInput = find("term");
  const stop = find("stop"), retry = find("retry");
  let scope, sequence = 0, busy = false, cancelled = false, retryAction = null;

  function showError(error, action) {
    errorBox.textContent = error ? error.message : "";
    retryAction = action;
    retry.hidden = !action;
  }

  function toggleBusy(value) {
    busy = value;
    for (const control of host.querySelectorAll("select,input,button:not(#release-stop)")) control.disabled = value;
  }

  function updateProgress(message, done = 0, total = 0) {
    status.textContent = message;
    progress.hidden = total === 0;
    if (total) { progress.max = total; progress.value = done; }
    if (message === "กำลังอนุมัติและล็อกคะแนน") stop.hidden = true;
  }

  async function load() {
    const year = yearInput.value, term = termInput.value, token = ++sequence;
    scope = null;
    content.replaceChildren();
    updateProgress("กำลังโหลดสถานะภาคเรียน…");
    showError(null);
    try {
      const [release, scopedSubjects, releases] = await Promise.all([
        read(sb.from("grade_releases").select("id,locked_at,calendar:academic_calendar!calendar_id(start_date)")
          .eq("year", year).eq("term", term).maybeSingle()),
        read(fetchAllRows(() => sb.from("subjects").select("id,grade_level,term,exam_closed_at")
          .eq("year", year).or(`term.eq.${term},term.is.null`))),
        term === "1" ? read(sb.from("grade_releases").select("locked_at").eq("year", year).eq("term", "2").maybeSingle()) : null
      ]);
      const locked = release?.locked_at ? await loadLockedRelease(year, term) : null;
      if (token !== sequence) return;
      scope = { year, term, release, scopedSubjects, locked, otherLock:releases?.locked_at };
      render();
      updateProgress("");
    } catch (error) {
      if (token !== sequence) return;
      updateProgress("");
      showError(new Error("โหลดสถานะภาคเรียนไม่สำเร็จ · " + error.message), load);
    }
  }

  function render() {
    const { release, scopedSubjects, locked, otherLock } = scope;
    const releaseDate = release?.calendar?.start_date;
    const exams = scopedSubjects.filter(row => row.term === scope.term);
    scope.openExams = exams.filter(row => row.exam_closed_at === null).length;
    const lead = release
      ? locked ? `อนุมัติแล้ว ${gradeDate(release.locked_at, true)} · ผู้ปกครองเห็น ${gradeDate(releaseDate)}`
        : `${releaseDate > today() ? "กำหนดประกาศ" : "ประกาศแล้ว"} ${gradeDate(releaseDate)} · ${otherLock ? "ล็อกจากการอนุมัติภาค 2" : "ยังไม่ล็อก"}`
      : otherLock ? "ล็อกจากการอนุมัติภาค 2 · ยังไม่มีวันประกาศของภาคนี้" : "ยังไม่ได้อนุมัติผล";
    let html = `<p><strong>${gradeEscape(lead)}</strong></p>`;
    if (!locked) {
      html += `<p class="hint">ยังไม่ปิดคะแนนสอบ ${scope.openExams} วิชา</p>`;
      if (!release && !exams.length) html += '<p class="empty">ยังไม่มีรายวิชาที่ระบุภาคเรียนนี้ กรุณาตรวจสอบการตั้งค่ารายวิชา</p>';
      else {
        if (!release) html += `<div class="field"><label for="release-date">วันที่ผู้ปกครองเห็นผล</label>
          <input id="release-date" type="date" min="${today()}" required></div>`;
        html += `<div class="grade-lock-actions"><button type="button" class="primary" id="release-approve">
          ${release ? "อนุมัติย้อนหลัง (ล็อกคะแนน)" : "อนุมัติผลและประกาศ"}</button></div>`;
      }
    } else {
      const counts = new Map();
      for (const row of locked.repairs) {
        const [name, count] = counts.get(row.subject_id) || [row.subject?.name || "รายวิชา", 0];
        counts.set(row.subject_id, [name, count + 1]);
      }
      html += `<h3>คำขอที่เปิดให้แก้อยู่</h3>
        ${list(locked.requests.map(row => `ภาค ${row.term} · ${row.subject?.name || row.assessment?.name || row.kind} · ${row.grade_edit_request_students.length} คน`), "ไม่มีคำขอที่เปิดให้แก้อยู่")}
        ${locked.requests.length ? '<div class="grade-lock-actions"><a href="grade-edit-requests.html?tab=open">ดูคำขอที่เปิดให้แก้</a></div>' : ""}
        <h3>ซ่อม ร./มส. ที่ยังไม่ปิด</h3>
        ${list([...counts.values()].map(([name, count]) => `${name} · ${count} คน`), "ไม่มีรายการซ่อมที่ยังเปิดอยู่")}
        <h3>ห้องที่ต้องบันทึกสมรรถนะใหม่</h3>
        ${list(locked.stale.map(roomName), "ไม่มีห้องที่ต้องบันทึกใหม่")}
        ${locked.stale.length ? `<div class="grade-lock-actions"><button type="button" class="primary" id="release-refresh">บันทึกสมรรถนะใหม่ ${locked.stale.length} ห้อง</button></div>` : ""}`;
    }
    if (release) {
      const calendar = new URL("calendar.html", location.href);
      calendar.searchParams.set("year", scope.year);
      html += `<div class="grade-lock-actions"><a href="${gradeEscape(calendar.pathname + calendar.search)}">เลื่อนวันในปฏิทิน</a>
        ${admin || releaseDate > today() ? '<button type="button" class="danger" id="release-revoke">ยกเลิกประกาศ</button>'
          : '<span class="hint">ถึงวันประกาศแล้ว · ยกเลิกได้เฉพาะผู้ดูแลระบบ</span>'}</div>`;
    }
    content.innerHTML = html;
    find("approve")?.addEventListener("click", approve);
    find("refresh")?.addEventListener("click", refresh);
    find("revoke")?.addEventListener("click", revoke);
  }

  async function execute(operation, date, publishRooms = true) {
    const current = scope;
    const isRefresh = operation === "refresh";
    let after = "";
    cancelled = false;
    toggleBusy(true);
    showError(null);
    stop.hidden = false;
    stop.disabled = false;
    updateProgress("กำลังเตรียมข้อมูล…");
    try {
      const run = await prepareRun(current, publishRooms, () => cancelled);
      const rooms = publishRooms ? (isRefresh ? current.locked.stale : run.rooms) : [];
      const result = await runGradeRelease({
        rooms, cancelled:() => cancelled, progress:updateProgress,
        compute:run.compute, publish:rows => gradeRpc("publish_competency_results", { p_year:current.year, p_term:current.term, p_rows:rows }),
        repairs:run.repairs,
        approve:isRefresh ? null : rows => gradeRpc("approve_grade_release",
          { p_year:current.year, p_term:current.term, p_date:date, p_repairs:rows })
      });
      if (result.cancelled) {
        updateProgress(`หยุดแล้ว · บันทึกสมรรถนะไปแล้ว ${result.published} ห้อง · ยังไม่ได้อนุมัติรอบใหม่`);
        showError(null, isRefresh ? refresh : approve);
        return;
      }
      after = isRefresh ? `บันทึกสมรรถนะใหม่ ${result.published} ห้อง`
        : `อนุมัติแล้ว · บันทึกสมรรถนะ ${result.published} ห้อง · รายชื่อซ่อม ${result.repairs} รายการ`;
    } catch (error) {
      updateProgress("");
      showError(new Error((isRefresh ? "บันทึกสมรรถนะใหม่ไม่สำเร็จ · " : "อนุมัติไม่สำเร็จ · ") + error.message),
        isRefresh ? refresh : approve);
    } finally {
      stop.hidden = true;
      progress.hidden = true;
      toggleBusy(false);
    }
    if (after) {
      await load();
      updateProgress(after);
    }
  }

  async function approve() {
    if (!scope || busy) return;
    const { year, term, release, openExams } = scope;
    const dateInput = find("date");
    const date = dateInput?.value || null;
    if (!release && (!date || date < today())) {
      showError(new Error("เลือกวันประกาศตั้งแต่วันนี้เป็นต้นไป"));
      dateInput.min = today();
      dateInput.focus();
      return;
    }
    toggleBusy(true);
    let accepted;
    try {
      accepted = await window.crsAskConfirm({
        title:release ? "อนุมัติย้อนหลัง (ล็อกคะแนน)" : "อนุมัติผลและประกาศ",
        message:`ภาคเรียน ${term}/${year} · ผู้ปกครองเห็น ${gradeDate(date || release?.calendar?.start_date)}\n` +
          "หลังอนุมัติ ครูแก้คะแนนที่ล็อกได้เมื่อมีสิทธิ์ซ่อม หรือได้รับอนุมัติจากฝ่ายวิชาการและ ผอ.\n" +
          (term === "2" ? "การอนุมัติภาค 2 มีผลล็อกคะแนนภาค 1 ของปีนี้ด้วย\n" : "") +
          `ยังไม่ปิดคะแนนสอบ ${openExams} วิชา`,
        okLabel:release ? "อนุมัติย้อนหลัง" : "อนุมัติผลและประกาศ", danger:false,
        checkbox:release ? { label:"บันทึกสมรรถนะใหม่ทุกห้องด้วย", checked:true } : null
      });
    } finally { toggleBusy(false); }
    find("approve")?.focus();
    if (accepted) await execute("approve", date, !release || accepted.checked);
  }

  async function refresh() {
    if (busy || !scope?.locked?.stale.length) return;
    await execute("refresh", null);
  }

  async function revoke() {
    if (busy || !scope?.release) return;
    const current = scope;
    toggleBusy(true);
    showError(null);
    try {
      if (!await window.crsAskConfirm({ title:"ยกเลิกประกาศผลการเรียน",
        message:`ยกเลิกภาคเรียน ${current.term}/${current.year} จะลบวันประกาศและรายการซ่อมของรอบนี้ ผู้ปกครองจะดูผลภาคเรียนนี้ไม่ได้ คะแนนจะกลับไปใช้สถานะล็อกของรอบที่ยังมีอยู่`,
        requireText:`${current.term}/${current.year}`, okLabel:"ยกเลิกประกาศ" })) return;
      await gradeRpc("cancel_grade_release", { p_id:current.release.id });
      await load();
      updateProgress("ยกเลิกประกาศผลการเรียนแล้ว");
    } catch (error) { showError(error); }
    finally { toggleBusy(false); }
  }

  stop.onclick = () => { cancelled = true; stop.disabled = true; status.textContent = "กำลังหยุดเมื่อขั้นตอนปัจจุบันเสร็จ…"; };
  retry.onclick = () => retryAction?.();
  yearInput.onchange = termInput.onchange = () => { if (!busy) void load(); };
  try {
    const years = await getAcademicYears();
    if (!years.length) {
      toggleBusy(true);
      updateProgress("ยังไม่มีปีการศึกษา · กำหนดปีการศึกษาก่อนอนุมัติผล");
      return;
    }
    yearInput.innerHTML = [...years].reverse().map(row => `<option value="${gradeEscape(row.year)}">${gradeEscape(row.year)}</option>`).join("");
    const choice = [query.get("year"), getActiveYear(), academicYearOf(today(), years)].find(year => years.some(row => row.year === year));
    if (choice) yearInput.value = choice;
    const term = query.get("term") || academicTermOf(today(), years);
    if (["1", "2"].includes(term)) termInput.value = term;
    await load();
  } catch (error) { updateProgress(""); showError(error); }
}
