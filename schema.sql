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
  teacher     text,                             -- legacy: เลิกใช้แล้ว (ใช้ owner_id + profiles แทน)
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
  insert into subjects (name, level, max_score, year, term)
  values ('วิทยาการคำนวณ', 'มัธยม', 100, '2568', '1')
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

-- จำนวนคาบเรียนทั้งหมดตามรอบของวิชา: ประถม = ทั้งปี (term เป็น null),
-- มัธยม = ทั้งภาคเรียน (term เป็น 1/2) ใช้เป็นฐานคำนวณเกณฑ์เวลาเรียนสำหรับเช็ค มส.
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


-- ============================================================
-- ส่วนวิชาพื้นฐาน / วิชาบูรณาการ + ข้อมูลวิชาเพิ่มเติม (รหัสวิชา/หน่วยกิต/ชั้น)
-- ------------------------------------------------------------
-- ต่อท้ายของเดิม ไม่รื้อของเดิม — รันซ้ำได้เอง (idempotent)
-- ============================================================

-- รหัสวิชา — ทุกวิชาควรมี แต่ปล่อย nullable ตอน migrate เพราะวิชาเก่ายังไม่เคยกรอก
-- (ฝั่งหน้าเว็บ manage.html บังคับกรอกก่อนบันทึกสำหรับวิชาที่สร้าง/แก้ไขใหม่)
alter table subjects add column if not exists code text;

-- หน่วยกิต — ใช้เฉพาะวิชาระดับมัธยม (ประถมไม่มีหน่วยกิตแบบมัธยม) nullable เสมอ
alter table subjects add column if not exists credits numeric;
alter table subjects drop constraint if exists subjects_credits_ok;
alter table subjects add constraint subjects_credits_ok check (credits is null or credits > 0);

-- ชั้นเรียน เช่น 'ป.1'..'ป.6' หรือ 'ม.1'..'ม.6' — ต้องระบุทั้งประถมและมัธยม
-- (nullable ตอน migrate เพราะวิชาเก่ายังไม่เคยกรอก บังคับกรอกฝั่งหน้าเว็บแทน)
alter table subjects add column if not exists grade_level text;

-- ประเภทวิชา: 'พื้นฐาน' = วิชาเดี่ยวกรอกคะแนนตรง, 'บูรณาการ' = วิชารวมหลายวิชาพื้นฐาน
-- (ไม่มีหน่วยใหญ่/สมรรถนะหลักเป็นของตัวเอง คำนวณจากวิชาพื้นฐานสมาชิกแทน)
alter table subjects add column if not exists subject_type text not null default 'พื้นฐาน';
alter table subjects drop constraint if exists subjects_type_ok;
alter table subjects add constraint subjects_type_ok check (subject_type in ('พื้นฐาน', 'บูรณาการ'));


-- ------------------------------------------------------------
-- 10) สมาชิกวิชาบูรณาการ (วิชาพื้นฐานที่ประกอบกันเป็นวิชาบูรณาการ 1 ตัว)
-- ------------------------------------------------------------
-- กรอกคะแนนแยกที่วิชาพื้นฐาน (member_subject_id) ตามปกติ ไม่กรอกที่วิชาบูรณาการตรงๆ
-- หน้าสรุปจะรวมคะแนนวิชาพื้นฐานเข้าวิชาบูรณาการ ถ่วงน้ำหนักด้วย subjects.total_periods
-- ของวิชาพื้นฐานแต่ละตัว (ยืนยันกับผู้ใช้แล้วว่าใช้เวลาเรียนเป็นน้ำหนัก ไม่ใช่หน่วยกิต)
create table if not exists integration_members (
  id                    uuid primary key default gen_random_uuid(),
  integrated_subject_id uuid not null references subjects(id) on delete cascade,
  member_subject_id     uuid not null references subjects(id) on delete cascade,
  created_at            timestamptz default now(),

  constraint integration_members_unique unique (integrated_subject_id, member_subject_id),
  constraint integration_members_no_self check (integrated_subject_id <> member_subject_id)
);
create index if not exists integration_members_integrated_idx on integration_members(integrated_subject_id);
create index if not exists integration_members_member_idx on integration_members(member_subject_id);

alter table integration_members disable row level security;


-- ============================================================
-- ส่วน Auth + RLS  —  เฟส 1: โครงสร้าง (ปลอดภัย รันได้เลย ไม่กระทบเว็บที่ใช้อยู่)
-- ------------------------------------------------------------
-- เฟสนี้แค่เพิ่มตาราง/ฟังก์ชัน/นโยบายไว้เฉยๆ ยังไม่เปิด RLS จริง (ตารางทุกตัว
-- ยัง disable row level security เหมือนเดิม) เว็บปัจจุบันจะยังทำงานปกติทุกอย่าง
-- ห้ามรันเฟส 2 (ท้ายไฟล์) จนกว่าจะทดสอบหน้า login.html ในเครื่องผ่านหมดแล้ว
-- ============================================================

-- ------------------------------------------------------------
-- 11) โปรไฟล์ผู้ใช้ (ผูกกับ auth.users ของ Supabase) — เก็บ role
-- ------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'teacher',
  created_at  timestamptz default now(),

  constraint profiles_role_ok check (role in ('admin', 'teacher'))
);

-- สร้างโปรไฟล์อัตโนมัติ (role='teacher' เป็นค่าเริ่มต้นเสมอ) ทุกครั้งที่ Admin เพิ่มบัญชี
-- ใหม่ผ่าน Supabase Dashboard (Authentication > Add user) — เลื่อน role เป็น 'admin' เอง
-- ทีหลังผ่าน SQL Editor: update profiles set role='admin' where email='...'
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'teacher')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- เจ้าของวิชา (ครูที่สร้าง/รับผิดชอบวิชานั้น) — nullable เพราะวิชาเก่ายังไม่มีเจ้าของ
-- (แก้ไขได้เฉพาะ admin จนกว่าจะมีคนตั้งเจ้าของให้ผ่าน manage.html)
alter table subjects add column if not exists owner_id uuid references auth.users(id);

-- ------------------------------------------------------------
-- ฟังก์ชันช่วยเช็คสิทธิ์ (security definer เพื่อไม่ให้ชนกับ RLS ของตารางที่มันอ่านเอง)
-- ------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function can_edit_subject(p_subject_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_admin() or exists (
    select 1 from subjects where id = p_subject_id and owner_id = auth.uid()
  );
$$;

create or replace function can_edit_unit(p_unit_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from units u where u.id = p_unit_id and can_edit_subject(u.subject_id)
  );
$$;

create or replace function can_edit_indicator(p_indicator_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from indicators i join units u on u.id = i.unit_id
    where i.id = p_indicator_id and can_edit_subject(u.subject_id)
  );
$$;

create or replace function can_edit_collection(p_collection_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from collections c
    join indicators i on i.id = c.indicator_id
    join units u on u.id = i.unit_id
    where c.id = p_collection_id and can_edit_subject(u.subject_id)
  );
$$;

create or replace function can_edit_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from attendance_sessions s where s.id = p_session_id and can_edit_subject(s.subject_id)
  );
$$;

-- ------------------------------------------------------------
-- นโยบาย RLS ของทุกตาราง (สร้างไว้ล่วงหน้า แต่ยังไม่มีผลจนกว่าจะ enable row level
-- security ในเฟส 2 ท้ายไฟล์) — กติกา: authenticated อ่านได้หมด, แก้ไข/ลบ/เพิ่ม
-- ได้เฉพาะ admin หรือเจ้าของวิชานั้น (owner_id) ยกเว้น students ที่ admin เท่านั้น
-- ------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (auth.role() = 'authenticated');
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (is_admin()) with check (is_admin());

drop policy if exists subjects_select on subjects;
create policy subjects_select on subjects for select using (auth.role() = 'authenticated');
drop policy if exists subjects_insert on subjects;
create policy subjects_insert on subjects for insert with check (is_admin());
drop policy if exists subjects_update on subjects;
create policy subjects_update on subjects for update using (is_admin() or owner_id = auth.uid()) with check (is_admin() or owner_id = auth.uid());
drop policy if exists subjects_delete on subjects;
create policy subjects_delete on subjects for delete using (is_admin());

drop policy if exists units_select on units;
create policy units_select on units for select using (auth.role() = 'authenticated');
drop policy if exists units_insert on units;
create policy units_insert on units for insert with check (can_edit_subject(subject_id));
drop policy if exists units_update on units;
create policy units_update on units for update using (can_edit_subject(subject_id)) with check (can_edit_subject(subject_id));
drop policy if exists units_delete on units;
create policy units_delete on units for delete using (can_edit_subject(subject_id));

drop policy if exists indicators_select on indicators;
create policy indicators_select on indicators for select using (auth.role() = 'authenticated');
drop policy if exists indicators_insert on indicators;
create policy indicators_insert on indicators for insert with check (can_edit_unit(unit_id));
drop policy if exists indicators_update on indicators;
create policy indicators_update on indicators for update using (can_edit_unit(unit_id)) with check (can_edit_unit(unit_id));
drop policy if exists indicators_delete on indicators;
create policy indicators_delete on indicators for delete using (can_edit_unit(unit_id));

drop policy if exists collections_select on collections;
create policy collections_select on collections for select using (auth.role() = 'authenticated');
drop policy if exists collections_insert on collections;
create policy collections_insert on collections for insert with check (can_edit_indicator(indicator_id));
drop policy if exists collections_update on collections;
create policy collections_update on collections for update using (can_edit_indicator(indicator_id)) with check (can_edit_indicator(indicator_id));
drop policy if exists collections_delete on collections;
create policy collections_delete on collections for delete using (can_edit_indicator(indicator_id));

drop policy if exists scores_select on scores;
create policy scores_select on scores for select using (auth.role() = 'authenticated');
drop policy if exists scores_insert on scores;
create policy scores_insert on scores for insert with check (can_edit_collection(collection_id));
drop policy if exists scores_update on scores;
create policy scores_update on scores for update using (can_edit_collection(collection_id)) with check (can_edit_collection(collection_id));
drop policy if exists scores_delete on scores;
create policy scores_delete on scores for delete using (can_edit_collection(collection_id));

drop policy if exists attendance_sessions_select on attendance_sessions;
create policy attendance_sessions_select on attendance_sessions for select using (auth.role() = 'authenticated');
drop policy if exists attendance_sessions_insert on attendance_sessions;
create policy attendance_sessions_insert on attendance_sessions for insert with check (can_edit_subject(subject_id));
drop policy if exists attendance_sessions_update on attendance_sessions;
create policy attendance_sessions_update on attendance_sessions for update using (can_edit_subject(subject_id)) with check (can_edit_subject(subject_id));
drop policy if exists attendance_sessions_delete on attendance_sessions;
create policy attendance_sessions_delete on attendance_sessions for delete using (can_edit_subject(subject_id));

drop policy if exists attendance_records_select on attendance_records;
create policy attendance_records_select on attendance_records for select using (auth.role() = 'authenticated');
drop policy if exists attendance_records_insert on attendance_records;
create policy attendance_records_insert on attendance_records for insert with check (can_edit_session(session_id));
drop policy if exists attendance_records_update on attendance_records;
create policy attendance_records_update on attendance_records for update using (can_edit_session(session_id)) with check (can_edit_session(session_id));
drop policy if exists attendance_records_delete on attendance_records;
create policy attendance_records_delete on attendance_records for delete using (can_edit_session(session_id));

