// ============================================================
// Supabase Edge Function: jibble-sync
// ------------------------------------------------------------
// ดึงข้อมูลจาก Jibble เข้ามาเก็บใน Supabase — ทำงานฝั่ง server เท่านั้น
// เหตุผลที่ต้องมีไฟล์นี้: repo เป็น public + หน้าเว็บเป็น static จึงฝัง Jibble API key ไม่ได้
// key อยู่ใน Supabase secrets (JIBBLE_KEY_ID / JIBBLE_KEY_SECRET) หน้าเว็บไม่เคยเห็น
//
// เรียกใช้ (ต้องแนบ Authorization: Bearer <access_token ของผู้ใช้ที่ล็อกอิน>):
//   POST { scope: "people" }                          → ซิงก์รายชื่อ + ตารางงาน + วันหยุด
//   POST { scope: "month", yearMonth: "2026-07" }     → ซิงก์เวลาเข้า-ออกของเดือนนั้น
//   POST { scope: "month", yearMonth: "2026-07", force: true }  → ดึงทับทั้งเดือน (ปุ่ม "ซิงก์ใหม่")
//   POST { scope: "today" }                          → อัปเดตการ์ดครูมาวันนี้ (ผู้ล็อกอินทุกคน)
//
// กติกาความนิ่งของข้อมูล: วันนิ่ง = วันก่อนหน้า หรือ วันนี้ที่เลยเวลา auto clock-out (18:00) แล้ว
//   → ก่อน 18:00 วันนี้ถูกดึงใหม่ทุกครั้ง · หลัง 18:00 ไม่ต้องดึงซ้ำ
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
const JIBBLE_WORKSPACE = "https://workspace.prod.jibble.io/v1";
const JIBBLE_TIME = "https://time-tracking.prod.jibble.io/v1";

