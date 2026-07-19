/* เมนูกลางของหน้าที่ต้องล็อกอิน — แก้รายการเมนูเพียงไฟล์นี้ไฟล์เดียว */
(function () {
  const nav = document.querySelector("header .nav");
  if (!nav) return;
  const header = nav.closest("header");
  if (header) header.classList.add("academic-header");
  nav.setAttribute("aria-label", "เมนูฝ่ายวิชาการ");

  // ไฟล์ shell อยู่รากเว็บเสมอ จึงใช้สร้าง URL ที่ถูกต้องจากทั้ง root และ academic/
  const appRootUrl = new URL("./", document.currentScript.src);
  const dashboardUrl = new URL("dashboard.html", appRootUrl).href;
  const groups = [
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
  ];
  const current = window.location.pathname.split("/").pop() || "entry.html";
  const dashboardLink = `<a href="${dashboardUrl}" class="dashboard-link${current === "dashboard.html" ? " active" : ""}">ภาพรวม</a>`;

  nav.innerHTML = dashboardLink + groups.map(group => {
    const isCurrent = group.items.some(([href]) => href === current);
    const links = group.items.map(([href, label]) => {
      const target = new URL("academic/" + href, appRootUrl).href;
      return `<a href="${target}"${href === current ? " class='active'" : ""}>${label}</a>`;
    }).join("");
    return `<div class="nav-group${isCurrent ? " current" : ""}"><span class="nav-group-label">${group.label}</span><div class="nav-group-links">${links}</div></div>`;
  }).join("") + `<a href="#" id="btn-signout">ออกจากระบบ</a>`;

  // บนมือถือ/แท็บเล็ต เมนูเป็นแถบเลื่อนแนวนอน จึงเลื่อนปุ่มหน้าปัจจุบันให้เห็นเอง
  const active = nav.querySelector("a.active");
  if (active) requestAnimationFrame(() => active.scrollIntoView({ block: "nearest", inline: "nearest" }));

  // ให้หน้าเริ่มแสดงอย่างนุ่มนวล โดยข้ามทันทีหากผู้ใช้ตั้งค่าให้ลดการเคลื่อนไหว
  const preparePageReveal = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.body.classList.add("academic-motion");
    const revealItems = Array.from(document.querySelectorAll(".wrap > header, .wrap > .card"));
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
  const workflows = {
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
  };
  const workflow = workflows[current];
  if (!workflow) return;

  const decorateWorkspace = () => {
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
    decorateWorkspace();
    preparePageReveal();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWorkspace, { once: true });
  } else {
    initializeWorkspace();
  }

})();