drop policy if exists remarks_select on remarks;
create policy remarks_select on remarks for select using (auth.role() = 'authenticated');
drop policy if exists remarks_insert on remarks;
create policy remarks_insert on remarks for insert with check (can_edit_subject(subject_id));
drop policy if exists remarks_update on remarks;
create policy remarks_update on remarks for update using (can_edit_subject(subject_id)) with check (can_edit_subject(subject_id));
drop policy if exists remarks_delete on remarks;
create policy remarks_delete on remarks for delete using (can_edit_subject(subject_id));

drop policy if exists integration_members_select on integration_members;
create policy integration_members_select on integration_members for select using (auth.role() = 'authenticated');
drop policy if exists integration_members_insert on integration_members;
create policy integration_members_insert on integration_members for insert with check (can_edit_subject(integrated_subject_id));
drop policy if exists integration_members_delete on integration_members;
create policy integration_members_delete on integration_members for delete using (can_edit_subject(integrated_subject_id));

-- นักเรียน: ยังไม่มีหน้าจัดการนักเรียน (ดู CLAUDE.md) เลยให้แก้ได้เฉพาะ admin ไปก่อน
-- อ่านได้ทุกคนที่ล็อกอินแล้ว (ทุกวิชาใช้รายชื่อร่วมกัน)
drop policy if exists students_select on students;
create policy students_select on students for select using (auth.role() = 'authenticated');
drop policy if exists students_write on students;
create policy students_write on students for all using (is_admin()) with check (is_admin());


-- ============================================================
-- ส่วน Auth + RLS  —  เฟส 2: เปิดใช้งานจริง (⚠️ ห้ามรันจนกว่าจะพร้อม)
-- ------------------------------------------------------------
-- รันบล็อกนี้แล้ว เว็บทุกหน้าจะ "ต้องล็อกอินก่อนถึงจะใช้ได้ทันที" (อ่าน/เขียนทั้งหมด
-- ต้องผ่าน auth) ห้ามรันจนกว่าจะเช็คครบทุกข้อนี้ก่อน:
--   1. login.html + สคริปต์เช็คล็อกอินกลาง (auth-guard.js) ขึ้น GitHub Pages แล้ว
--   2. สร้างบัญชี Admin ตัวเองผ่าน Supabase Dashboard (Authentication > Add user)
--      แล้วทดสอบล็อกอินที่ login.html ผ่านจริงอย่างน้อย 1 รอบ
--   3. รัน SQL ตั้ง role ตัวเองเป็น admin แล้ว:
--        update profiles set role = 'admin' where email = 'อีเมลที่ใช้สมัคร';
-- ถ้ารันบล็อกนี้ไปแล้วเว็บพัง ให้รัน "alter table X disable row level security;"
-- ทีละตาราง (รายชื่อตารางอยู่ท้ายสุดของไฟล์นี้) เพื่อปิด RLS กลับเป็นเหมือนเดิมชั่วคราว
-- ============================================================
alter table profiles              enable row level security;
alter table subjects              enable row level security;
alter table units                 enable row level security;
alter table indicators            enable row level security;
alter table collections           enable row level security;
alter table scores                enable row level security;
alter table students              enable row level security;
alter table attendance_sessions   enable row level security;
alter table attendance_records    enable row level security;
alter table remarks               enable row level security;
alter table integration_members   enable row level security;

-- ทางฉุกเฉิน (rollback): copy 11 บรรทัดนี้ไปรันแทน ถ้าต้องปิด RLS กลับเป็นเดิมทั้งหมด
-- alter table profiles              disable row level security;
-- alter table subjects              disable row level security;
-- alter table units                 disable row level security;
-- alter table indicators            disable row level security;
-- alter table collections           disable row level security;
-- alter table scores                disable row level security;
-- alter table students              disable row level security;
-- alter table attendance_sessions   disable row level security;
-- alter table attendance_records    disable row level security;
-- alter table remarks               disable row level security;
-- alter table integration_members   disable row level security;


-- ============================================================
-- ส่วนจัดการนักเรียน + ผูกนักเรียนกับวิชา — รันได้เลยตอนนี้ (RLS เปิดอยู่แล้ว
-- เพิ่มตาราง/policy ใหม่ครบในบล็อกเดียว ไม่กระทบตารางเดิมที่ใช้งานอยู่)
-- ------------------------------------------------------------
-- ตอนนี้ index.html/attendance.html/summary.html จะดึง "รายชื่อนักเรียนที่ลงทะเบียนในวิชานั้น"
-- (ผ่าน enrollments) แทน "นักเรียนทั้งหมด" เหมือนเดิม — วิชาไหนยังไม่มีใครลงทะเบียน จะไม่เห็น
-- รายชื่อเลยจนกว่าจะไปเพิ่มที่ manage.html (ดู CLAUDE.md วิธีเพิ่ม)
-- ============================================================

-- ชั้นปีของนักเรียน (เช่น 'ม.3') ใช้คู่กับ classroom ตอน bulk-add ทั้งห้องเข้าวิชา
alter table students add column if not exists grade_level text;

-- ------------------------------------------------------------
-- 12) การลงทะเบียนนักเรียนต่อวิชา (many-to-many)
-- ------------------------------------------------------------
-- ค่าเริ่มต้นมาจากปุ่ม "เพิ่มทั้งห้อง" ใน manage.html (bulk insert ตาม grade_level+classroom
-- ที่ตรงกัน) แต่เพิ่ม/ลบทีละคนได้อิสระ — รองรับเคสนักเรียนซ้ำชั้น/มส. ที่ต้องเรียนร่วมห้องอื่น
create table if not exists enrollments (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references subjects(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  created_at  timestamptz default now(),

  constraint enrollments_unique unique (subject_id, student_id)
);
create index if not exists enrollments_subject_idx on enrollments(subject_id);
create index if not exists enrollments_student_idx on enrollments(student_id);

alter table enrollments enable row level security;
drop policy if exists enrollments_select on enrollments;
create policy enrollments_select on enrollments for select using (auth.role() = 'authenticated');
drop policy if exists enrollments_insert on enrollments;
create policy enrollments_insert on enrollments for insert with check (can_edit_subject(subject_id));
drop policy if exists enrollments_delete on enrollments;
create policy enrollments_delete on enrollments for delete using (can_edit_subject(subject_id));


-- ============================================================
-- ส่วนชั่วโมงชดเชย (ใช้ "เติมตัวเลขให้ถึงเกณฑ์" แทนการข้ามเช็ค มส. ทั้งหมด)
-- ------------------------------------------------------------
-- ยืนยันกับผู้ใช้แล้ว: ไม่ใช่ "ผ่อนผัน" แบบข้ามกฎ แต่ให้นักเรียนชดเชยเวลาเรียนที่ขาด
-- (ทำงาน/เรียนเสริม ฯลฯ) แล้วครูบันทึกจำนวนคาบที่ชดเชยได้ตรงนี้ ระบบจะบวกเข้าไปใน
-- attended_periods ตอนคำนวณ % เข้าเรียนสำหรับเช็ค มส. — ครูเจ้าของวิชานั้นเพิ่มเองได้เลย
-- ไม่ต้องรอ admin อนุมัติ (ยืนยันแล้ว)
-- ------------------------------------------------------------
-- 13) ชั่วโมงชดเชยของนักเรียนต่อวิชา
-- ------------------------------------------------------------
create table if not exists makeup_hours (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  periods     numeric not null,          -- จำนวนคาบที่ชดเชยได้ (บวกเข้า attended_periods ตรงๆ)
  reason      text not null,             -- รายละเอียด/เหตุผล บังคับกรอกเสมอ
  created_at  timestamptz default now(),

  constraint makeup_hours_periods_ok check (periods > 0)
);
create index if not exists makeup_hours_student_idx on makeup_hours(student_id);
create index if not exists makeup_hours_subject_idx on makeup_hours(subject_id);

alter table makeup_hours enable row level security;
drop policy if exists makeup_hours_select on makeup_hours;
create policy makeup_hours_select on makeup_hours for select using (auth.role() = 'authenticated');
drop policy if exists makeup_hours_insert on makeup_hours;
create policy makeup_hours_insert on makeup_hours for insert with check (can_edit_subject(subject_id));
drop policy if exists makeup_hours_delete on makeup_hours;
create policy makeup_hours_delete on makeup_hours for delete using (can_edit_subject(subject_id));


-- ============================================================
-- ส่วนขึ้นปีการศึกษาใหม่ / เลื่อนชั้น (rollover.html) — รันได้เลย (เพิ่มใหม่ ไม่กระทบของเดิม)
-- ------------------------------------------------------------
-- ธงจบการศึกษา + ค่าตั้งค่าส่วนกลาง (ชั้นสูงสุดที่เปิดสอน) ตรรกะเลื่อนชั้นอยู่ฝั่ง JS (rollover.html)
-- ============================================================

-- 14) ธงจบการศึกษาของนักเรียน — เด็กที่จบ (ชั้นสูงสุด) ตอนเลื่อนชั้นจะถูกตั้ง true แยกออกจากรายชื่อ
--     active (ไม่ลบ ประวัติคะแนน/เช็คชื่อยังอยู่ครบผ่าน enrollments ของวิชาปีเก่า)
alter table students add column if not exists graduated boolean not null default false;

-- 14.1) ธงย้ายออก/เลิกเรียน — เด็กที่ไม่ได้เรียนต่อที่โรงเรียนนี้ (เช่น ป.6 ที่ไปเรียนมัธยมที่อื่น)
--     ต่างจาก graduated (จบหลักสูตร) — ใช้ตอนเลื่อนชั้นเลือก "ย้ายออก" แยกออกจากรายชื่อ active เหมือนกัน
alter table students add column if not exists left_school boolean not null default false;

-- 15) ค่าตั้งค่าส่วนกลาง (key-value) — ตอนนี้เก็บ highest_grade = ชั้นสูงสุดที่โรงเรียนเปิดสอน
--     ใช้ตัดสินว่าใครจบตอนเลื่อนชั้น (เช่น 'ม.3' สำหรับโรงเรียนขยายโอกาส)
create table if not exists app_settings (
  key   text primary key,
  value text
);
alter table app_settings enable row level security;
drop policy if exists app_settings_select on app_settings;
create policy app_settings_select on app_settings for select using (auth.role() = 'authenticated');
drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings for all using (is_admin()) with check (is_admin());

insert into app_settings (key, value) values ('highest_grade', 'ม.3')
  on conflict (key) do nothing;

-- หมายเหตุ (2026-07): การเช็คชื่อหลายครั้งต่อวันไม่ต้องแก้ schema — attendance_sessions
-- ตั้งใจไม่มี unique(subject_id, session_date) อยู่แล้ว (เคสจริง: วันเดียวเช็คหลายครั้งได้)
-- ข้อจำกัดเดิมอยู่ที่ฝั่งหน้าเว็บ (แก้ที่ attendance.html แล้ว ไม่มี SQL ต้องรัน)


