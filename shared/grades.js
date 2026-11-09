// สูตรกลาง CRS MIS / แอปผู้ปกครอง — ย้ายจาก supabase-client.js โดยไม่เปลี่ยนผล
// โมดูลบริสุทธิ์: ไม่โหลดฐานข้อมูล เครือข่าย หรือ DOM

export const MS_RETAKE_RATIO = 0.40;          // ขาดดิบเกินนี้ = เรียนซ้ำรายวิชา ชดเชยช่วยไม่ได้
export const MS_MAKEUP_RATIO = 0.20;          // ขาดสุทธิเกินนี้ = ต้องเรียนเพิ่มให้ครบเวลา
export const MS_MAKEUP_GRADE_CAP = 1;
// ใช้เวลาปิดสอบครั้งแรกเท่านั้น เพื่อไม่ให้การยกเลิกแล้วปิดซ้ำเลื่อนเส้นแบ่ง
export function msMakeupCutoff(subj) {
  const value = subj?.exam_first_closed_at ? Date.parse(subj.exam_first_closed_at) : NaN;
  return Number.isFinite(value) ? value : null;
}
export function isLateMakeup(row, subj) {
  const cutoff = msMakeupCutoff(subj);
  const created = Date.parse(row?.created_at);
  return cutoff !== null && Number.isFinite(created) && created > cutoff;
}
export const MS_WARN_PERCENT_SECONDARY = 10;  // มัธยม: ขาดสุทธิถึงเท่านี้ = ขึ้นหน้าเฝ้าระวัง
export const MS_WARN_PERCENT_PRIMARY = 5;     // ประถม: เตือนเร็วกว่าเพราะคาบทั้งปีมากกว่า
export const PRIMARY_SCHOOL_DAYS = 200;
export const PRIMARY_MAX_MISSED_DAYS = PRIMARY_SCHOOL_DAYS * MS_MAKEUP_RATIO;

// เวลาเรียนประถมเป็นยอดรายคนทั้งปีจากเช็คชื่อรายวัน ไม่ใช้คาบรายวิชาเป็นผลตัดสิน
export function computePrimaryDailyAttendance(studentId, dailyRows = []) {
  let absentCount = 0, sickLeaveCount = 0, personalLeaveCount = 0, recordedDays = 0;
  for (const row of dailyRows || []) {
    if (row.student_id !== studentId) continue;
    recordedDays++;
    if (row.status === "ขาด") absentCount++;
    else if (row.status === "ลาป่วย") sickLeaveCount++;
    else if (row.status === "ลากิจ") personalLeaveCount++;
  }
  const leaveCount = sickLeaveCount + personalLeaveCount;
  const missedDays = absentCount + leaveCount * 0.5;
  return {
    missedDays, absentCount, leaveCount, sickLeaveCount, personalLeaveCount, recordedDays,
    percent: Math.max(0, (PRIMARY_SCHOOL_DAYS - missedDays) / PRIMARY_SCHOOL_DAYS * 100),
    below80: missedDays > PRIMARY_MAX_MISSED_DAYS
  };
}

// เกณฑ์แปลงเปอร์เซ็นต์คะแนนเป็นเกรด (มาตรฐาน 8 ระดับ ตามที่ยืนยันแล้วใน CLAUDE.md)
export function percentToGrade(p) {
  if (p >= 80) return 4;
  if (p >= 75) return 3.5;
  if (p >= 70) return 3;
  if (p >= 65) return 2.5;
  if (p >= 60) return 2;
  if (p >= 55) return 1.5;
  if (p >= 50) return 1;
  return 0;
}

// นับจำนวนคาบที่ขาดสะสมจริงของนักเรียน 1 คน (ถ่วงน้ำหนักแบบเดียวกับเช็ค มส.: ขาด = เต็ม 1,
// ลาป่วย/ลากิจ = ครึ่งเดียว, มา/มาสาย = ไม่นับ) จาก session ที่เช็คชื่อไปแล้วเท่านั้น — ไม่ใช่
// % ของคาบเต็มตามรอบวิชา (ประถมทั้งปี / มัธยมทั้งภาคเรียน) เพราะถ้าเทียบเป็น % ตั้งแต่ช่วงต้น
// (ที่เช็คชื่อไปแค่ไม่กี่ครั้ง) ตัวเลขจะเพี้ยนสูงเกินจริง ทำให้ติด มส. ง่ายเกินไปทั้งที่ยังเหลือเวลาแก้ตัวอีกเยอะ
// (บั๊กที่ผู้ใช้เจอจริงตอนเปิดเทอมใหม่ — ยืนยันแก้แล้ว 2026-07)
export function computeMissedPeriods(studentId, sessionsArr) {
  let missed = 0;
  for (const sess of sessionsArr) {
    const rec = (sess.attendance_records || []).find(r => r.student_id === studentId);
    if (!rec) continue; // ยังไม่มีบันทึกของคนนี้ในครั้งนี้ ข้ามไป ไม่นับ
    // ครอบ Number() เสมอ — periods_covered เป็น numeric(4,1) ตั้งแต่ 2026-08-04 (รองรับครึ่งคาบ)
    // ถ้า client ได้ค่ามาเป็นสตริงเมื่อไหร่ การบวกดิบจะกลายเป็นต่อสตริง ("2" + "2.5" = "22.5")
    // แล้วคาบขาดจะพุ่งมั่วจนกระทบ มส. ของเด็กจริง
    const p = Number(sess.periods_covered) || 0;
    if (rec.status === "ขาด") missed += p;
    else if (rec.status === "ลาป่วย" || rec.status === "ลากิจ") missed += p * 0.5;
    // 'มา'/'มาสาย' ไม่นับ (ไม่ขาด)
  }
  return missed;
}

