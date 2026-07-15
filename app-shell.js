/* เมนูกลางของหน้าที่ต้องล็อกอิน — แก้รายการเมนูเพียงไฟล์นี้ไฟล์เดียว */
(function () {
  const nav = document.querySelector("header .nav");
  if (!nav) return;

  const items = [
    ["entry.html", "กรอกคะแนน"],
    ["competency-manage.html", "กำหนดสมรรถนะ"],
    ["competency-entry.html", "ลงคะแนนสมรรถนะ"],
    ["attendance.html", "เช็คชื่อ"],
    ["summary.html", "สรุปคะแนน"],
    ["manage.html", "จัดการโครงสร้าง"],
    ["students.html", "นักเรียน"],
    ["retention.html", "เรียนซ้ำชั้น"],
    ["warning.html", "เฝ้าระวัง มส."],
    ["rollover.html", "ขึ้นปีใหม่"]
  ];
  const current = window.location.pathname.split("/").pop() || "entry.html";

  nav.innerHTML = items.map(([href, label]) =>
    `<a href="${href}"${href === current ? " class=\"active\"" : ""}>${label}</a>`
  ).join("") + '<a href="#" id="btn-signout">ออกจากระบบ</a>';

  // บนมือถือ/แท็บเล็ต เมนูเป็นแถบเลื่อนแนวนอน จึงเลื่อนปุ่มหน้าปัจจุบันให้เห็นเอง
  const active = nav.querySelector("a.active");
  if (active) requestAnimationFrame(() => active.scrollIntoView({ block: "nearest", inline: "nearest" }));
})();
