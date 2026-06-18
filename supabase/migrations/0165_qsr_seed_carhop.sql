-- 0165_qsr_seed_carhop.sql
--
-- Seeds the prototype demo lesson: "The Perfect Stall Approach" (Carhop
-- Service) — one published course + lesson + the 8 card types from spec §6.
-- Card text is reconstructed from the prototypes; reconcile verbatim against
-- cards.jsx when the prototype folder is attached. Video/image assets are
-- left null (uploaded in the Mux / media milestones); poll results start at 0
-- and are computed server-side.
--
-- Idempotent: only seeds if the course isn't already present.

do $$
declare
  v_course uuid;
  v_lesson uuid;
begin
  select id into v_course from qsr_courses where title = 'The Perfect Stall Approach' limit 1;
  if v_course is not null then
    return;
  end if;

  insert into qsr_courses (title, category, description, status, est_minutes, points)
  values (
    'The Perfect Stall Approach', 'Carhop Service',
    'The four beats that turn a parked car into a five-star visit.',
    'published', 5, 70
  )
  returning id into v_course;

  insert into qsr_lessons (course_id, title, module, ord)
  values (v_course, 'The Perfect Stall Approach', 'Carhop Service', 0)
  returning id into v_lesson;

  insert into qsr_cards (lesson_id, ord, type, data) values
    (v_lesson, 0, 'intro',
     '{"kicker":"Carhop Service","icon":"cup","title":"The Perfect Stall Approach","body":"You''re the face of the drive-in. Let''s lock in the four beats that turn a parked car into a five-star visit.","meta":[{"v":"8","k":"cards"},{"v":"5 min","k":"to finish"},{"v":"+70","k":"points"}]}'::jsonb),
    (v_lesson, 1, 'steps',
     '{"kicker":"The Framework","title":"Four beats, every stall","steps":[{"t":"Acknowledge fast","d":"Wave or make eye contact within 10 seconds of the order light."},{"t":"Greet with energy","d":"\"Welcome to SONIC — thanks for waiting!\" Smile, and use their name if you have it."},{"t":"Confirm the order","d":"Repeat it back, and call out anything hot or frozen so it lands fresh."},{"t":"Close the stall","d":"Hand off, thank them, and invite them back. They leave smiling."}]}'::jsonb),
    (v_lesson, 2, 'image',
     '{"kicker":"Read the lot","title":"The order light is your start line","body":"The moment a stall''s light comes on, the clock starts. Scan the lot on every pass so no light waits.","imageUrl":null}'::jsonb),
    (v_lesson, 3, 'video',
     '{"kicker":"Watch","title":"A five-star stall, start to finish","body":"Watch a veteran run all four beats in one smooth approach.","muxPlaybackId":null,"gate":true,"threshold":0.9}'::jsonb),
    (v_lesson, 4, 'quiz',
     '{"kicker":"Quick check","points":15,"q":"A guest''s order light comes on. How fast should you acknowledge them?","options":["Within 10 seconds","After you finish your current task","Within about two minutes"],"answer":0,"explain":"Acknowledge within 10 seconds — even a wave. Fast eye contact tells the guest they''re seen."}'::jsonb),
    (v_lesson, 5, 'reveal',
     '{"kicker":"Pro tip","title":"The hot & cold call-out","reveal":"Name anything hot or frozen as you hand it off — \"Here''s your hot Coney and your cold Slush.\" It sets expectations and shows you''ve got their order right."}'::jsonb),
    (v_lesson, 6, 'poll',
     '{"kicker":"Crew pulse","q":"What''s the toughest beat to nail during a rush?","options":["Acknowledging fast","Greeting with energy","Confirming the order","Closing the stall"],"results":[0,0,0,0]}'::jsonb),
    (v_lesson, 7, 'done',
     '{"title":"Stall mastered!","body":"You''ve got the four beats down. Bring that energy to every light.","points":70}'::jsonb);
end $$;

notify pgrst, 'reload schema';