// เขตเวลาของโรงเรียน — Jibble ตั้ง Asia/Bangkok ไว้ทุกคน (ตรวจแล้ว)
const TZ_OFFSET_MINUTES = 7 * 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ---------- วันที่ (คิดตามเวลาไทยเสมอ ไม่ใช่ UTC ของเครื่อง server) ----------
function nowInBangkok(): Date {
  return new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000);
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function monthBounds(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const end = ymd(new Date(Date.UTC(y, m, 0))); // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
  return { start, end };
}
const minDate = (a: string, b: string) => (a < b ? a : b);
function isoWeekday(dateStr: string): number {
  const weekday = new Date(dateStr + "T00:00:00Z").getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
function isPastTime(nowBkk: Date, timeStr: string): boolean {
  const [hour, minute] = String(timeStr).split(":").map(Number);
  return nowBkk.getUTCHours() > hour ||
    (nowBkk.getUTCHours() === hour && nowBkk.getUTCMinutes() >= (minute || 0));
}

// ---------- Jibble ----------
async function getJibbleToken(): Promise<string> {
  const id = Deno.env.get("JIBBLE_KEY_ID");
  const secret = Deno.env.get("JIBBLE_KEY_SECRET");
  if (!id || !secret) {
    throw new Error("ยังไม่ได้ตั้ง secret JIBBLE_KEY_ID / JIBBLE_KEY_SECRET ใน Supabase");
  }
  const res = await fetch(JIBBLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw new Error(`ขอ token จาก Jibble ไม่สำเร็จ (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error("Jibble ไม่ได้คืน access_token กลับมา");
  return data.access_token;
}

// ⚠ สำคัญ: Jibble ไม่ส่ง @odata.nextLink กลับมา — ดึง $top=1000 แล้วจะได้แค่ 1000 แถวและหยุดเงียบ ๆ
// ไม่มี error ใด ๆ (เจอจริงตอนสำรวจ: ข้อมูล 8 วันสุดท้ายหายไปโดยไม่รู้ตัว)
// จึงต้องวนหน้าเองด้วย $skip จนกว่าจะได้น้อยกว่า pageSize
async function fetchAll(
  baseUrl: string,
  params: Record<string, string>,
  token: string,
): Promise<any[]> {
  const pageSize = 500;
  const rows: any[] = [];
  for (let skip = 0; skip < 100_000; skip += pageSize) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("$top", String(pageSize));
    url.searchParams.set("$skip", String(skip));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`ดึงข้อมูลจาก Jibble ไม่สำเร็จ (HTTP ${res.status}) ที่ ${baseUrl}`);
    }
    const data = await res.json();
    const page: any[] = data.value ?? [];
    rows.push(...page);
    if (page.length < pageSize) break; // หน้าสุดท้าย
  }
  return rows;
}

// ---------- ซิงก์รายชื่อ + ตารางงาน + วันหยุด ----------
async function syncPeople(db: any, token: string) {
  // 1) รายชื่อ — เอาเฉพาะฟิลด์ที่ใช้ ไม่ดึงการตั้งค่า/ข้อมูลใบหน้าที่ไม่จำเป็น
  const people = await fetchAll(`${JIBBLE_WORKSPACE}/People`, {
    "$select": "id,fullName,email,code,status,role",
  }, token);

  // จับคู่ด้วย jibble_person_id เท่านั้น ไม่เทียบชื่อ (ชื่อไทยสะกดต่างกันได้ง่าย)
  // คนที่มีอยู่แล้วจะถูกอัปเดตชื่อ/สถานะ ส่วน exempt / allowed_late_time / user_id
  // เป็นค่าที่ตั้งในระบบเรา จึงไม่ส่งไปใน upsert เพื่อไม่ให้ถูกทับหาย
  const staffRows = people.map((p) => ({
    jibble_person_id: p.id,
    full_name: p.fullName ?? "(ไม่มีชื่อ)",
    email: p.email ?? null,
    jibble_code: p.code ?? null,
    is_active: p.status === "Joined",
    updated_at: new Date().toISOString(),
  }));
  if (staffRows.length) {
    const { error } = await db.from("staff").upsert(staffRows, { onConflict: "jibble_person_id" });
    if (error) throw new Error("บันทึกรายชื่อบุคลากรไม่สำเร็จ: " + error.message);
  }

  // 2) ตารางงาน — ใช้ชุดที่ตั้งเป็น default (People.scheduleId ว่างทุกคน = ใช้ default)
  const schedules = await fetchAll(`${JIBBLE_WORKSPACE}/Schedules`, {}, token);
  const def = schedules.find((s) => s.default) ?? schedules[0];
  const DAY_TO_ISO: Record<string, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
  };
  const scheduleRows: any[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = def?.daySchedules?.find((d: any) => DAY_TO_ISO[d.day] === weekday);
    scheduleRows.push({
      weekday,
      is_working_day: !!day,                                  // ไม่มีในตาราง = ไม่ใช่วันทำงาน
      start_time: day ? String(day.from).slice(0, 8) : null,  // "07:45:00.0000000" → "07:45:00"
      end_time: day ? String(day.to).slice(0, 8) : null,
      synced_at: new Date().toISOString(),
    });
  }
  const { error: schedErr } = await db.from("work_schedule").upsert(scheduleRows, { onConflict: "weekday" });
  if (schedErr) throw new Error("บันทึกตารางงานไม่สำเร็จ: " + schedErr.message);

  // 3) วันหยุด — ใช้ปฏิทินที่ตั้งเป็น default ของโรงเรียน
  const calendars = await fetchAll(`${JIBBLE_WORKSPACE}/Calendars`, {}, token);
  const defaultCal = calendars.find((c) => c.default) ?? calendars[0];
  let holidayCount = 0;
  if (defaultCal) {
    const days = await fetchAll(`${JIBBLE_WORKSPACE}/CalendarDays`, {}, token);
    const rows = days
      .filter((d) => d.calendarId === defaultCal.id && d.date)
      .map((d) => ({
        holiday_date: String(d.date).slice(0, 10),
        name: d.name ?? null,
        is_short_day: !!d.isShortDay,
        jibble_id: d.id ?? null,
        synced_at: new Date().toISOString(),
      }));
    if (rows.length) {
      const { error } = await db.from("work_holidays").upsert(rows, { onConflict: "holiday_date" });
      if (error) throw new Error("บันทึกวันหยุดไม่สำเร็จ: " + error.message);
    }
    holidayCount = rows.length;
  }

  // 4) เวลา auto clock-out ของ Jibble = จุดที่ถือว่า "ข้อมูลของวันนั้นนิ่งแล้ว"
  // ดึงจาก Jibble จริงแทนการ hardcode 18:00 (ถ้าโรงเรียนเปลี่ยน ระบบจะตามเอง)
  // ดึงคนเดียวพอ เพราะเป็นค่าที่ตั้งเหมือนกันทั้งองค์กร (ตรวจแล้วทุกคนเป็น 18:00:00)
  let finalTime: string | null = null;
  try {
    const res = await fetch(`${JIBBLE_WORKSPACE}/People?$top=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const one = (await res.json())?.value?.[0];
      const raw = one?.["ITimeTrackingSettings/AutomaticOutAtTime"];
      if (typeof raw === "string" && /^\d{2}:\d{2}/.test(raw)) finalTime = raw.slice(0, 5);
    }
  } catch { /* ไม่ใช่ข้อมูลหลัก ถ้าดึงไม่ได้ก็ใช้ค่าเดิมใน hr_settings ต่อไป */ }
  if (finalTime) {
    await db.from("hr_settings").upsert({ key: "day_final_time", value: finalTime }, { onConflict: "key" });
  }

  return {
    people: staffRows.length,
    holidays: holidayCount,
    schedule: scheduleRows.filter((r) => r.is_working_day).length,
    dayFinalTime: finalTime,
  };
}

// ---------- ยุบ TimeEntries เป็น work_attendance (ใช้ร่วมกันทั้ง month และ today) ----------
type StaffLink = { id: string; jibble_person_id: string | null };
type AttendanceRow = {
  staff_id: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  first_in_local: string | null;
  auto_out: boolean;
  source: string;
  synced_at: string;
};

function collapseTimeEntries(
  entries: any[],
  staffList: StaffLink[],
  syncedAt: string,
): AttendanceRow[] {
  const byJibbleId = new Map<string, string>(
    staffList
      .filter((staff) => staff.jibble_person_id)
      .map((staff) => [staff.jibble_person_id!, staff.id]),
  );

  type Agg = { firstIn?: string; lastOut?: string; autoOut: boolean };
  const agg = new Map<string, Agg>();
  for (const entry of entries) {
    if (entry.status !== "Active") continue;
    const staffId = byJibbleId.get(entry.personId);
    if (!staffId || !entry.belongsToDate) continue;
    const key = `${staffId}|${String(entry.belongsToDate).slice(0, 10)}`;
    const current = agg.get(key) ?? { autoOut: false };
    if (entry.type === "In") {
      if (!current.firstIn || entry.localTime < current.firstIn) current.firstIn = entry.localTime;
    } else if (entry.type === "Out") {
      if (!current.lastOut || entry.localTime > current.lastOut) {
        current.lastOut = entry.localTime;
        // AutoOut = ระบบเด้งออกให้ = "ลืมกด logout" ไม่ใช่ "ทำงานถึงเวลานั้น"
        current.autoOut = entry.clientType === "AutoOut";
      }
    }
    agg.set(key, current);
  }

  return [...agg.entries()].map(([key, value]) => {
    const [staffId, workDate] = key.split("|");
    return {
      staff_id: staffId,
      work_date: workDate,
      first_in: value.firstIn ?? null,
      last_out: value.lastOut ?? null,
      // localTime มี offset +07:00 แล้ว ตัดเวลาตรง ๆ ปลอดภัยกว่าคำนวณ timezone ใหม่
      first_in_local: value.firstIn ? value.firstIn.slice(11, 19) : null,
      auto_out: value.autoOut,
      source: "jibble",
      synced_at: syncedAt,
    };
  });
}

// ---------- ซิงก์เวลาเข้า-ออกของเดือนหนึ่ง ----------
async function syncMonth(db: any, token: string, yearMonth: string, force: boolean) {
  const { start: monthStart, end: monthEnd } = monthBounds(yearMonth);
  const nowBkk = nowInBangkok();
  const today = ymd(nowBkk);

  // เวลาที่ถือว่า "วันนี้จบแล้ว" — อ่านจากค่าตั้ง (Jibble auto clock-out) ไม่ hardcode
  const { data: finalSetting } = await db
    .from("hr_settings").select("value").eq("key", "day_final_time").maybeSingle();
  const finalTime = finalSetting?.value ?? "18:00";
  const pastFinalTime = isPastTime(nowBkk, finalTime);

  // วันสุดท้ายที่ข้อมูล "นิ่ง" แล้ว
  const finalDay = pastFinalTime ? today : addDays(today, -1);

  const { data: prev } = await db
    .from("work_month_sync").select("*").eq("year_month", yearMonth).maybeSingle();

  const start = force || !prev ? monthStart : addDays(prev.synced_through, 1);
  const end = minDate(monthEnd, today);

  let attendanceRows = 0;
  if (start <= end) {
    const entries = await fetchAll(`${JIBBLE_TIME}/TimeEntries`, {
      "$select": "personId,belongsToDate,type,localTime,clientType,status",
      "$filter": `belongsToDate ge ${start} and belongsToDate le ${end}`,
      "$orderby": "time asc",
    }, token);

    const { data: staffList, error: staffErr } = await db
      .from("staff").select("id,jibble_person_id").not("jibble_person_id", "is", null);
    if (staffErr) throw new Error("อ่านทะเบียนบุคลากรไม่สำเร็จ: " + staffErr.message);
    const rows = collapseTimeEntries(entries, staffList ?? [], new Date().toISOString());

    if (rows.length) {
      const { error } = await db.from("work_attendance")
        .upsert(rows, { onConflict: "staff_id,work_date" });
      if (error) throw new Error("บันทึกเวลาเข้า-ออกไม่สำเร็จ: " + error.message);
    }
    attendanceRows = rows.length;
  }

  // จดว่าดึงถึงวันไหนแล้ว — เก็บเฉพาะวันที่นิ่งแล้วเท่านั้น และห้ามถอยหลัง
  const newThrough = minDate(monthEnd, finalDay);
  if (newThrough >= monthStart && (!prev || newThrough > prev.synced_through || force)) {
    const { error } = await db.from("work_month_sync").upsert({
      year_month: yearMonth,
      synced_through: newThrough,
      synced_at: new Date().toISOString(),
    }, { onConflict: "year_month" });
    if (error) throw new Error("บันทึกสถานะการซิงก์ไม่สำเร็จ: " + error.message);
  }

  return {
    fetchedFrom: start <= end ? start : null,
    fetchedTo: start <= end ? end : null,
    attendanceRows,
    syncedThrough: newThrough,
    todayIsFinal: pastFinalTime,
  };
}

// ---------- การ์ด "ครูมาวันนี้" ----------
function shuffled<T>(rows: T[]): T[] {
  const out = [...rows];
  for (let index = out.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [out[index], out[swapWith]] = [out[swapWith], out[index]];
  }
  return out;
}

async function syncToday(db: any, isHr: boolean) {
  const nowBkk = nowInBangkok();
  const today = ymd(nowBkk);
  const weekday = isoWeekday(today);

  const [scheduleRes, holidayRes, settingsRes] = await Promise.all([
    db.from("work_schedule")
      .select("weekday,is_working_day")
      .eq("weekday", weekday)
      .maybeSingle(),
    db.from("work_holidays")
      .select("holiday_date")
      .eq("holiday_date", today)
      .maybeSingle(),
    db.from("hr_settings")
      .select("key,value")
      .in("key", ["day_final_time", "today_refresh_minutes"]),
  ]);
  if (scheduleRes.error) throw new Error("อ่านตารางงานไม่สำเร็จ: " + scheduleRes.error.message);
  if (holidayRes.error) throw new Error("อ่านวันหยุดไม่สำเร็จ: " + holidayRes.error.message);
  if (settingsRes.error) throw new Error("อ่านค่าตั้งงานบุคคลไม่สำเร็จ: " + settingsRes.error.message);
  if (!scheduleRes.data) throw new Error("ยังไม่มีตารางงานของวันนี้ กรุณาซิงก์ข้อมูลบุคลากรก่อน");

  // วันหยุดต้องจบตรงนี้ ไม่ขอ token และไม่ยิง Jibble
  if (scheduleRes.data.is_working_day !== true || holidayRes.data) {
    return { isHoliday: true, fetched: false, rowsSynced: 0, fetchedAt: null };
  }

  const settings = new Map<string, string>(
    (settingsRes.data ?? []).map((row: any) => [row.key, row.value]),
  );
  // ค่าเริ่มต้น 5 นาทีเป็นตัวเลขที่ผู้ใช้ยืนยันแล้ว เก็บลง hr_settings ครั้งเดียว
  // จากนั้นทุกครั้งอ่านจากตาราง ไม่ฝังค่านี้ไว้ในตรรกะ throttle
  if (!settings.has("today_refresh_minutes")) {
    const { error } = await db.from("hr_settings").insert({
      key: "today_refresh_minutes",
      value: "5",
    });
    if (error && error.code !== "23505") {
      throw new Error("ตั้งค่ารอบอัปเดตข้อมูลวันนี้ไม่สำเร็จ: " + error.message);
    }
    settings.set("today_refresh_minutes", "5");
  }
  const refreshMinutes = Number(settings.get("today_refresh_minutes"));
  if (!Number.isFinite(refreshMinutes) || refreshMinutes < 0) {
    throw new Error("ค่า today_refresh_minutes ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
  }
  const finalTime = String(settings.get("day_final_time") ?? "18:00").slice(0, 5);
  const pastFinalTime = isPastTime(nowBkk, finalTime);

  const { data: latestLog, error: logError } = await db.from("jibble_sync_log")
    .select("started_at,finished_at")
    .eq("scope", "today")
    .eq("ok", true)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logError) throw new Error("อ่านประวัติการอัปเดตวันนี้ไม่สำเร็จ: " + logError.message);

  const latestAt = latestLog?.finished_at ?? latestLog?.started_at ?? null;
  const freshAfter = Date.now() - refreshMinutes * 60_000;
  const cacheIsFresh = !!latestAt && new Date(latestAt).getTime() >= freshAfter;
  const finalMoment = new Date(`${today}T${finalTime}:00+07:00`).getTime();
  const hasFinalCache = !!latestAt && new Date(latestAt).getTime() >= finalMoment;

  const { data: staffList, error: staffError } = await db.from("staff")
    .select("id,jibble_person_id,exempt,allowed_late_time")
    .eq("is_active", true);
  if (staffError) throw new Error("อ่านทะเบียนบุคลากรไม่สำเร็จ: " + staffError.message);

  let fetched = false;
  let rowsSynced = 0;
  // ก่อนปิดวัน refresh ตามช่วงที่ตั้งไว้; หลังปิดวันดึงอีกครั้งเดียวให้ได้ข้อมูลสุดท้ายของวัน
  const shouldFetch = pastFinalTime ? !hasFinalCache : !cacheIsFresh;
  if (shouldFetch) {
    const token = await getJibbleToken();
    const entries = await fetchAll(`${JIBBLE_TIME}/TimeEntries`, {
      "$select": "personId,belongsToDate,type,localTime,clientType,status",
      "$filter": `belongsToDate ge ${today} and belongsToDate le ${today}`,
      "$orderby": "time asc",
    }, token);
    const syncedAt = new Date().toISOString();
    const attendanceRows = collapseTimeEntries(entries, staffList ?? [], syncedAt);
    if (attendanceRows.length) {
      const { error } = await db.from("work_attendance")
        .upsert(attendanceRows, { onConflict: "staff_id,work_date" });
      if (error) throw new Error("บันทึกเวลาเข้า-ออกวันนี้ไม่สำเร็จ: " + error.message);
    }
    fetched = true;
    rowsSynced = attendanceRows.length;
  }

  const attendanceRes = await db.from("work_attendance")
    .select("staff_id,first_in_local,auto_out,synced_at")
    .eq("work_date", today);
  if (attendanceRes.error) throw new Error("อ่านเวลาเข้า-ออกวันนี้ไม่สำเร็จ: " + attendanceRes.error.message);

  const attendanceByStaff = new Map<string, any>(
    (attendanceRes.data ?? []).map((row: any) => [row.staff_id, row]),
  );
  // "ข้อมูล ณ ..." ต้องมาจากเวลาที่เขียนข้อมูลจริง ไม่ใช่เวลาที่มีคนเปิด dashboard
  const fetchedAt = (attendanceRes.data ?? [])
    .map((row: any) => row.synced_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  if (!isHr) {
    const total = (staffList ?? []).length;
    const checkedIn = (staffList ?? []).filter((staff: any) =>
      staff.exempt === true || !!attendanceByStaff.get(staff.id)?.first_in_local
    ).length;
    // สำคัญ: basic กรองที่ server และไม่ประกอบ rows ขึ้น response แม้แต่ field เดียว
    return { mode: "basic", total, checkedIn, fetchedAt, fetched, rowsSynced };
  }

  // ใบลาใช้เฉพาะโหมด full — ครูทั่วไปไม่ควรเสีย query นี้ทุกครั้งที่เปิด dashboard
  const leavesRes = await db.from("staff_leaves")
    .select("staff_id,day_portion")
    .lte("start_date", today)
    .gte("end_date", today);
  if (leavesRes.error) throw new Error("อ่านข้อมูลลาวันนี้ไม่สำเร็จ: " + leavesRes.error.message);
  const leaveByStaff = new Map<string, any>();
  for (const leave of (leavesRes.data ?? [])) {
    if (!leaveByStaff.has(leave.staff_id)) leaveByStaff.set(leave.staff_id, leave);
  }

  const anonymousRows = (staffList ?? []).map((staff: any) => {
    const attendance = attendanceByStaff.get(staff.id);
    const leave = leaveByStaff.get(staff.id);
    return {
      exempt: staff.exempt === true,
      allowed_late_time: staff.allowed_late_time ?? null,
      first_in_local: attendance?.first_in_local ?? null,
      auto_out: attendance?.auto_out === true,
      on_leave: !!leave,
      leave_portion: leave?.day_portion ?? null,
    };
  });
  return {
    mode: "full",
    rows: shuffled(anonymousRows),
    fetchedAt,
    fetched,
    rowsSynced,
  };
}

// ---------- ทางเข้าหลัก ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "รองรับเฉพาะ POST" }, 405);

  const started = new Date().toISOString();
  let scope = "";
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ---- ตรวจสิทธิ์ ----
    // today: ผู้ล็อกอินทุกคนเรียกได้ แต่คืนรูปแบบตามสิทธิ์
    // people/month: คง gate เดิมไว้ ต้องเป็น admin หรือฝ่ายบุคคลที่ได้รับอนุญาต
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "ต้องล็อกอินก่อน" }, 401);

    const body = await req.json().catch(() => ({}));
    scope = body.scope ?? "";
    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await asUser.auth.getUser();
    if (userError || !userData.user) return json({ error: "เซสชันหมดอายุ กรุณาล็อกอินใหม่" }, 401);

    const { data: allowed, error: permError } = await asUser.rpc("has_department", {
      p_department: "บุคลากร",
    });
    if (permError) return json({ error: "ตรวจสิทธิ์ไม่สำเร็จ: " + permError.message }, 500);
    if (scope !== "today" && allowed !== true) {
      return json({ error: "ไม่มีสิทธิ์ซิงก์ข้อมูลฝ่ายบุคคล" }, 403);
    }

    let result: Record<string, unknown>;
    if (scope === "today") {
      result = await syncToday(service, allowed === true);
    } else if (scope === "people") {
      const token = await getJibbleToken();
      result = await syncPeople(service, token);
    } else if (scope === "month") {
      const yearMonth = String(body.yearMonth ?? "");
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return json({ error: "ต้องระบุ yearMonth เป็นรูปแบบ YYYY-MM" }, 400);
      }
      const token = await getJibbleToken();
      scope = yearMonth;
      result = await syncMonth(service, token, yearMonth, body.force === true);
    } else {
      return json({ error: 'scope ต้องเป็น "people", "month" หรือ "today"' }, 400);
    }

    // jibble_sync_log อ่านได้โดยผู้ล็อกอินทุกคน จึงห้ามเขียน anonymous rows ของโหมด full ลง message
    const logMessage = scope === "today"
      ? JSON.stringify({
        mode: result.mode ?? null,
        isHoliday: result.isHoliday === true,
        total: result.mode === "basic"
          ? Number(result.total ?? 0)
          : Array.isArray(result.rows) ? result.rows.length : 0,
        checkedIn: result.mode === "basic" ? Number(result.checkedIn ?? 0) : undefined,
        fetchedAt: result.fetchedAt ?? null,
      })
      : JSON.stringify(result);
    // today เขียน success log เฉพาะเมื่อยิง Jibble จริง เพื่อไม่ให้ cache hit ต่ออายุ throttle
    if (scope !== "today" || result.fetched === true) {
      await service.from("jibble_sync_log").insert({
        started_at: started,
        finished_at: new Date().toISOString(),
        ok: true,
        scope,
        rows_synced: scope === "today"
          ? Number(result.rowsSynced ?? 0)
          : Number(result.attendanceRows ?? result.people ?? 0),
        message: logMessage,
      });
    }

    // fetched/rowsSynced เป็น metadata ภายในสำหรับ handler ไม่ต้องเพิ่มลง API response
    const responseResult = { ...result };
    delete responseResult.fetched;
    delete responseResult.rowsSynced;
    return json({ ok: true, ...responseResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // บันทึกความล้มเหลวไว้เสมอ — serverless พังเงียบได้ ต้องเห็นว่าพลาดตอนไหนเพราะอะไร
    await service.from("jibble_sync_log").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      ok: false,
      scope,
      message,
    }).then(() => {}, () => {});
    return json({ ok: false, error: message }, 500);
  }
});