-- ============================================================
-- สมรรถนะหลักจากกิจกรรม + กิจวัตรประจำวัน (2026-07)
-- ------------------------------------------------------------
-- เพิ่มแบบ additive เท่านั้น: ไม่ย้าย/ลบตาราง units, indicators, collections, scores เดิม
-- รายวิชายังคงใช้โครงสร้างเดิมทั้งหมด แต่เลือกชื่อสมรรถนะ/องค์ประกอบจากรายการกลางได้
-- กิจกรรมและกิจวัตรใช้รายการกลางเดียวกัน แล้วเก็บคะแนนดิบแยกในตารางชุดนี้
-- ============================================================

-- 16) รายการกลางของสมรรถนะหลัก 6 ด้าน
create table if not exists core_competencies (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  seq         integer not null,
  created_at  timestamptz default now(),
  constraint core_competencies_seq_unique unique (seq)
);

-- องค์ประกอบมาตรฐานแยกตามช่วงชั้น เพราะบางช่วงชั้นมีรายการไม่เท่ากัน
create table if not exists core_competency_elements (
  id              uuid primary key default gen_random_uuid(),
  competency_id   uuid not null references core_competencies(id) on delete cascade,
  stage           text not null check (stage in ('ช่วงชั้น 1', 'ช่วงชั้น 2', 'ช่วงชั้น 3')),
  name            text not null,
  seq             integer not null,
  created_at      timestamptz default now(),
  constraint core_elements_unique unique (competency_id, stage, seq)
);
create index if not exists core_elements_competency_idx on core_competency_elements(competency_id, stage);

-- ผูกโครงสร้างสมรรถนะที่อยู่ใต้รายวิชาเดิมกับรายการกลาง (nullable เพื่อไม่กระทบข้อมูลเก่า)
alter table units add column if not exists core_competency_id uuid references core_competencies(id);
alter table indicators add column if not exists core_competency_element_id uuid references core_competency_elements(id);
create index if not exists units_core_competency_idx on units(core_competency_id);
create index if not exists indicators_core_element_idx on indicators(core_competency_element_id);

-- 17) รายการประเมินจากกิจกรรมหรือกิจวัตร (กิจวัตรใช้รายการเดิมสร้างหลายครั้งได้)
create table if not exists competency_assessments (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('กิจกรรม', 'กิจวัตรประจำวัน')),
  name        text not null,
  year        text not null,
  owner_id    uuid not null references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists competency_assessments_year_idx on competency_assessments(year);
create index if not exists competency_assessments_owner_idx on competency_assessments(owner_id);

-- องค์ประกอบที่รายการนี้เลือกใช้ + คะแนนเต็มต่อครั้งประเมิน
create table if not exists competency_assessment_targets (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references competency_assessments(id) on delete cascade,
  competency_id   uuid not null references core_competencies(id),
  element_id      uuid not null references core_competency_elements(id),
  max_score       numeric not null,
  seq             integer not null default 1,
  created_at      timestamptz default now(),
  constraint competency_assessment_targets_unique unique (assessment_id, element_id),
  constraint competency_assessment_targets_max_ok check (max_score > 0)
);
create index if not exists competency_targets_assessment_idx on competency_assessment_targets(assessment_id);

