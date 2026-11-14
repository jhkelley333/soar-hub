// Ask Ninja Tot — SOAR Hub AI assistant (beta).
// Variant A styling: navy sidebar (#16365A), primary blue (#0B7BD6), bg #EEF3F8.
// Only shown to admin, coo, vp, rvp roles.
import { useEffect, useId, useRef, useState } from "react";
import { Send, AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { askTot } from "./api";

type Msg = {
  id: string;
  from: "user" | "bot";
  text: string;
  sources?: string[];
  error?: boolean;
};

const SUGGESTIONS = [
  { area: "Ranking", prompt: "Who are the top 5 ranked stores this period?" },
  { area: "Labor", prompt: "Which stores are over their labor chart this week?" },
  { area: "Drive-Through Speed", prompt: "Which stores have the worst on-time % today?" },
  { area: "Store Directory", prompt: "List stores in my region with their GMs" },
  { area: "Roster", prompt: "Which stores have an open GM position?" },
  { area: "PTO & Credits", prompt: "Any PTO requests coming up this week?" },
  { area: "Policies", prompt: "What is the corrective action policy?" },
  { area: "Resources", prompt: "What does the GM Binder say about food safety?" },
];

function TotMark({ size = 30 }: { size?: number }) {
  const uid = useId().replace(/:/g, "t");
  const bg = `bg${uid}`;
  const arm = `arm${uid}`;
  // viewBox 80×100 → height is 1.25× width
  const h = Math.round(size * 1.25);
  return (
    <svg width={size} height={h} viewBox="0 0 80 100" fill="none" aria-label="Ninja Tot">
      <defs>
        {/* Body: bright lime highlight top-left → deeper green bottom-right */}
        <radialGradient id={bg} cx="36%" cy="22%" r="70%">
          <stop offset="0%" stopColor="#B8EC50" />
          <stop offset="100%" stopColor="#62B418" />
        </radialGradient>
        {/* Arms: slightly darker than body */}
        <radialGradient id={arm} cx="28%" cy="20%" r="75%">
          <stop offset="0%" stopColor="#92CC2A" />
          <stop offset="100%" stop-color="#52A010" />
        </radialGradient>
      </defs>

      {/* ── Tot body — cylinder shape ── */}
      {/* rx=20 keeps enough straight side + top/bottom to read as a cylinder
          at small sizes; rx=30 collapses to an oval below ~36px */}
      <rect x="5" y="2" width="70" height="80" rx="20" fill={`url(#${bg})`} />
      {/* upper-left body sheen */}
      <ellipse cx="26" cy="20" rx="16" ry="10" fill="rgba(255,255,255,0.13)" />

      {/* ── Blue ninja headband ── */}
      <rect x="5" y="22" width="70" height="22" rx="8" fill="#4E80CC" />
      {/* headband top highlight */}
      <rect x="5" y="22" width="70" height="6" rx="8" fill="rgba(255,255,255,0.22)" />
      {/* tie-knot hints on each side */}
      <path d="M5,33 C0,29 -1,38 4,39 C1,36 1,31 5,33 Z" fill="#3660A8" />
      <path d="M75,33 C80,29 81,38 76,39 C79,36 79,31 75,33 Z" fill="#3660A8" />

      {/* ── Eyes — big round black with gleam, inside headband ── */}
      <ellipse cx="25" cy="33" rx="9.5" ry="10.5" fill="#111" />
      <ellipse cx="55" cy="33" rx="9.5" ry="10.5" fill="#111" />
      {/* primary gleam */}
      <circle cx="21" cy="29" r="3.5" fill="white" />
      <circle cx="51" cy="29" r="3.5" fill="white" />
      {/* secondary sparkle */}
      <circle cx="24" cy="32" r="1.4" fill="white" opacity="0.5" />
      <circle cx="54" cy="32" r="1.4" fill="white" opacity="0.5" />

      {/* ── Smile ── */}
      <path d="M28,57 Q40,70 52,57" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" fill="none" />

      {/* ── Belt — two-tone embroidered with gold buckle ── */}
      {/* pink/magenta outer band */}
      <rect x="12" y="64" width="56" height="10" rx="4" fill="#C44D7A" />
      <rect x="12" y="64" width="56" height="3.5" rx="4" fill="rgba(255,255,255,0.15)" />
      {/* stitch details on pink */}
      <line x1="16" y1="67.5" x2="32" y2="67.5" stroke="rgba(255,255,255,0.20)" strokeWidth="0.8" />
      <line x1="48" y1="67.5" x2="64" y2="67.5" stroke="rgba(255,255,255,0.20)" strokeWidth="0.8" />
      {/* orange/amber lower band */}
      <rect x="14" y="72" width="52" height="8" rx="3" fill="#F09A20" />
      <rect x="14" y="72" width="52" height="2.5" rx="3" fill="rgba(255,255,255,0.13)" />
      {/* gold buckle plate */}
      <rect x="36" y="63" width="8" height="13" rx="2" fill="#F5C228" />
      <rect x="36" y="63" width="8" height="4" rx="2" fill="rgba(255,255,255,0.25)" />
      {/* buckle ring */}
      <rect x="37.5" y="66" width="5" height="7" rx="1.2" fill="none" stroke="#C89000" strokeWidth="1.5" />
      {/* buckle pin */}
      <line x1="40" y1="66" x2="40" y2="73" stroke="#C89000" strokeWidth="1.3" />

      {/* ── Arms — drawn over lower body so they read as front appendages ── */}
      {/* arm shadow/separation outline drawn first */}
      <ellipse cx="9" cy="80" rx="10.5" ry="13" fill="rgba(80,140,20,0.35)" />
      <ellipse cx="71" cy="80" rx="10.5" ry="13" fill="rgba(80,140,20,0.35)" />
      {/* arm fill */}
      <ellipse cx="9" cy="79" rx="9.5" ry="12" fill={`url(#${bg})`} />
      <ellipse cx="71" cy="79" rx="9.5" ry="12" fill={`url(#${bg})`} />
      {/* arm highlight */}
      <ellipse cx="6" cy="74" rx="4" ry="5" fill="rgba(200,245,100,0.28)" />
      <ellipse cx="68" cy="74" rx="4" ry="5" fill="rgba(200,245,100,0.28)" />

      {/* ── Wrist wraps ── */}
      <rect x="1" y="85" width="16" height="6.5" rx="3" fill="#EDE8DF" />
      <line x1="1" y1="88.2" x2="17" y2="88.2" stroke="#C4BDB0" strokeWidth="0.9" />
      <rect x="63" y="85" width="16" height="6.5" rx="3" fill="#EDE8DF" />
      <line x1="63" y1="88.2" x2="79" y2="88.2" stroke="#C4BDB0" strokeWidth="0.9" />

      {/* ── Fists ── */}
      <ellipse cx="9" cy="95" rx="8" ry="5.5" fill={`url(#${bg})`} />
      <ellipse cx="71" cy="95" rx="8" ry="5.5" fill={`url(#${bg})`} />
    </svg>
  );
}

export function RankingAskTotView() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");

    const userMsg: Msg = { id: `u-${Date.now()}`, from: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages
      .filter((m) => !m.error)
      .slice(-6)
      .map((m) => ({ role: (m.from === "user" ? "user" : "assistant") as "user" | "assistant", content: m.text }));

    try {
      const res = await askTot(q, history);
      const botMsg: Msg = {
        id: `b-${Date.now()}`,
        from: "bot",
        text: res.answer,
        sources: res.sources,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const errorMsg: Msg = {
        id: `e-${Date.now()}`,
        from: "bot",
        text: err instanceof Error ? err.message : "Ninja Tot couldn't reach the Hub. Try again.",
        error: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-zinc-200 shadow-sm">
      {/* Section header — always visible, identifies Ask Tot in System Settings */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: "#16365A" }}
      >
        <TotMark size={34} />
        <div>
          <div className="text-[15px] font-bold leading-tight text-white">Ask Ninja Tot</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#BFD6EE" }}>
            SOAR Hub AI Assistant · Beta
          </div>
        </div>
      </div>

      {/* Chat shell */}
      <div className="flex" style={{ height: "calc(100vh - 260px)", minHeight: "460px" }}>
      {/* Sidebar */}
      <div
        className="hidden w-[220px] shrink-0 flex-col gap-4 p-4 md:flex"
        style={{ background: "#16365A", color: "white" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <TotMark size={36} />
          <div>
            <div className="text-[15px] font-bold leading-tight">Ask Ninja Tot</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#BFD6EE" }}>
              SOAR Hub Assistant
            </div>
          </div>
        </div>

        {/* Beta badge */}
        <div
          className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ background: "rgba(255,255,255,0.12)", color: "#BFD6EE" }}
        >
          <Sparkles className="h-3 w-3" /> Beta
        </div>

        {/* Ask about */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#BFD6EE" }}>
            Ask about
          </div>
          {["Store directory", "Ranking & labor", "Drive-through KPI", "PTO & credits", "Policies & guides", "PAF queue (RVP+)"].map((item) => (
            <div
              key={item}
              className="rounded-lg px-2 py-1.5 text-[13px] font-medium"
              style={{ color: "#E3EDF8" }}
            >
              {item}
            </div>
          ))}
        </div>

        {/* New chat */}
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="mt-auto rounded-xl px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10"
            style={{ background: "#0B7BD6" }}
          >
            + New chat
          </button>
        )}

        {/* Connected status */}
        <div
          className="mt-auto rounded-xl p-3 text-[11px]"
          style={{ background: "rgba(255,255,255,0.08)", color: "#BFD6EE" }}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Connected to SOAR Hub
          </div>
          <div className="mt-1 opacity-70">Stores · Ranking · Labor · KPI · Resources</div>
        </div>
      </div>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "#EEF3F8" }}>
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 md:hidden">
            <TotMark size={28} />
          </div>
          <div className="text-[15px] font-bold text-midnight">
            {isEmpty ? "Ask Ninja Tot" : (messages[0]?.text?.slice(0, 44) ?? "Ask Ninja Tot")}
            {!isEmpty && messages[0]?.text?.length > 44 ? "…" : ""}
          </div>
          <div
            className="rounded-full px-2.5 py-0.5 text-[12px] font-bold"
            style={{ color: "#0B5FA8", background: "#E6F1FB" }}
          >
            Beta
          </div>
        </div>

        {/* Message area */}
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-[700px] space-y-4">
            {isEmpty ? (
              <EmptyState onSuggest={(p) => send(p)} />
            ) : (
              messages.map((m) => <MessageRow key={m.id} msg={m} onRetry={() => send(m.text)} />)
            )}
            {loading && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <TotMark size={28} />
                </div>
                <div className="text-[13px] italic" style={{ color: "#5A6B80" }}>
                  Ninja Tot is checking the Hub…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-zinc-100 bg-white px-4 py-3">
          <div className="mx-auto max-w-[700px]">
            {/* Suggestion chips — shown only when no messages yet */}
            {isEmpty && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <button
                    key={s.prompt}
                    onClick={() => send(s.prompt)}
                    className="rounded-full border px-3 py-1 text-[13px] font-semibold transition hover:bg-blue-50"
                    style={{ borderColor: "#C9D6E3", color: "#0B5FA8", background: "white" }}
                  >
                    {s.prompt}
                  </button>
                ))}
              </div>
            )}
            <div
              className="flex items-end gap-2 rounded-2xl border p-3"
              style={{ borderColor: "#D3DCE6", background: "white", boxShadow: "0 4px 14px rgba(19,35,58,.06)" }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about stores, ranking, labor, policies, PTO…"
                className="flex-1 resize-none bg-transparent text-[15px] text-midnight outline-none placeholder:text-zinc-400"
                style={{ maxHeight: "120px" }}
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="grid h-11 min-w-[44px] place-items-center rounded-xl transition disabled:opacity-40"
                style={{ background: "#0B7BD6" }}
              >
                <Send className="h-4 w-4 text-white" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[11px]" style={{ color: "#5A6B80" }}>
              Ninja Tot answers only from SOAR Hub data you have access to.
            </p>
          </div>
        </div>
      </div>
      </div>{/* end chat shell */}
    </div>
  );
}

