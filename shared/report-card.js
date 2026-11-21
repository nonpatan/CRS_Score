// สูตรกลาง ปพ.6 ของ CRS MIS / แอปผู้ปกครอง — ย้ายจาก academic/summary.html โดยไม่เปลี่ยนผล
// โมดูลบริสุทธิ์: ไม่โหลดฐานข้อมูล เครือข่าย หรือ DOM

// คุณลักษณะรายข้อ: ประถมปลายปีเฉลี่ยสองครั้งปัดขึ้น มีครั้งเดียวใช้ครั้งนั้น
export function traitLevel(rows, traitId, { primary = false, half = "", term = "1" } = {}) {
  const terms = primary && half === "ปลายปี" ? ["1", "2"] : [primary ? "1" : String(term)];
  const levels = terms.map(t => rows.find(r => r.trait_id === traitId && String(r.term) === t)?.level)
    .filter(v => Number.isInteger(v) && v >= 0 && v <= 3);
  return levels.length ? Math.ceil(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
}

// รวมผลของกิจกรรมในแต่ละประเภทตามลำดับหลักสูตร
export function activityRows(categories, assessments, memberIds, resultById, requiredTerms, externalRows = []) {
  const mine = new Map();
  for (const row of assessments) {
    if (!memberIds.has(row.id)) continue;
    if (!mine.has(row.activity_category)) mine.set(row.activity_category, []);
    mine.get(row.activity_category).push(row);
  }
  return categories.slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .filter(category => category.active || mine.has(category.code) || externalRows.some(r => r.category_code === category.code))
    .map(category => {
      const rows = mine.get(category.code) || [];
      const statuses = requiredTerms.map(term => {
        const external = externalRows.find(r => r.category_code === category.code && r.term === term);
        if (external) return external.passed ? "ผ่าน" : "ไม่ผ่าน";
        const current = rows.filter(r => r.term === null || r.term === term);
        if (current.some(r => resultById.get(r.id) === false)) return "ไม่ผ่าน";
        return (category.active && !current.length) || current.some(r => !resultById.has(r.id)) ? "รอผล" : "ผ่าน";
      });
      return { name:category.code, result:statuses.includes("ไม่ผ่าน") ? "ไม่ผ่าน" : statuses.includes("รอผล") ? "รอผล" : "ผ่าน" };
    });
}

// ชุดภาคที่ใช้โหลดผลของใบ ปพ.6 ตามช่วงที่เลือก
export function reportTerms({ primary, half, term }) {
  return primary && half === "ปลายปี" ? ["1", "2"] : [primary ? "1" : term];
}
