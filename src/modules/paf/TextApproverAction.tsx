// Manual nudge to the assigned approver when a quick response is needed.
// Emails them a heads-up + a link to the PAF queue (and texts too, once
// Telnyx is configured). Server validates approver/contact info.
import { useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { textPafApprover } from "./api";
import type { PafRow } from "./types";

function channelLabel(channels: ("email" | "text")[]): string {
  const hasEmail = channels.includes("email");
  const hasText = channels.includes("text");
  if (hasEmail && hasText) return "by text & email";
  if (hasText) return "by text";
  if (hasEmail) return "by email";
  return "";
}

export function TextApproverAction({ paf }: { paf: PafRow }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => textPafApprover(paf.id),
    onSuccess: (r) =>
      toast.push(`Notified ${r.to} ${channelLabel(r.channels)}.`.trim(), "success"),
    onError: (e: unknown) =>
      toast.push((e as Error)?.message ?? "Couldn't notify the approver.", "error"),
  });
  return (
    <Button type="button" variant="ghost" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
      <Bell className="h-3.5 w-3.5" strokeWidth={2} />
      {m.isPending ? "Notifying…" : "Notify approver"}
    </Button>
  );
}
