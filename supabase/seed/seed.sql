-- ============================================================================
-- WISSENDURST'27 — seed data (sample events)
-- Run AFTER the migrations. Safe to re-run (upserts on slug).
-- ============================================================================

insert into public.events
  (slug, title, short_description, description, category, rules, eligibility,
   registration_fee, venue, event_date, start_time, end_time,
   max_participants, registration_open, featured)
values
  ('clinical-skills-workshop',
   'Clinical Skills Workshop',
   'Hands-on stations in suturing, IV access and basic life support.',
   'A practical, station-based workshop led by senior clinicians. Rotate through suturing, cannulation, airway and BLS stations with real feedback. Bring your curiosity; kits are provided.',
   'workshop',
   '["Open to MBBS and allied-health students","Carry your college ID","Wear closed footwear; aprons provided","Batches of 20 per rotation, arrive 15 minutes early"]'::jsonb,
   'MBBS / BDS / Nursing / Allied-health students',
   25000, 'Skills Lab, Block C', '2027-02-12', '09:30', '13:00', 60, true, true),

  ('the-medical-debate',
   'The Medical Ethics Debate',
   'Two teams, one dilemma, no easy answers.',
   'A structured debate on a contemporary bioethics motion. Teams argue for and against, judged on evidence, clarity and rebuttal. Motions released 48 hours prior.',
   'debate',
   '["Teams of two","6 minutes constructive + 3 minutes rebuttal per side","Evidence must be citable","Decorum is scored"]'::jsonb,
   'Open to all healthcare students',
   15000, 'Auditorium A', '2027-02-12', '14:00', '17:00', 32, true, true),

  ('poster-presentation',
   'Poster Presentation',
   'Present your research on a single, striking board.',
   'Showcase original research, case reports or reviews. Posters are displayed through the day; a panel visits each during the judging window.',
   'poster',
   '["A0 portrait, printed by participant","Presenting author must register","3-minute walkthrough to judges","Plagiarism = disqualification"]'::jsonb,
   'Any student with original work',
   20000, 'Concourse, Ground Floor', '2027-02-13', '10:00', '15:00', null, true, true),

  ('paper-presentation',
   'Paper Presentation',
   'Eight minutes to make your case to the room.',
   'Oral presentation of original research or a systematic review, followed by Q&A. Slides submitted the night before.',
   'paper',
   '["8-minute talk + 2-minute Q&A","Max 12 slides","One presenting author","Submit slides by 2027-02-12 20:00"]'::jsonb,
   'Under- and post-graduate students',
   20000, 'Seminar Hall 2', '2027-02-13', '09:30', '13:00', 40, true, false),

  ('diagnostic-challenge',
   'The Diagnostic Challenge',
   'A rapid-fire clinical reasoning competition.',
   'Teams race through image stops, ECGs, spot diagnoses and short clinical vignettes. Fastest accurate team wins.',
   'competition',
   '["Teams of three","No phones during rounds","Negative marking in the final","Tie-breaker is a buzzer round"]'::jsonb,
   'Clinical-year students',
   30000, 'Lecture Theatre 1', '2027-02-13', '15:00', '18:00', 24, true, false),

  ('research-methodology-primer',
   'Research Methodology Primer',
   'From question to publishable design in one session.',
   'An academic session on framing research questions, study design, sampling and basic biostatistics, with worked examples.',
   'academic',
   '["Bring a laptop","Notes shared afterwards","Interactive; questions encouraged"]'::jsonb,
   'Open to all',
   10000, 'Seminar Hall 1', '2027-02-14', '10:00', '12:30', null, true, false)
on conflict (slug) do update set
  title = excluded.title,
  short_description = excluded.short_description,
  description = excluded.description,
  category = excluded.category,
  rules = excluded.rules,
  eligibility = excluded.eligibility,
  registration_fee = excluded.registration_fee,
  venue = excluded.venue,
  event_date = excluded.event_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  max_participants = excluded.max_participants,
  featured = excluded.featured;

-- ── Make yourself an admin ──────────────────────────────────────────────────
-- 1. Sign up through the app first (creates auth user + profile).
-- 2. Then run, with your email:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
