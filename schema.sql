-- ============================================================
-- ระบบเก็บคะแนนหลักสูตรสมรรถนะ  (schema สำหรับ Supabase / PostgreSQL)
-- ------------------------------------------------------------
-- โครงสร้าง 4 ชั้น เหมือนกันทั้ง "คะแนนวิชา" และ "สมรรถนะหลัก 6 ด้าน"
--   วิชา -> หน่วยใหญ่ -> หน่วยย่อย -> ครั้งที่ -> คะแนนดิบของนักเรียน
-- เก็บแค่คะแนนดิบเท่านั้น การเทียบสัดส่วน (บัญญัติไตรยางศ์) คำนวณตอนแสดงผล
-- ============================================================

-- ลบของเก่าก่อน (ตอนทดสอบ รันซ้ำได้) เรียงจากตารางลูกไปแม่
drop table if exists scores cascade;
drop table if exists collections cascade;
drop table if exists indicators cascade;
drop table if exists units cascade;
drop table if exists students cascade;
drop table if exists subjects cascade;


-- ------------------------------------------------------------
-- 1) วิชา
-- ------------------------------------------------------------
create table subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,                 -- ชื่อวิชา เช่น วิทยาการคำนวณ
  level       text    not null,                 -- 'ประถม' หรือ 'มัธยม' ใช้เลือก label
  max_score   integer not null default 100,     -- เพดานคะแนนวิชา ครูกำหนด
  teacher     text,                             -- อีเมลหรือชื่อครูเจ้าของ
  year        text,                             -- ปีการศึกษา
  term        text,                             -- ภาคเรียน
  created_at  timestamptz default now(),

  constraint subjects_level_ok check (level in ('ประถม', 'มัธยม')),
  constraint subjects_max_ok   check (max_score > 0)
);


-- ------------------------------------------------------------
-- 2) หน่วยใหญ่  (มาตรฐาน / สมรรถนะเฉพาะ / ด้านของสมรรถนะหลัก)
-- ------------------------------------------------------------
create table units (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid    not null references subjects(id) on delete cascade,
  kind        text    not null,                 -- 'วิชา' หรือ 'สมรรถนะหลัก'
  name        text    not null,                 -- เช่น มาตรฐานที่ 1 / ด้านการจัดการตนเอง
  max_score   integer not null default 100,     -- เพดานหน่วยใหญ่ (สมรรถนะหลัก = 100 ตายตัว)
  seq         integer not null default 1,       -- ลำดับการแสดงผล
  created_at  timestamptz default now(),

  constraint units_kind_ok check (kind in ('วิชา', 'สมรรถนะหลัก')),
  constraint units_max_ok  check (max_score > 0)
);
create index units_subject_idx on units(subject_id);


-- ------------------------------------------------------------
-- 3) หน่วยย่อย  (ตัวชี้วัด / ผลลัพธ์ / องค์ประกอบ)
-- ------------------------------------------------------------
create table indicators (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid    not null references units(id) on delete cascade,
  name        text    not null,                 -- เช่น ตชว.ที่ 1 / องค์ประกอบที่ 1
  max_score   integer not null default 25,      -- เพดานหน่วยย่อย ครูกำหนด
  seq         integer not null default 1,
  created_at  timestamptz default now(),

  constraint indicators_max_ok check (max_score > 0)
);
create index indicators_unit_idx on indicators(unit_id);


-- ------------------------------------------------------------
-- 4) ครั้งที่  (ชั้นล่างสุดที่ครูกรอกคะแนนจริง)
-- ------------------------------------------------------------
create table collections (
  id            uuid primary key default gen_random_uuid(),
  indicator_id  uuid    not null references indicators(id) on delete cascade,
  seq           integer not null default 1,     -- ครั้งที่ 1, 2, 3 ...
  max_score     integer not null default 10,    -- คะแนนเต็มของครั้งนี้ ครูกำหนด
  created_at    timestamptz default now(),

  constraint collections_max_ok check (max_score > 0)
);
create index collections_indicator_idx on collections(indicator_id);