-- รายชื่อผู้เข้าร่วมของรายการ/แม่แบบ: เลือกทั้งห้องแล้วปรับรายคนได้ และคละชั้น/ห้องได้
create table if not exists competency_assessment_members (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references competency_assessments(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  created_at      timestamptz default now(),
  constraint competency_assessment_members_unique unique (assessment_id, student_id)
);
create index if not exists competency_members_assessment_idx on competency_assessment_members(assessment_id);

-- แต่ละครั้งที่ลงคะแนน แยกตามองค์ประกอบ (แต่ละองค์ประกอบมีครั้งที่ 1, 2, 3... ของตัวเอง)
create table if not exists competency_assessment_sessions (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references competency_assessments(id) on delete cascade,
  target_id       uuid not null references competency_assessment_targets(id) on delete cascade,
  attempt_no      integer not null,
  session_date    date, -- เก็บไว้รองรับข้อมูลรุ่นเก่าเท่านั้น หน้าเว็บใหม่ไม่ใช้วันที่
  note            text,
  created_at      timestamptz default now(),
  constraint competency_sessions_attempt_ok check (attempt_no > 0),
  constraint competency_sessions_target_attempt_unique unique (target_id, attempt_no)
);
create index if not exists competency_sessions_assessment_idx on competency_assessment_sessions(assessment_id, target_id, attempt_no);

-- snapshot รายชื่อ ณ ครั้งประเมิน: ประวัติไม่เปลี่ยนเมื่อครูแก้สมาชิกแม่แบบหรือเด็กเลื่อนชั้น
create table if not exists competency_assessment_session_students (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references competency_assessment_sessions(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  constraint competency_session_students_unique unique (session_id, student_id)
);
create index if not exists competency_session_students_session_idx on competency_assessment_session_students(session_id);

-- คะแนนดิบเหมือนรายวิชา: ครูกำหนดคะแนนเต็มที่ target แล้วกรอกเลขจริงเอง ไม่มี rubric บังคับ
create table if not exists competency_assessment_scores (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references competency_assessment_sessions(id) on delete cascade,
  target_id       uuid not null references competency_assessment_targets(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  raw_score       numeric not null default 0,
  updated_at      timestamptz default now(),
  constraint competency_assessment_scores_unique unique (session_id, target_id, student_id),
  constraint competency_assessment_scores_nonneg check (raw_score >= 0)
);
create index if not exists competency_scores_session_idx on competency_assessment_scores(session_id);

-- ข้อมูลมาตรฐานจากตารางสมรรถนะหลัก ช่วงชั้น 1–3 (เก็บเฉพาะชื่อสมรรถนะ/องค์ประกอบ ไม่เก็บ rubric)
insert into core_competencies (code, name, seq) values
  ('self_management', 'การจัดการตนเอง', 1),
  ('higher_order_thinking', 'การคิดขั้นสูง', 2),
  ('communication', 'การสื่อสาร', 3),
  ('teamwork', 'การรวมพลังทำงานเป็นทีม', 4),
  ('active_citizenship', 'การเป็นพลเมืองที่เข้มแข็ง', 5),
  ('nature_science_technology', 'การอยู่ร่วมกับธรรมชาติและวิทยาการ', 6)
on conflict (code) do update set name = excluded.name, seq = excluded.seq;

-- ใช้ชื่อมาตรฐานเดียวกันในแต่ละช่วงชั้นเมื่อชื่อในเอกสารต่างกันเพียงคำเชื่อม/การเว้นวรรค
insert into core_competency_elements (competency_id, stage, name, seq)
select c.id, v.stage, v.name, v.seq
from core_competencies c
join (values
  ('self_management','ช่วงชั้น 1','การเห็นคุณค่าในตนเอง',1),
  ('self_management','ช่วงชั้น 1','การมีเป้าหมายในชีวิต',2),
  ('self_management','ช่วงชั้น 1','การจัดการอารมณ์และความเครียด',3),
  ('self_management','ช่วงชั้น 1','การจัดการปัญหาและภาวะวิกฤต',4),
  ('self_management','ช่วงชั้น 2','การเห็นคุณค่าในตนเอง',1),
  ('self_management','ช่วงชั้น 2','การมีเป้าหมายในชีวิต',2),
  ('self_management','ช่วงชั้น 2','การจัดการอารมณ์และความเครียด',3),
  ('self_management','ช่วงชั้น 2','การจัดการปัญหาและภาวะวิกฤต',4),
  ('self_management','ช่วงชั้น 3','การเห็นคุณค่าในตนเอง',1),
  ('self_management','ช่วงชั้น 3','การมีเป้าหมายในชีวิต',2),
  ('self_management','ช่วงชั้น 3','การจัดการอารมณ์และความเครียด',3),
  ('self_management','ช่วงชั้น 3','การจัดการปัญหาและภาวะวิกฤต',4),
  ('higher_order_thinking','ช่วงชั้น 1','การคิดอย่างมีวิจารณญาณ',1),
  ('higher_order_thinking','ช่วงชั้น 1','การคิดเชิงระบบ',2),
  ('higher_order_thinking','ช่วงชั้น 1','การคิดสร้างสรรค์',3),
  ('higher_order_thinking','ช่วงชั้น 1','การคิดแก้ปัญหา',4),
  ('higher_order_thinking','ช่วงชั้น 2','การคิดอย่างมีวิจารณญาณ',1),
  ('higher_order_thinking','ช่วงชั้น 2','การคิดเชิงระบบ',2),
  ('higher_order_thinking','ช่วงชั้น 2','การคิดสร้างสรรค์',3),
  ('higher_order_thinking','ช่วงชั้น 2','การคิดแก้ปัญหา',4),
  ('higher_order_thinking','ช่วงชั้น 3','การคิดอย่างมีวิจารณญาณ',1),
  ('higher_order_thinking','ช่วงชั้น 3','การคิดเชิงระบบ',2),
  ('higher_order_thinking','ช่วงชั้น 3','การคิดสร้างสรรค์',3),
  ('higher_order_thinking','ช่วงชั้น 3','การคิดแก้ปัญหา',4),
  ('communication','ช่วงชั้น 1','การรับสารอย่างมีสติและถอดรหัสเพื่อให้เกิดความเข้าใจ',1),
  ('communication','ช่วงชั้น 1','การรับส่งสารบนพื้นฐานความเข้าใจและความเคารพในความคิดเห็นและวัฒนธรรมที่แตกต่าง',2),
  ('communication','ช่วงชั้น 1','การเลือกใช้กลวิธีการสื่อสารอย่างเหมาะสมโดยคำนึงถึงความรับผิดชอบต่อสังคมเพื่อบรรลุวัตถุประสงค์ในการสื่อสาร',3),
  ('communication','ช่วงชั้น 2','การรับสารอย่างมีสติและถอดรหัสเพื่อให้เกิดความเข้าใจ',1),
  ('communication','ช่วงชั้น 2','การรับส่งสารบนพื้นฐานความเข้าใจและความเคารพในความคิดเห็นและวัฒนธรรมที่แตกต่าง',2),
  ('communication','ช่วงชั้น 2','การเลือกใช้กลวิธีการสื่อสารอย่างเหมาะสมโดยคำนึงถึงความรับผิดชอบต่อสังคมเพื่อบรรลุวัตถุประสงค์ในการสื่อสาร',3),
  ('communication','ช่วงชั้น 3','การรับสารอย่างมีสติและถอดรหัสเพื่อให้เกิดความเข้าใจ',1),
  ('communication','ช่วงชั้น 3','การรับส่งสารบนพื้นฐานความเข้าใจและความเคารพในความคิดเห็นและวัฒนธรรมที่แตกต่าง',2),
  ('communication','ช่วงชั้น 3','การเลือกใช้กลวิธีการสื่อสารอย่างเหมาะสมโดยคำนึงถึงความรับผิดชอบต่อสังคมเพื่อบรรลุวัตถุประสงค์ในการสื่อสาร',3),
  ('teamwork','ช่วงชั้น 1','การเป็นสมาชิกทีมที่ดีและมีภาวะผู้นำ',1),
  ('teamwork','ช่วงชั้น 1','กระบวนการทำงานแบบร่วมมือรวมพลัง',2),
  ('teamwork','ช่วงชั้น 1','การสร้างความสัมพันธ์และจัดการความขัดแย้ง',3),
  ('teamwork','ช่วงชั้น 2','การเป็นสมาชิกทีมที่ดีและมีภาวะผู้นำ',1),
  ('teamwork','ช่วงชั้น 2','กระบวนการทำงานแบบร่วมมือรวมพลัง',2),
  ('teamwork','ช่วงชั้น 2','การสร้างความสัมพันธ์และจัดการความขัดแย้ง',3),
  ('teamwork','ช่วงชั้น 3','การเป็นสมาชิกทีมที่ดีและมีภาวะผู้นำ',1),
  ('teamwork','ช่วงชั้น 3','กระบวนการทำงานแบบร่วมมือรวมพลัง',2),
  ('teamwork','ช่วงชั้น 3','การสร้างความสัมพันธ์และจัดการความขัดแย้ง',3),
  ('active_citizenship','ช่วงชั้น 1','พลเมืองรู้เคารพสิทธิ',1),
  ('active_citizenship','ช่วงชั้น 1','พลเมืองรับผิดชอบต่อบทบาทหน้าที่',2),
  ('active_citizenship','ช่วงชั้น 1','พลเมืองมีส่วนร่วมอย่างมีวิจารณญาณ',3),
  ('active_citizenship','ช่วงชั้น 2','พลเมืองรู้เคารพสิทธิ',1),
  ('active_citizenship','ช่วงชั้น 2','พลเมืองรับผิดชอบต่อบทบาทหน้าที่',2),
  ('active_citizenship','ช่วงชั้น 2','พลเมืองมีส่วนร่วมอย่างมีวิจารณญาณ',3),
  ('active_citizenship','ช่วงชั้น 2','พลเมืองผู้สร้างการเปลี่ยนแปลง',4),
  ('active_citizenship','ช่วงชั้น 3','พลเมืองรู้เคารพสิทธิ',1),
  ('active_citizenship','ช่วงชั้น 3','พลเมืองรับผิดชอบต่อบทบาทหน้าที่',2),
  ('active_citizenship','ช่วงชั้น 3','พลเมืองมีส่วนร่วมอย่างมีวิจารณญาณ',3),
  ('active_citizenship','ช่วงชั้น 3','พลเมืองผู้สร้างการเปลี่ยนแปลง',4),
  ('nature_science_technology','ช่วงชั้น 1','การเข้าใจปรากฏการณ์ที่เกิดขึ้นบนโลกและในเอกภพ',1),
  ('nature_science_technology','ช่วงชั้น 1','การเชื่อมโยงความสัมพันธ์ของคณิตศาสตร์ วิทยาศาสตร์ และเทคโนโลยีเพื่อการอยู่ร่วมกันกับธรรมชาติอย่างยั่งยืน',2),
  ('nature_science_technology','ช่วงชั้น 1','การสร้าง ใช้ และรู้เท่าทันวิทยาการเทคโนโลยี',3),
  ('nature_science_technology','ช่วงชั้น 1','การมีคุณลักษณะทางคณิตศาสตร์และวิทยาศาสตร์สำหรับการอยู่ร่วมกับธรรมชาติอย่างยั่งยืน',4),
  ('nature_science_technology','ช่วงชั้น 2','การเข้าใจปรากฏการณ์ที่เกิดขึ้นบนโลกและในเอกภพ',1),
  ('nature_science_technology','ช่วงชั้น 2','การเชื่อมโยงความสัมพันธ์ของคณิตศาสตร์ วิทยาศาสตร์ และเทคโนโลยีเพื่อการอยู่ร่วมกันกับธรรมชาติอย่างยั่งยืน',2),
  ('nature_science_technology','ช่วงชั้น 2','การสร้าง ใช้ และรู้เท่าทันวิทยาการเทคโนโลยี',3),
  ('nature_science_technology','ช่วงชั้น 2','การมีคุณลักษณะทางคณิตศาสตร์และวิทยาศาสตร์สำหรับการอยู่ร่วมกับธรรมชาติอย่างยั่งยืน',4),
  ('nature_science_technology','ช่วงชั้น 3','การเข้าใจปรากฏการณ์ที่เกิดขึ้นบนโลกและในเอกภพ',1),
  ('nature_science_technology','ช่วงชั้น 3','การเชื่อมโยงความสัมพันธ์ของคณิตศาสตร์ วิทยาศาสตร์ และเทคโนโลยีเพื่อการอยู่ร่วมกันกับธรรมชาติอย่างยั่งยืน',2),
  ('nature_science_technology','ช่วงชั้น 3','การสร้าง ใช้ และรู้เท่าทันวิทยาการเทคโนโลยี',3),
  ('nature_science_technology','ช่วงชั้น 3','การมีคุณลักษณะทางคณิตศาสตร์และวิทยาศาสตร์สำหรับการอยู่ร่วมกับธรรมชาติอย่างยั่งยืน',4)
) as v(competency_code, stage, name, seq) on v.competency_code = c.code
on conflict (competency_id, stage, seq) do update set name = excluded.name;

-- สิทธิ์: รายการกลางอ่านได้ทุกคนที่ล็อกอิน, แก้ข้อมูลกลางเฉพาะ admin
alter table core_competencies enable row level security;
alter table core_competency_elements enable row level security;
drop policy if exists core_competencies_select on core_competencies;
create policy core_competencies_select on core_competencies for select using (auth.role() = 'authenticated');
drop policy if exists core_competencies_write on core_competencies;
create policy core_competencies_write on core_competencies for all using (is_admin()) with check (is_admin());
drop policy if exists core_elements_select on core_competency_elements;
create policy core_elements_select on core_competency_elements for select using (auth.role() = 'authenticated');
drop policy if exists core_elements_write on core_competency_elements;
create policy core_elements_write on core_competency_elements for all using (is_admin()) with check (is_admin());

-- helper ฝั่ง RLS สำหรับกิจกรรม/กิจวัตร (owner หรือ admin)
create or replace function can_edit_competency_assessment(p_assessment_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_admin() or exists (
    select 1 from competency_assessments where id = p_assessment_id and owner_id = auth.uid()
  );
$$;
create or replace function can_edit_competency_session(p_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from competency_assessment_sessions s
    where s.id = p_session_id and can_edit_competency_assessment(s.assessment_id)
  );
$$;

alter table competency_assessments enable row level security;
alter table competency_assessment_targets enable row level security;
alter table competency_assessment_members enable row level security;
alter table competency_assessment_sessions enable row level security;
alter table competency_assessment_session_students enable row level security;
alter table competency_assessment_scores enable row level security;

drop policy if exists competency_assessments_select on competency_assessments;
create policy competency_assessments_select on competency_assessments for select using (auth.role() = 'authenticated');
drop policy if exists competency_assessments_insert on competency_assessments;
create policy competency_assessments_insert on competency_assessments for insert with check (owner_id = auth.uid() or is_admin());
drop policy if exists competency_assessments_update on competency_assessments;
create policy competency_assessments_update on competency_assessments for update using (can_edit_competency_assessment(id)) with check (can_edit_competency_assessment(id));
drop policy if exists competency_assessments_delete on competency_assessments;
create policy competency_assessments_delete on competency_assessments for delete using (can_edit_competency_assessment(id));

drop policy if exists competency_targets_select on competency_assessment_targets;
create policy competency_targets_select on competency_assessment_targets for select using (auth.role() = 'authenticated');
drop policy if exists competency_targets_write on competency_assessment_targets;
create policy competency_targets_write on competency_assessment_targets for all using (can_edit_competency_assessment(assessment_id)) with check (can_edit_competency_assessment(assessment_id));
drop policy if exists competency_members_select on competency_assessment_members;
create policy competency_members_select on competency_assessment_members for select using (auth.role() = 'authenticated');
drop policy if exists competency_members_write on competency_assessment_members;
create policy competency_members_write on competency_assessment_members for all using (can_edit_competency_assessment(assessment_id)) with check (can_edit_competency_assessment(assessment_id));
drop policy if exists competency_sessions_select on competency_assessment_sessions;
create policy competency_sessions_select on competency_assessment_sessions for select using (auth.role() = 'authenticated');
drop policy if exists competency_sessions_write on competency_assessment_sessions;
create policy competency_sessions_write on competency_assessment_sessions for all using (can_edit_competency_assessment(assessment_id)) with check (can_edit_competency_assessment(assessment_id));
drop policy if exists competency_session_students_select on competency_assessment_session_students;
create policy competency_session_students_select on competency_assessment_session_students for select using (auth.role() = 'authenticated');
drop policy if exists competency_session_students_write on competency_assessment_session_students;
create policy competency_session_students_write on competency_assessment_session_students for all using (can_edit_competency_session(session_id)) with check (can_edit_competency_session(session_id));
drop policy if exists competency_scores_select on competency_assessment_scores;
create policy competency_scores_select on competency_assessment_scores for select using (auth.role() = 'authenticated');
drop policy if exists competency_scores_write on competency_assessment_scores;
create policy competency_scores_write on competency_assessment_scores for all using (can_edit_competency_session(session_id)) with check (can_edit_competency_session(session_id));

-- ============================================================
-- Migration: เปลี่ยนครั้งประเมินกิจกรรม/กิจวัตรจาก “ตามวันที่”
-- เป็น “แยกครั้งที่ของแต่ละองค์ประกอบ” (2026-07-16)
-- รันบล็อกนี้กับฐานข้อมูลเดิมก่อน deploy competency-entry.html รุ่นใหม่
-- ข้อมูลคะแนนเดิมจะถูกแยกไปเป็นครั้งที่ของแต่ละองค์ประกอบโดยไม่ลบคะแนน
-- ============================================================
alter table competency_assessment_sessions
  add column if not exists target_id uuid references competency_assessment_targets(id) on delete cascade;
alter table competency_assessment_sessions
  add column if not exists attempt_no integer;

do $$
declare
  old_session record;
  target_row record;
  new_session_id uuid;
  next_attempt integer;
begin
  -- แถวรุ่นเก่าหนึ่งแถวเคยครอบทุกองค์ประกอบ จึงแตกเป็นหนึ่งแถวต่อองค์ประกอบ
  for old_session in
    select * from competency_assessment_sessions
    where target_id is null
    order by created_at, id
  loop
    for target_row in
      select id from competency_assessment_targets
      where assessment_id = old_session.assessment_id
      order by seq, id
    loop
      select coalesce(max(attempt_no), 0) + 1 into next_attempt
      from competency_assessment_sessions
      where target_id = target_row.id;

      insert into competency_assessment_sessions
        (assessment_id, target_id, attempt_no, session_date, note, created_at)
      values
        (old_session.assessment_id, target_row.id, next_attempt,
         old_session.session_date, old_session.note, old_session.created_at)
      returning id into new_session_id;

      insert into competency_assessment_session_students (session_id, student_id)
      select new_session_id, student_id
      from competency_assessment_session_students
      where session_id = old_session.id
      on conflict (session_id, student_id) do nothing;

      update competency_assessment_scores
      set session_id = new_session_id
      where session_id = old_session.id and target_id = target_row.id;
    end loop;

    delete from competency_assessment_sessions where id = old_session.id;
  end loop;
end $$;

alter table competency_assessment_sessions
  alter column target_id set not null,
  alter column attempt_no set not null;
alter table competency_assessment_sessions
  alter column session_date drop not null;

alter table competency_assessment_sessions
  drop constraint if exists competency_sessions_attempt_ok;
alter table competency_assessment_sessions
  add constraint competency_sessions_attempt_ok check (attempt_no > 0);

create unique index if not exists competency_sessions_target_attempt_unique_idx
  on competency_assessment_sessions(target_id, attempt_no);
drop index if exists competency_sessions_assessment_idx;
create index competency_sessions_assessment_idx
  on competency_assessment_sessions(assessment_id, target_id, attempt_no);

-- ============================================================
-- Migration: น้ำหนักรวมสมรรถนะ 3 แหล่ง + เกณฑ์แปลผลกลาง
-- และภาคเรียนของกิจกรรม/กิจวัตร (2026-07-16)
-- ------------------------------------------------------------
-- รันบล็อกนี้ก่อนใช้หน้ากำหนดสมรรถนะ/หน้าสรุปคะแนนรุ่นที่รวม 3 แหล่ง
-- term = null หมายถึงรายการทั้งปี (ข้อมูลเดิมทั้งหมดจะยังใช้ได้)
-- ============================================================

alter table competency_assessments
  add column if not exists term text;
alter table competency_assessments
  drop constraint if exists competency_assessments_term_ok;
alter table competency_assessments
  add constraint competency_assessments_term_ok check (term is null or term in ('1', '2'));
create index if not exists competency_assessments_year_term_idx
  on competency_assessments(year, term);

-- น้ำหนักรายวิชา/กิจกรรม/กิจวัตร กำหนดแยกต่อสมรรถนะหลักแต่ละด้าน
-- ไม่ seed ตัวเลขแทนโรงเรียน: admin ต้องกำหนดเอง และแต่ละแถวต้องรวมเป็น 100%
create table if not exists competency_source_weights (
  competency_id  uuid primary key references core_competencies(id) on delete cascade,
  subject_weight numeric not null,
  activity_weight numeric not null,
  routine_weight numeric not null,
  updated_at     timestamptz not null default now(),
  constraint competency_source_weights_range_ok check (
    subject_weight >= 0 and subject_weight <= 100 and
    activity_weight >= 0 and activity_weight <= 100 and
    routine_weight >= 0 and routine_weight <= 100
  ),
  constraint competency_source_weights_sum_ok check (
    abs((subject_weight + activity_weight + routine_weight) - 100) < 0.000001
  )
);

-- เกณฑ์แปลผลกลาง ใช้ร่วมกันทั้ง 6 ด้าน แก้ค่าได้จากหน้ากำหนดสมรรถนะ
create table if not exists competency_interpretation_levels (
  code       text primary key,
  label      text not null,
  min_score  numeric not null,
  max_score  numeric not null,
  seq        integer not null unique,
  updated_at timestamptz not null default now(),
  constraint competency_levels_range_ok check (
    min_score >= 0 and max_score <= 100 and min_score <= max_score
  )
);

insert into competency_interpretation_levels (code, label, min_score, max_score, seq) values
  ('beginning',  'เริ่มต้น',             1,  59, 1),
  ('developing', 'กำลังพัฒนา',          60,  69, 2),
  ('capable',    'สามารถ',              70,  79, 3),
  ('beyond',     'เหนือความคาดหวัง',    80, 100, 4)
on conflict (code) do nothing;

alter table competency_source_weights enable row level security;
alter table competency_interpretation_levels enable row level security;

drop policy if exists competency_source_weights_select on competency_source_weights;
create policy competency_source_weights_select on competency_source_weights
  for select using (auth.role() = 'authenticated');
drop policy if exists competency_source_weights_write on competency_source_weights;
create policy competency_source_weights_write on competency_source_weights
  for all using (is_admin()) with check (is_admin());

drop policy if exists competency_levels_select on competency_interpretation_levels;
create policy competency_levels_select on competency_interpretation_levels
  for select using (auth.role() = 'authenticated');
drop policy if exists competency_levels_write on competency_interpretation_levels;
create policy competency_levels_write on competency_interpretation_levels
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- Migration: อนุญาตน้ำหนักแหล่งคะแนนเป็น 0% (2026-07-16)
-- ------------------------------------------------------------
-- แหล่งที่น้ำหนัก 0% ไม่จำเป็นต้องมีคะแนนของสมรรถนะด้านนั้น
-- แต่ผลรวมรายวิชา + กิจกรรม + กิจวัตรยังต้องเท่ากับ 100% เสมอ
-- ============================================================
alter table competency_source_weights
  drop constraint if exists competency_source_weights_range_ok;
alter table competency_source_weights
  add constraint competency_source_weights_range_ok check (
    subject_weight >= 0 and subject_weight <= 100 and
    activity_weight >= 0 and activity_weight <= 100 and
    routine_weight >= 0 and routine_weight <= 100
  );

-- ============================================================
-- Migration: ประวัติชั้นและห้องของนักเรียนแยกตามปีการศึกษา (2026-07-17)
-- ------------------------------------------------------------
-- students.grade_level / students.classroom คงไว้เป็น "ข้อมูลปีปัจจุบัน" เพื่อให้หน้าเดิม
-- ทำงานต่อได้ แต่รายงานย้อนหลังต้องอ้างอิงตารางนี้แทน จึงไม่ถูกเขียนทับเมื่อเลื่อนชั้น
-- ============================================================
create table if not exists student_year_placements (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  year        text not null,
  grade_level text not null,
  classroom   text not null,
  created_at  timestamptz not null default now(),

  -- นักเรียนอยู่ได้ห้องเดียวต่อหนึ่งปีการศึกษา
  constraint student_year_placements_unique unique (student_id, year),
  constraint student_year_placements_year_not_blank check (btrim(year) <> ''),
  constraint student_year_placements_grade_not_blank check (btrim(grade_level) <> ''),
  constraint student_year_placements_classroom_not_blank check (btrim(classroom) <> '')
);
create index if not exists student_year_placements_year_class_idx
  on student_year_placements(year, grade_level, classroom);
create index if not exists student_year_placements_student_idx
  on student_year_placements(student_id);

alter table student_year_placements enable row level security;
drop policy if exists student_year_placements_select on student_year_placements;
create policy student_year_placements_select on student_year_placements
  for select using (auth.role() = 'authenticated');
drop policy if exists student_year_placements_write on student_year_placements;
create policy student_year_placements_write on student_year_placements
  for all using (is_admin()) with check (is_admin());

-- หลังรัน migration ด้านบน ให้ตรวจข้อมูล students ก่อน แล้วรันคำสั่งนี้เพียงครั้งเดียว
-- โดยแทน '2569' ด้วย "ปีการศึกษาปัจจุบันจริง" ของโรงเรียนเท่านั้น
-- ห้ามเดาปีหรือใช้คำสั่งนี้เพื่อสร้างประวัติปีเก่า เพราะ classroom เก่าอาจถูกเขียนทับแล้ว
--
-- insert into student_year_placements (student_id, year, grade_level, classroom)
-- select id, '2569', grade_level, classroom
-- from students
-- where coalesce(graduated, false) = false and coalesce(left_school, false) = false
--   and grade_level is not null and btrim(grade_level) <> ''
--   and classroom is not null and btrim(classroom) <> ''
-- on conflict (student_id, year) do nothing;

-- ============================================================
-- Migration: สิทธิ์จัดการรายการสมรรถนะตามเจ้าของ (2026-07-17)
-- ------------------------------------------------------------
-- รันบล็อกนี้ทับ policy รุ่นที่จำกัดเฉพาะ admin
-- ครูสร้างและจัดการได้เฉพาะรายการของตนเอง; admin จัดการได้ทุกรายการ
-- น้ำหนัก 3 แหล่งและเกณฑ์แปลผลกลางยังมี policy admin-only แยกต่างหาก
-- ============================================================
drop policy if exists competency_assessments_insert on competency_assessments;
create policy competency_assessments_insert on competency_assessments
  for insert with check (owner_id = auth.uid() or is_admin());
drop policy if exists competency_assessments_update on competency_assessments;
create policy competency_assessments_update on competency_assessments
  for update using (can_edit_competency_assessment(id)) with check (can_edit_competency_assessment(id));
drop policy if exists competency_assessments_delete on competency_assessments;
create policy competency_assessments_delete on competency_assessments
  for delete using (can_edit_competency_assessment(id));

drop policy if exists competency_targets_write on competency_assessment_targets;
create policy competency_targets_write on competency_assessment_targets
  for all using (can_edit_competency_assessment(assessment_id)) with check (can_edit_competency_assessment(assessment_id));
drop policy if exists competency_members_write on competency_assessment_members;
create policy competency_members_write on competency_assessment_members
  for all using (can_edit_competency_assessment(assessment_id)) with check (can_edit_competency_assessment(assessment_id));

-- ============================================================
-- Migration: ข้อมูลส่วนตัวและรูปโปรไฟล์ของผู้ใช้ (2026-07-18)
-- ------------------------------------------------------------
-- แยกจาก profiles เดิมเพื่อให้ครูแก้ชื่อ/รูปของตนได้ แต่ไม่แตะ role หรือ email
-- รูปเก็บใน private bucket และเจ้าของบัญชีเท่านั้นที่อ่าน/เขียนไฟล์ของตนเองได้
-- ============================================================
create table if not exists user_profile_details (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_path   text,
  updated_at    timestamptz not null default now(),
  constraint user_profile_details_name_length check (display_name is null or char_length(btrim(display_name)) between 1 and 80)
);

alter table user_profile_details enable row level security;
drop policy if exists user_profile_details_select_own on user_profile_details;
create policy user_profile_details_select_own on user_profile_details
  for select using (user_id = auth.uid());
drop policy if exists user_profile_details_insert_own on user_profile_details;
create policy user_profile_details_insert_own on user_profile_details
  for insert with check (user_id = auth.uid());
drop policy if exists user_profile_details_update_own on user_profile_details;
create policy user_profile_details_update_own on user_profile_details
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists profile_avatars_select_own on storage.objects;
create policy profile_avatars_select_own on storage.objects
  for select to authenticated using (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists profile_avatars_insert_own on storage.objects;
create policy profile_avatars_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists profile_avatars_update_own on storage.objects;
create policy profile_avatars_update_own on storage.objects
  for update to authenticated using (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Migration: แก้ "ข้อมูลวิชา" (subjects) สงวนให้ admin เท่านั้น (2026-07-18)
-- ------------------------------------------------------------
-- เดิม subjects_update = admin หรือเจ้าของวิชา (owner_id) — เปลี่ยนเป็น admin เท่านั้น
-- เจตนา: ชื่อ/รหัส/คาบ/หน่วยกิต/เจ้าของ ของวิชา แก้ได้เฉพาะ admin
-- ส่วน "โครงสร้าง/คะแนน" (units/indicators/collections/scores/attendance/remarks/
-- makeup_hours/enrollments/integration_members) ยังเป็น admin-หรือ-เจ้าของวิชา ผ่าน
-- can_edit_subject() เหมือนเดิม — บล็อกนี้ไม่แตะ policy เหล่านั้น
-- (subjects_insert และ subjects_delete เป็น admin-only อยู่แล้ว ไม่ต้องแก้)
-- ============================================================
drop policy if exists subjects_update on subjects;
create policy subjects_update on subjects
  for update using (is_admin()) with check (is_admin());

-- ============================================================
-- Migration: ระบบสิทธิ์ระดับฝ่าย (2026-07-25)
-- ------------------------------------------------------------
-- โมเดล: (ระบุว่าอยู่ฝ่ายไหน) + (admin กดอนุญาต) → มีอำนาจเท่า admin เฉพาะหน้าของฝ่ายนั้น
--   ถ้า granted = false → แม้ระบุว่าอยู่ฝ่ายนั้นก็ทำอะไรไม่ได้ (ยืนยันกับผู้ใช้แล้ว)
--   คนหนึ่งอยู่ได้หลายฝ่ายพร้อมกัน (ยืนยันแล้ว) จึงเป็นตาราง many-to-many ไม่ใช่คอลัมน์ใน profiles
--
-- ทำไมไม่ใช้ profiles.role: role มีแค่ 'admin'/'teacher' + มี check constraint และเป็นค่าเดี่ยว
--   เจ้าหน้าที่ที่คีย์ข้อมูลฝ่ายมักเป็น "ครูที่ทำธุรการควบ" ถ้าเปลี่ยน role จะกระทบสิทธิ์ฝ่ายวิชาการเดิม
--
-- ⚠ บล็อกนี้ "ไม่แตะ policy เดิมของฝ่ายวิชาการแม้แต่ตัวเดียว" — เป็นตาราง+ฟังก์ชันใหม่ล้วน
--   การยกฝ่ายวิชาการมาใช้ has_department() เป็นงานแยก (ตัวเลือก C) ทำทีหลังพร้อมทดสอบเฉพาะ
-- ============================================================
create table if not exists user_departments (
  user_id     uuid not null references auth.users(id) on delete cascade,
  department  text not null,
  granted     boolean not null default false,   -- admin ต้องกดอนุญาตก่อนจึงมีผล
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz,
  created_at  timestamptz not null default now(),

  primary key (user_id, department),
  constraint user_departments_dept_ok check (
    department in ('วิชาการ', 'บุคลากร', 'การเงิน', 'บริหารทั่วไป')
  )
);

-- ใช้ตอนหน้าจัดการสิทธิ์ไล่ดูว่าฝ่ายหนึ่ง ๆ มีใครบ้าง
create index if not exists user_departments_dept_idx on user_departments (department, granted);

-- security definer เหมือน is_admin()/can_edit_subject() เพื่อไม่ให้ชนกับ RLS ของตารางที่มันอ่านเอง
create or replace function has_department(p_department text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_admin() or exists (
    select 1 from user_departments
    where user_id = auth.uid()
      and department = p_department
      and granted
  );
$$;

alter table user_departments enable row level security;

-- อ่านได้เมื่อล็อกอิน (แนวเดียวกับ profiles_select) — หน้าเว็บต้องรู้ว่าตัวเองอยู่ฝ่ายไหนเพื่อซ่อน/แสดงปุ่ม
drop policy if exists user_departments_select on user_departments;
create policy user_departments_select on user_departments
  for select using (auth.role() = 'authenticated');

-- ⚠ เขียนได้เฉพาะ admin เท่านั้น — สำคัญมาก ไม่งั้นคนในฝ่ายจะแจกสิทธิ์ให้ตัวเอง/คนอื่นได้
drop policy if exists user_departments_insert on user_departments;
create policy user_departments_insert on user_departments
  for insert with check (is_admin());
drop policy if exists user_departments_update on user_departments;
create policy user_departments_update on user_departments
  for update using (is_admin()) with check (is_admin());
drop policy if exists user_departments_delete on user_departments;
create policy user_departments_delete on user_departments
  for delete using (is_admin());

-- ทางฉุกเฉินถ้าตารางนี้ทำให้อะไรพัง (ไม่กระทบฝ่ายวิชาการ เพราะยังไม่มี policy เดิมตัวไหนเรียกใช้):
-- alter table user_departments disable row level security;

-- ============================================================
-- Migration: โมดูลฝ่ายบุคคล — slice แรก "สรุปเวลาทำงาน" (2026-07-25)
-- ------------------------------------------------------------
-- ต้นทางเวลาเข้า-ออกคือ Jibble (แอปแยก) ดึงผ่าน Supabase Edge Function แบบ on-demand
-- (ดึงเมื่อมีคนเปิดหน้าดูเท่านั้น ไม่มี cron) — รายละเอียดการออกแบบอยู่ใน personnel/PLAN.md
--
-- กติกาสิทธิ์ทุกตารางในบล็อกนี้ (ยืนยันกับผู้ใช้แล้ว):
--   select        = ผู้ล็อกอินทุกคน (ยกเว้นที่ระบุเป็นอย่างอื่น)
--   insert/update = has_department('บุคลากร')   -- admin หรือฝ่ายบุคคลที่ได้รับอนุญาต
--   delete        = is_admin()                   -- "แก้ได้แต่ลบไม่ได้" สงวนการลบไว้ที่ admin
-- ============================================================

-- ---------- 1) ทะเบียนบุคลากร ----------
-- ครอบ "ทุกคนในโรงเรียน" รวมคนที่ไม่มีบัญชีล็อกอินและคนที่ไม่มีบัญชี Jibble
create table if not exists staff (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  position          text,                       -- ตำแหน่ง เช่น ครูผู้สอน / ธุรการ / นักการ
  staff_type        text,                       -- ประเภทบุคลากร (เผื่อโควตาวันลาต่างกันในอนาคต)
  email             text,

  -- จับคู่กับ Jibble ด้วย id ตรง ๆ ไม่เทียบชื่อ (ชื่อไทยสะกดต่างกันได้ง่าย)
  -- ⚠ NULL ได้: คนอนุโลม 2 คนไม่มีบัญชีใน Jibble เลย (ยืนยันกับผู้ใช้แล้ว)
  jibble_person_id  uuid unique,
  jibble_code       text,                       -- People.code เช่น TA-1

  is_active         boolean not null default true,   -- sync จาก Jibble status (Joined/Removed)

  -- อนุโลมไม่ต้องลงเวลา → ถือว่า "มา" เสมอในวันทำงาน (คนละเรื่องกับ allowed_late_time)
  exempt            boolean not null default false,
  -- อนุญาตให้เข้าสายถึงเวลานี้เป็นรายคน โดยไม่นับว่าสาย (NULL = ใช้เวลากลาง)
  allowed_late_time time,

  -- ผูกกับบัญชีล็อกอิน ถ้ามี (ใช้ให้ครูเปิดดูข้อมูลของตัวเองได้) — คนไม่มีบัญชีเป็น NULL
  user_id           uuid unique references auth.users(id) on delete set null,

  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists staff_active_idx on staff (is_active);

-- ---------- 2) สรุปเวลาทำงานรายวัน (Edge Function ยุบจาก Jibble TimeEntries) ----------
-- Jibble คืนมาเป็น event ทีละครั้ง (In/Out) ไม่ใช่สรุปรายวัน จึงยุบเป็น 1 แถว/คน/วัน ที่นี่
create table if not exists work_attendance (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references staff(id) on delete cascade,
  work_date      date not null,

  first_in       timestamptz,          -- เวลาเข้าแรกสุดของวัน (In ตัวแรก)
  last_out       timestamptz,          -- เวลาออกท้ายสุด — ⚠ ใช้ประเมินชั่วโมงทำงานไม่ได้ ดูหมายเหตุ
  first_in_local time,                 -- เวลาเข้าแบบเวลาท้องถิ่น ใช้เทียบเกณฑ์ "สาย" ตรง ๆ

  -- true = ออกด้วย AutoOut 18:00 (แปลว่า "ลืมกด logout" ไม่ใช่ "ทำงานถึง 18:00")
  -- ข้อมูลจริง 45 วัน: 80% ของการออกเป็น AutoOut และมีคนที่ลืม 100% หลายคน
  -- → ห้ามใช้ last_out คำนวณชั่วโมงทำงาน/เวลากลับ จะได้ 18:00 เกือบทุกคนทุกวัน
  auto_out       boolean not null default false,

  source         text not null default 'jibble',
  synced_at      timestamptz not null default now(),

  constraint work_attendance_unique unique (staff_id, work_date)   -- upsert ซ้ำได้ ไม่เกิดแถวซ้ำ
);
create index if not exists work_attendance_date_idx on work_attendance (work_date);

-- ---------- 3) สมุดจดว่าดึงข้อมูลถึงไหนแล้ว ----------
-- จำเป็น เพราะ work_attendance เก็บเฉพาะคนที่มาลงเวลา →
-- "วันหยุดที่ดึงแล้วไม่มีใครมา" กับ "วันที่ยังไม่เคยดึง" หน้าตาเหมือนกันเป๊ะ (ว่างทั้งคู่)
-- ถ้าไม่มีตารางนี้ ระบบจะวิ่งดึงวันหยุด/เสาร์-อาทิตย์ซ้ำทุกครั้งที่เปิดหน้า และไม่มีวันหยุดวิ่ง
create table if not exists work_month_sync (
  year_month      text primary key,             -- '2026-07'
  synced_through  date not null,                -- ดึงครบถึงวันไหนแล้ว (เฉพาะวันที่ "นิ่ง" แล้ว)
  synced_at       timestamptz not null default now(),

  constraint work_month_sync_format check (year_month ~ '^[0-9]{4}-[0-9]{2}$')
);
-- นิยาม "วันนิ่ง" = วันก่อนหน้า หรือ วันนี้ที่เลย 18:00 แล้ว (Jibble auto clock-out = ข้อมูลนิ่ง)
-- → ก่อน 18:00 วันนี้ถูกดึงใหม่ทุกครั้งและไม่นับเข้ายอดสรุป · หลัง 18:00 ไม่ต้องดึงซ้ำ

-- ---------- 4) วันหยุด (cache จาก Jibble CalendarDays) ----------
-- ไม่ให้ครูกรอกวันหยุดในระบบเรา — กรอกที่ Jibble ที่เดียว กันข้อมูล 2 ที่ขัดกัน
create table if not exists work_holidays (
  holiday_date  date primary key,
  name          text,
  is_short_day  boolean not null default false,   -- Jibble มีแนวคิดวันทำงานครึ่งวัน
  jibble_id     uuid,
  synced_at     timestamptz not null default now()
);

-- ---------- 5) ตารางงาน (cache จาก Jibble Schedules) ----------
-- ของโรงเรียนตอนนี้: จันทร์–ศุกร์ 07:45–16:30 (ไม่มีเสาร์-อาทิตย์ = ไม่ใช่วันทำงาน)
-- เก็บไว้เพื่อ (ก) รู้ว่าวันไหนเป็นวันทำงาน (ข) ใช้ start_time เป็นฐานคำนวณ "สาย"
create table if not exists work_schedule (
  weekday         smallint primary key,          -- 1=จันทร์ ... 7=อาทิตย์ (ISO)
  is_working_day  boolean not null default false,
  start_time      time,
  end_time        time,
  synced_at       timestamptz not null default now(),

  constraint work_schedule_weekday_ok check (weekday between 1 and 7)
);

-- ---------- 6) การลา (กรอกเองในระบบเรา — Jibble ไม่มีข้อมูลส่วนนี้) ----------
-- ระบบ Time Off ของ Jibble ว่างเปล่าทั้งหมด (ตรวจแล้ว) โรงเรียนใช้ใบลากระดาษ
-- ธุรการ/ฝ่ายบุคคลเป็นคนคีย์เข้าระบบ — ครูไม่ได้ยื่นเอง จึงไม่มีขั้นตอนอนุมัติ
create table if not exists staff_leaves (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  leave_type   text not null,                    -- อ้างอิง leave_types.code
  day_portion  text not null default 'full',     -- full = เต็มวัน, morning/afternoon = ครึ่งวัน (0.5)
  reason       text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint staff_leaves_range_ok check (end_date >= start_date),
  constraint staff_leaves_portion_ok check (day_portion in ('full', 'morning', 'afternoon')),
  -- ครึ่งวันต้องเป็นวันเดียว ไม่งั้น "ลาครึ่งวัน 5 วันรวด" จะตีความไม่ได้
  constraint staff_leaves_half_single_day check (day_portion = 'full' or start_date = end_date)
);
create index if not exists staff_leaves_staff_idx on staff_leaves (staff_id, start_date);

-- ---------- 7) ประเภทการลา + โควตาต่อปีการศึกษา ----------
-- แยกเป็นตารางเพื่อให้ admin เพิ่มประเภทใหม่ (ลาพักผ่อน/ลาบวช) ได้เองโดยไม่ต้องแก้โค้ด
create table if not exists leave_types (
  code        text primary key,                  -- 'ลากิจ', 'ลาป่วย', 'ลาคลอด'
  sort_order  smallint not null default 0,
  active      boolean not null default true
);

create table if not exists leave_quotas (
  year        text not null,                     -- ปีการศึกษา เช่น '2569'
  leave_type  text not null references leave_types(code) on delete cascade,
  days        numeric(5,1) not null,             -- โควตาต่อปี (ไม่มีแถว = ไม่จำกัด/ไม่แสดงยอดคงเหลือ)
  primary key (year, leave_type),

  constraint leave_quotas_days_ok check (days >= 0)
);

-- ค่าตั้งต้นที่ผู้ใช้ยืนยันแล้ว 2026-07-25 (แก้ได้เองในหน้าตั้งค่างานบุคคล)
insert into leave_types (code, sort_order) values
  ('ลาป่วย', 1), ('ลากิจ', 2), ('ลาคลอด', 3)
on conflict (code) do nothing;

-- ---------- 8) ปีการศึกษา (วันเริ่มตั้งค่าได้) ----------
-- ผู้ใช้ระบุว่าเริ่ม "ราว 16 พ.ค. ของทุกปี แต่อาจเปลี่ยนแปลงได้" → ห้าม hardcode
-- รอบปี = [start_date ปีนี้, start_date ปีถัดไป) → เดือนเมษายนตกอยู่ในปีก่อนหน้าอัตโนมัติ
-- ทำให้ทุกวันในปฏิทินมีปีการศึกษาสังกัดเสมอ ไม่มีวันไหนตกหล่น
create table if not exists academic_years (
  year        text primary key,                  -- '2569'
  start_date  date not null
);

