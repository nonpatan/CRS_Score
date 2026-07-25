/* เมนูกลางของหน้าที่ต้องล็อกอิน — แก้รายการเมนูเพียงไฟล์นี้ไฟล์เดียว
   รองรับหลายฝ่าย: ดูว่าหน้าปัจจุบันอยู่ในโฟลเดอร์ไหน แล้วเลือกชุดเมนูของฝ่ายนั้น
   (โฟลเดอร์ที่ไม่รู้จักจะถือเป็นฝ่ายวิชาการ เพื่อคงพฤติกรรมเดิมของหน้าเก่าทุกหน้า) */
(function () {
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
            ["competency-entry.html", "ลงคะแนนสมรรถนะ"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["manage.html", "จัดการโครงสร้าง"],
            ["competency-manage.html", "กำหนดสมรรถนะ"],
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
        }
      ],
      workflows: {
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
          title: "กำหนดกิจกรรมและสมรรถนะ",
          description: "เลือกปีการศึกษา แล้วสร้างหรือแก้ไขรายการประเมิน",
          steps: ["เลือกปี", "กำหนดรายการ", "เพิ่มผู้เรียน"]
        },
        "competency-entry.html": {
          title: "เลือกครั้งประเมิน",
          description: "กำหนดกิจกรรมและครั้งที่ต้องการ ก่อนบันทึกคะแนนสมรรถนะ",
          steps: ["เลือกกิจกรรม", "เลือกครั้ง", "กรอกคะแนน"]
        }
      }
    },

    personnel: {
      label: "ฝ่ายบุคคล",
      kicker: "บุคคล",
      home: "index.html",
      moduleHome: ["index.html", "ภาพรวมบุคลากร"],
      // หน้าที่เป็นงานของฝ่ายบุคคลโดยเฉพาะ — ครูทั่วไปเห็นได้แค่ "ข้อมูลการทำงานของฉัน"
      // ซ่อนไว้ก่อนเสมอ (fail-closed) แล้วให้หน้าเว็บเรียก applyPersonnelMenuAccess() เปิดให้
      // ถ้าลืมเรียก คนมีสิทธิ์จะเห็นเมนูไม่ครบ (สังเกตได้ทันที) ดีกว่าเผลอเปิดให้คนไม่มีสิทธิ์
      hrOnly: ["index.html", "leave.html", "staff.html", "hr-settings.html", "work-summary.html"],
      groups: [
        {
          label: "บันทึก",
          items: [
            ["leave.html", "บันทึกการลา"]
          ]
        },
        {
          label: "กำหนดค่า",
          items: [
            ["staff.html", "ทะเบียนบุคลากร"],
            ["hr-settings.html", "ตั้งค่างานบุคคล"]
          ]
        },
        {
          label: "รายงาน",
          items: [
            ["work-summary.html", "สรุปเวลาทำงาน"],
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
    const restricted = (mod.hrOnly || []).includes(href) ? ' data-restricted="1" hidden' : "";
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