function EmptyState({ onSuggest }: { onSuggest: (p: string) => void }) {
  return (
    <div className="pt-6 text-center">
      <div className="mb-1 text-[12px] font-bold uppercase tracking-widest" style={{ color: "#0B7BD6" }}>
        Ninja Tot · SOAR Hub
      </div>
      <h2 className="mb-2 text-3xl font-black tracking-tight text-midnight">What do you need?</h2>
      <p className="mb-8 text-[15px]" style={{ color: "#4A5B70" }}>
        Ask about stores, ranking, labor, PTO, policies, work orders, and more — all from SOAR Hub data.
      </p>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.prompt}
            onClick={() => onSuggest(s.prompt)}
            className="rounded-xl border p-3.5 text-left transition hover:border-blue-400 hover:shadow-sm"
            style={{ background: "white", borderColor: "#DCE3EB" }}
          >
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "#0B7BD6" }}>
              {s.area}
            </div>
            <div className="text-[14px] font-semibold text-midnight">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BotMessage({ text }: { text: string }) {
  // Simple inline markdown: **bold**, numbered/bullet lists, line breaks
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ol" | "ul" | null = null;

  function flushList() {
    if (!listItems.length) return;
    const Tag = listType!;
    elements.push(
      <Tag key={elements.length} className={Tag === "ol" ? "ml-4 list-decimal space-y-0.5" : "ml-4 list-disc space-y-0.5"}>
        {listItems}
      </Tag>
    );
    listItems = [];
    listType = null;
  }

  function renderInline(raw: string) {
    // Replace **text** with <strong>
    const parts = raw.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    const ulMatch = line.match(/^[-•]\s+(.*)/);

    if (olMatch) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(<li key={listItems.length} className="text-[15px] leading-relaxed text-midnight">{renderInline(olMatch[2])}</li>);
    } else if (ulMatch) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(<li key={listItems.length} className="text-[15px] leading-relaxed text-midnight">{renderInline(ulMatch[1])}</li>);
    } else {
      flushList();
      if (line.trim() === "") {
        if (i > 0) elements.push(<div key={elements.length} className="h-2" />);
      } else {
        elements.push(
          <p key={elements.length} className="text-[15px] leading-relaxed text-midnight">
            {renderInline(line)}
          </p>
        );
      }
    }
  }
  flushList();

  return <div className="space-y-1">{elements}</div>;
}

function MessageRow({ msg, onRetry }: { msg: Msg; onRetry: () => void }) {
  if (msg.from === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[78%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[15px] leading-relaxed text-white"
          style={{ background: "#0B7BD6", borderRadius: "16px 16px 4px 16px" }}
        >
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        <TotMark size={28} />
      </div>
      <div className="flex-1 space-y-2">
        {msg.error ? (
          <div
            className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[14px]"
            style={{ background: "#FFF4E5", border: "1px solid #F2C98B", color: "#5C3B00" }}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{msg.text}</div>
            <button onClick={onRetry} className="shrink-0 font-semibold text-amber-700 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <BotMessage text={msg.text} />
        )}

        {msg.sources && msg.sources.length > 0 && !msg.error && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "#5A6B80" }}>
            <span>Source:</span>
            {msg.sources.map((s) => (
              <span
                key={s}
                className="rounded-md border px-2 py-0.5"
                style={{ background: "white", borderColor: "#DCE3EB" }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
