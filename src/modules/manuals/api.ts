// Manual & Guide Search — client API. Calls the search_manuals RPC, which is
// SECURITY INVOKER, so results are already RLS-scoped to the caller.
import { supabase } from "@/lib/supabase";

export interface ManualSearchHit {
  chunk_id: string;
  manual_id: string;
  manual_title: string;
  section_path: string | null;
  version_label: string;
  snippet: string; // ts_headline output: matches wrapped in <mark>…</mark>
  rank: number;
}

export async function searchManuals(
  q: string,
  manualId: string | null = null,
  maxResults = 20,
): Promise<ManualSearchHit[]> {
  const { data, error } = await supabase.rpc("search_manuals", {
    q,
    manual_id: manualId,
    max_results: maxResults,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualSearchHit[];
}
