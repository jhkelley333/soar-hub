// Per-store password vault card (My Stores → store detail). Store logins with
// usernames + passwords; passwords are encrypted server-side and only fetched
// on an explicit reveal. GM and above for stores in their scope.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Eye, EyeOff, Copy, ExternalLink, KeyRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { deleteVaultEntry, fetchVault, revealVaultPassword, saveVaultEntry, type VaultEntry } from "./vaultApi";

export function StoreVaultCard({ storeNumber }: { storeNumber: string }) {
  const q = useQuery({ queryKey: ["store-vault", storeNumber], queryFn: () => fetchVault(storeNumber) });
  const [editing, setEditing] = useState<VaultEntry | "new" | null>(null);
  const rows = q.data?.rows ?? [];

  return (
    <Card>
      <CardHeader
        title="Password Vault"
        description="Store logins — usernames & passwords. Passwords are encrypted; click the eye to reveal."
        actions={<Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-3.5 w-3.5" /> Add login</Button>}
      />
      <CardBody>
        {q.data && q.data.key_configured === false && (
          <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
            The vault encryption key isn't set on the server yet (VAULT_KEY) — passwords can't be saved or revealed until an admin adds it.
          </div>
        )}
        {q.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : q.isError ? (
          <div className="text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load the vault."}</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><KeyRound className="h-4 w-4 text-zinc-400" /> No logins saved yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {rows.map((r) => <VaultRow key={r.id} r={r} onEdit={() => setEditing(r)} />)}
          </ul>
        )}
      </CardBody>
      {editing && <VaultEntryModal storeNumber={storeNumber} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function VaultRow({ r, onEdit }: { r: VaultEntry; onEdit: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pw, setPw] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const copy = (v: string, what: string) => navigator.clipboard?.writeText(v).then(() => toast.push(`${what} copied.`, "success")).catch(() => {});
  const reveal = useMutation({
    mutationFn: () => revealVaultPassword(r.id),
    onSuccess: (d) => { setPw(d.password); setShown(true); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't reveal.", "error"),
  });
  const del = useMutation({
    mutationFn: () => deleteVaultEntry(r.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["store-vault"] }); toast.push("Deleted.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  const toggle = () => { if (pw == null) reveal.mutate(); else setShown((s) => !s); };

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-midnight">{r.label}</span>
          {r.url && <a href={/^https?:\/\//.test(r.url) ? r.url : `https://${r.url}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline"><ExternalLink className="h-3 w-3" /> link</a>}
        </div>
        {r.username && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-600">
            <span className="text-zinc-400">User</span> <span className="font-mono">{r.username}</span>
            <button type="button" onClick={() => copy(r.username!, "Username")} className="text-zinc-300 hover:text-accent"><Copy className="h-3 w-3" /></button>
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-600">
          <span className="text-zinc-400">Pass</span>
          {r.has_password ? (
            <>
              <span className="font-mono">{shown && pw != null ? pw : "••••••••"}</span>
              <button type="button" onClick={toggle} disabled={reveal.isPending} className="text-zinc-300 hover:text-accent" title={shown ? "Hide" : "Reveal"}>
                {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              {pw != null && <button type="button" onClick={() => copy(pw, "Password")} className="text-zinc-300 hover:text-accent" title="Copy"><Copy className="h-3 w-3" /></button>}
            </>
          ) : <span className="text-zinc-400">—</span>}
        </div>
        {r.notes && <div className="mt-0.5 text-xs text-zinc-500">{r.notes}</div>}
        {r.updated_by_name && <div className="mt-0.5 text-[11px] text-zinc-400">Updated by {r.updated_by_name} · {new Date(r.updated_at).toLocaleDateString("en-US")}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onEdit} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-accent" title="Edit"><Pencil className="h-4 w-4" /></button>
        <button type="button" onClick={() => { if (window.confirm(`Delete the "${r.label}" login?`)) del.mutate(); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-red-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
      </div>
    </li>
  );
}

function VaultEntryModal({ storeNumber, entry, onClose }: { storeNumber: string; entry: VaultEntry | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [label, setLabel] = useState(entry?.label ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState(entry?.url ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");

  const save = useMutation({
    mutationFn: () => saveVaultEntry({
      id: entry?.id, store_number: storeNumber, label: label.trim(),
      username: username.trim(), url: url.trim(), notes: notes.trim(),
      // On edit, only send a password when one was typed (blank keeps the current).
      ...(entry && !password ? {} : { password }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["store-vault", storeNumber] }); toast.push("Saved.", "success"); onClose(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  return (
    <Modal open onClose={onClose} title={entry ? "Edit login" : "Add login"} maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!label.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </>
      }>
      <div className="space-y-3">
        <div><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Alarm system, DoorDash portal" /></div>
        <div><Label>Username</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></div>
        <div><Label>Password</Label><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={entry ? "Leave blank to keep current" : ""} /></div>
        <div><Label>URL (optional)</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="portal.example.com" /></div>
        <div><Label>Notes (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">Passwords are encrypted at rest and only shown when you reveal them.</p>
    </Modal>
  );
}
