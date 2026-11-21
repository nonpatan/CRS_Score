// แอปผู้ปกครองโหลดไฟล์นี้จาก Pages — ห้ามเปลี่ยนชื่อ/ลายเซ็นฟังก์ชันโดยไม่แก้แอป

// ยอดคงเหลือ = ยอดยกมา + ฝาก − ถอน − หักค่ารถ − หักค่าใช้จ่าย
// รับ txns ทั้งก้อนของนักเรียนคนหนึ่ง (หรือทั้งห้องแล้วกรองเอง)
export function computeSavingsBalance(txns) {
  return (Array.isArray(txns) ? txns : []).reduce((balance, txn) => {
    const amount = Number(txn?.amount);
    if (!Number.isFinite(amount)) return balance;
    if (txn.kind === "ยอดยกมา" || txn.kind === "ฝาก") return balance + amount;
    if (txn.kind === "ถอน" || txn.kind === "หักค่ารถ" || txn.kind === "หักค่าใช้จ่าย") return balance - amount;
    return balance;
  }, 0);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}
// ไล่วันจาก from ถึง to (รวมปลายทั้งสองข้าง)
function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}
// 1=จันทร์ ... 7=อาทิตย์ (ตรงกับ work_schedule.weekday)
function isoWeekday(dateStr) {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay();  // 0=อาทิตย์
  return wd === 0 ? 7 : wd;
}

// ---------- ค่ารถรับส่ง ----------
// ต้องแก้พร้อมชุดสถานะใน transport_payments_guard() ที่ schema.sql หากกติกาเปลี่ยน
export const TRANSPORT_CHARGE_STATUSES = ["มา", "มาสาย"];

function transportMonthStart(dateStr) {
  return String(dateStr || "").slice(0, 7) + "-01";
}

function nextTransportMonth(ym) {
  const date = new Date(ym + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + 1);
  return toDateStr(date).slice(0, 7) + "-01";
}

function transportRateKey(year, ym, zoneId, tripMode) {
  return [year, ym, zoneId, tripMode].join("\u0000");
}

// คำนวณยอดจากช่วงใช้รถ + เช็คชื่อ + override + ยอดเดือนที่ประกาศ โดยไม่แตะ DOM/ฐานข้อมูล
// monthRates ต้องมี year เสมอ เพราะเดือน พ.ค. เดียวกันอยู่ได้ใน 2 ปีการศึกษา
export function computeTransportCharges({
  periods = [], attendance = [], overrides = [], monthRates = [], openingDebt = 0, from, to
} = {}) {
  if (!from || !to || from > to) {
    return { days:[], months:[], openingDebt:0, total:0, missingAttendanceDates:[], unannouncedMonths:[] };
  }

  const opening = Number(openingDebt) > 0 ? Number(openingDebt) : 0;

  const attendanceByDate = new Map(
    (attendance || []).map(row => [row.attend_date || row.date, row.status])
  );
  const overrideByDate = new Map(
    (overrides || []).map(row => [row.charge_date || row.date, row])
  );
  const rateByKey = new Map((monthRates || []).map(row => [
    transportRateKey(row.year, row.ym, row.zone_id, row.trip_mode), row
  ]));
  const missing = new Set();
  const unannounced = new Set();
  const days = [];
  const months = [];

  for (const period of (periods || [])) {
    const start = [period.start_date, from].sort().at(-1);
    const periodEnd = period.end_date || to;
    const end = [periodEnd, to].sort()[0];
    if (!start || start > end) continue;

    if (period.billing_mode === "รายวัน") {
      for (const date of eachDate(start, end)) {
        const override = overrideByDate.get(date);
        const status = attendanceByDate.get(date) ?? null;
        if (override) {
          days.push({ date, amount:Number(override.amount) || 0, source:"override", status });
          continue;
        }
        if (!attendanceByDate.has(date) && isoWeekday(date) <= 5) missing.add(date);
        days.push({
          date,
          amount:TRANSPORT_CHARGE_STATUSES.includes(status) ? (Number(period.rate_amount) || 0) : 0,
          source:"auto",
          status
        });
      }
      continue;
    }

    if (period.billing_mode !== "รายเดือน") continue;
    for (let ym = transportMonthStart(start); ym <= transportMonthStart(end); ym = nextTransportMonth(ym)) {
      const anchor = period.start_date > ym ? period.start_date : ym;
      const override = overrideByDate.get(anchor);
      if (override) {
        months.push({ ym, amount:Number(override.amount) || 0, announced:true, source:"override" });
        continue;
      }
      const rate = rateByKey.get(transportRateKey(period.year, ym, period.zone_id, period.trip_mode));
      if (!rate) {
        months.push({ ym, amount:0, announced:false, source:"month_rate" });
        unannounced.add(ym);
        continue;
      }
      months.push({ ym, amount:Number(rate.amount) || 0, announced:true, source:"month_rate" });
    }
  }

  const total = [...days, ...months].reduce((sum, row) => sum + (Number(row.amount) || 0), 0) + opening;
  return {
    days,
    months,
    openingDebt:opening,
    total,
    missingAttendanceDates:[...missing].sort(),
    unannouncedMonths:[...unannounced].sort()
  };
}

export function computeTransportOutstanding(charges, payments) {
  const paid = (Array.isArray(payments) ? payments : []).reduce((sum, payment) => {
    const amount = Number(payment?.amount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  return (Number(charges?.total) || 0) - paid;
}
