// Manual SMS nudge to the assigned approver when a quick response is needed.
// Texts a heads-up + a link to the PAF queue. Server validates approver/phone.
import { useMutation } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { textPafApprover } from "./api";
import type { PafRow } from "./types";

export function TextApproverAction({ paf }: { paf: PafRow }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => textPafApprover(paf.id),
    onSuccess: (r) => toast.push(`Heads-up text sent to ${r.to}.`, "success"),
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't send the text.", "error"),
  });
  return (
    <Button type="button" variant="ghost" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
      <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
      {m.isPending ? "Texting…" : "Text approver"}
    </Button>
  );
}
