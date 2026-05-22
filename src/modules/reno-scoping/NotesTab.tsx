// Notes tab — append-only feed of freeform field observations against
// the scope. Anyone who can read the scope sees the notes; anyone who
// can write to the scope can add one.

import { useState } from "react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import type { RenoScopeNote } from "./types";

interface Props {
  notes: RenoScopeNote[];
  loading: boolean;
  canAdd: boolean;
  onAdd: (text: string) => Promise<unknown>;
  adding: boolean;
}

export function NotesTab({ notes, loading, canAdd, onAdd, adding }: Props) {
  const [draft, setDraft] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await onAdd(text);
    setDraft("");
  }

  return (
    <div className="space-y-4">
      {canAdd && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-2 p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a field note…"
              rows={3}
              className="w-full resize-none rounded-md border-0 bg-zinc-50 px-3 py-2 text-sm text-midnight ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-frost"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!draft.trim() || adding}>
                {adding ? "Adding…" : "Add note"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : notes.length === 0 ? (
        <EmptyState title="No notes yet" description="Capture anything that doesn't fit in a checklist item." />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Card>
                <div className="p-3">
                  <p className="whitespace-pre-wrap text-sm text-zinc-800">{n.note_text}</p>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