// คำนวณสถานะเฝ้าระวัง มส. จากวิชาพื้นฐาน 1 ตัว หรือหลายตัวที่ประกอบเป็นวิชาบูรณาการ
// ใช้ร่วมกันทั้ง dashboard.html, warning.html และ summary.html เพื่อให้เกณฑ์ไม่แยกกันหลายหน้า
// subjectDataList ใช้รูปเดียวกับผลจาก loadSubjectData(): [{ subject, sessions, makeupHours }, ...]
// เกณฑ์เตือนรับจากผู้เรียกเพราะประถม/มัธยมเตือนคนละจุด แต่เกณฑ์ มส. ใช้ค่ากลางชุดเดียวกันเสมอ
export function computeAttendanceRisk(studentId, subjectDataList, options = {}) {
  const warnPercent = Number(options.warnPercent ?? MS_WARN_PERCENT_SECONDARY);
  const dataList = Array.isArray(subjectDataList) ? subjectDataList : [];
  let totalBase = 0;
  let rawMissed = 0;
  let makeupTotal = 0;

  for (const item of dataList) {
    if (!item || !item.subject) continue;
    totalBase += Number(item.subject.total_periods) || 0;
    rawMissed += computeMissedPeriods(studentId, item.sessions || []);
    makeupTotal += (item.makeupHours || [])
      .filter(row => row.student_id === studentId)
      .reduce((sum, row) => sum + (Number(row.periods) || 0), 0);
  }

  // หน้าเฝ้าระวังประถมยังดูรายวิชา แต่ใช้คาบขาดดิบเป็นข้อมูลประกอบ ไม่หักชั่วโมงชดเชยเดิม
  if (options.primary) {
    const has = totalBase > 0;
    const percent = has ? rawMissed / totalBase * 100 : 0;
    const critical = has && rawMissed > totalBase * MS_MAKEUP_RATIO;
    return {
      totalBase, rawMissed, makeupTotal: 0, netMissed: rawMissed,
      percent, rawPercent: percent, retake: false, critical,
      risky: has && percent >= warnPercent,
      level: !has ? null : critical ? "critical" : percent >= warnPercent ? "warn" : null
    };
  }

  const netMissed = Math.max(0, rawMissed - makeupTotal);
  const has = totalBase > 0;
  const percent = has ? (netMissed / totalBase) * 100 : 0;
  const rawPercent = has ? (rawMissed / totalBase) * 100 : 0;
  // เรียนซ้ำต้องดูยอดขาดดิบให้ตรงกับ computeSubjectResult — ชดเชยไม่ลดระดับนี้
  const retake = has && rawMissed > totalBase * MS_RETAKE_RATIO;
  const critical = has && (retake || netMissed > totalBase * MS_MAKEUP_RATIO);
  return {
    totalBase,
    rawMissed,
    makeupTotal,
    netMissed,
    percent,
    rawPercent,
    retake,
    critical,
    risky: has && (critical || percent >= warnPercent),
    level: !has ? null : retake ? "retake" : critical ? "critical"
      : (percent >= warnPercent ? "warn" : null)
  };
}

export function gradeWeightFor(subj, gradeWeights) {
  const weight = (gradeWeights || []).find(row => row.year === subj.year && row.level === subj.level);
  if (!weight) throw new Error(
    "ยังไม่ได้ตั้งอัตราส่วนคะแนนของปีการศึกษา " + (subj.year || "(ไม่ระบุ)") +
    " ระดับ" + (subj.level || "(ไม่ระบุ)") + " — ให้ admin หรือฝ่ายวิชาการตั้งที่หน้า “จัดการโครงสร้าง” ก่อน"
  );
  return weight;
}

export const PRIMARY_HALVES = ["กลางปี", "ปลายปี"];

// ครั้งที่เป็นตัวแบ่งช่วง ส่วนคะแนนของข้อ/หน่วยใช้ฐานทั้งปีเพื่อไม่ให้ข้อที่แบ่งสองช่วงถูกนับซ้ำ
export function computePrimaryHalves(studentId, subj, unitsTree, examScores, collectWeight, examWeight) {
  const halves = Object.fromEntries(PRIMARY_HALVES.map(half => [half, {
    hasStructure:false, collectPart:0, examPart:0, score:0, complete:false,
    partialPercent:null, examScored:false, examOverCap:false,
    collectScoredCount:0, collectExpectedCount:0
  }]));
  const subjectUnits = [], competencyUnits = [], notScoredUnits = [];
  let notScoredIndicatorCount = 0;
  for (const unit of unitsTree) {
    if (unit.counts_score === false) {
      if (unit.kind === "วิชา") notScoredUnits.push(unit.name);
      continue;
    }
    const indicators = (unit.indicators || []).filter(ind => ind.counts_score !== false);
    const notScoredCount = (unit.indicators || []).length - indicators.length;
    if (unit.kind === "วิชา") notScoredIndicatorCount += notScoredCount;
    const active = indicators.map(ind => {
      const collections = ind.collections || [];
      return { ind, collections, cap:collections.reduce((sum, coll) => sum + Number(coll.max_score || 0), 0) };
    }).filter(row => row.collections.length);
    const indMaxAll = active.reduce((sum, row) => sum + Number(row.ind.max_score), 0);
    const unitMax = Number(unit.max_score);
    const parts = {};
    for (const half of PRIMARY_HALVES) {
      let earned = 0, available = 0, partialEarned = 0, partialAvailable = 0;
      let expected = 0, scored = 0;
      for (const { ind, collections, cap } of active) {
        const chosen = collections.filter(coll => coll.half === half);
        if (!chosen.length || cap <= 0) continue;
        let raw = 0, capH = 0, rawPartial = 0, capPartial = 0;
        for (const coll of chosen) {
          const max = Number(coll.max_score) || 0;
          capH += max; expected++;
          const score = (coll.scores || []).find(row => row.student_id === studentId);
          if (score) { raw += Number(score.raw_score); rawPartial += Number(score.raw_score); capPartial += max; scored++; }
        }
        available += Number(ind.max_score) * capH / cap;
        earned += Number(ind.max_score) * raw / cap;
        if (capPartial > 0) {
          partialEarned += Number(ind.max_score) * rawPartial / capPartial;
          partialAvailable += Number(ind.max_score);
        }
      }
      const max = indMaxAll > 0 ? unitMax * available / indMaxAll : 0;
      const scaled = indMaxAll > 0 ? unitMax * earned / indMaxAll : 0;
      const partialScaled = partialAvailable > 0 ? unitMax * partialEarned / partialAvailable : 0;
      parts[half] = { scaled, max, partialScaled, hasPartial:partialAvailable > 0 };
      if (unit.kind === "วิชา" && max > 0) {
        const h = halves[half];
        h._raw = (h._raw || 0) + scaled;
        h._cap = (h._cap || 0) + max;
        if (partialAvailable > 0) {
          h._partialRaw = (h._partialRaw || 0) + partialScaled;
          h._partialCap = (h._partialCap || 0) + unitMax;
        }
        h.collectExpectedCount += expected;
        h.collectScoredCount += scored;
      }
    }
    const totalScaled = parts["กลางปี"].scaled + parts["ปลายปี"].scaled;
    if (unit.kind === "วิชา") subjectUnits.push({ name:unit.name, scaled:totalScaled, max:unit.max_score, notScoredCount, halves:parts });
    else {
      const availableHalves = PRIMARY_HALVES.filter(half => parts[half].max > 0);
      const scaled = availableHalves.length ? availableHalves.reduce((sum, half) => sum +
        (parts[half].scaled / parts[half].max) * unitMax, 0) / availableHalves.length : 0;
      competencyUnits.push({ name:unit.name, scaled, max:unit.max_score, notScoredCount,
        halves:Object.fromEntries(PRIMARY_HALVES.map(half => [half, {
          scaled:parts[half].max > 0 ? parts[half].scaled / parts[half].max * unitMax : null,
          max:unit.max_score
        }])) });
    }
  }
  for (const half of PRIMARY_HALVES) {
    const h = halves[half];
    h.hasStructure = h._cap > 0 && h.collectExpectedCount > 0;
    h.collectPart = h.hasStructure ? h._raw / h._cap * collectWeight : 0;
    const examRow = (examScores || []).find(row => row.student_id === studentId && row.half === half);
    h.examPart = examRow ? Number(examRow.raw_score) : 0;
    h.examOverCap = Boolean(examRow) && h.examPart > examWeight + 0.000001;
    h.examScored = Boolean(examRow) && !h.examOverCap;
    h.score = h.collectPart + h.examPart;
    h.complete = h.hasStructure && h.collectExpectedCount === h.collectScoredCount && h.examScored;
    const partialCollect = h._partialCap > 0 ? h._partialRaw / h._partialCap * collectWeight : null;
    const partialEarned = (partialCollect ?? 0) + (h.examScored ? h.examPart : 0);
    const partialCap = (partialCollect === null ? 0 : collectWeight) + (h.examScored ? examWeight : 0);
    h.partialPercent = partialCap > 0 ? partialEarned / partialCap * 100 : null;
    delete h._raw; delete h._cap; delete h._partialRaw; delete h._partialCap;
  }
  const mid = halves["กลางปี"], end = halves["ปลายปี"];
  const collectPart = (mid.collectPart + end.collectPart) / 2;
  const examPart = (mid.examPart + end.examPart) / 2;
  const scoring = {
    expectedCount:mid.collectExpectedCount + end.collectExpectedCount + 2,
    scoredCount:mid.collectScoredCount + end.collectScoredCount + Number(mid.examScored) + Number(end.examScored),
    collectExpectedCount:mid.collectExpectedCount + end.collectExpectedCount,
    collectScoredCount:mid.collectScoredCount + end.collectScoredCount,
    notScoredIndicatorCount, notScoredUnits, emptyIndicatorCount:0, emptyUnitCount:0,
    hasCollectStructure:mid.hasStructure && end.hasStructure,
    examScored:mid.examScored && end.examScored,
    examOverCap:mid.examOverCap || end.examOverCap,
    complete:mid.complete && end.complete,
    partialPercent:[mid.partialPercent,end.partialPercent].filter(value => value !== null).length
      ? [mid.partialPercent,end.partialPercent].filter(value => value !== null).reduce((sum,value) => sum + value, 0) /
        [mid.partialPercent,end.partialPercent].filter(value => value !== null).length : null
  };
  const percentScore = (mid.score + end.score) / 2;
  return { halves, subjectUnits, competencyUnits, subjectScaled:(mid.collectPart + end.collectPart) / 2 *
    (collectWeight > 0 ? Number(subj.max_score) / collectWeight : 0),
    collectPercent:collectWeight > 0 ? collectPart / collectWeight * 100 : 0,
    collectPart, examPart, scoring,
    result:{ type:"grade", grade:percentToGrade(percentScore), percentScore, makeupTotal:0 } };
}