-- ---------- 9) ค่าตั้งงานบุคคล + บันทึกการซิงก์ ----------
create table if not exists hr_settings (
  key    text primary key,
  value  text
);
-- late_grace_minutes = ผ่อนผันกี่นาทีหลังเวลาเข้างานถึงจะนับว่าสาย (ยืนยัน: 5 นาที → 07:50)
insert into hr_settings (key, value) values ('late_grace_minutes', '5')
on conflict (key) do nothing;

-- serverless พังเงียบได้ ต้องเห็นว่าซิงก์ล่าสุดเมื่อไหร่ สำเร็จไหม
create table if not exists jibble_sync_log (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  scope        text,                             -- เช่น '2026-07' หรือ 'people'
  rows_synced  integer,
  message      text
);
create index if not exists jibble_sync_log_time_idx on jibble_sync_log (started_at desc);

-- ------------------------------------------------------------
-- RLS ของโมดูลฝ่ายบุคคล
-- select ทั่วไป = ผู้ล็อกอินทุกคน · insert/update = ฝ่ายบุคคลที่ได้รับอนุญาต · delete = admin
-- ยกเว้น staff_leaves + work_attendance ที่ครูทั่วไปเห็นเฉพาะของตัวเอง (ยืนยันกับผู้ใช้แล้ว)
-- ------------------------------------------------------------
alter table staff            enable row level security;
alter table work_attendance  enable row level security;
alter table work_month_sync  enable row level security;
alter table work_holidays    enable row level security;
alter table work_schedule    enable row level security;
alter table staff_leaves     enable row level security;
alter table leave_types      enable row level security;
alter table leave_quotas     enable row level security;
alter table academic_years   enable row level security;
alter table hr_settings      enable row level security;
alter table jibble_sync_log  enable row level security;

