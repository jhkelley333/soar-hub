// Ask Tot — SOAR Hub AI assistant (beta).
// Variant A styling: navy sidebar (#16365A), primary blue (#0B7BD6), bg #EEF3F8.
// Only shown to admin, coo, vp, rvp roles.
import { useEffect, useRef, useState } from "react";
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
  { area: "Store Directory", prompt: "List stores in my region with their GMs" },
  { area: "Ranking", prompt: "Who are the top 5 ranked stores this period?" },
  { area: "Ranking", prompt: "Which stores improved the most vs last year?" },
  { area: "Resources", prompt: "What does the operations guide say about food safety?" },
];

function TotMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" aria-label="Tot">
      <ellipse cx="30" cy="38" rx="20" ry="17" fill="#FFD100" />
      <ellipse cx="30" cy="22" rx="16" ry="16" fill="#FFD100" />
      <ellipse cx="23" cy="20" rx="4" ry="5" fill="white" />
      <ellipse cx="37" cy="20" rx="4" ry="5" fill="white" />
      <circle cx="23" cy="21" r="2.5" fill="#1F6FE0" />
      <circle cx="37" cy="21" r="2.5" fill="#1F6FE0" />
      <path d="M25 29 Q30 33 35 29" stroke="#A07820" strokeWidth="1.5" strokeLinecap="round" fill="none" />
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
        text: err instanceof Error ? err.message : "Tot couldn't reach the Hub. Try again.",
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
          <div className="text-[15px] font-bold leading-tight text-white">Ask Tot</div>
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
            <div className="text-[15px] font-bold leading-tight">Ask Tot</div>
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
          {["Store directory", "Ranking & scores", "Resource docs"].map((item) => (
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
          <div className="mt-1 opacity-70">Stores · Ranking · Promos</div>
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
            {isEmpty ? "Ask Tot · SOAR Hub" : (messages[0]?.text?.slice(0, 44) ?? "Ask Tot")}
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
                  Tot is checking the Hub…
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
                placeholder="Ask about stores, ranking, promos…"
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
              Tot answers only from SOAR Hub data you have access to.
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
        Ask Tot · SOAR Hub
      </div>
      <h2 className="mb-2 text-3xl font-black tracking-tight text-midnight">What do you need?</h2>
      <p className="mb-8 text-[15px]" style={{ color: "#4A5B70" }}>
        Ask about stores, ranking scores, promos, and more.
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
          <div className="text-[15px] leading-relaxed text-midnight whitespace-pre-wrap">{msg.text}</div>
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