export function computeSubjectResult(studentId, subj, unitsTree, remarksArr, sessionsArr, makeupArr, options = {}) {
  const { skipMs = false, examScores = [], gradeWeight = null } = options || {};
  if (!gradeWeight || gradeWeight.level !== subj.level || gradeWeight.year !== subj.year) {
    throw new Error(
      "ยังไม่ได้ตั้งอัตราส่วนคะแนนของปีการศึกษา " + (subj.year || "(ไม่ระบุ)") +
      " ระดับ" + (subj.level || "(ไม่ระบุ)") + " — ให้ admin หรือฝ่ายวิชาการตั้งที่หน้า “จัดการโครงสร้าง” ก่อน"
    );
  }
  const collectWeight = Number(gradeWeight.collect_weight);
  const examWeight = Number(gradeWeight.exam_weight);
  if (!Number.isFinite(collectWeight) || !Number.isFinite(examWeight) || Math.abs(collectWeight + examWeight - 100) > 0.000001) {
    throw new Error("อัตราส่วนคะแนนของระดับ “" + subj.level + "” ไม่ถูกต้อง");
  }
  const primaryCollections = unitsTree.flatMap(unit => unit.indicators || []).flatMap(ind => ind.collections || []);
  if (subj.level === "ประถม" && (primaryCollections.length === 0 ||
    primaryCollections.some(coll => PRIMARY_HALVES.includes(coll.half)))) {
    return computePrimaryHalves(studentId, subj, unitsTree, examScores, collectWeight, examWeight);
  }
  const examRow = (examScores || []).find(row => row.student_id === studentId) || null;
  const examPart = examRow ? Number(examRow.raw_score) : 0;
  const examOverCap = Boolean(examRow) && examPart > examWeight + 0.000001;
  const examUsable = Boolean(examRow) && !examOverCap;
  const subjectUnits = [];
  const competencyUnits = [];
  let subjectRaw = 0, subjectCap = 0;
  // partial คิดจากเฉพาะครั้งที่กรอกแล้ว ใช้แค่แสดงระหว่างเทอม ไม่ใช่เกรดทางการ
  let subjectPartialRaw = 0, subjectPartialCap = 0;
  let expectedCount = 0, scoredCount = 0;
  let notScoredIndicatorCount = 0;
  let emptyIndicatorCount = 0, emptyUnitCount = 0;
  const notScoredUnits = [];

  for (const unit of unitsTree) {
    if (unit.counts_score === false) {
      if (unit.kind === "วิชา") notScoredUnits.push(unit.name);
      continue;
    }
    const unitIndicators = unit.indicators || [];
    const notScoredCount = unitIndicators.filter(ind => ind.counts_score === false).length;
    if (unit.kind === "วิชา" && unitIndicators.length === 0) emptyUnitCount++;
    let unitRaw = 0, unitCap = 0;
    let unitPartialRaw = 0, unitPartialCap = 0;
    let unitExpected = 0, unitScored = 0;
    for (const ind of unitIndicators) {
      if (ind.counts_score === false) continue;
      if (unit.kind === "วิชา" && !(ind.collections || []).length) emptyIndicatorCount++;
      // หน่วยวิชามัธยมยังนับข้อว่างเป็นศูนย์; ข้ามเฉพาะสมรรถนะหลักที่ยังไม่มีครั้งที่
      if (unit.kind === "สมรรถนะหลัก" && !(ind.collections || []).length) continue;
      let indRaw = 0, indCap = 0, indPartialCap = 0;
      for (const coll of (ind.collections || [])) {
        const collectionMax = Number(coll.max_score) || 0;
        indCap += collectionMax;
        unitExpected++;
        const row = (coll.scores || []).find(s => s.student_id === studentId);
        if (row) {
          indRaw += Number(row.raw_score);
          indPartialCap += collectionMax;
          unitScored++;
        }
      }
      const indScaled = indCap > 0 ? (indRaw / indCap) * ind.max_score : 0;
      unitRaw += indScaled;
      unitCap += ind.max_score;
      if (indPartialCap > 0) {
        unitPartialRaw += (indRaw / indPartialCap) * ind.max_score;
        unitPartialCap += ind.max_score;
      }
    }
    const unitScaled = unitCap > 0 ? (unitRaw / unitCap) * unit.max_score
      : unit.kind === "สมรรถนะหลัก" ? null : 0;
    const unitPartialScaled = unitPartialCap > 0 ? (unitPartialRaw / unitPartialCap) * unit.max_score : 0;
    if (unit.kind === "วิชา") {
      subjectUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score, notScoredCount });
      notScoredIndicatorCount += notScoredCount;
      if (unitCap > 0) {
        subjectRaw += unitScaled;
        subjectCap += unit.max_score;
        if (unitPartialCap > 0) {
          subjectPartialRaw += unitPartialScaled;
          subjectPartialCap += unit.max_score;
        }
      }
      expectedCount += unitExpected;
      scoredCount += unitScored;
    } else {
      competencyUnits.push({ name: unit.name, scaled: unitScaled, max: unit.max_score, notScoredCount });
    }
  }

  const subjectScaled = subjectCap > 0 ? (subjectRaw / subjectCap) * subj.max_score : 0;
  const collectPercent = subj.max_score > 0 ? (subjectScaled / subj.max_score) * 100 : 0;
  const collectPart = collectPercent * collectWeight / 100;
  const collectExpectedCount = expectedCount;
  const collectScoredCount = scoredCount;
  const hasCollectStructure = subjectCap > 0 && collectExpectedCount > 0;
  expectedCount += 1;
  if (examUsable) scoredCount += 1;
  const collectPartialPercent = subjectPartialCap > 0
    ? (subjectPartialRaw / subjectPartialCap) * 100
    : null;
  let partialEarned = 0, partialCap = 0;
  if (collectPartialPercent !== null) {
    partialEarned += collectPartialPercent * collectWeight / 100;
    partialCap += collectWeight;
  }
  if (examUsable) {
    partialEarned += examPart;
    partialCap += examWeight;
  }
  const scoring = {
    expectedCount,
    scoredCount,
    collectExpectedCount,
    collectScoredCount,
    notScoredIndicatorCount,
    notScoredUnits,
    emptyIndicatorCount,
    emptyUnitCount,
    hasCollectStructure,
    examScored: examUsable,
    examOverCap,
    complete: hasCollectStructure && scoredCount === expectedCount && emptyIndicatorCount === 0 && emptyUnitCount === 0,
    partialPercent: partialCap > 0 ? (partialEarned / partialCap) * 100 : null
  };

  // ชั่วโมงชดเชย (ทำงาน/เรียนเสริม ฯลฯ) ของนักเรียนคนนี้ในวิชานี้ — บวกเข้า attended ตรงๆ
  // ไม่ใช่การข้ามเช็ค มส. แต่เป็นการเติมตัวเลขให้ถึงเกณฑ์ (ยืนยันกับผู้ใช้แล้ว)
  const myMakeup = (makeupArr || []).filter(m => m.student_id === studentId);
  const makeupTotal = myMakeup.reduce((sum, m) => sum + Number(m.periods), 0);
  const makeupBeforeClose = myMakeup.filter(m => !isLateMakeup(m, subj))
    .reduce((sum, m) => sum + Number(m.periods), 0);
  let msCapped = false;

  // 1) เช็ค มส. ก่อน ร. เฉพาะมัธยม — ต้องมีทั้ง total_periods
  //    กับข้อมูลเช็คชื่ออย่างน้อย 1 ครั้ง ไม่งั้นข้ามไปคิดเกรดตามปกติ (ยัง เช็ค มส. ไม่ได้)
  // มส. มี 2 ระดับ ตาม "จำนวนคาบขาดสะสมจริง" เทียบกับเพดานคาบที่ขาดได้สูงสุด (ไม่ใช่ % ของคาบ
  // เต็มตามรอบวิชาแบบเดิม — เปลี่ยนเพราะเทียบ % ตั้งแต่ช่วงต้นทำให้ติด มส. ง่ายเกินจริง ยืนยันแล้ว
  // 2026-07): เพดานคำนวณจาก total_periods ของรอบวิชาเสมอ (ประถมทั้งปี / มัธยมทั้งภาคเรียน)
  // ไม่ใช่คาบที่เช็คไปแล้ว จึงไม่ติด มส. ง่ายๆ ตอนที่ยังเช็คชื่อเพียงไม่กี่ครั้ง
  //   ขาดสะสม > 20% ของคาบเต็มตามรอบวิชา และ <= 40%  → "เรียนเพิ่มเติมให้ครบเวลา" ใช้ชั่วโมงชดเชย
  //     ลบยอดขาดสุทธิให้ไม่เกิน 20% ได้
  //   ขาดสะสม > 40% ของคาบเต็มตามรอบวิชา               → "เรียนซ้ำรายวิชา" ชั่วโมงชดเชยช่วยไม่ได้เลย
  if (subj.level !== "ประถม" && !skipMs && subj.total_periods && sessionsArr.length > 0) {
    const rawMissed = computeMissedPeriods(studentId, sessionsArr);
    const maxMissedRetake = subj.total_periods * MS_RETAKE_RATIO;
    const maxMissedMakeup = subj.total_periods * MS_MAKEUP_RATIO;

    if (rawMissed > maxMissedRetake) {
      // ขาดเกินเพดานเรียนซ้ำแล้ว — ชดเชยช่วยไม่ได้แล้ว ต้องเรียนซ้ำรายวิชา (ไม่หัก makeupTotal เข้าไปเลย)
      return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "มส.", subtype: "retake", missedPeriods: rawMissed, maxMissed: maxMissedRetake } };
    }
    if (rawMissed > maxMissedMakeup) {
      const netMissed = Math.max(0, rawMissed - makeupTotal);
      if (netMissed > maxMissedMakeup) {
        return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "มส.", subtype: "makeup", missedPeriods: rawMissed, netMissed, maxMissed: maxMissedMakeup, makeupTotal } };
      }
      msCapped = rawMissed - makeupBeforeClose > maxMissedMakeup;
      // ชดเชยจนขาดสุทธิไม่เกินเพดานแล้ว — หลุด มส. ไปคิดเกรดต่อ (เก็บ makeupTotal ไว้โชว์ในผลเกรด)
    }
  }

  // 2) เช็ค ร. ที่ครูระบุเอง ก่อน ร. จากคะแนนสอบที่ขาด
  const remark = subj.level !== "ประถม" && remarksArr.find(r => r.student_id === studentId && r.code === "ร.");
  if (remark) {
    return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "ร.", reason: remark.reason } };
  }

  // ร. ที่ระบบคำนวณจากการไม่มีคะแนนสอบ — เกิดหลังครูปิดคะแนนสอบเท่านั้น
  // ไม่เขียนลง remarks เพื่อให้หายเองเมื่อเปิดคะแนนหรือกรอกคะแนนย้อนหลัง
  if (subj.level !== "ประถม" && subj.exam_closed_at && !examRow) {
    return {
      subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring,
      result: { type: "ร.", reason: "ไม่มีคะแนนสอบปลายภาค/ปลายปี" }
    };
  }

  // 3) แปลงเป็นเกรด
  const percentScore = collectPart + examPart;
  const rawGrade = percentToGrade(percentScore);
  return { subjectUnits, competencyUnits, subjectScaled, collectPercent, collectPart, examPart, scoring, result: { type: "grade", grade: msCapped ? Math.min(rawGrade, MS_MAKEUP_GRADE_CAP) : rawGrade, percentScore, makeupTotal, ...(msCapped ? { msCapped: true, uncappedGrade: rawGrade } : {}) } };
}

