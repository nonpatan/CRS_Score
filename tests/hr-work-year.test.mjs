import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const client = read("supabase-client.js");
const hrSettings = read("personnel/hr-settings.html");
const workSummary = read("personnel/work-summary.html");
const myWork = read("personnel/my-work.html");
const leave = read("personnel/leave.html");
const academicProjects = read("academic/projects.html");
const dailyAttendance = read("general-affairs/daily-attendance.html");

// รัน helper รอบปีทำงานจริงด้วย Supabase จำลอง: override เฉพาะปีที่ตั้ง และ fallback ปีอื่น
const helperStart = client.indexOf("export async function getWorkYears");
const helperEnd = client.indexOf("// รายการปีสำหรับจุดที่สร้าง/แก้ข้อมูล", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "ต้องมี helper รอบปีทำงานครบ");
const helperSource = client.slice(helperStart, helperEnd).replaceAll("export ", "");
let upsertPayload = null;
let deletedYear = null;
const fakeSb = {
  from(table) {
    if (table === "academic_years") {
      return {
        select() {
          return {
            order() {
              return Promise.resolve({
                data: [
                  { year:"2568", start_date:"2025-05-16" },
                  { year:"2569", start_date:"2026-05-18" }
                ],
                error:null
              });
            }
          };
        }
      };
    }
    assert.equal(table, "hr_years");
    return {
      select(columns) {
        if (columns === "year,staff_start_date") {
          return Promise.resolve({
            data:[{ year:"2569", staff_start_date:"2026-05-01" }], error:null
          });
        }
        return {
          single() { return Promise.resolve({ data:upsertPayload, error:null }); }
        };
      },
      upsert(payload, options) {
        upsertPayload = payload;
        assert.deepEqual(options, { onConflict:"year" });
        return {
          select() {
            return {
              single() { return Promise.resolve({ data:upsertPayload, error:null }); }
            };
          }
        };
      },
      delete() {
        return {
          eq(column, value) {
            assert.equal(column, "year");
            deletedYear = value;
            return Promise.resolve({ error:null });
          }
        };
      }
    };
  }
};
const { getWorkYears, saveHrYearStart, clearHrYearStart } = new Function(
  "sb", helperSource + "; return { getWorkYears, saveHrYearStart, clearHrYearStart };"
)(fakeSb);

const years = await getWorkYears();
assert.deepEqual(years, [
  {
    year:"2568", start_date:"2025-05-16", academic_start_date:"2025-05-16",
    hr_start_date:null
  },
  {
    year:"2569", start_date:"2026-05-01", academic_start_date:"2026-05-18",
    hr_start_date:"2026-05-01"
  }
]);
await assert.rejects(() => saveHrYearStart("abc", "2026-05-01"), /ตัวเลข 4 หลัก/);
await assert.rejects(() => saveHrYearStart("2569", ""), /เลือกวันเริ่มรอบปีทำงาน/);
assert.deepEqual(await saveHrYearStart(" 2569 ", " 2026-05-01 "), {
  year:"2569", staff_start_date:"2026-05-01"
});
assert.deepEqual(upsertPayload, { year:"2569", staff_start_date:"2026-05-01" });
await clearHrYearStart(" 2569 ");
assert.equal(deletedYear, "2569");

// สูตรช่วงปีเดิมต้องรับรายการรอบปีทำงานได้ และเลื่อนปลายปี 2568 เป็น 30 เม.ย. 2569
const rangeStart = client.indexOf("export function academicYearRange");
const rangeEnd = client.indexOf("// โควตาวันลา", rangeStart);
const rangeSource = client.slice(rangeStart, rangeEnd).replaceAll("export ", "");
const addDaysStr = (value, days) => {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const { academicYearRange, academicYearOf } = new Function(
  "addDaysStr", "toDateStr",
  rangeSource + "; return { academicYearRange, academicYearOf };"
)(addDaysStr, value => value.toISOString().slice(0, 10));
assert.deepEqual(academicYearRange("2568", years), {
  start:"2025-05-16", end:"2026-04-30"
});
assert.equal(academicYearOf("2026-05-01", years), "2569");

// หน้า HR ทั้ง 4 หน้าใช้รอบปีทำงาน แต่การ์ดโครงการใน my-work ยังคงใช้ปีการศึกษา
assert.match(hrSettings, /getWorkYears[^]*?saveHrYearStart[^]*?clearHrYearStart/);
assert.match(hrSettings, /data-hr-year/);
assert.match(hrSettings, /วันเริ่มรอบปี \$\{effective\[i\]\.year\} ต้องอยู่หลังวันเริ่มรอบปี/);
assert.match(hrSettings, /วันที่กรอกอยู่หลังวันเปิดเรียน โปรดตรวจอีกครั้ง/);
assert.match(hrSettings, /ล้างค่าได้เฉพาะผู้ดูแลระบบ/);
assert.match(workSummary, /getWorkYears\(\)/);
assert.doesNotMatch(workSummary, /getAcademicYears/);
assert.match(workSummary, /workYearStartingInMonth/);
assert.match(myWork, /getAcademicYears[^]*?getWorkYears/);
assert.match(myWork, /โครงการ\/กิจกรรมเป็นข้อมูลฝ่ายวิชาการ จึงต้องใช้ years ไม่ใช่ workYears[^]*?academicYearOf\(today, years\)/);
assert.match(myWork, /async function renderYear\(\)[^]*?academicYearOf\(today, workYears\)[^]*?academicYearRange\(year, workYears\)/);
assert.match(leave, /getWorkYears\(\)/);
assert.doesNotMatch(leave, /getAcademicYears/);
assert.doesNotMatch(academicProjects, /getWorkYears/);
assert.doesNotMatch(dailyAttendance, /getWorkYears/);

const versions = execFileSync("sh", ["-c",
  "grep -rho 'supabase-client\\.js?v=[0-9a-z-]*' --include='*.html' . | sort -u"
], { cwd:root, encoding:"utf8" }).trim().split("\n").filter(Boolean);
assert.deepEqual(versions, ["supabase-client.js?v=20260831-1"]);

console.log("HR work year: helpers, fallback, four HR pages, academic isolation and cache passed");
