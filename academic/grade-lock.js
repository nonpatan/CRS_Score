import { sb, fetchAllRows } from "../supabase-client.js?v=20261127-1";

export const pendingGradeRequests = ["รอวิชาการ", "รอผอ.", "ส่งกลับ"];
export const gradeRequestUrl = "./grade-edit-requests.html";
export const gradeEscape = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

export function gradeLockError(error) {
  if (error?.hint !== "grade_locked" && !error?.message?.startsWith("GRADE_LOCKED:")) return "";
  return error.message?.replace(/^GRADE_LOCKED:\s*/, "") || "ภาคเรียนนี้อนุมัติผลแล้ว ส่งคำขอแก้ผ่านฝ่ายวิชาการ";
}

export async function gradeRpc(name, params) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data;
}

export function targetGradeRequests(query, { year, kind, target, term }) {
  query = query.eq("year", year).eq("kind", kind);
  if (kind === "วิชา") return query.eq("subject_id", target);
  if (kind === "กิจกรรม/กิจวัตร") return query.eq("assessment_id", target);
  return query.eq("term", term);
}

export async function readGradeLock(scope, { mid = false, userId } = {}) {
  const { year, term, kind, target } = scope;
  const data = kind === "วิชา" ? await gradeRpc("subject_lock_status", { p_subject_id:target })
    : kind === "กิจกรรม/กิจวัตร" ? await gradeRpc("assessment_lock_status", { p_assessment_id:target })
    : await gradeRpc("trait_lock_status", { p_year:year, p_term:term });
  if (!data) throw new Error("ไม่พบสถานะล็อกของรายการนี้");
  const locked = Boolean(mid ? data.locked_mid : data.locked);
  if (!locked) return { locked, ...scope };

  const [releases, requests] = await Promise.all([
    sb.from("grade_releases").select("term,locked_at").eq("year", year).not("locked_at", "is", null),
    fetchAllRows(() => targetGradeRequests(sb.from("grade_edit_requests")
      .select("id,requested_by,status,term,grade_edit_request_students(student_id)"), scope)
      .or(`status.eq.เปิดให้แก้,and(requested_by.eq.${userId},status.in.("รอวิชาการ","รอผอ.","ส่งกลับ"))`))
  ]);
  if (releases.error || requests.error) throw releases.error || requests.error;
  const release = releases.data?.find(row => row.term === term) || releases.data?.find(row => row.term === "2");
  const repairs = new Map(), openRequests = new Map(), relevant = requests.data || [];
  for (const row of data.repairs || []) {
    if (!repairs.has(row.student_id)) repairs.set(row.student_id, []);
    repairs.get(row.student_id).push(row);
  }
  for (const request of relevant) {
    if (request.status !== "เปิดให้แก้") continue;
    for (const { student_id } of request.grade_edit_request_students) {
      if (!openRequests.has(student_id)) openRequests.set(student_id, []);
      openRequests.get(student_id).push(request);
    }
  }
  return {
    ...scope, locked, lockedAt:release?.locked_at, requestable:locked,
    repairs, open:new Set(data.open_student_ids || []), openRequests, requests:relevant
  };
}

export function gradeRowLocked(state, studentId) {
  return Boolean(state?.locked && !state.open?.has(studentId) && !state.repairs?.has(studentId));
}

export function gradeDate(value, withTime = false) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", { timeZone:"Asia/Bangkok", dateStyle:"medium",
    ...(withTime ? { timeStyle:"short" } : {}) }).format(new Date(value));
}