-- ------------------------------------------------------------
-- 5) นักเรียน
-- ------------------------------------------------------------
create table students (
  id          uuid primary key default gen_random_uuid(),
  student_no  text    not null,                 -- เลขประจำตัว (เก็บเป็น text กัน 0 นำหน้าหาย)
  name        text    not null,                 -- ชื่อ-สกุล
  classroom   text,                             -- ห้อง เช่น ม.1/1
  created_at  timestamptz default now()
);
create index students_classroom_idx on students(classroom);


-- ------------------------------------------------------------
-- 6) คะแนนดิบ  (นักเรียน x ครั้งที่ -> คะแนนที่ได้)
-- ------------------------------------------------------------
create table scores (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid    not null references students(id) on delete cascade,
  collection_id  uuid    not null references collections(id) on delete cascade,
  raw_score      numeric not null default 0,     -- คะแนนดิบที่ครูกรอก
  updated_at     timestamptz default now(),

  -- นักเรียน 1 คน มีคะแนนได้ครั้งละ 1 ค่า ต่อ 1 collection (ใช้กับ upsert ตอนบันทึก)
  constraint scores_unique unique (student_id, collection_id),
  constraint scores_nonneg check (raw_score >= 0)
);
create index scores_student_idx    on scores(student_id);
create index scores_collection_idx on scores(collection_id);


-- ============================================================
-- ข้อมูลตัวอย่าง (seed) — วิชาเดียว ไว้ทดสอบหน้ากรอก
--   วิทยาการคำนวณ ม.1  เพดาน 100
--     มาตรฐานที่ 1 (เพดาน 100)
--        ตชว.1 (25) -> ครั้งที่ 1 (10), ครั้งที่ 2 (15)
--        ตชว.2 (25) -> ครั้งที่ 1 (25)
--     มาตรฐานที่ 2 (เพดาน 100)
--        ตชว.1 (50) -> ครั้งที่ 1 (20), ครั้งที่ 2 (30)
--   นักเรียน 4 คน
-- (คะแนนดิบยังไม่ใส่ ให้กรอกผ่านหน้าเว็บ)
-- ============================================================

-- สร้างวิชา แล้วเก็บ id ไว้ผูกกับหน่วยใหญ่ต่อ
do $$
declare
  v_subject uuid;
  v_std1 uuid; v_std2 uuid;
  v_ind uuid;
begin
  insert into subjects (name, level, max_score, teacher, year, term)
  values ('วิทยาการคำนวณ', 'มัธยม', 100, 'teacher@crs.ac.th', '2568', '1')
  returning id into v_subject;

  -- มาตรฐานที่ 1
  insert into units (subject_id, kind, name, max_score, seq)
  values (v_subject, 'วิชา', 'มาตรฐานที่ 1', 100, 1)
  returning id into v_std1;

  insert into indicators (unit_id, name, max_score, seq)
  values (v_std1, 'ตัวชี้วัดที่ 1', 25, 1) returning id into v_ind;
  insert into collections (indicator_id, seq, max_score) values (v_ind, 1, 10), (v_ind, 2, 15);

  insert into indicators (unit_id, name, max_score, seq)
  values (v_std1, 'ตัวชี้วัดที่ 2', 25, 2) returning id into v_ind;
  insert into collections (indicator_id, seq, max_score) values (v_ind, 1, 25);

  -- มาตรฐานที่ 2
  insert into units (subject_id, kind, name, max_score, seq)
  values (v_subject, 'วิชา', 'มาตรฐานที่ 2', 100, 2)
  returning id into v_std2;

  insert into indicators (unit_id, name, max_score, seq)
  values (v_std2, 'ตัวชี้วัดที่ 1', 50, 1) returning id into v_ind;
  insert into collections (indicator_id, seq, max_score) values (v_ind, 1, 20), (v_ind, 2, 30);

  -- นักเรียน
  insert into students (student_no, name, classroom) values
    ('0001', 'ด.ช. เล็ก เด่นดี',   'ม.1/1'),
    ('0002', 'ด.ญ. กานต์ ใจงาม',   'ม.1/1'),
    ('0003', 'ด.ช. ธน ตั้งมั่น',    'ม.1/1'),
    ('0004', 'ด.ญ. พร ศรีสุข',      'ม.1/1');
