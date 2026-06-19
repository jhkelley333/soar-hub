-- 0170_qsr_course_summary_total_points.sql
-- SOAR QSR — add total earnable points to the course summary: the course's
-- completion points PLUS every quiz card's points. So course cards reflect
-- what a learner can actually earn, not just the completion bonus.

create or replace view qsr_course_summary with (security_invoker = true) as
  select c.id, c.title, c.category, c.description, c.status, c.est_minutes, c.points,
         count(distinct l.id) as lesson_count,
         count(distinct cd.id) as card_count,
         coalesce(c.points, 0) + coalesce(sum(
           case when cd.type = 'quiz'
             then coalesce(nullif(cd.data ->> 'points', '')::int, 0)
             else 0 end
         ), 0) as total_points
  from qsr_courses c
  left join qsr_lessons l on l.course_id = c.id
  left join qsr_cards cd on cd.lesson_id = l.id
  group by c.id;

grant select on qsr_course_summary to authenticated;

notify pgrst, 'reload schema';
