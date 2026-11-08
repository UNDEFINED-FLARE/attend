-- UniAttend 0006 — fix: adding students failed on Supabase with
-- "UPDATE requires a WHERE clause". Supabase loads pg_safeupdate for API
-- requests, which rejects an UPDATE with no WHERE even inside a function, and
-- import_students() validated rows with one. Same function, plus that WHERE.
-- CREATE OR REPLACE keeps the function's owner and EXECUTE grants.

-- p_rows: [{"student_number","full_name","email","module_code"}...]
create or replace function uniattend.import_students(p_inst uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pattern text; n_rows int; ins int := 0; upd int := 0; enr int := 0; errors jsonb;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 10000 then raise exception 'import at most 10,000 rows at a time'; end if;
  if n_rows > 50 and not uniattend.plan_feature(p_inst, 'bulk_import') then
    raise exception 'bulk import of more than 50 students needs the Professional plan' using errcode = 'P0001';
  end if;
  select student_number_pattern into pattern from uniattend.institutions where id = p_inst;

  drop table if exists pg_temp._imp;
  create temp table _imp on commit drop as
  select n::int as row_no,
         upper(trim(r->>'student_number')) as sn,
         left(trim(r->>'full_name'), 200) as full_name,
         nullif(lower(trim(r->>'email')), '') as email,
         nullif(upper(trim(r->>'module_code')), '') as module_code,
         null::text as error
  from jsonb_array_elements(p_rows) with ordinality t(r, n);

  update pg_temp._imp set error = case
    when sn is null or sn = '' then 'student number is missing'
    when pattern is not null and sn !~ pattern then 'student number does not match the institution format'
    when full_name is null or full_name = '' then 'name is missing'
    when email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'email is not valid'
    when module_code is not null and not exists (select 1 from uniattend.modules m
         where m.institution_id = p_inst and upper(m.code) = pg_temp._imp.module_code and m.deleted_at is null)
      then 'unknown module code ' || module_code
  end
  -- Every row starts with error null, so this matches all of them. The clause
  -- is required: Supabase's pg_safeupdate rejects UPDATE without WHERE.
  where error is null;
  -- a student number repeated with different names in one file is an error, not a merge
  update pg_temp._imp i set error = 'student number appears more than once with different details'
  where error is null and exists (select 1 from pg_temp._imp j where j.sn = i.sn and j.row_no <> i.row_no
                                  and (j.full_name is distinct from i.full_name or j.email is distinct from i.email));

  with up as (
    insert into uniattend.students as s (institution_id, student_number, full_name, email)
    select distinct on (sn) p_inst, sn, full_name, email from pg_temp._imp where error is null order by sn, row_no
    on conflict (institution_id, student_number) do update
      set full_name = excluded.full_name, email = coalesce(excluded.email, s.email)
      where s.deleted_at is null
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into ins, upd from up;

  insert into uniattend.module_enrolments (institution_id, module_id, student_id)
  select distinct p_inst, m.id, s.id
  from pg_temp._imp i
  join uniattend.students s on s.institution_id = p_inst and s.student_number = i.sn
  join uniattend.modules m on m.institution_id = p_inst and upper(m.code) = i.module_code and m.deleted_at is null
  where i.error is null and i.module_code is not null
  on conflict (module_id, student_id) do nothing;
  get diagnostics enr = row_count;

  select coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'student_number', sn, 'error', error) order by row_no), '[]')
    into errors from pg_temp._imp where error is not null;
  perform uniattend.write_audit(p_inst, 'import', 'students', null,
    jsonb_build_object('rows', n_rows, 'inserted', ins, 'updated', upd, 'enrolled', enr, 'errors', jsonb_array_length(errors)));
  return jsonb_build_object('inserted', ins, 'updated', upd, 'enrolled', enr, 'errors', errors);
end $$;