// ---------- คำนวณผลรวมวิชาบูรณาการของนักเรียน 1 คน ----------
// คะแนน: ถัวเฉลี่ยถ่วงน้ำหนักด้วยจำนวนคาบเรียน (total_periods) ของวิชาพื้นฐานแต่ละตัว (ยืนยันแล้ว)
// วิชาย่อยใดได้เกรด 0 ผลรวมเป็น 0 แม้คาบเป็น 0; ร้อยละรวมยังแสดงค่าถัวเฉลี่ยจริง
// มส.: คิด "แบบรวม" ที่ระดับวิชาบูรณาการ (ยืนยันกับผู้ใช้แล้ว 2026-07) — ไม่ใช่แยกรายวิชาย่อย:
//   ฐานเวลาเรียนรวม = SUM(total_periods ของวิชาย่อยทุกตัว)  เช่น สังคม 20 + การงาน 20 = 40 คาบ
//   คาบขาดสะสมรวม  = SUM(คาบขาดของนักเรียนคนนี้ในทุกวิชาย่อย)  (เช็คชื่อยังทำรายวิชาย่อย
//                     เหมือนเดิม — ครูจะได้เห็นว่าเด็กขาดหนักที่วิชาไหน แล้วไปตามแก้ที่วิชานั้น)
//   ชั่วโมงชดเชยรวม = SUM(makeup_hours ของทุกวิชาย่อย)
//   เพดาน 20%/40% คิดจากฐานรวม — ตรรกะ 2 ระดับ (เรียนเพิ่ม/เรียนซ้ำ) เหมือนวิชาพื้นฐานทุกอย่าง
// มส. (รวม) ชนะ ร. เมื่อขัดแย้งกัน (ยืนยันแล้ว) — ไม่มี มส. แต่มีวิชาย่อยติด ร. → บูรณาการติด ร.
// รับ memberDataList = [{ subject, units, remarksData, sessions, makeupHours }, ...] จาก loadSubjectData
export function computeIntegratedResult(studentId, memberDataList) {
  const memberResults = [];
  const noPeriodSubjects = [];
  let hasR = false;
  let weightedSum = 0, weightSum = 0;
  const zeroMembers = [];
  let expectedCount = 0, scoredCount = 0;
  let collectExpectedCount = 0, collectScoredCount = 0, notScoredIndicatorCount = 0;
  let emptyIndicatorCount = 0, emptyUnitCount = 0;
  const notScoredUnits = [];
  let hasCollectStructure = memberDataList.length > 0;
  let examScored = memberDataList.length > 0;
  let examOverCap = false;
  let partialWeightedSum = 0, partialWeightSum = 0;
  let partialZero = false;
  let totalBase = 0, rawMissed = 0, makeupTotal = 0, makeupBeforeClose = 0, anySessions = false;
  const halfTotals = Object.fromEntries(PRIMARY_HALVES.map(half => [half, {
    weightedScore:0, weightedCollect:0, weightedExam:0, weight:0,
    complete:memberDataList.length > 0, hasStructure:memberDataList.length > 0,
    examScored:memberDataList.length > 0, examOverCap:false,
    collectScoredCount:0, collectExpectedCount:0, partialWeighted:0, partialWeight:0
  }]));
  let hasPrimaryHalves = false;

  for (const md of memberDataList) {
    // skipMs = true: วิชาย่อยไม่ตัดสิน มส. รายตัว (คิดรวมข้างล่างแทน) — ผลรายวิชาจึงมีแค่ ร./เกรด
    const r = computeSubjectResult(studentId, md.subject, md.units, md.remarksData, md.sessions, md.makeupHours, {
      skipMs: true,
      examScores: md.examScores,
      gradeWeight: md.gradeWeight
    });
    const weight = Number(md.subject.total_periods) || 0;
    const missed = computeMissedPeriods(studentId, md.sessions || []);
    // เก็บสมรรถนะหลักของวิชาย่อยนี้ไว้ด้วย (ถ้ามี) — แสดงแยกตามวิชาที่กรอกไว้จริง ไม่ถัวเฉลี่ยรวม
    // เพราะสมรรถนะหลักมักกรอกแค่บางวิชา ถัวเฉลี่ยรวมกับวิชาที่ไม่มีข้อมูลจะทำให้คะแนนต่ำลงผิดๆ
    // missedPeriods เก็บไว้โชว์รายวิชา ให้ครูเห็นว่าเด็กขาดหนักที่วิชาย่อยไหน
    memberResults.push({ subject: md.subject, result: r.result, weight, competencyUnits: r.competencyUnits, missedPeriods: missed, scoring: r.scoring, halves:r.halves });
    if (r.halves) {
      hasPrimaryHalves = true;
      for (const half of PRIMARY_HALVES) {
        const part = r.halves[half], total = halfTotals[half];
        if (weight > 0) {
          total.weight += weight;
          total.weightedScore += part.score * weight;
          total.weightedCollect += part.collectPart * weight;
          total.weightedExam += part.examPart * weight;
          if (part.partialPercent !== null) {
            total.partialWeighted += part.partialPercent * weight;
            total.partialWeight += weight;
          }
        }
        total.complete &&= part.complete;
        total.hasStructure &&= part.hasStructure;
        total.examScored &&= part.examScored;
        total.examOverCap ||= part.examOverCap;
        total.collectScoredCount += part.collectScoredCount;
        total.collectExpectedCount += part.collectExpectedCount;
      }
    }
    expectedCount += r.scoring.expectedCount;
    scoredCount += r.scoring.scoredCount;
    collectExpectedCount += r.scoring.collectExpectedCount;
    collectScoredCount += r.scoring.collectScoredCount;
    notScoredIndicatorCount += r.scoring.notScoredIndicatorCount;
    emptyIndicatorCount += r.scoring.emptyIndicatorCount;
    emptyUnitCount += r.scoring.emptyUnitCount;
    notScoredUnits.push(...r.scoring.notScoredUnits.map(name => md.subject.name + ": " + name));
    if (!r.scoring.hasCollectStructure) hasCollectStructure = false;
    if (!r.scoring.examScored) examScored = false;
    if (r.scoring.examOverCap) examOverCap = true;
    if (r.scoring.partialPercent !== null) {
      if (percentToGrade(r.scoring.partialPercent) === 0) partialZero = true;
      if (weight > 0) {
        partialWeightedSum += r.scoring.partialPercent * weight;
        partialWeightSum += weight;
      }
    }
    if (r.result.type === "ร.") hasR = true;
    else if (r.result.type === "grade") {
      if (Number(r.result.grade) === 0) zeroMembers.push(md.subject);
      if (weight > 0) { weightedSum += r.result.percentScore * weight; weightSum += weight; }
    }

    // ถ้าไม่มีฐานเวลา ห้ามนับคาบขาดเข้ายอดรวมฝ่ายเดียว ไม่งั้นอัตราขาดจะพุ่งและติด มส. ผิด
    // ยัง push memberResults และคิดคะแนนตามปกติ — ตัดออกเฉพาะส่วนเวลาเรียน/มส.
    if (weight <= 0) {
      noPeriodSubjects.push(md.subject.name);
      continue;
    }

    totalBase += weight;
    rawMissed += missed;
    if ((md.sessions || []).length > 0) anySessions = true;
    makeupTotal += (md.makeupHours || [])
      .filter(m => m.student_id === studentId)
      .reduce((sum, m) => sum + Number(m.periods), 0);
    makeupBeforeClose += (md.makeupHours || [])
      .filter(m => m.student_id === studentId && !isLateMakeup(m, md.subject))
      .reduce((sum, m) => sum + Number(m.periods), 0);
  }

  // 1) เช็ค มส. รวมก่อน (มส. ชนะ ร.) — ต้องมีฐานเวลากับข้อมูลเช็คชื่ออย่างน้อย 1 ครั้งถึงเช็คได้
  let overall = null;
  let msCapped = false;
  if (memberDataList[0]?.subject?.level !== "ประถม" && totalBase > 0 && anySessions) {
    const maxMissedRetake = totalBase * MS_RETAKE_RATIO;
    const maxMissedMakeup = totalBase * MS_MAKEUP_RATIO;
    if (rawMissed > maxMissedRetake) {
      overall = { type: "มส.", subtype: "retake", missedPeriods: rawMissed, maxMissed: maxMissedRetake, totalBase };
    } else if (rawMissed > maxMissedMakeup) {
      const netMissed = Math.max(0, rawMissed - makeupTotal);
      if (netMissed > maxMissedMakeup) {
        overall = { type: "มส.", subtype: "makeup", missedPeriods: rawMissed, netMissed, maxMissed: maxMissedMakeup, makeupTotal, totalBase };
      } else msCapped = rawMissed - makeupBeforeClose > maxMissedMakeup;
    }
  }

  // 2) ไม่มี มส. → เช็ค ร. ของวิชาย่อย
  if (!overall && hasR) {
    const rMembers = memberResults.filter(member => member.result.type === "ร.")
      .map(member => ({ subject: member.subject, reason:member.result.reason || "" }));
    overall = { type:"ร.", rMembers,
      reason:rMembers.map(member => member.subject.name + ": " + (member.reason || "ยังไม่ระบุเหตุผล")).join(" · ") };
  }

  // 3) ถัวร้อยละถ่วงคาบแล้วตัดเกรดครั้งเดียว; วิชาย่อยได้ 0 บังคับผลรวมเป็น 0
  if (!overall) {
    const percentScore = weightSum > 0 ? weightedSum / weightSum : 0;
    const rawGrade = zeroMembers.length ? 0 : percentToGrade(percentScore);
    overall = { type: "grade", grade: msCapped ? Math.min(rawGrade, MS_MAKEUP_GRADE_CAP) : rawGrade,
      percentScore, weightSum, makeupTotal, zeroMembers,
      ...(msCapped ? { msCapped: true, uncappedGrade: rawGrade } : {}) };
  }

  const scoring = {
    expectedCount,
    scoredCount,
    collectExpectedCount,
    collectScoredCount,
    notScoredIndicatorCount,
    emptyIndicatorCount,
    emptyUnitCount,
    notScoredUnits,
    hasCollectStructure,
    examScored,
    examOverCap,
    complete: hasPrimaryHalves ? PRIMARY_HALVES.every(half => halfTotals[half].complete) :
      hasCollectStructure && expectedCount > 0 && scoredCount === expectedCount && emptyIndicatorCount === 0 && emptyUnitCount === 0,
    partialPercent: partialWeightSum > 0 ? partialWeightedSum / partialWeightSum : null,
    partialZero
  };
  const halves = hasPrimaryHalves ? Object.fromEntries(PRIMARY_HALVES.map(half => {
    const total = halfTotals[half], weight = total.weight;
    return [half, {
      hasStructure:total.hasStructure && weight > 0,
      collectPart:weight > 0 ? total.weightedCollect / weight : 0,
      examPart:weight > 0 ? total.weightedExam / weight : 0,
      score:weight > 0 ? total.weightedScore / weight : 0,
      complete:total.complete && weight > 0,
      partialPercent:total.partialWeight > 0 ? total.partialWeighted / total.partialWeight : null,
      examScored:total.examScored, examOverCap:total.examOverCap,
      collectScoredCount:total.collectScoredCount, collectExpectedCount:total.collectExpectedCount
    }];
  })) : undefined;
  return { memberResults, overall, scoring, halves, totalBase, rawMissed, makeupTotal, noPeriodSubjects };
}