end $$;


-- ============================================================
-- หมายเหตุความปลอดภัย (อ่านก่อนใช้จริง)
-- ------------------------------------------------------------
-- ช่วงทดสอบ: ปิด RLS เพื่อให้ anon key อ่าน/เขียนได้เลย จะได้ทดสอบไว
-- ก่อนเปิดใช้จริงกับครูหลายคน ต้องเปิด RLS + ต่อระบบ login ก่อน
-- ไม่งั้นใครมี URL ก็แก้คะแนนได้
-- ============================================================
alter table subjects   disable row level security;
alter table units      disable row level security;
alter table indicators disable row level security;
alter table collections disable row level security;
alter table students   disable row level security;
alter table scores     disable row level security;


-- ============================================================
-- ส่วนเช็คชื่อ + ผลการเรียน (ร. / มส.)
-- ------------------------------------------------------------
-- ต่อท้ายของเดิม ไม่รื้อ 6 ตารางด้านบน — สคริปต์นี้รันซ้ำได้เอง (idempotent)
-- ใช้ตอน migrate ฐานข้อมูลที่สร้างไปแล้วบน Supabase (ห้ามรันทั้งไฟล์ซ้ำ
-- เพราะ drop table ด้านบนสุดจะลบข้อมูลที่กรอกไว้แล้วทั้งหมด)
-- ============================================================

-- จำนวนคาบเรียนทั้งหมดทั้งเทอมของวิชา ใช้เป็นตัวหารคำนวณ % เวลาเรียนสำหรับเช็ค มส.
-- ปล่อยให้เป็นค่าว่างได้ (nullable) เพราะวิชาที่มีอยู่แล้วยังไม่เคยกรอกค่านี้
alter table subjects
  add column if not exists total_periods integer;

alter table subjects
  drop constraint if exists subjects_total_periods_ok;
alter table subjects
  add constraint subjects_total_periods_ok check (total_periods is null or total_periods > 0);


-- ------------------------------------------------------------
-- 7) ครั้งที่เช็คชื่อ
-- ------------------------------------------------------------
create table if not exists attendance_sessions (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid    not null references subjects(id) on delete cascade,
  session_date    date    not null,                 -- วันที่เช็คชื่อ
  periods_covered integer not null,                 -- จำนวนคาบที่ครั้งนี้ครอบคลุม ครูกำหนดเองทุกครั้ง ไม่ fix
  created_at      timestamptz default now(),

  constraint attendance_sessions_periods_ok check (periods_covered > 0)
);
create index if not exists attendance_sessions_subject_idx on attendance_sessions(subject_id);


-- ------------------------------------------------------------
-- 8) ผลเช็คชื่อต่อคนต่อครั้ง
-- ------------------------------------------------------------
create table if not exists attendance_records (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid    not null references attendance_sessions(id) on delete cascade,
  student_id  uuid    not null references students(id) on delete cascade,
  status      text    not null default 'มา',        -- มา / ขาด / ลาป่วย / ลากิจ / มาสาย
  created_at  timestamptz default now(),

  constraint attendance_records_status_ok check (status in ('มา', 'ขาด', 'ลาป่วย', 'ลากิจ', 'มาสาย')),
  -- นักเรียน 1 คน มีผลเช็คชื่อได้ค่าเดียวต่อ 1 ครั้งที่เช็ค (ใช้กับ upsert ตอนบันทึก)
  constraint attendance_records_unique unique (session_id, student_id)
);
create index if not exists attendance_records_session_idx on attendance_records(session_id);
create index if not exists attendance_records_student_idx on attendance_records(student_id);