-- true ถ้าแถว staff นี้คือตัวผู้ใช้ที่ล็อกอินอยู่ (ใช้ให้ครูดูข้อมูลของตัวเองได้)
create or replace function is_my_staff_row(p_staff_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from staff where id = p_staff_id and user_id = auth.uid()
  );
$$;

-- staff: อ่านได้ทุกคนที่ล็อกอิน (หน้าต่าง ๆ ต้องแสดงชื่อบุคลากร)
drop policy if exists staff_select on staff;
create policy staff_select on staff for select using (auth.role() = 'authenticated');
drop policy if exists staff_insert on staff;
create policy staff_insert on staff for insert with check (has_department('บุคลากร'));
drop policy if exists staff_update on staff;
create policy staff_update on staff for update
  using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists staff_delete on staff;
create policy staff_delete on staff for delete using (is_admin());

-- work_attendance: ครูเห็นเฉพาะของตัวเอง · ฝ่ายบุคคล/admin เห็นทั้งหมด
drop policy if exists work_attendance_select on work_attendance;
create policy work_attendance_select on work_attendance for select
  using (has_department('บุคลากร') or is_my_staff_row(staff_id));
drop policy if exists work_attendance_insert on work_attendance;
create policy work_attendance_insert on work_attendance for insert
  with check (has_department('บุคลากร'));