// ---------- วิชาที่ "นับได้" ในรายงานเกรด/ซ้ำชั้น ----------
// = วิชาบูรณาการทุกตัว + วิชาพื้นฐานที่ไม่ได้เป็นสมาชิกของบูรณาการตัวไหน
// (คะแนนวิชาสมาชิกถูกรวมเข้าบูรณาการไปแล้ว นับซ้ำไม่ได้ — ยืนยันกับผู้ใช้ตั้งแต่ 2026-07)
export function pickCountableSubjects(subjects, memberLinks) {
  const memberIds = new Set((memberLinks || []).map(link => link.member_subject_id));
  return (subjects || []).filter(s => s.subject_type === "บูรณาการ" || !memberIds.has(s.id));
}

// หน่วยกิตมัธยมและคาบประถมของวิชาบูรณาการมาจากวิชาย่อยเท่านั้น
export function subjectCreditInfo(subject, memberSubjects = []) {
  if (subject?.level === "ประถม" || subject?.grade_level?.startsWith("ป.")) {
    if (subject?.subject_type === "บูรณาการ") {
      if (!memberSubjects.length) return { credits:null, weight:null, unit:"คาบ", missing:[(subject?.name || "วิชาบูรณาการ") + " (ยังไม่มีวิชาย่อย)"] };
      const missing = memberSubjects.filter(member => !Number.isFinite(Number(member?.total_periods)) || !(Number(member?.total_periods) > 0))
        .map(member => `${subject?.name || "วิชาบูรณาการ"} (วิชาย่อย ${member?.name || "ไม่ระบุชื่อ"})`);
      return { credits:null, weight:missing.length ? null : memberSubjects.reduce((sum, member) => sum + Number(member.total_periods), 0), unit:"คาบ", missing };
    }
    const periods = Number(subject?.total_periods);
    return Number.isFinite(periods) && periods > 0
      ? { credits:null, weight:periods, unit:"คาบ", missing:[] }
      : { credits:null, weight:null, unit:"คาบ", missing:[subject?.name || "ไม่ระบุชื่อวิชา"] };
  }
  if (subject?.subject_type === "บูรณาการ") {
    if (!memberSubjects.length) return { credits:null, weight:null, unit:"หน่วยกิต", missing:[(subject?.name || "วิชาบูรณาการ") + " (ยังไม่มีวิชาย่อย)"] };
    const missing = memberSubjects.filter(member => !Number.isFinite(Number(member?.credits)) || !(Number(member?.credits) > 0))
      .map(member => `${subject?.name || "วิชาบูรณาการ"} (วิชาย่อย ${member?.name || "ไม่ระบุชื่อ"})`);
    const credits = missing.length ? null : memberSubjects.reduce((sum, member) => sum + Number(member.credits), 0);
    return { credits, weight:credits, unit:"หน่วยกิต", missing };
  }
  const credits = Number(subject?.credits);
  return Number.isFinite(credits) && credits > 0
    ? { credits, weight:credits, unit:"หน่วยกิต", missing:[] }
    : { credits:null, weight:null, unit:"หน่วยกิต", missing:[subject?.name || "ไม่ระบุชื่อวิชา"] };
}

