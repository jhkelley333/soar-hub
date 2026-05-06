import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { sendTestEmail } from "./api";
import { EMAIL_TEMPLATE_KEYS, TEMPLATE_VARIABLES } from "./defaults";
import type { PafFormConfig } from "./types";
import { cn } from "@/lib/cn";

const TEMPLATE_LABELS: Record<string, string> = {
  PAF_SUBMITTED: "Submitted",
  PAF_REJECTED: "Rejected",
  NEEDS_APPROVAL: "Needs approval",
  PAF_PROCESSED: "Processed",
  APPROVAL_CONFIRMED: "Approval confirmed",
};

export function TemplatesEditor({
  draft,
  onChange,
}: {
  draft: PafFormConfig;
  onChange: (next: PafFormConfig) => void;
}) {
  const [active, setActive] = useState<string>(EMAIL_TEMPLATE_KEYS[0]);
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const tpl = draft.emailTemplates[active] ?? { subject: "", body: "" };
  const variables = TEMPLATE_VARIABLES[
    active as (typeof EMAIL_TEMPLATE_KEYS)[number]
  ] ?? [];

  function patch(p: Partial<{ subject: string; body: string }>) {
    onChange({
      ...draft,
      emailTemplates: {
        ...draft.emailTemplates,
        [active]: { ...tpl, ...p },
      },
    });
  }

  async function onSendTest() {
    setSending(true);
    try {
      const res = await sendTestEmail(active, tpl);
      toast.push(`Test rendered. ${res.note ?? ""}`, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Send failed.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {/* Sub-tabs for the 5 templates */}
      <div className="mb-4 flex flex-wrap gap-2">
        {EMAIL_TEMPLATE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setActive(k)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              active === k
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:text-midnight"
            )}
          >
            {TEMPLATE_LABELS[k] ?? k}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <div>
            <Label htmlFor="tpl-key">Template key</Label>
            <Input id="tpl-key" value={active} disabled readOnly />
            <p className="mt-1 text-xs text-zinc-500">
              Locked — referenced from code.
            </p>
          </div>
          <div>
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input
              id="tpl-subject"
              value={tpl.subject}
              onChange={(e) => patch({ subject: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="tpl-body">Body</Label>
            <textarea
              id="tpl-body"
              value={tpl.body}
              onChange={(e) => patch({ body: e.target.value })}
              rows={12}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 font-mono text-xs text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSendTest}
              disabled={sending}
            >
              <Send className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              {sending ? "Sending…" : "Send test"}
            </Button>
          </div>
        </div>

        <aside className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Available variables
          </h4>
          <ul className="space-y-1.5">
            {variables.map((v) => (
              <li key={v}>
                <code className="rounded bg-white px-1.5 py-0.5 text-[11px] ring-1 ring-zinc-200">
                  {`{{${v}}}`}
                </code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-zinc-500">
            Variables are replaced when the email is sent.
          </p>
          <div className="mt-3 border-t border-zinc-200 pt-3">
            <Badge tone="info">Test mode</Badge>
            <p className="mt-1 text-[11px] text-zinc-500">
              "Send test" renders the subject + body with sample data and
              targets your own email address.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
