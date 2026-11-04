-- ============================================================================
-- WISSENDURST'27 — 0005_participant_id_format
-- Switch participant IDs from random 5-char codes to sequential WD27/0001,
-- WD27/0002, … Uniqueness is guaranteed by the sequence + the existing unique
-- constraint on profiles.participant_id.
-- ============================================================================

create sequence if not exists public.participant_seq;

-- New generator: WD27/ + zero-padded sequence value.
create or replace function public.assign_participant_id()
returns trigger language plpgsql as $$
begin
  if new.participant_id is not null and new.participant_id <> '' then
    return new;
  end if;
  new.participant_id :=
    'W27/E/' || lpad(nextval('public.participant_seq')::text, 4, '0');
  return new;
end $$;

-- The BEFORE INSERT trigger from 0001 already calls assign_participant_id();
-- replacing the function above is enough. (Re-created here for idempotency.)
drop trigger if exists trg_assign_participant_id on public.profiles;
create trigger trg_assign_participant_id before insert on public.profiles
  for each row execute function public.assign_participant_id();

-- ── OPTIONAL: renumber EXISTING users into the new format ────────────────────
-- participant_id is not referenced by any foreign key (registrations use the
-- profile UUID), so renumbering is safe. Comment this block out if you'd rather
-- keep existing users' current IDs and only apply the new format going forward.
do $$
declare
  r record;
begin
  perform setval('public.participant_seq', 1, false); -- next value = 1
  for r in
    select id from public.profiles order by created_at asc, id asc
  loop
    update public.profiles
      set participant_id =
        'W27/E/' || lpad(nextval('public.participant_seq')::text, 4, '0')
      where id = r.id;
  end loop;
end $$;
