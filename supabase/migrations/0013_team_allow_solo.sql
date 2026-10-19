-- ============================================================================
-- WISSENDRUST'27 — 0013_team_allow_solo
-- A single person may join a team event on their own (team of one). The only
-- limit is the maximum team size; the minimum is now 1. Duplicate membership
-- is already prevented by register_team (a participant who already holds an
-- active registration for the event — solo OR on any team — is rejected), so
-- this only relaxes the lower bound.
-- ============================================================================

alter table public.events alter column team_min set default 1;
update public.events set team_min = 1 where team_min <> 1;
