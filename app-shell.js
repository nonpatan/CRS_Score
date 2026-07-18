/* เมนูกลางของหน้าที่ต้องล็อกอิน — แก้รายการเมนูเพียงไฟล์นี้ไฟล์เดียว */
(function () {
  const nav = document.querySelector("header .nav");
  if (!nav) return;

  // ไฟล์ shell อยู่รากเว็บเสมอ จึงใช้สร้าง URL ที่ถูกต้องจากทั้ง root และ academic/
  const appRootUrl = new URL("./", document.currentScript.src);
  const dashboardUrl = new URL("dashboard.html", appRootUrl).href;
  const groups = [
    {
      label: "ลงคะแนน",
      items: [
        ["entry.html", "กรอกคะแนน"],
        ["competency-entry.html", "ลงคะแนนสมรรถนะ"],
        ["attendance.html", "เช็คชื่อ"]
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

})();
