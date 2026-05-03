import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { listVendors } from "../api";

export function VendorsTab() {
  const query = useQuery({
    queryKey: ["work-orders", "vendors"],
    queryFn: listVendors,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load vendors"
        description={(query.error as Error)?.message ?? "Try again in a moment."}
      />
    );
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No vendors listed yet"
        description="Vendors are sourced from the operations Google Sheet."
      />
    );
  }

  const headers = Object.keys(rows[0]);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0">
                {headers.map((h) => (
                  <td key={h} className="px-5 py-3 text-zinc-700">
                    {row[h] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