drop policy if exists work_attendance_update on work_attendance;
create policy work_attendance_update on work_attendance for update
  using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists work_attendance_delete on work_attendance;
create policy work_attendance_delete on work_attendance for delete using (is_admin());

-- staff_leaves: ครูเห็นเฉพาะใบลาของตัวเอง (มีเหตุผลการลาซึ่งเป็นเรื่องส่วนตัว)
drop policy if exists staff_leaves_select on staff_leaves;
create policy staff_leaves_select on staff_leaves for select
  using (has_department('บุคลากร') or is_my_staff_row(staff_id));
drop policy if exists staff_leaves_insert on staff_leaves;
create policy staff_leaves_insert on staff_leaves for insert
  with check (has_department('บุคลากร'));
drop policy if exists staff_leaves_update on staff_leaves;
create policy staff_leaves_update on staff_leaves for update
  using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists staff_leaves_delete on staff_leaves;
create policy staff_leaves_delete on staff_leaves for delete using (is_admin());

-- ตารางอ้างอิงที่เหลือ: อ่านได้ทุกคนที่ล็อกอิน (หน้าสรุปต้องใช้คำนวณ) เขียนตามกติกาเดียวกัน
-- เขียนตรง ๆ ทีละตัวแทน dynamic SQL เพื่อให้ตรวจด้วยตาและ grep หา policy ได้ เหมือน policy อื่นในไฟล์นี้

drop policy if exists work_month_sync_select on work_month_sync;
create policy work_month_sync_select on work_month_sync for select using (auth.role() = 'authenticated');
drop policy if exists work_month_sync_insert on work_month_sync;
create policy work_month_sync_insert on work_month_sync for insert with check (has_department('บุคลากร'));
drop policy if exists work_month_sync_update on work_month_sync;
create policy work_month_sync_update on work_month_sync for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists work_month_sync_delete on work_month_sync;
create policy work_month_sync_delete on work_month_sync for delete using (is_admin());

drop policy if exists work_holidays_select on work_holidays;
create policy work_holidays_select on work_holidays for select using (auth.role() = 'authenticated');
drop policy if exists work_holidays_insert on work_holidays;
create policy work_holidays_insert on work_holidays for insert with check (has_department('บุคลากร'));
drop policy if exists work_holidays_update on work_holidays;
create policy work_holidays_update on work_holidays for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists work_holidays_delete on work_holidays;
create policy work_holidays_delete on work_holidays for delete using (is_admin());

drop policy if exists work_schedule_select on work_schedule;
create policy work_schedule_select on work_schedule for select using (auth.role() = 'authenticated');
drop policy if exists work_schedule_insert on work_schedule;
create policy work_schedule_insert on work_schedule for insert with check (has_department('บุคลากร'));
drop policy if exists work_schedule_update on work_schedule;
create policy work_schedule_update on work_schedule for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists work_schedule_delete on work_schedule;
create policy work_schedule_delete on work_schedule for delete using (is_admin());

drop policy if exists leave_types_select on leave_types;
create policy leave_types_select on leave_types for select using (auth.role() = 'authenticated');
drop policy if exists leave_types_insert on leave_types;
create policy leave_types_insert on leave_types for insert with check (has_department('บุคลากร'));
drop policy if exists leave_types_update on leave_types;
create policy leave_types_update on leave_types for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists leave_types_delete on leave_types;
create policy leave_types_delete on leave_types for delete using (is_admin());

drop policy if exists leave_quotas_select on leave_quotas;
create policy leave_quotas_select on leave_quotas for select using (auth.role() = 'authenticated');
drop policy if exists leave_quotas_insert on leave_quotas;
create policy leave_quotas_insert on leave_quotas for insert with check (has_department('บุคลากร'));
drop policy if exists leave_quotas_update on leave_quotas;
create policy leave_quotas_update on leave_quotas for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists leave_quotas_delete on leave_quotas;
create policy leave_quotas_delete on leave_quotas for delete using (is_admin());

drop policy if exists academic_years_select on academic_years;
create policy academic_years_select on academic_years for select using (auth.role() = 'authenticated');
drop policy if exists academic_years_insert on academic_years;
create policy academic_years_insert on academic_years for insert with check (has_department('บุคลากร'));
drop policy if exists academic_years_update on academic_years;
create policy academic_years_update on academic_years for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists academic_years_delete on academic_years;
create policy academic_years_delete on academic_years for delete using (is_admin());

drop policy if exists hr_settings_select on hr_settings;
create policy hr_settings_select on hr_settings for select using (auth.role() = 'authenticated');
drop policy if exists hr_settings_insert on hr_settings;
create policy hr_settings_insert on hr_settings for insert with check (has_department('บุคลากร'));
drop policy if exists hr_settings_update on hr_settings;
create policy hr_settings_update on hr_settings for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists hr_settings_delete on hr_settings;
create policy hr_settings_delete on hr_settings for delete using (is_admin());