// ---------- รวมผลทุกวิชาของนักเรียนทุกคน (ชั้นคำนวณบริสุทธิ์) ----------
// อินพุตใช้ Map ของ loadSubjectsData และรายชื่อ/การลงทะเบียนเดิม ไม่กรองวิชาย่อยตามรายคน
// เพื่อคงผลเดิมเมื่อเรียนสมาชิกบูรณาการไม่ครบทุกวิชา
export function assembleStudentResults({ scopedSubjects, memberLinks, loadedData, enrolledBySubject, students }) {
  const out = new Map();
  const countableSubjects = pickCountableSubjects(scopedSubjects, memberLinks);
  const groupMembers = new Map(); // integrated_subject_id -> [member_subject_id, ...]
  for (const link of memberLinks) {
    if (!groupMembers.has(link.integrated_subject_id)) groupMembers.set(link.integrated_subject_id, []);
    groupMembers.get(link.integrated_subject_id).push(link.member_subject_id);
  }

  for (const [studentId, student] of students) out.set(studentId, { student, subjects: [] });

  for (const subj of countableSubjects) {
    if (subj.subject_type === "บูรณาการ") {
      const members = groupMembers.get(subj.id) || [];
      const memberDataList = members.map(id => loadedData.get(id)).filter(Boolean);
      const enrolledSet = new Set();
      for (const id of members) for (const sid of (enrolledBySubject.get(id) || [])) enrolledSet.add(sid);
      for (const studentId of enrolledSet) {
        if (!out.has(studentId)) continue;
        const ir = computeIntegratedResult(studentId, memberDataList);
        out.get(studentId).subjects.push({
          subject: subj,
          creditInfo: subjectCreditInfo(subj, memberDataList.map(data => data.subject)),
          result: ir.overall,
          scoring: ir.scoring,
          noPeriodSubjects: ir.noPeriodSubjects,
          memberResults: ir.memberResults,
          // เวลาเรียนรวมทุกวิชาย่อย (ขาดดิบ ยังไม่หักชดเชย) — ใบ ปพ.6 ใช้แสดง
          attendance: { base: ir.totalBase, missed: ir.rawMissed },
          halves: ir.halves  // ประถม: คะแนนกลางปี/ปลายปี (ใบ ปพ.6) · มัธยม = undefined
        });
      }
    } else {
      const data = loadedData.get(subj.id);
      const enrolledSet = enrolledBySubject.get(subj.id) || new Set();
      for (const studentId of enrolledSet) {
        if (!out.has(studentId)) continue;
        const r = computeSubjectResult(studentId, data.subject, data.units, data.remarksData, data.sessions, data.makeupHours, {
          examScores: data.examScores,
          gradeWeight: data.gradeWeight
        });
        out.get(studentId).subjects.push({ subject: subj, creditInfo: subjectCreditInfo(subj), result: r.result, scoring: r.scoring,
          attendance: { base: Number(data.subject.total_periods) || 0, missed: computeMissedPeriods(studentId, data.sessions) },
          halves: r.halves });
      }
    }
  }

  return out;
}