export function installGradeStyles() {
  if (document.getElementById("grade-lock-style")) return;
  const style = document.createElement("style");
  style.id = "grade-lock-style";
  style.textContent = `
    .grade-lock-banner{padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--amber-soft);color:var(--ink);margin:0 0 12px;overflow-wrap:anywhere}
    .grade-lock-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0}
    .grade-lock-actions button,.grade-lock-actions a,.grade-lock-row button,.grade-request-dialog button{min-height:44px;min-width:44px;padding:8px 12px;border:0;border-radius:8px;font:inherit;cursor:pointer}
    .grade-lock-actions :is(a,button),.grade-lock-row button{scroll-margin-block-end:100px}
    .grade-lock-actions a{display:inline-flex;align-items:center;color:var(--teal)}
    .grade-lock-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px}
    .grade-lock-chip{display:inline-block;font-size:13px;padding:2px 8px;border-radius:8px;background:var(--amber-soft);color:var(--amber)}
    .grade-lock-chip.open{background:var(--teal-soft);color:var(--teal)}
    .grade-lock-chip.locked{background:var(--bg);color:var(--ink)}
    [data-grade-readonly]{background:var(--bg)!important;color:var(--ink)!important;cursor:not-allowed}
    .grade-lock-actions :focus-visible,.grade-lock-row :focus-visible,.grade-request-dialog :focus-visible{outline:2px solid var(--teal);outline-offset:2px}
    .grade-lock-actions :disabled,.grade-lock-row :disabled,.grade-request-dialog :disabled{opacity:.55;cursor:wait}
    .grade-request-dialog{width:min(calc(100% - 24px),520px);max-height:calc(100dvh - 24px);border:1px solid var(--line);border-radius:12px;padding:16px;color:var(--ink);background:var(--white)}
    .grade-request-dialog::backdrop{background:rgba(15,23,42,.58)}
    .grade-request-dialog h2{margin:0 0 8px;font-size:20px}
    .grade-request-dialog fieldset{min-width:0;margin:0 0 12px;padding:8px;border:1px solid var(--line);border-radius:8px}
    .grade-request-dialog .grade-candidates{max-height:240px;overflow:auto}
    .grade-request-dialog .grade-choice{display:flex;min-height:44px;align-items:center;gap:10px;overflow-wrap:anywhere}
    .grade-request-dialog input[type=checkbox]{flex:none;width:18px;height:18px}
    .grade-request-dialog textarea{width:100%;min-height:85px;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--white);color:var(--ink)}
    .grade-request-dialog [role=alert],.grade-lock-banner [role=alert]{color:var(--danger)}
  `;
  document.head.append(style);
}

function gradeForm({ title, students, selected = [], reason = "", label, submit, success }) {
  installGradeStyles();
  const trigger = document.activeElement;
  const dialog = document.createElement("dialog");
  const chosen = new Set(selected);
  dialog.className = "grade-request-dialog";
  dialog.setAttribute("aria-labelledby", "grade-form-title");
  dialog.innerHTML = `<form>
    <h2 id="grade-form-title">${gradeEscape(title)}</h2>
    ${students ? `<fieldset><legend>เลือกนักเรียน (ไม่เกิน 200 คน)</legend><div class="grade-candidates">
    ${students.map(student => `<label class="grade-choice"><input type="checkbox" name="student" value="${gradeEscape(student.id)}"${chosen.has(student.id) ? " checked" : ""}>
    <span>${gradeEscape(student.name)}${student.room ? " · " + gradeEscape(student.room) : ""}</span></label>`).join("")}</div></fieldset>` : ""}
    <label for="grade-form-note">เหตุผล (จำเป็น)</label>
    <textarea id="grade-form-note" name="reason" required aria-describedby="grade-form-error">${gradeEscape(reason)}</textarea>
    <p id="grade-form-error" role="alert"></p>
    <div class="grade-lock-actions"><button type="submit" class="primary">${gradeEscape(label)}</button>
    <button type="button" class="ghost" data-cancel>ยกเลิก</button></div>
  </form>`;
  const form = dialog.querySelector("form");
  const error = dialog.querySelector("[role=alert]");
  const cancel = dialog.querySelector("[data-cancel]");
  const button = form.querySelector("[type=submit]");
  const note = form.elements.reason;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener("cancel", event => { if (button.disabled) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); if (trigger?.isConnected) trigger.focus(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (button.disabled) return;
    const ids = new FormData(form).getAll("student"), value = note.value.trim();
    if (students && (ids.length === 0 || ids.length > 200)) {
      error.textContent = "เลือกนักเรียน 1–200 คน";
      form.querySelector("[name=student]")?.focus();
      return;
    }
    if (!value) { error.textContent = "กรอกเหตุผลก่อนส่ง"; note.focus(); return; }
    error.textContent = "";
    button.disabled = cancel.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try { await submit(value, ids); }
    catch (failure) { error.textContent = gradeLockError(failure) || failure.message; return; }
    finally { button.disabled = cancel.disabled = false; button.textContent = label; }
    dialog.close();
    await success();
  });
  document.body.append(dialog);
  dialog.showModal();
}

