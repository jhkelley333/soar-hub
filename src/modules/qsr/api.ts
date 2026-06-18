// SOAR QSR — client data access. Reads go straight through supabase-js under
// RLS (published courses are readable by any signed-in user; authors see all).
// Server-authoritative actions (scoring, progress) get Netlify functions in
// later milestones.
import { supabase } from "@/lib/supabase";

export interface QsrCourseSummary {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  status: "draft" | "published";
  est_minutes: number | null;
  points: number;
  lesson_count: number;
  card_count: number;
}

export async function listQsrCourses(): Promise<QsrCourseSummary[]> {
  const { data, error } = await supabase
    .from("qsr_course_summary")
    .select("id, title, category, description, status, est_minutes, points, lesson_count, card_count")
    .order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as QsrCourseSummary[];
}