// ---------- คิดเกรดเฉลี่ย (GPA) จากผลรายวิชาของนักเรียน 1 คน ----------
// ถ่วงน้ำหนักด้วยหน่วยกิตมัธยม หรือคาบเรียนประถม
// pending = ยังสรุปของจริงไม่ได้เพราะมี ร./มส. หรือกรอกคะแนนไม่ครบ
// provisionalGpa คิดจากคะแนนเฉพาะที่กรอกแล้ว ใช้ดูระหว่างทางเท่านั้น ห้ามใช้ตัดสิน
export function computeGpa(subjectResults) {
  const list = subjectResults || [];
  const total = list.length;
  const hasBlocked = list.some(x => x.result.type === "มส." || x.result.type === "ร.");
  const hasIncomplete = list.some(x => x.scoring && !x.scoring.complete);
  const missingCredits = [...new Set(list.flatMap(x => x.creditInfo?.missing || []))];
  const missingUnits = [...new Set(list.filter(x => x.creditInfo?.missing?.length).map(x => x.creditInfo.unit === "คาบ" ? "คาบเรียน" : "หน่วยกิต"))];
  const missingLabel = missingUnits.length ? "ยังไม่ตั้ง" + missingUnits[0] : "";
  const pending = hasBlocked || hasIncomplete || missingCredits.length > 0;
  const reasons = [];
  if (hasBlocked) reasons.push("มีวิชาติด ร./มส.");
  if (hasIncomplete) reasons.push("ยังกรอกคะแนนไม่ครบ");
  for (const unit of missingUnits) {
    const names = [...new Set(list.filter(x => (x.creditInfo?.unit === "คาบ" ? "คาบเรียน" : "หน่วยกิต") === unit)
      .flatMap(x => x.creditInfo?.missing || []))];
    reasons.push("ยังไม่ตั้ง" + unit + ": " + names.join(" · "));
  }

  let weightedSum = 0, weightSum = 0, countedSubjects = 0;
  for (const x of list) {
    if (x.result.type !== "grade") continue;
    const partial = x.scoring?.partialPercent;
    // ⚠ วิชาที่ยังไม่มีคะแนนเลย (ไม่มีโครงสร้าง หรือมีแต่ยังไม่กรอกสักช่อง) ต้อง **ข้าม**
    // ห้ามนับเป็นเกรด 0 — ไม่งั้นเลข "ชั่วคราว" จะสร้างบั๊กเดิมของข้อ 3 ขึ้นมาใหม่ในตัวมันเอง
    // (เคสจริง: มีคะแนนวิชาเดียวได้ 100% อีก 4 วิชายังไม่มีโครงสร้าง → เคยขึ้น 1.33 ทั้งที่ควรเป็น 4.00)
    if (x.scoring && !x.scoring.complete && (partial === null || partial === undefined)) continue;
    // เมื่อน้ำหนักขาด ค่าเฉลี่ยชั่วคราวประมาณด้วยน้ำหนัก 1 เท่านั้น; ผลทางการถูกบล็อกด้านบน
    const w = x.creditInfo
      ? (Number(x.creditInfo.weight) > 0 ? Number(x.creditInfo.weight) : 1)
      : (x.subject.credits && x.subject.credits > 0 ? Number(x.subject.credits) : 1);
    // ผลที่ตัดสินแล้วต้องใช้เกรดจริง (รวมเพดานแก้ มส. หลังปิดสอบ)
    // เฉพาะข้อมูลยังไม่ครบจึงแปลเปอร์เซ็นต์ชั่วคราว
    const grade = x.scoring && !x.scoring.complete
      ? (x.scoring.partialZero ? 0 : percentToGrade(partial))
      : Number(x.result.grade);
    weightedSum += grade * w;
    weightSum += w;
    countedSubjects++;
  }
  const value = weightSum > 0 ? weightedSum / weightSum : 0;
  return {
    gpa: pending || total === 0 ? null : value,
    pending,
    pendingReason: reasons.join(" · "),
    missingCredits,
    missingLabel,
    provisionalGpa: countedSubjects > 0 ? value : null,
    countedSubjects,
    total
  };
}

