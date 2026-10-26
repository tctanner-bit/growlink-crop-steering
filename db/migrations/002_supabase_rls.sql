-- Row-level security for Supabase. The web app and controller use a server-side Postgres
-- connection (table owner, bypasses RLS) and scope every query by owner. These policies
-- make direct supabase-js access from a browser safe by default. No-op outside Supabase.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_proc where proname = 'uid') then
    execute 'alter table connections enable row level security';
    execute 'alter table rooms enable row level security';
    execute 'alter table room_state enable row level security';
    execute 'alter table readings enable row level security';
    execute 'alter table events enable row level security';
    execute 'alter table valve_runs enable row level security';
    execute 'alter table day_summaries enable row level security';
    execute 'alter table reviews enable row level security';
    execute 'alter table commands enable row level security';
    execute 'alter table controller_status enable row level security';

    execute $p$create policy connections_owner on connections for select using (owner_id = auth.uid())$p$;
    execute $p$create policy rooms_owner on rooms for select using (connection_id in (select id from connections where owner_id = auth.uid()))$p$;
    execute $p$create policy room_state_owner on room_state for select using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = auth.uid()))$p$;
    execute $p$create policy readings_owner on readings for select using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = auth.uid()))$p$;
    execute $p$create policy events_owner on events for select using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = auth.uid()))$p$;
    execute $p$create policy reviews_owner on reviews for select using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = auth.uid()))$p$;
    execute $p$create policy day_summaries_owner on day_summaries for select using (room_id in (select r.id from rooms r join connections c on c.id = r.connection_id where c.owner_id = auth.uid()))$p$;
  end if;
end $$;
