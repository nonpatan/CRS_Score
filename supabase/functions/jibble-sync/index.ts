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

// ---------- ซิงก์เวลาเข้า-ออกของเดือนหนึ่ง ----------
async function syncMonth(db: any, token: string, yearMonth: string, force: boolean) {
  const { start: monthStart, end: monthEnd } = monthBounds(yearMonth);
  const nowBkk = nowInBangkok();
  const today = ymd(nowBkk);

  // เวลาที่ถือว่า "วันนี้จบแล้ว" — อ่านจากค่าตั้ง (Jibble auto clock-out) ไม่ hardcode
  const { data: finalSetting } = await db
    .from("hr_settings").select("value").eq("key", "day_final_time").maybeSingle();
  const finalTime = finalSetting?.value ?? "18:00";
  const [fh, fm] = finalTime.split(":").map(Number);
  const pastFinalTime =
    nowBkk.getUTCHours() > fh || (nowBkk.getUTCHours() === fh && nowBkk.getUTCMinutes() >= (fm || 0));

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

    // แผนที่ jibble_person_id → staff.id (คนที่ไม่มีในทะเบียนจะถูกข้าม)
    const { data: staffList, error: staffErr } = await db
      .from("staff").select("id,jibble_person_id").not("jibble_person_id", "is", null);
    if (staffErr) throw new Error("อ่านทะเบียนบุคลากรไม่สำเร็จ: " + staffErr.message);
    const byJibbleId = new Map<string, string>(
      (staffList ?? []).map((s: any) => [s.jibble_person_id, s.id]),
    );

    // ยุบ event ทีละครั้ง (In/Out) ให้เหลือ 1 แถวต่อคนต่อวัน
    type Agg = { firstIn?: string; lastOut?: string; autoOut: boolean };
    const agg = new Map<string, Agg>();
    for (const e of entries) {
      if (e.status !== "Active") continue;
      const staffId = byJibbleId.get(e.personId);
      if (!staffId || !e.belongsToDate) continue;
      const key = `${staffId}|${String(e.belongsToDate).slice(0, 10)}`;
      const cur = agg.get(key) ?? { autoOut: false };
      if (e.type === "In") {
        if (!cur.firstIn || e.localTime < cur.firstIn) cur.firstIn = e.localTime;
      } else if (e.type === "Out") {
        if (!cur.lastOut || e.localTime > cur.lastOut) {
          cur.lastOut = e.localTime;
          // AutoOut = ระบบเด้งออกให้ = "ลืมกด logout" ไม่ใช่ "ทำงานถึงเวลานั้น"
          cur.autoOut = e.clientType === "AutoOut";
        }
      }
      agg.set(key, cur);
    }

    const rows = [...agg.entries()].map(([key, v]) => {
      const [staffId, workDate] = key.split("|");
      return {
        staff_id: staffId,
        work_date: workDate,
        first_in: v.firstIn ?? null,
        last_out: v.lastOut ?? null,
        // ตัดเวลาจากสตริง localTime ตรง ๆ (มี offset +07:00 ติดมาแล้ว) ปลอดภัยกว่าคำนวณ timezone เอง
        first_in_local: v.firstIn ? v.firstIn.slice(11, 19) : null,
        auto_out: v.autoOut,
        source: "jibble",
        synced_at: new Date().toISOString(),
      };
    });

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
    // ---- ตรวจสิทธิ์: ต้องล็อกอิน และต้องเป็น admin หรือฝ่ายบุคคลที่ได้รับอนุญาต ----
    // ใช้ token ของผู้ใช้เรียก has_department() เพื่อให้ RLS/auth.uid() ทำงานตามบริบทผู้ใช้จริง
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "ต้องล็อกอินก่อน" }, 401);

    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: allowed, error: permError } = await asUser.rpc("has_department", {
      p_department: "บุคลากร",
    });
    if (permError) return json({ error: "ตรวจสิทธิ์ไม่สำเร็จ: " + permError.message }, 500);
    if (allowed !== true) return json({ error: "ไม่มีสิทธิ์ซิงก์ข้อมูลฝ่ายบุคคล" }, 403);

    const body = await req.json().catch(() => ({}));
    scope = body.scope ?? "";
    const token = await getJibbleToken();

    let result: Record<string, unknown>;
    if (scope === "people") {
      result = await syncPeople(service, token);
    } else if (scope === "month") {
      const yearMonth = String(body.yearMonth ?? "");
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return json({ error: "ต้องระบุ yearMonth เป็นรูปแบบ YYYY-MM" }, 400);
      }
      scope = yearMonth;
      result = await syncMonth(service, token, yearMonth, body.force === true);
    } else {
      return json({ error: 'scope ต้องเป็น "people" หรือ "month"' }, 400);
    }

    await service.from("jibble_sync_log").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      ok: true,
      scope,
      rows_synced: Number(result.attendanceRows ?? result.people ?? 0),
      message: JSON.stringify(result),
    });

    return json({ ok: true, ...result });
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