// แปลง child_grade_data ตาม SQL G1: โครงสร้างครบทุกคน แต่แถวคะแนน/เวลาเฉพาะนักเรียนนี้
// null/ยังไม่ประกาศไม่มีข้อมูลให้คำนวณ ไม่สร้างค่าเกรดขึ้นเอง
export function fromGradeRpc(payload) {
  if (!payload || payload.released !== true || !payload.student_id) return null;
  const studentId = payload.student_id;
  const memberLinks = payload.integration_members || [];
  const enrolledIds = new Set(payload.enrolled_subject_ids || []);
  const integratedIds = new Set(memberLinks.map(link => link.integrated_subject_id));
  const subjects = payload.subjects || [];
  const scopedSubjects = subjects.filter(subject => enrolledIds.has(subject.id) || integratedIds.has(subject.id));
  const group = rows => {
    const map = new Map();
    for (const row of rows || []) {
      if (!map.has(row.subject_id)) map.set(row.subject_id, []);
      map.get(row.subject_id).push(row);
    }
    return map;
  };
  const units = group(payload.units), remarks = group(payload.remarks), sessions = group(payload.sessions);
  const makeup = group(payload.makeup_hours), exams = group(payload.exam_scores);
  const loadedData = new Map(subjects.filter(subject => subject.subject_type === "พื้นฐาน").map(subject => [subject.id, {
    subject, units:units.get(subject.id) || [], remarksData:remarks.get(subject.id) || [],
    sessions:sessions.get(subject.id) || [], makeupHours:makeup.get(subject.id) || [],
    examScores:exams.get(subject.id) || [], gradeWeight:gradeWeightFor(subject, payload.grade_weights)
  }]));
  return {
    scopedSubjects, memberLinks, loadedData,
    enrolledBySubject:new Map([...enrolledIds].map(id => [id, new Set([studentId])])),
    students:new Map([[studentId, { id:studentId }]])
  };
}

// คะแนนรวมทางการตามใบ ปพ.6: ร./มส./คะแนนยังไม่ครบ แสดงขีด ไม่ใช้คะแนนชั่วคราว
export function subjectTotalScore(entry) {
  if (entry.result?.type !== "grade" || (entry.scoring && !entry.scoring.complete)) return null;
  return Number(entry.result.percentScore);
}

// คะแนนตอนนี้ของสรุปรายวิชา ใช้ส่วนคะแนนที่คำนวณแล้ว (แยกจากคะแนนรวมทางการ)
export function subjectCurrentScore(entry, half) {
  if (entry.halves) {
    const part = entry.halves[half];
    return part.hasStructure && !part.examOverCap ? part.score : null;
  }
  return entry.scoring.examOverCap || !entry.scoring.hasCollectStructure ? null :
    entry.collectPart + (entry.scoring.examScored ? entry.examPart : 0);
}
