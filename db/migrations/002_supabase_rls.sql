-- Row-level security for Supabase. The web app and controller connect server-side as the
-- table owner (bypasses RLS) and scope every query by owner. The browser never queries these
-- tables, so RLS is on everywhere: deny by default, owner read-only on non-secret tables.
-- `connections` has no policy at all — sealed API keys are never reachable through the Data API.
-- No-op outside Supabase.
do $$
declare t text;
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_proc where proname = 'uid') then
    foreach t in array array['connections','rooms','room_state','readings','events','valve_runs','day_summaries','reviews','commands','controller_status','schema_migrations'] loop
      execute format('alter table %I enable row level security', t);
    end loop;
    execute $p$create policy rooms_owner on rooms for select to authenticated using (connection_id in (select id from connections where owner_id = (select auth.uid())))$p$;
    foreach t in array array['room_state','readings','events','reviews','day_summaries'] loop
      execute format($p$create policy %I on %I for select to authenticated using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = (select auth.uid())))$p$, t || '_owner', t);
    end loop;
  end if;
end $$;
