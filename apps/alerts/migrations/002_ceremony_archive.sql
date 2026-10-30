-- Apply after 001 with the migration role, before starting the updated Worker.
-- All legacy pending entries move or remain in the checkpoint in this transaction.
begin;
lock table public.alerts_state in exclusive mode;
lock table public.alerts_lock in exclusive mode;

create table public.alerts_ceremonies (
  sid text primary key,
  ceremony jsonb not null check (
    jsonb_typeof(ceremony->'shares') is not distinct from 'object' and not ceremony ? 'at'
    and octet_length(ceremony::text) <= 65536
  )
);
alter table public.alerts_ceremonies enable row level security;
revoke all on public.alerts_ceremonies from anon, authenticated;
grant all on public.alerts_ceremonies to service_role;

insert into public.alerts_ceremonies(sid,ceremony)
  select p.key,p.value from public.alerts_state s, lateral jsonb_each(s.value->'pending') p
  where s.key='aegis' and not p.value ? 'at';
update public.alerts_state s set value = s.value || jsonb_build_object(
  'pending', coalesce((select jsonb_object_agg(p.key,p.value) from jsonb_each(s.value->'pending') p where p.value ? 'at'), '{}'::jsonb),
  'archiveVersion',1,'revision',1) where s.key='aegis';
-- Invalidate an invocation holding the pre-migration JSON snapshot.
update public.alerts_lock set owner=null,until_at=null;

-- The old Worker must not overwrite an archived checkpoint through the generic RPC.
create or replace function public.alerts_save_state(state_key text, state_value jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if state_key='aegis' then raise exception 'use atomic chronology commit'; end if;
  insert into alerts_state values(state_key,state_value) on conflict(key) do update set value=excluded.value;
end $$;

create function public.alerts_check_chronology_lease(holder uuid, expected_revision bigint)
returns void language plpgsql set search_path = public as $$
begin
  perform 1 from alerts_lock where owner=holder and until_at>clock_timestamp() for update;
  if not found then raise exception 'chronology lease lost'; end if;
  if coalesce((select (value->>'revision')::bigint from alerts_state where key='aegis'),0) <> expected_revision then
    raise exception 'chronology revision changed';
  end if;
end $$;

-- Return one explicit entry per requested SID, including NULL for new ceremonies.
-- A JSON object avoids PostgREST row limits silently truncating recovery.
create function public.alerts_load_ceremonies(holder uuid, expected_revision bigint, sids jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare result jsonb;
begin
  perform alerts_check_chronology_lease(holder,expected_revision);
  if jsonb_typeof(sids)<>'array' or jsonb_array_length(sids)>1000 then raise exception 'archive batch limit'; end if;
  select coalesce(jsonb_object_agg(s.sid,c.ceremony),'{}'::jsonb) into result
    from jsonb_array_elements_text(sids) s(sid) left join alerts_ceremonies c on c.sid=s.sid;
  if octet_length(result::text)>8388608 then raise exception 'archive recovery byte limit'; end if;
  return result;
end $$;

create function public.alerts_save_chronology(holder uuid, expected_revision bigint, state_value jsonb,
  archive_writes jsonb, archive_deletes jsonb)
returns bigint language plpgsql set search_path = public as $$
begin
  perform alerts_check_chronology_lease(holder,expected_revision);
  if (state_value->>'revision')::bigint is distinct from expected_revision+1
    or (state_value->>'archiveVersion')::integer is distinct from 1
    or jsonb_typeof(state_value->'pending') is distinct from 'object'
    or octet_length(state_value::text)>8388608
    or jsonb_typeof(archive_writes) is distinct from 'object' or octet_length(archive_writes::text)>8388608
    or jsonb_typeof(archive_deletes) is distinct from 'array'
    or jsonb_array_length(archive_deletes)>1000
    or (select count(*) from jsonb_each(archive_writes))>1000
    or (select count(*) from jsonb_each(state_value->'pending'))>10000
    or exists(select 1 from jsonb_each(state_value->'pending') p where not p.value ? 'at')
    or (state_value->>'cursor')::bigint < coalesce((select (value->>'cursor')::bigint from alerts_state where key='aegis'),0)
    then raise exception 'invalid chronology batch'; end if;
  delete from alerts_ceremonies where sid in (select jsonb_array_elements_text(archive_deletes));
  insert into alerts_ceremonies(sid,ceremony) select key,value from jsonb_each(archive_writes)
    on conflict(sid) do update set ceremony=excluded.ceremony;
  insert into alerts_state values('aegis',state_value) on conflict(key) do update set value=excluded.value;
  -- Check expiry again after writes. Any failure rolls back archive and checkpoint together.
  perform 1 from alerts_lock where owner=holder and until_at>clock_timestamp();
  if not found then raise exception 'chronology lease lost'; end if;
  return expected_revision+1;
end $$;

revoke execute on function public.alerts_check_chronology_lease(uuid,bigint),
  public.alerts_load_ceremonies(uuid,bigint,jsonb), public.alerts_save_chronology(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.alerts_check_chronology_lease(uuid,bigint),
  public.alerts_load_ceremonies(uuid,bigint,jsonb), public.alerts_save_chronology(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
commit;
