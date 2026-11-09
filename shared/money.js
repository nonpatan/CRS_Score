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
