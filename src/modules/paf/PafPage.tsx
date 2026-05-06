// /paf — submit form + history list. Visible to anyone with a PAF
// reading role; the submit form only renders for submitter roles
// (DO/GM/SDO/Admin).

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { listPafs } from "./api";
import { PafForm } from "./PafForm";
import { PafTable } from "./PafTable";

export function PafPage() {
  const { profile } = useAuth();
  const [view, setView] = useState<"list" | "submit">("list");

  const query = useQuery({
    queryKey: ["paf-list"],
    queryFn: listPafs,
  });

  const canSubmit = ["do", "gm", "sdo", "admin"].includes(profile?.role ?? "");
  const canProcess = profile?.role === "payroll" || profile?.role === "admin";

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="PAF" description="Loading…" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="PAF" />
        <EmptyState
          title="Couldn't load PAF data"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }

  const data = query.data;

  return (
    <>
      <PageHeader
        title="Payroll Adjustment Forms"
        description={`${data.pafs.length} PAF${data.pafs.length === 1 ? "" : "s"} in your scope.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canProcess && (
              <Link to="/paf/queue">
                <Button variant="ghost" size="sm">
                  Payroll queue
                </Button>
              </Link>
            )}
            {canSubmit && view === "list" && (
              <Button onClick={() => setView("submit")}>
                <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                New PAF
              </Button>
            )}
            {view === "submit" && (
              <Button variant="ghost" size="sm" onClick={() => setView("list")}>
                Back to history
              </Button>
            )}
          </div>
        }
      />

      {view === "submit" && canSubmit && (
        <PafForm onSubmitted={() => setView("list")} />
      )}

      {view === "list" && (
        <Card>
          {data.pafs.length === 0 ? (
            <EmptyState
              title="No PAFs yet"
              description={
                canSubmit
                  ? "Click + New PAF to submit one."
                  : "PAFs in your scope will appear here once submitted."
              }
            />
          ) : (
            <PafTable rows={data.pafs} actions="view" />
          )}
        </Card>
      )}
    </>
  );
}
