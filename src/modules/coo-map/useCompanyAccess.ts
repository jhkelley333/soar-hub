// The caller's company grants, read directly (RLS returns only their own rows
// via the "read own company_access" policy). Multi-company = COO-map access.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useCompanyAccess() {
  const q = useQuery({
    queryKey: ["company-access"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("company_access").select("company_id");
      if (error) throw error;
      return (data ?? []).map((r) => r.company_id as string);
    },
    staleTime: 10 * 60_000,
  });
  return { companyIds: q.data ?? [], multiCompany: (q.data?.length ?? 0) >= 2, isLoading: q.isLoading };
}