-- ------------------------------------------------------------
-- 9) สถานะพิเศษที่ครูติดเอง (ตอนนี้ใช้แค่ ร. — เผื่อขยายเป็น "ผ่อนผัน" ทีหลัง)
-- ------------------------------------------------------------
create table if not exists remarks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid    not null references students(id) on delete cascade,
  subject_id  uuid    not null references subjects(id) on delete cascade,
  code        text    not null,                     -- ตอนนี้ใช้แค่ 'ร.'
  reason      text    not null,                      -- ครูต้องระบุเหตุผลเสมอ บังคับกรอก
  created_at  timestamptz default now(),

  constraint remarks_code_ok check (code in ('ร.')),
  -- กันติด ร. ซ้ำหลายแถวในวิชาเดียวกันของนักเรียนคนเดียวกัน
  constraint remarks_unique unique (student_id, subject_id, code)
);
create index if not exists remarks_student_idx on remarks(student_id);
create index if not exists remarks_subject_idx on remarks(subject_id);


-- ปิด RLS เหมือนตารางอื่น (ช่วงทดสอบ) — เปิดพร้อม auth ตอนใช้จริง
alter table attendance_sessions disable row level security;
alter table attendance_records  disable row level security;
alter table remarks             disable row level security;


-- ============================================================
-- ข้อมูลตัวอย่าง (seed) — สมรรถนะหลัก 6 ด้าน ผูกกับวิชาตัวอย่างเดิม
-- ------------------------------------------------------------
-- ชื่อ 6 ด้าน อ้างอิงจากไฟล์ "ตัวอย่างแบบเก็บคะแนน.xlsx" ชีต "สมรรถนะหลัก"
-- (แก้คำว่า "วิทยากร" เป็น "วิทยาการ" ในด้านที่ 6 ตามที่ยืนยันกับผู้ใช้แล้ว
-- เพราะต้นฉบับพิมพ์ผิด) max_score = 100 ตายตัวตามกติกาสมรรถนะหลัก (ดู CLAUDE.md)
-- เช็คก่อนว่าวิชานี้เคยมีหน่วย "สมรรถนะหลัก" แล้วหรือยัง มีแล้วจะไม่สร้างซ้ำ (idempotent)
-- ============================================================
do $$
declare
  v_subject uuid;
  v_unit    uuid;
  v_ind     uuid;
  v_name    text;
  v_seq     integer := 1;
  v_names   text[] := array[
    'ด้านการจัดการตนเอง',
    'ด้านการคิดขั้นสูง',
    'ด้านการสื่อสาร',
    'ด้านการรวมพลังทำงานเป็นทีม',
    'ด้านการพลเมืองที่เข้มแข็ง',
    'ด้านการอยู่ร่วมกับธรรมชาติและวิทยาการอย่างยั่งยืน'
  ];
begin
  select id into v_subject from subjects where name = 'วิทยาการคำนวณ' limit 1;
  if v_subject is null then
    return; -- ไม่มีวิชาตัวอย่างนี้แล้ว ข้ามไปเฉยๆ ไม่ต้อง error
  end if;

  if exists (select 1 from units where subject_id = v_subject and kind = 'สมรรถนะหลัก') then
    return; -- เคยสร้างไว้แล้ว ไม่ต้องสร้างซ้ำ
  end if;

  foreach v_name in array v_names loop
    insert into units (subject_id, kind, name, max_score, seq)
    values (v_subject, 'สมรรถนะหลัก', v_name, 100, v_seq)
    returning id into v_unit;

    insert into indicators (unit_id, name, max_score, seq)
    values (v_unit, 'องค์ประกอบที่ 1', 50, 1) returning id into v_ind;
    insert into collections (indicator_id, seq, max_score) values (v_ind, 1, 50);

    insert into indicators (unit_id, name, max_score, seq)
    values (v_unit, 'องค์ประกอบที่ 2', 50, 2) returning id into v_ind;
    insert into collections (indicator_id, seq, max_score) values (v_ind, 1, 50);

    v_seq := v_seq + 1;
  end loop;
end $$;
