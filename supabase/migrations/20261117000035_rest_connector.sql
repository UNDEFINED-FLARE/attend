-- UniAttend 0035 — a connection that reads the university's own JSON API.
--
-- A new kind of connection, 'rest': UniAttend calls an https address on the
-- institution's system (with a bearer token, an API-key header or OAuth client
-- credentials), follows its paging, and maps each record's fields to students,
-- lecturers and their modules. The settings (address, paging, field mapping) live
-- in the connection's options; the credential is encrypted by the app like every
-- other token. Everything else — scheduling, the worker, runs, errors and the
-- safety rules for removing enrolments — is shared with Moodle and roster links.

alter table uniattend.integrations drop constraint if exists integrations_kind_check;
alter table uniattend.integrations add constraint integrations_kind_check check (kind in ('moodle', 'feed', 'api', 'rest'));

create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0035: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0035: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;
do $$
begin
  perform uniattend._rewrite('save_integration', 'p_kind not in (''moodle'',''feed'',''api'')',
                             'p_kind not in (''moodle'',''feed'',''api'',''rest'')');
  -- The worker picks up due API connections too.
  perform uniattend._rewrite('integration_claim', 'i.kind in (''moodle'',''feed'')', 'i.kind in (''moodle'',''feed'',''rest'')');
end $$;
drop function uniattend._rewrite(text, text, text, int);

insert into uniattend.schema_versions (version, name) values ('20261117000035', 'rest_connector')
on conflict (version) do nothing;
