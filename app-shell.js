/* เมนูกลางของหน้าที่ต้องล็อกอิน — แก้รายการเมนูเพียงไฟล์นี้ไฟล์เดียว
   รองรับหลายฝ่าย: ดูว่าหน้าปัจจุบันอยู่ในโฟลเดอร์ไหน แล้วเลือกชุดเมนูของฝ่ายนั้น
   (โฟลเดอร์ที่ไม่รู้จักจะถือเป็นฝ่ายวิชาการ เพื่อคงพฤติกรรมเดิมของหน้าเก่าทุกหน้า) */
(function () {
  // กราฟโดนัทกลาง — legend ใส่ตัวเลขและสัดส่วนเสมอ สีจึงไม่ใช่ช่องทางเดียวที่สื่อความหมาย
  window.renderDonut = function ({
    svgId, legendId, heroId, titleId, title, hero, unit, segments, empty
  }) {
    const byId = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[ch]);
    const svg = byId(svgId);
    const legend = byId(legendId);
    const heroEl = byId(heroId);
    if (!svg || !legend || !heroEl) return;

    const cx = 90, cy = 90, r = 62, thickness = 20, gap = 2;
    const circumference = 2 * Math.PI * r;
    const safeSegments = Array.isArray(segments) ? segments : [];
    const total = safeSegments.reduce((sum, segment) => sum + Number(segment.value || 0), 0);
    const drawn = empty ? [] : safeSegments.filter(segment => Number(segment.value) > 0);

    heroEl.textContent = hero;
    let arcs = "";
    if (empty || total === 0) {
      arcs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thickness}"></circle>`;
    } else {
      let offset = 0;
      for (const segment of drawn) {
        const length = (Number(segment.value) / total) * circumference;
        const visible = drawn.length === 1 ? length : Math.max(.5, length - gap);
        arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="${segment.color}" stroke-width="${thickness}"
          stroke-dasharray="${visible.toFixed(2)} ${(circumference - visible).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
          transform="rotate(-90 ${cx} ${cy})"><title>${escapeHtml(segment.label)} ${segment.value} ${escapeHtml(unit)}</title></circle>`;
        offset += length;
      }
    }
    svg.innerHTML = `<title id="${titleId}">${escapeHtml(title)}</title>` + arcs;
    legend.innerHTML = safeSegments.map(segment => {
      const value = empty ? "—" : segment.value;
      const share = empty ? "—" : `${total > 0 ? Math.round((Number(segment.value) / total) * 100) : 0}%`;
      return `<li><span class="swatch" style="background:${segment.color}"></span>` +
        `<span class="legend-name">${escapeHtml(segment.label)}</span>` +
        `<span class="legend-value">${value} ${escapeHtml(unit)}</span>` +
        `<span class="legend-share">${share}</span></li>`;
    }).join("");
  };

  // กล่องยืนยันกลางของทุกฝ่าย — ใช้แทน confirm()/prompt() ซึ่ง webview บางตัวบล็อกเงียบ ๆ
  // requireText มีค่าเมื่อการกระทำเสี่ยงสูงและต้องพิมพ์ข้อความให้ตรงก่อนยืนยัน
  window.crsAskConfirm = function ({
    title = "ยืนยันการทำรายการ",
    message = "",
    requireText = null,
    okLabel = "ยืนยัน",
    danger = true
  } = {}) {
    return new Promise(resolve => {
      if (!document.getElementById("crs-confirm-style")) {
        const style = document.createElement("style");
        style.id = "crs-confirm-style";
        style.textContent = `
          .crs-confirm-overlay{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.58)}
          .crs-confirm-overlay.show{display:flex}
          .crs-confirm-dialog{width:min(100%,460px);max-height:calc(100vh - 40px);overflow:auto;border-radius:16px;background:var(--white,#fff);box-shadow:0 24px 70px rgba(15,23,42,.3);padding:22px}
          .crs-confirm-dialog h3{margin:0;color:var(--ink,#1f2a2e);font-size:1.15rem;line-height:1.4}
          .crs-confirm-message{margin:10px 0 0;color:var(--muted,#5f6b70);font-size:.95rem;line-height:1.65;white-space:pre-line}
          .crs-confirm-field{margin-top:16px}
          .crs-confirm-field[hidden]{display:none}
          .crs-confirm-field label{display:block;margin-bottom:6px;color:var(--ink,#1f2a2e);font-weight:600;font-size:.92rem}
          .crs-confirm-field input{box-sizing:border-box;width:100%;min-height:44px;border:1px solid var(--line,#dfe4e3);border-radius:10px;background:var(--white,#fff);color:var(--ink,#1f2a2e);font:inherit;font-size:16px;padding:9px 11px}
          .crs-confirm-field input:focus{outline:3px solid rgba(15,110,86,.18);border-color:var(--teal,#0f6e56)}
          .crs-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
          .crs-confirm-actions button{min-height:44px;border:0;border-radius:10px;font:inherit;font-weight:700;padding:9px 16px;cursor:pointer}
          .crs-confirm-cancel{background:var(--teal-soft,#e1f5ee);color:var(--ink,#1f2a2e)}
          .crs-confirm-ok{background:var(--teal,#0f6e56);color:#fff}
          .crs-confirm-ok.crs-confirm-danger{background:var(--danger,#a32d2d);color:#fff}
          .crs-confirm-actions button:disabled{cursor:not-allowed;opacity:.45}
          @media(max-width:520px){.crs-confirm-overlay{align-items:flex-end;padding:12px}.crs-confirm-dialog{width:100%;max-height:calc(100vh - 24px);border-radius:16px;padding:18px}.crs-confirm-actions{display:grid;grid-template-columns:1fr 1fr}.crs-confirm-actions button{width:100%}}
        `;
        document.head.appendChild(style);
      }

      let overlay = document.getElementById("crs-confirm-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "crs-confirm-overlay";
        overlay.className = "crs-confirm-overlay";
        overlay.setAttribute("role", "presentation");
        overlay.innerHTML = `
          <div class="crs-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="crs-confirm-title" aria-describedby="crs-confirm-message">
            <h3 id="crs-confirm-title"></h3>
            <div class="crs-confirm-message" id="crs-confirm-message"></div>
            <div class="crs-confirm-field" id="crs-confirm-field" hidden>
              <label for="crs-confirm-input" id="crs-confirm-label"></label>
              <input id="crs-confirm-input" type="text" autocomplete="off">
            </div>
            <div class="crs-confirm-actions">
              <button type="button" class="crs-confirm-cancel" id="crs-confirm-cancel">ยกเลิก</button>
              <button type="button" class="crs-confirm-ok" id="crs-confirm-ok"></button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      const titleEl = document.getElementById("crs-confirm-title");
      const messageEl = document.getElementById("crs-confirm-message");
      const field = document.getElementById("crs-confirm-field");
      const label = document.getElementById("crs-confirm-label");
      const input = document.getElementById("crs-confirm-input");
      const cancel = document.getElementById("crs-confirm-cancel");
      const ok = document.getElementById("crs-confirm-ok");
      const required = requireText == null ? null : String(requireText);
      const previousFocus = document.activeElement;

      titleEl.textContent = title;
      messageEl.textContent = message;
      field.hidden = required == null;
      label.textContent = required == null ? "" : `พิมพ์ “${required}” เพื่อยืนยัน`;
      input.value = "";
      ok.textContent = okLabel;
      // ⚠ ห้ามใช้ชื่อคลาส "danger" ตรง ๆ — app-shell.css มีกฎ `button.danger,.danger{...!important}`
      // ที่จะทับปุ่มนี้ให้กลายเป็นพื้นอ่อน ทำให้ปุ่มยืนยันการลบไม่เด่นกว่าปุ่มยกเลิก
      ok.classList.toggle("crs-confirm-danger", Boolean(danger));
      ok.disabled = required != null;

      const syncButton = () => { ok.disabled = required != null && input.value !== required; };
      const finish = result => {
        overlay.classList.remove("show");
        overlay.removeEventListener("click", onOutsideClick);
        document.removeEventListener("keydown", onKeyDown);
        input.removeEventListener("input", syncButton);
        cancel.onclick = null;
        ok.onclick = null;
        if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
        resolve(result);
      };
      const onOutsideClick = event => { if (event.target === overlay) finish(false); };
      const onKeyDown = event => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Enter" && !ok.disabled) finish(true);
      };

      cancel.onclick = () => finish(false);
      ok.onclick = () => finish(true);
      input.addEventListener("input", syncButton);
      overlay.addEventListener("click", onOutsideClick);
      document.addEventListener("keydown", onKeyDown);
      overlay.classList.add("show");
      setTimeout(() => (required == null ? cancel : input).focus(), 0);
    });
  };

  const nav = document.querySelector("header .nav");
  if (!nav) return;
  const header = nav.closest("header");
  if (header) header.classList.add("academic-header");

  // ไฟล์ shell อยู่รากเว็บเสมอ จึงใช้สร้าง URL ที่ถูกต้องจากทุกโฟลเดอร์ฝ่าย
  const appRootUrl = new URL("./", document.currentScript.src);
  const shellVersion = new URL(document.currentScript.src).searchParams.get("v");
  const dashboardUrl = new URL("dashboard.html", appRootUrl).href;

  // ---------- นิยามฝ่าย: เมนู + หน้าเริ่มต้น + workflow ของแต่ละหน้า ----------
  // workflow แยกตามฝ่าย เพื่อไม่ให้ชื่อไฟล์ซ้ำข้ามฝ่ายแล้วหยิบคำอธิบายผิดอัน
  const MODULES = {
    academic: {
      label: "ฝ่ายวิชาการ",
      kicker: "วิชาการ",
      // ใช้เมื่อ URL ลงท้ายด้วย / (ไม่มีชื่อไฟล์) — ตั้งแต่มี index.html เว็บเซิร์ฟเวอร์จะเสิร์ฟหน้านี้
      // ให้กับ /academic/ อยู่แล้ว ปุ่มที่ไฮไลต์จึงต้องเป็นหน้าเดียวกัน (เดิมชี้ entry.html
      // ตอนที่ /academic/ ยังเป็น 404 จึงไม่เคยมีใครเข้าถึงเส้นทางนี้ได้จริง)
      home: "index.html",
      moduleHome: ["index.html", "ภาพรวมวิชาการ"],
      groups: [
        {
          label: "ลงคะแนน",
          items: [
            ["attendance.html", "เช็คชื่อ"],
            ["entry.html", "กรอกคะแนน"],
            ["competency-entry.html", "กรอกคะแนนกิจกรรม/กิจวัตร"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["manage.html", "จัดการโครงสร้าง"],
            ["competency-manage.html", "กำหนดกิจกรรม/กิจวัตร"],
            ["competency-core.html", "กำหนดสมรรถนะหลัก"],
            ["students.html", "นักเรียน"],
            ["rollover.html", "ขึ้นปีใหม่"]
          ]
        },
        {
          label: "รายงาน",
          items: [
            ["summary.html", "สรุปผลการเรียน"],
            ["warning.html", "เฝ้าระวัง มส."],
            ["retention.html", "เรียนซ้ำชั้น"]
          ]
        },
        {
          label: "งานฝ่าย",
          items: [
            ["calendar.html", "ปฏิทินปฏิบัติงาน"],
            ["projects.html", "โครงการ/กิจกรรม"],
            ["okr.html", "OKR ของโรงเรียน"],
            ["project-approval.html", "อนุมัติโครงการ/กิจกรรม"],
            ["project-report.html", "รายงานโครงการ/กิจกรรม"]
          ]
        }
      ],
      workflows: {
        "calendar.html": {
          title: "จัดการปฏิทินปฏิบัติงาน",
          description: "เลือกปีและเดือน แล้วตรวจ เพิ่ม หรือแก้กำหนดการของฝ่ายวิชาการ",
          steps: ["เลือกช่วงเวลา", "ตรวจรายการ", "บันทึก"]
        },
        "projects.html": {
          title: "จัดการโครงการและกิจกรรม",
          description: "กรองรายการ ตรวจงบและ OKR แล้วบันทึกรายละเอียดโครงการ",
          steps: ["เลือกปี", "ตรวจภาพรวม", "บันทึก"]
        },
        "okr.html": {
          title: "OKR ของโรงเรียน",
          description: "ตั้ง Objective และ Key Result บันทึกผลวัด และดูว่าโครงการไหนรองรับ KR ตัวใด",
          steps: ["เลือกปี", "ตั้ง OKR", "บันทึกผลวัด"]
        },
        "project-approval.html": {
          title: "อนุมัติโครงการ/กิจกรรม",
          description: "ตรวจรายละเอียดที่ผู้รับผิดชอบส่งมา แล้วอนุมัติ ส่งกลับให้แก้ หรือไม่อนุมัติ",
          steps: ["เลือกรายการ", "ตรวจรายละเอียด", "บันทึกผลพิจารณา"]
        },
        "project-report.html": {
          title: "รายงานโครงการ/กิจกรรม",
          description: "สรุปทั้งปีว่าทำอะไรไปบ้าง ใช้งบเท่าไหร่ และมีอะไรค้างต้องตาม",
          steps: ["เลือกปี", "ดูสิ่งที่ต้องตาม", "ดูรายการทั้งหมด"]
        },
        "entry.html": {
          title: "ตั้งค่าการกรอกคะแนน",
          description: "เลือกปี ชั้น ห้อง วิชา และครั้งที่ก่อนเริ่มบันทึกคะแนน",
          steps: ["ตั้งค่า", "เลือกครั้ง", "กรอกคะแนน"]
        },
        "attendance.html": {
          title: "เตรียมเช็คชื่อ",
          description: "เลือกวิชา วันเรียน และจำนวนคาบ แล้วค่อยโหลดรายชื่อ",
          steps: ["ตั้งค่า", "โหลดรายชื่อ", "บันทึกสถานะ"]
        },
        "summary.html": {
          title: "เลือกข้อมูลสำหรับรายงาน",
          description: "กำหนดปี ชั้น ห้อง และวิชา เพื่อดูผลของนักเรียนได้ตรงกลุ่ม",
          steps: ["เลือกมุมมอง", "กรองข้อมูล", "ดูผลสรุป"]
        },
        "manage.html": {
          title: "เลือกวิชาที่ต้องการจัดการ",
          description: "ค้นหาวิชาเดิม หรือเริ่มสร้างโครงสร้างรายวิชาใหม่",
          steps: ["เลือกวิชา", "แก้โครงสร้าง", "บันทึก"]
        },
        "students.html": {
          title: "จัดการรายชื่อนักเรียน",
          description: "กรองรายชื่อก่อนเพิ่ม แก้ไข หรือนำข้อมูลจาก Excel เข้าระบบ",
          steps: ["เลือกชั้น", "ตรวจรายชื่อ", "บันทึก"]
        },
        "rollover.html": {
          title: "เตรียมขึ้นปีการศึกษาใหม่",
          description: "ตรวจข้อมูลต้นทางก่อนเลื่อนชั้นและสร้างวิชาของปีใหม่",
          steps: ["เลือกปี", "ตรวจพรีวิว", "ยืนยัน"]
        },
        "warning.html": {
          title: "กรองกลุ่มที่ต้องติดตาม",
          description: "เลือกปี ชั้น และห้อง เพื่อดูความเสี่ยงการขาดเรียน",
          steps: ["เลือกกลุ่ม", "ตรวจความเสี่ยง", "ติดตาม"]
        },
        "retention.html": {
          title: "เลือกเกณฑ์รายงาน",
          description: "กำหนดปีและชั้น เพื่อดูนักเรียนที่เข้าเกณฑ์เรียนซ้ำชั้น",
          steps: ["เลือกปี", "เลือกชั้น", "ดูรายงาน"]
        },
        "competency-manage.html": {
          title: "กำหนดกิจกรรม/กิจวัตร",
          description: "เลือกปีการศึกษา แล้วสร้างหรือแก้ไขรายการประเมิน",
          steps: ["เลือกปี", "กำหนดรายการ", "เพิ่มผู้เรียน"]
        },
        "competency-core.html": {
          title: "ตั้งค่าสมรรถนะหลัก",
          description: "จัดการรายการและองค์ประกอบ แล้วตั้งน้ำหนัก 3 แหล่งกับเกณฑ์แปลผลกลาง",
          steps: ["จัดการรายการ", "ตั้งน้ำหนัก", "ตั้งเกณฑ์"]
        },
        "competency-entry.html": {
          title: "กรอกคะแนนกิจกรรม/กิจวัตร",
          description: "เลือกรายการเพื่อกรอกคะแนนสมรรถนะ และบันทึกผลผ่าน/ไม่ผ่านสำหรับกิจกรรมพัฒนาผู้เรียน",
          steps: ["เลือกรายการ", "กรอกคะแนน", "บันทึกผลกิจกรรม"]
        }
      }
    },

    personnel: {
      label: "ฝ่ายบุคคล",
      kicker: "บุคคล",
      home: "index.html",
      moduleHome: ["index.html", "ภาพรวมบุคลากร"],
      // หน้าที่เป็นงานของฝ่ายบุคคลโดยเฉพาะ — ครูทั่วไปเห็นตารางเวรรวมและข้อมูลของตัวเอง
      // ซ่อนไว้ก่อนเสมอ (fail-closed) แล้วให้หน้าเว็บเรียก applyPersonnelMenuAccess() เปิดให้
      // ถ้าลืมเรียก คนมีสิทธิ์จะเห็นเมนูไม่ครบ (สังเกตได้ทันที) ดีกว่าเผลอเปิดให้คนไม่มีสิทธิ์
      hrOnly: ["index.html", "leave.html", "field-duty.html", "late-permission.html", "coverage.html", "duty.html", "staff.html", "hr-settings.html", "work-summary.html"],
      groups: [
        {
          label: "บันทึก",
          items: [
            ["leave.html", "บันทึกการลา"],
            ["field-duty.html", "บันทึกออกปฏิบัติหน้าที่"],
            ["late-permission.html", "บันทึกคำขอเข้าสาย"],
            ["coverage.html", "จัดคนแทนประจำวัน"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["staff.html", "ทะเบียนบุคลากร"],
            ["duty.html", "ตารางเวร"],
            ["hr-settings.html", "ตั้งค่างานบุคคล"]
          ]
        },
        {
          label: "รายงาน",
          items: [
            ["work-summary.html", "สรุปเวลาทำงาน"],
            ["duty-board.html", "ตารางเวรของทุกคน"],
            ["my-work.html", "ข้อมูลการทำงานของฉัน"]
          ]
        }
      ],
      workflows: {
        "leave.html": {
          title: "บันทึกการลา",
          description: "เลือกบุคลากร ช่วงวันที่ และประเภทการลา ก่อนบันทึก",
          steps: ["เลือกคน", "ระบุวันลา", "บันทึก"]
        },
        "field-duty.html": {
          title: "บันทึกออกปฏิบัติหน้าที่",
          description: "เลือกบุคลากร ช่วงวันที่ ประเภท และหัวข้อ พร้อมติดตามลิงก์รายงานสรุป",
          steps: ["เลือกคน", "ระบุรายละเอียด", "ติดตามรายงาน"]
        },
        "late-permission.html": {
          title: "บันทึกคำขอเข้าสาย",
          description: "บันทึกคำขอวันนี้หรือย้อนหลังในเดือนปัจจุบัน แล้วตรวจรายการผู้ขอเข้าสาย",
          steps: ["เลือกคนและวันที่", "บันทึกคำขอ", "ตรวจรายการ"]
        },
        "coverage.html": {
          title: "จัดคนแทนประจำวัน",
          description: "เลือกวันที่ ดูว่าใครไม่มา แล้วจัดคนแทนทั้งวิชา ครูประจำชั้น และเวร",
          steps: ["เลือกวันที่", "ดูของค้างรายคน", "เลือกคนแทน"]
        },
        "duty.html": {
          title: "จัดตารางเวร",
          description: "กำหนดรูปแบบวัน × งาน แล้วสร้างหรือสลับเวรจริงของเดือน",
          steps: ["ตั้งรูปแบบวัน × งาน", "สร้างรายเดือน", "ตรวจและสลับเวร"]
        },
        "staff.html": {
          title: "จัดการทะเบียนบุคลากร",
          description: "ตรวจรายชื่อ จับคู่กับ Jibble และตั้งค่าเฉพาะรายคน",
          steps: ["ดึงรายชื่อ", "ตรวจข้อมูล", "บันทึก"]
        },
        "hr-settings.html": {
          title: "ตั้งค่างานบุคคล",
          description: "กำหนดช่วงผ่อนผันเข้าสาย ปีการศึกษา และโควตาวันลา",
          steps: ["เวลาทำงาน", "ปีการศึกษา", "โควตาวันลา"]
        },
        "work-summary.html": {
          title: "เลือกรอบรายงาน",
          description: "เลือกรายเดือนหรือสะสมทั้งปี เพื่อดูภาพรวมเวลาทำงาน",
          steps: ["เลือกรอบ", "ดูภาพรวม", "เจาะรายคน"]
        },
        "duty-board.html": {
          title: "ตารางเวรของทุกคน",
          description: "ดูว่าใครเวรวันไหน เพื่อไปตกลงสลับเวรกันเองก่อนส่งคำขอ",
          steps: ["เลือกเดือน", "ดูตารางเวร", "ตกลงและส่งคำขอ"]
        }
      }
    },

    "general-affairs": {
      label: "ฝ่ายบริหารทั่วไป",
      kicker: "บริหารทั่วไป",
      home: "index.html",
      moduleHome: ["index.html", "ภาพรวมบริหารทั่วไป"],
      // รายงานนี้มีข้อมูลการทำงานรายครู — ซ่อนไว้ก่อน แล้วให้หน้าเว็บเปิดเฉพาะ
      // admin / ฝ่ายบริหารทั่วไป / ฝ่ายบุคลากรผ่าน applyRestrictedMenuAccess()
      reportOnly: ["homeroom-audit.html"],
      groups: [
        {
          label: "บันทึก",
          items: [
            ["daily-attendance.html", "เช็คชื่อรายวัน"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["homeroom.html", "ครูประจำชั้น"]
          ]
        },
        {
          label: "รายงาน",
          items: [
            ["homeroom-audit.html", "รายงานการเช็คชื่อประจำชั้น"]
          ]
        }
      ],
      workflows: {
        "daily-attendance.html": {
          title: "เช็คชื่อประจำวัน",
          description: "เลือกวันที่และห้อง แล้วเปลี่ยนเฉพาะนักเรียนที่ไม่ได้มา ก่อนบันทึกทั้งห้อง",
          steps: ["เลือกห้อง", "เปลี่ยนสถานะ", "บันทึก"]
        },
        "homeroom.html": {
          title: "กำหนดครูประจำชั้น",
          description: "เลือกปี ตรวจทุกห้อง และผูกครูที่มีบัญชีพร้อมเช็คชื่อ",
          steps: ["เลือกปี", "ตรวจบัญชี", "กำหนดครู"]
        },
        "homeroom-audit.html": {
          title: "รายงานการเช็คชื่อประจำชั้น",
          description: "เลือกช่วงวัน แล้วตรวจข้อเท็จจริงรายห้อง รายครู และคนแทน",
          steps: ["เลือกช่วง", "เลือกมุมมอง", "ตรวจรายการ"]
        }
      }
    },

    finance: {
      label: "ฝ่ายการเงิน",
      kicker: "การเงิน",
      home: "index.html",
      moduleHome: ["index.html", "ภาพรวมการเงิน"],
      // งานที่เห็นภาพรวม/ถือเงินสด — ซ่อนก่อนแล้วให้หน้าเว็บเปิดเฉพาะฝ่ายการเงิน
      financeOnly: ["savings-payout.html", "savings-remit.html", "savings-opening.html", "savings-report.html", "transport-settings.html", "transport-remit.html", "transport-report.html", "fee-assign.html", "fee-payment.html", "fee-settings.html", "fee-stock.html", "scholarship-grant.html", "scholarship-sources.html"],
      groups: [
        {
          label: "บันทึก",
          items: [
            ["savings-entry.html", "รับฝากออมทรัพย์"],
            ["savings-withdraw.html", "แจ้งเบิกออมทรัพย์"],
            ["transport-entry.html", "รับเงินค่ารถ"]
          ]
        },
        {
          label: "ฝ่ายการเงิน",
          items: [
            ["savings-payout.html", "จ่ายเงินคืนนักเรียน"],
            ["savings-remit.html", "รับเงินส่งจากครู"],
            ["transport-remit.html", "รับเงินค่ารถจากครู"],
            ["fee-assign.html", "ตั้งหนี้นักเรียน"],
            ["fee-payment.html", "รับเงินค่าใช้จ่ายนักเรียน"],
            ["scholarship-grant.html", "บันทึกทุนการศึกษา"]
          ]
        },
        {
          label: "รายงาน",
          items: [
            ["savings-report.html", "รายงานออมทรัพย์"],
            ["transport-report.html", "รายงานค่ารถ"],
            ["fee-report.html", "รายงานค่าใช้จ่ายนักเรียน"],
            ["scholarship-report.html", "รายงานทุนการศึกษา"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["savings-opening.html", "ยอดยกมาออมทรัพย์"],
            ["transport-settings.html", "ตั้งค่าค่ารถ"],
            ["fee-settings.html", "ตั้งค่าค่าใช้จ่าย"],
            ["fee-stock.html", "คลังสินค้า"],
            ["scholarship-sources.html", "ทะเบียนแหล่งทุน"]
          ]
        }
      ],
      workflows: {
        "savings-entry.html": {
          title: "รับฝากออมทรัพย์",
          description: "เลือกห้อง ตรวจการเช็คชื่อ และบันทึกยอดฝากของนักเรียนที่มาโรงเรียนวันนี้",
          steps: ["เลือกห้อง", "กรอกยอดฝาก", "บันทึกทั้งห้อง"]
        },
        "savings-opening.html": {
          title: "ยอดยกมาออมทรัพย์",
          description: "เลือกชั้นและห้อง แล้วนำเข้ายอดจากสมุดเดิมให้ครบก่อนเริ่มรับฝาก",
          steps: ["เลือกห้อง", "กรอกยอดยกมา", "บันทึก"]
        },
        "savings-withdraw.html": {
          title: "แจ้งเบิกออมทรัพย์",
          description: "เลือกห้อง ตรวจยอดที่เบิกได้ แล้วส่งคำขอเข้าคิวของฝ่ายการเงิน",
          steps: ["เลือกนักเรียน", "กรอกคำขอ", "ส่งเข้าคิว"]
        },
        "transport-entry.html": {
          title: "รับเงินค่ารถ",
          description: "เลือกห้อง ตรวจยอดค้างรายคน แล้วรับเงินสดหรือหักออมทรัพย์",
          steps: ["เลือกห้อง", "ตรวจยอดค้าง", "ยืนยันรายการ"]
        },
        "savings-payout.html": {
          title: "จ่ายเงินคืนนักเรียน",
          description: "จ่ายตามคิวเบิกออมทรัพย์ และคืนเงินที่ค้างของนักเรียนที่ออกแล้ว ทั้งสมุดออมทรัพย์และบัญชีทุน",
          steps: ["ตรวจคิว", "ยืนยันผู้รับ", "จ่ายเงิน"]
        },
        "savings-remit.html": {
          title: "รับเงินส่งจากครู",
          description: "เลือกห้อง ตรวจรายการฝากและเงินสด แล้วบันทึกการรับเงินด้วยยอดที่ตรงกัน",
          steps: ["เลือกห้อง", "นับเงิน", "ยืนยันรับเงิน"]
        },
        "savings-report.html": {
          title: "รายงานออมทรัพย์",
          description: "เลือกช่วงวัน ดูภาพรวมระดับโรงเรียน ห้อง และสมุดรายคน",
          steps: ["เลือกช่วง", "ดูรายห้อง", "ดูรายคน"]
        },
        "transport-remit.html": {
          title: "รับเงินค่ารถจากครู",
          description: "เลือกห้อง ตรวจรายการรับเงินสดค่ารถ แล้วบันทึกการรับเงินด้วยยอดที่ตรงกัน",
          steps: ["เลือกห้อง", "นับเงิน", "ยืนยันรับเงิน"]
        },
        "transport-report.html": {
          title: "รายงานค่ารถ",
          description: "เลือกช่วงวัน ดูยอดที่เก็บได้และยอดค้างชำระสะสมระดับโรงเรียนถึงรายคน",
          steps: ["เลือกช่วง", "ดูรายห้อง", "ดูรายคน"]
        },
        "transport-settings.html": {
          title: "ตั้งค่าค่ารถ",
          description: "ตั้งโซนและอัตรา ผูกนักเรียน แล้วประกาศยอดที่จะเก็บรายเดือน",
          steps: ["ตั้งโซน", "ผูกนักเรียน", "ประกาศยอด"]
        },
        "fee-settings.html": {
          title: "ตั้งค่าค่าใช้จ่าย",
          description: "กำหนดรายการ อัตรา ราคา เงินอุดหนุน และโปรโมชั่นก่อนตั้งหนี้ให้นักเรียน",
          steps: ["เลือกรายการ", "กำหนดอัตรา", "ตรวจและบันทึก"]
        },
        "fee-stock.html": {
          title: "คลังสินค้า",
          description: "ตรวจยอดคงเหลือ ตั้งยอดยกมา รับสินค้าเข้า และปรับยอดพร้อมเหตุผล",
          steps: ["ตรวจยอดยกมา", "บันทึกการเคลื่อนไหว", "ดูประวัติ"]
        },
        "fee-assign.html": {
          title: "ตั้งหนี้นักเรียน",
          description: "เลือกห้องและชนิดรายการ ตรวจรายชื่อ อัตรา และยอดรวมก่อนตั้งหนี้",
          steps: ["เลือกห้อง", "เลือกรายการ", "ตรวจและบันทึก"]
        },
        "fee-payment.html": {
          title: "รับเงินค่าใช้จ่ายนักเรียน",
          description: "เลือกนักเรียน ตรวจรายการค้าง แล้วผูกเงินที่รับเข้ากับแต่ละบรรทัด",
          steps: ["เลือกนักเรียน", "จัดยอดที่รับ", "ยืนยันและเปิดเอกสาร"]
        },
        "fee-receipt.html": {
          title: "ใบแจ้งหนี้และใบเสร็จรับเงิน",
          description: "ตรวจรายการ snapshot ยอดที่จ่าย และยอดคงเหลือก่อนพิมพ์เอกสาร A4",
          steps: ["ตรวจเอกสาร", "นับการพิมพ์", "พิมพ์"]
        },
        "fee-report.html": {
          title: "รายงานค่าใช้จ่ายนักเรียน",
          description: "ดูยอดเรียกเก็บ ส่วนลด และยอดค้างจากระดับห้องถึงรายการรายคน",
          steps: ["ดูรายห้อง", "ดูรายคน", "ตรวจรายการ"]
        },
        "scholarship-grant.html": {
          title: "บันทึกทุนการศึกษา",
          description: "เลือกปี ห้อง และนักเรียน แล้วบันทึกรับทุนหรือยอดยกมาพร้อมตรวจประวัติ",
          steps: ["เลือกนักเรียน", "กรอกรายการ", "ยืนยันบันทึก"]
        },
        "scholarship-report.html": {
          title: "รายงานทุนการศึกษา",
          description: "ดูยอดทุนจากระดับห้องถึงรายคน และสรุปรายแหล่งทุนโดยไม่แยกการใช้เงิน",
          steps: ["ดูรายห้อง", "ดูรายคน", "ดูแหล่งทุน"]
        },
        "scholarship-sources.html": {
          title: "ทะเบียนแหล่งทุน",
          description: "เพิ่ม แก้ และปิดใช้งานรายชื่อผู้ให้ทุนก่อนบันทึกรายการรับทุน",
          steps: ["เพิ่มแหล่งทุน", "ตรวจรายการ", "เปิดหรือปิดใช้"]
        }
      }
    }
  };

  // ---------- หาว่าหน้านี้อยู่ฝ่ายไหน จากโฟลเดอร์ใน URL ----------
  const path = window.location.pathname;
  const segments = path.split("/").filter(Boolean);
  // URL ที่ลงท้ายด้วย / ไม่มีชื่อไฟล์ → ตัวสุดท้ายคือชื่อโฟลเดอร์
  const folder = path.endsWith("/")
    ? segments[segments.length - 1]
    : segments[segments.length - 2];
  const moduleKey = Object.prototype.hasOwnProperty.call(MODULES, folder) ? folder : "academic";
  const mod = MODULES[moduleKey];

  nav.setAttribute("aria-label", "เมนู" + mod.label);
  if (header) header.dataset.shellKicker = "CRS MIS  /  " + mod.kicker;

  const current = (path.endsWith("/") ? "" : segments[segments.length - 1]) || mod.home;
  const pageName = current.replace(/\.html$/i, "").replace(/[^a-z0-9-]/gi, "-");
  // คง class เดิม (academic-*) ไว้ทุกฝ่าย — จริง ๆ คือ class ของ "โครงแอป" ไม่ใช่ของฝ่ายวิชาการ
  // การรีเนมกระทบ CSS ของหน้าที่ใช้งานจริงโดยไม่ได้ประโยชน์ทางสายตา จึงเพิ่ม class ฝ่ายไว้แทน
  document.body.classList.add("academic-shell", "academic-" + pageName, "shell-module-" + moduleKey);

  const buildLink = (href, label, extraClass) => {
    const target = new URL(moduleKey + "/" + href, appRootUrl);
    // ส่ง cache version ไปกับลิงก์หน้า HTML ด้วย เพื่อให้การนำทางหลัง deploy
    // ไม่ดึง document รุ่นเก่าจาก browser/GitHub Pages cache
    if (shellVersion) target.searchParams.set("v", shellVersion);
    const classes = [extraClass, href === current ? "active" : ""].filter(Boolean).join(" ");
    const restricted = [...(mod.hrOnly || []), ...(mod.financeOnly || []), ...(mod.reportOnly || [])].includes(href)
      ? ' data-restricted="1" hidden'
      : "";
    return `<a href="${target.href}"${classes ? ` class="${classes}"` : ""}${restricted}>${label}</a>`;
  };

  const dashboardLink = `<a href="${dashboardUrl}" class="dashboard-link${current === "dashboard.html" ? " active" : ""}">ภาพรวม</a>`;
  // ฝ่ายที่มีหน้าภาพรวมของตัวเอง ให้ขึ้นถัดจากภาพรวมส่วนกลาง (ฝ่ายวิชาการไม่มี = ไม่แสดงอะไร)
  const moduleHomeLink = mod.moduleHome
    ? buildLink(mod.moduleHome[0], mod.moduleHome[1], "dashboard-link")
    : "";

  nav.innerHTML = dashboardLink + moduleHomeLink + mod.groups.map(group => {
    const isCurrent = group.items.some(([href]) => href === current);
    const links = group.items.map(([href, label]) => buildLink(href, label)).join("");
    return `<div class="nav-group${isCurrent ? " current" : ""}"><span class="nav-group-label">${group.label}</span><div class="nav-group-links">${links}</div></div>`;
  }).join("") + `<a href="#" id="btn-signout">ออกจากระบบ</a>`;

  // บนมือถือ/แท็บเล็ต เมนูเป็นแถบเลื่อนแนวนอน จึงเลื่อนปุ่มหน้าปัจจุบันให้เห็นเอง
  const active = nav.querySelector("a.active");
  if (active) requestAnimationFrame(() => active.scrollIntoView({ block: "nearest", inline: "nearest" }));

  // ให้หน้าเริ่มแสดงอย่างนุ่มนวล โดยข้ามทันทีหากผู้ใช้ตั้งค่าให้ลดการเคลื่อนไหว
  const preparePageReveal = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.body.classList.add("academic-motion");
    const revealItems = Array.from(document.querySelectorAll(".wrap > header, .academic-content > .card"));
    revealItems.forEach((element, index) => {
      element.classList.add("shell-reveal");
      element.style.setProperty("--shell-reveal-delay", `${Math.min(index * 55, 280)}ms`);
    });

    requestAnimationFrame(() => document.body.classList.add("academic-motion-ready"));

    // rollover.html และบางหน้าจะแสดง #main หลังตรวจสิทธิ์ จึงเริ่ม reveal หลังกล่องถูกเปิดจริง
    const deferredMain = document.querySelector("#main");
    if (!deferredMain) return;
    Array.from(deferredMain.querySelectorAll(":scope > .card")).forEach((element, index) => {
      element.style.setProperty("--shell-reveal-delay", `${Math.min(index * 55, 280)}ms`);
    });
    const revealMain = () => {
      if (deferredMain.classList.contains("shell-main-revealed") || getComputedStyle(deferredMain).display === "none") return;
      requestAnimationFrame(() => requestAnimationFrame(() => deferredMain.classList.add("shell-main-revealed")));
    };
    new MutationObserver(revealMain).observe(deferredMain, { attributes: true, attributeFilter: ["style", "class"] });
    revealMain();
  };

  // เติมบริบทการทำงานให้การ์ดแรกของแต่ละหน้า โดยไม่ยุ่งกับ form, id หรือ event เดิม
  const workflow = mod.workflows[current];

  // รวมเนื้อหาที่อยู่ถัดจาก header ไว้ในคอลัมน์เดียวกันทั้งหมด
  // เพื่อให้ sidebar desktop ไม่กำหนดความสูงของแถวแรกแล้วดันการ์ดใบถัดไปลงไปไกล
  const wrapAcademicContent = () => {
    const wrap = header && header.parentElement;
    if (!wrap || !wrap.classList.contains("wrap")) return;
    const existing = Array.from(wrap.children).find(element =>
      element.classList && element.classList.contains("academic-content")
    );
    if (existing) return;

    const movable = Array.from(wrap.children).filter(element =>
      element !== header && element.tagName !== "SCRIPT"
    );
    if (movable.length === 0) return;

    const content = document.createElement("div");
    content.className = "academic-content";
    wrap.insertBefore(content, movable[0]);
    movable.forEach(element => content.appendChild(element));
  };

  const decorateWorkspace = () => {
    // หน้าที่ไม่ได้นิยาม workflow ไว้ ก็ยังต้องได้ layout wrapper + reveal ตามปกติ
    if (!workflow) return;
    const primaryCard = document.querySelector(".wrap .card:not(.report-tabs)");
    if (!primaryCard || primaryCard.querySelector(".workspace-card-heading")) return;
    primaryCard.classList.add("workspace-primary-card");
    const steps = workflow.steps.map((label, index) =>
      '<span class="workspace-step' + (index === 0 ? " active" : "") + '"><b>' + (index + 1) + '</b>' + label + '</span>'
    ).join("");
    primaryCard.insertAdjacentHTML("afterbegin",
      '<div class="workspace-card-heading"><div><span class="workspace-eyebrow">WORKFLOW</span><h2>' +
      workflow.title + '</h2><p>' + workflow.description + '</p></div><div class="workspace-steps" aria-label="ลำดับการทำงาน">' +
      steps + '</div></div>'
    );
  };
  const initializeWorkspace = () => {
    wrapAcademicContent();
    decorateWorkspace();
    preparePageReveal();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWorkspace, { once: true });
  } else {
    initializeWorkspace();
  }

})();