drop policy if exists jibble_sync_log_select on jibble_sync_log;
create policy jibble_sync_log_select on jibble_sync_log for select using (auth.role() = 'authenticated');
drop policy if exists jibble_sync_log_insert on jibble_sync_log;
create policy jibble_sync_log_insert on jibble_sync_log for insert with check (has_department('บุคลากร'));
drop policy if exists jibble_sync_log_update on jibble_sync_log;
create policy jibble_sync_log_update on jibble_sync_log for update using (has_department('บุคลากร')) with check (has_department('บุคลากร'));
drop policy if exists jibble_sync_log_delete on jibble_sync_log;
create policy jibble_sync_log_delete on jibble_sync_log for delete using (is_admin());

-- ทางฉุกเฉินถ้าบล็อกนี้ทำให้อะไรพัง (ไม่กระทบฝ่ายวิชาการ เพราะเป็นตารางใหม่ล้วน):
-- alter table staff disable row level security;  -- ...ทำแบบเดียวกันกับตารางอื่นในบล็อกนี้

-- ============================================================
-- Migration: ยกฝ่ายวิชาการมาใช้ระบบสิทธิ์ระดับฝ่าย — ตัวเลือก C (2026-07-25)
-- ------------------------------------------------------------
-- เจตนา: คนที่อยู่ฝ่ายวิชาการและ admin กดอนุญาตแล้ว ทำงานในหน้าวิชาการได้เหมือน admin
--        **ยกเว้นการลบ** ซึ่งสงวนไว้ที่ is_admin() เท่านั้น (กติกา "แก้ได้แต่ลบไม่ได้")
--
-- ขอบเขต = เฉพาะ policy ที่ "ปัจจุบันเป็น admin-only และเป็นงานวิชาการ" เท่านั้น
--   ✅ แก้: subjects (insert/update) · students · student_year_placements · app_settings
--          · core_competencies · core_competency_elements · competency_source_weights
--          · competency_interpretation_levels · competency_assessments (insert)
--   ❌ ไม่แตะ: 67 จุดที่ใช้ can_edit_subject() (owner-based) — ครูเจ้าของวิชายังแก้ของตัวเอง
--             ได้เหมือนเดิมทุกประการ และฝ่ายวิชาการ *ไม่ได้* สิทธิ์แก้คะแนนวิชาคนอื่น
--   ❌ ไม่แตะ: subjects_delete (คงเป็น admin-only ตามกติกาไม่ลบ)
--   ❌ ไม่แตะ: profiles_update (การเลื่อน role เป็นงานผู้ดูแลระบบ ไม่ใช่งานวิชาการ)
--
-- ⚠ policy ที่เดิมเป็น `for all` (คลุม insert/update/delete รวมกัน) ต้องแตกเป็นรายคำสั่ง
--   ไม่งั้นการให้สิทธิ์ฝ่ายวิชาการจะพ่วงสิทธิ์ "ลบ" ไปด้วยโดยไม่ตั้งใจ
--   ทุกตารางมี policy _select ของตัวเองอยู่แล้ว การแตก _write จึงไม่กระทบการอ่าน
--
-- ย้อนกลับ: รันบล็อก "ย้อนกลับตัวเลือก C" ที่ comment ไว้ท้ายบล็อกนี้
-- ============================================================

-- ---------- subjects: สร้าง/แก้ข้อมูลวิชา (ลบยังเป็น admin เท่านั้น) ----------
drop policy if exists subjects_insert on subjects;
create policy subjects_insert on subjects for insert
  with check (is_admin() or has_department('วิชาการ'));

drop policy if exists subjects_update on subjects;
create policy subjects_update on subjects for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));

-- ---------- students ----------
drop policy if exists students_write on students;
drop policy if exists students_insert on students;
create policy students_insert on students for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists students_update on students;
create policy students_update on students for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists students_delete on students;
create policy students_delete on students for delete using (is_admin());

-- ---------- student_year_placements (ประวัติชั้น/ห้องรายปี) ----------
drop policy if exists student_year_placements_write on student_year_placements;
drop policy if exists student_year_placements_insert on student_year_placements;
create policy student_year_placements_insert on student_year_placements for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists student_year_placements_update on student_year_placements;
create policy student_year_placements_update on student_year_placements for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists student_year_placements_delete on student_year_placements;
create policy student_year_placements_delete on student_year_placements for delete using (is_admin());

-- ---------- app_settings (เช่น highest_grade ที่ rollover ใช้) ----------
drop policy if exists app_settings_write on app_settings;
drop policy if exists app_settings_insert on app_settings;
create policy app_settings_insert on app_settings for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists app_settings_update on app_settings;
create policy app_settings_update on app_settings for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists app_settings_delete on app_settings;
create policy app_settings_delete on app_settings for delete using (is_admin());

-- ---------- รายการกลางสมรรถนะหลัก 6 ด้าน ----------
drop policy if exists core_competencies_write on core_competencies;
drop policy if exists core_competencies_insert on core_competencies;
create policy core_competencies_insert on core_competencies for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists core_competencies_update on core_competencies;
create policy core_competencies_update on core_competencies for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists core_competencies_delete on core_competencies;
create policy core_competencies_delete on core_competencies for delete using (is_admin());

drop policy if exists core_elements_write on core_competency_elements;
drop policy if exists core_elements_insert on core_competency_elements;
create policy core_elements_insert on core_competency_elements for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists core_elements_update on core_competency_elements;
create policy core_elements_update on core_competency_elements for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists core_elements_delete on core_competency_elements;
create policy core_elements_delete on core_competency_elements for delete using (is_admin());

-- ---------- น้ำหนักแหล่งที่มา + เกณฑ์แปลผลสมรรถนะ ----------
drop policy if exists competency_source_weights_write on competency_source_weights;
drop policy if exists competency_source_weights_insert on competency_source_weights;
create policy competency_source_weights_insert on competency_source_weights for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists competency_source_weights_update on competency_source_weights;
create policy competency_source_weights_update on competency_source_weights for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists competency_source_weights_delete on competency_source_weights;
create policy competency_source_weights_delete on competency_source_weights for delete using (is_admin());

drop policy if exists competency_levels_write on competency_interpretation_levels;
drop policy if exists competency_levels_insert on competency_interpretation_levels;
create policy competency_levels_insert on competency_interpretation_levels for insert
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists competency_levels_update on competency_interpretation_levels;
create policy competency_levels_update on competency_interpretation_levels for update
  using (is_admin() or has_department('วิชาการ'))
  with check (is_admin() or has_department('วิชาการ'));
drop policy if exists competency_levels_delete on competency_interpretation_levels;
create policy competency_levels_delete on competency_interpretation_levels for delete using (is_admin());

-- ---------- สร้างกิจกรรม/กิจวัตรประเมินสมรรถนะ ----------
-- เดิม: เจ้าของ (owner_id) หรือ admin — เพิ่มฝ่ายวิชาการเข้าไป ส่วน update/delete
-- ยังใช้ can_edit_competency_assessment() (owner-based) เหมือนเดิม ไม่แตะ
drop policy if exists competency_assessments_insert on competency_assessments;
create policy competency_assessments_insert on competency_assessments for insert
  with check (owner_id = auth.uid() or is_admin() or has_department('วิชาการ'));

-- ------------------------------------------------------------
-- ย้อนกลับตัวเลือก C (คืนทุก policy ให้เป็น admin-only แบบเดิม)
-- ------------------------------------------------------------
-- drop policy if exists subjects_insert on subjects;
-- create policy subjects_insert on subjects for insert with check (is_admin());
-- drop policy if exists subjects_update on subjects;
-- create policy subjects_update on subjects for update using (is_admin()) with check (is_admin());
-- drop policy if exists students_insert on students;
-- drop policy if exists students_update on students;
-- drop policy if exists students_delete on students;
-- create policy students_write on students for all using (is_admin()) with check (is_admin());
-- drop policy if exists student_year_placements_insert on student_year_placements;
-- drop policy if exists student_year_placements_update on student_year_placements;
-- drop policy if exists student_year_placements_delete on student_year_placements;
-- create policy student_year_placements_write on student_year_placements for all using (is_admin()) with check (is_admin());
-- drop policy if exists app_settings_insert on app_settings;
-- drop policy if exists app_settings_update on app_settings;
-- drop policy if exists app_settings_delete on app_settings;
-- create policy app_settings_write on app_settings for all using (is_admin()) with check (is_admin());
-- drop policy if exists core_competencies_insert on core_competencies;
-- drop policy if exists core_competencies_update on core_competencies;
-- drop policy if exists core_competencies_delete on core_competencies;
-- create policy core_competencies_write on core_competencies for all using (is_admin()) with check (is_admin());
-- drop policy if exists core_elements_insert on core_competency_elements;
-- drop policy if exists core_elements_update on core_competency_elements;
-- drop policy if exists core_elements_delete on core_competency_elements;
-- create policy core_elements_write on core_competency_elements for all using (is_admin()) with check (is_admin());
-- drop policy if exists competency_source_weights_insert on competency_source_weights;
-- drop policy if exists competency_source_weights_update on competency_source_weights;
-- drop policy if exists competency_source_weights_delete on competency_source_weights;
-- create policy competency_source_weights_write on competency_source_weights for all using (is_admin()) with check (is_admin());
-- drop policy if exists competency_levels_insert on competency_interpretation_levels;
-- drop policy if exists competency_levels_update on competency_interpretation_levels;
-- drop policy if exists competency_levels_delete on competency_interpretation_levels;
-- create policy competency_levels_write on competency_interpretation_levels for all using (is_admin()) with check (is_admin());
-- drop policy if exists competency_assessments_insert on competency_assessments;
-- create policy competency_assessments_insert on competency_assessments for insert with check (owner_id = auth.uid() or is_admin());

-- ============================================================
-- Migration: จำกัดการอ่านทะเบียนบุคลากรให้เฉพาะฝ่ายบุคคลและเจ้าตัว (2026-07-25)
-- ------------------------------------------------------------
-- เดิม staff_select = ผู้ล็อกอินทุกคน → ครูทั่วไปอ่านทะเบียนได้ทั้งโรงเรียน
-- (ชื่อ · อีเมล · ใครได้รับอนุญาตเข้าสาย · ใครได้รับการอนุโลม) ซึ่งเป็นข้อมูลของฝ่ายบุคคล
--
-- ผลข้างเคียงที่เป็นบั๊กจริง: `work_attendance`/`staff_leaves` ถูก RLS กรองให้เห็นเฉพาะของตัวเอง
-- อยู่แล้ว แต่รายชื่อยังอ่านได้ครบ → ครูทั่วไปเปิดหน้าสรุปเวลาทำงานจะเห็น
-- "ทุกคนขาดทุกวัน" เพราะมีชื่อแต่ไม่มีข้อมูลเวลา — รายงานผิดแบบน่าตกใจ
--
-- แก้ให้สอดคล้องกับ work_attendance_select / staff_leaves_select ที่ทำถูกอยู่แล้ว
-- หมายเหตุ: is_my_staff_row() เป็น security definer จึงยังทำงานได้ตามปกติ
--          และ getStaffNameForUser() ฝั่งหน้าเว็บอ่านแถวของตัวเองได้ (ชื่อบนโปรไฟล์ยังขึ้นปกติ)
-- ============================================================
drop policy if exists staff_select on staff;
create policy staff_select on staff for select
  using (has_department('บุคลากร') or user_id = auth.uid());

-- ย้อนกลับ:
-- drop policy if exists staff_select on staff;
-- create policy staff_select on staff for select using (auth.role() = 'authenticated');