export function editGradeRequestForm({ scope, students, request, success }) {
  gradeForm({
    title:request ? "แก้ไขและส่งคำขอใหม่" : "ขอแก้คะแนน",
    students, reason:request?.reason, selected:request?.grade_edit_request_students.map(row => row.student_id),
    label:request ? "ส่งใหม่ให้วิชาการ" : "ส่งคำขอ",
    submit:(reason, ids) => request
      ? gradeRpc("resubmit_grade_edit_request", { p_id:request.id, p_student_ids:ids, p_reason:reason })
      : gradeRpc("submit_grade_edit_request", { p_year:scope.year, p_term:scope.term, p_kind:scope.kind,
        p_target:scope.target, p_student_ids:ids, p_reason:reason }),
    success:async () => {
      void gradeQueueCounts().catch(() => {});
      await success();
    }
  });
}

export function decideGradeRequestForm(request, decision, success) {
  gradeForm({ title:decision + "คำขอแก้คะแนน", label:decision,
    submit:note => gradeRpc("decide_grade_edit_request", { p_id:request.id, p_decision:decision, p_note:note }), success });
}

export async function confirmGradeAction(button, rpc, id, options, onResult) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  try {
    if (!await window.crsAskConfirm(options)) return;
    button.textContent = "กำลังบันทึก…";
    await gradeRpc(rpc, { p_id:id });
    if (rpc !== "finish_release_repair") void gradeQueueCounts().catch(() => {});
    await onResult();
  } catch (error) {
    await onResult(error);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

export const finishGradeRequestConfirm = { title:"แก้เสร็จ", okLabel:"แก้เสร็จ",
  message:"เมื่อปิดคำขอนี้ นักเรียนทุกคนในคำขอจะกลับไปใช้สิทธิ์ตามสถานะล็อกและสิทธิ์อื่นที่ยังเปิดอยู่ กรุณาบันทึกคะแนนก่อนปิดคำขอ" };

export const withdrawGradeRequestConfirm = { title:"ถอนคำขอแก้คะแนน", okLabel:"ถอนคำขอ",
  message:"คำขอนี้จะออกจากคิวพิจารณา" };

function gradeButton(text, action, className = "ghost") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.onclick = () => action(button);
  return button;
}

