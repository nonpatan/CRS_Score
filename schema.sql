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
create policy subjects_insert on subjects for insert with check (is_admin() or owner_id = auth.uid());
drop policy if exists subjects_update on subjects;
create policy subjects_update on subjects for update using (is_admin() or owner_id = auth.uid()) with check (is_admin() or owner_id = auth.uid());
drop policy if exists subjects_delete on subjects;
create policy subjects_delete on subjects for delete using (is_admin() or owner_id = auth.uid());

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