export function renderGradeLockBanner(host, state, students, { userId, canRequest, onChange }) {
  host.querySelector(":scope > .grade-lock-banner")?.remove();
  if (!state?.locked && !state?.error) return;
  installGradeStyles();
  const banner = document.createElement("section");
  banner.className = "grade-lock-banner";
  if (state.error) {
    banner.innerHTML = '<div role="alert"></div><div class="grade-lock-actions"></div>';
    banner.firstElementChild.textContent = "ตรวจสถานะล็อกไม่สำเร็จ · " + state.error;
    banner.lastElementChild.append(gradeButton("ลองโหลดสถานะใหม่", () => onChange()));
    host.prepend(banner);
    return;
  }
  banner.innerHTML = `<div><strong>🔒 ภาคเรียนนี้อนุมัติผลแล้ว ${gradeEscape(gradeDate(state.lockedAt))}</strong>
    <div>แก้ได้เฉพาะนักเรียนที่ซ่อม ร./มส. หรือได้รับอนุมัติให้แก้</div></div>`;
  const actions = document.createElement("div");
  actions.className = "grade-lock-actions";
  if (canRequest && students.length && state.requestable) {
    actions.append(gradeButton("ขอแก้", () => editGradeRequestForm({
      scope:state, students, success:() => onChange(null, "ส่งคำขอแล้ว รอฝ่ายวิชาการ")
    })));
  }
  const mine = state.requests.filter(row => row.requested_by === userId);
  if (mine.length) {
    const link = document.createElement("a");
    link.href = gradeRequestUrl;
    link.textContent = "ดูคำขอของฉัน";
    actions.append(link);
  }
  if (actions.childNodes.length) banner.append(actions);
  for (const request of mine) {
    const row = document.createElement("div");
    row.className = "grade-lock-actions";
    row.textContent = `คำขอภาค ${request.term} · ${request.status} · ${request.grade_edit_request_students.length} คน`;
    if (pendingGradeRequests.includes(request.status)) row.append(gradeButton("ถอนคำขอ", button =>
      confirmGradeAction(button, "withdraw_grade_edit_request", request.id, withdrawGradeRequestConfirm,
        error => onChange(error, "ถอนคำขอแล้ว"))));
    banner.append(row);
  }
  host.prepend(banner);
}

export function renderGradeLockRow(host, state, studentId, { userId, canFinishRepair, academic, onChange, canClose = () => true }) {
  host.querySelector(":scope > .grade-lock-row")?.remove();
  if (!state?.locked) return;
  installGradeStyles();
  const row = document.createElement("div");
  row.className = "grade-lock-row";
  const chip = (text, tone = "") => {
    const span = document.createElement("span");
    span.className = "grade-lock-chip " + tone;
    span.textContent = text;
    row.append(span);
  };
  for (const repair of state.repairs?.get(studentId) || []) {
    chip("ซ่อม " + repair.code);
    if (canFinishRepair) row.append(gradeButton("ซ่อมเสร็จ", button =>
      canClose() && confirmGradeAction(button, "finish_release_repair", repair.id, {
        title:"ซ่อมเสร็จ", okLabel:"ซ่อมเสร็จ",
        message:"ปิดสิทธิ์ซ่อมของนักเรียนในวิชานี้ กรุณาบันทึกคะแนนหรือคาบชดเชยก่อนปิด"
      }, error => onChange(error, "ปิดสิทธิ์ซ่อมแล้ว"))));
  }
  if (state.open.has(studentId)) {
    chip("ได้รับอนุมัติให้แก้", "open");
    for (const request of state.openRequests?.get(studentId) || []) {
      if (!academic && request.requested_by !== userId) continue;
      row.append(gradeButton("แก้เสร็จ", button =>
        canClose() && confirmGradeAction(button, "finish_grade_edit_request", request.id, finishGradeRequestConfirm,
          error => onChange(error, "ปิดคำขอแล้ว"))));
    }
  }
  if (!row.childNodes.length) chip("🔒 ล็อก", "locked");
  host.append(row);
}

let queueCountsRequest;
export function gradeQueueCounts() {
  if (!queueCountsRequest) {
    queueCountsRequest = gradeRpc("grade_edit_queue_counts").then(data => {
      window.dispatchEvent(new CustomEvent("crs-grade-queue-counts", { detail:data }));
      return data;
    }).finally(() => { queueCountsRequest = null; });
  }
  return queueCountsRequest;
}

export function watchGradeRequests(channelName, reload) {
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 250);
  };
  const channel = sb.channel(channelName).on("postgres_changes", {
    event:"*", schema:"public", table:"grade_edit_requests"
  }, refresh).subscribe();
  const onVisible = () => { if (!document.hidden) refresh(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    void sb.removeChannel(channel);
  }, { once:true });
}
