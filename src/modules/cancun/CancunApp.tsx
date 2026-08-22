// CMG Cancun Convention 2026 — in-app port of the PWA prototype, incubated
// under System Settings → Beta Test. Faithful to the design handoff: exact
// tokens, copy, tabs/sub-nav, gated Support, checklist, FAQ, photo wall.
//
// Identity is the signed-in SoarHub user: a convention "registration"
// (cancun_profiles.brand) is keyed to auth.uid(). The leadership crew
// (cancun_contacts) is RLS-gated — the client only receives rows once
// registered — so the Support gate is enforced server-side, not just in the UI.
// Checklist + passport flag persist to cancun_profiles. Photo files and the
// service-worker/offline layer land in follow-up PRs. Inline styles (raw hex/px)
// are intentional here to match the high-fidelity handoff 1:1.
//
// Assets (brand marks, AmStar greeter/vehicles, resort-casual, resort map) were
// not part of the code bundle; image slots render labeled placeholders until the
// binaries are dropped into ./assets and wired.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

const ARCH = "'Archivo', system-ui, sans-serif";
const SANS = "'Source Sans 3', system-ui, sans-serif";
const ACCENT = "#0A5F73";
const CREAM = "#FFF6E9";

type Brand = "Apricus QSR" | "Mitra QSR" | "Prime QSR" | "SOAR QSR";
type ScreenId ="home" | "photos" | "checklist" | "travel" | "arriving" | "resort" | "dining" | "map" | "agenda" | "attire" | "faq" | "support";

const NAV: Record<ScreenId, { tab: string; title: string; sub: string }> = {
  home: { tab: "home", title: "Convention Home", sub: "Cancun Convention 2026" },
  photos: { tab: "home", title: "Photo Wall", sub: "Shared album" },
  checklist: { tab: "trip", title: "Before You Go", sub: "Pre-flight checklist" },
  travel: { tab: "trip", title: "Travel Day", sub: "Flights and airport" },
  arriving: { tab: "trip", title: "Arriving in Cancun", sub: "Customs to shuttle" },
  resort: { tab: "resort", title: "The Resort", sub: "Hilton Cancun" },
  dining: { tab: "resort", title: "Dining & Menus", sub: "9 venues, all included" },
  map: { tab: "resort", title: "Resort Map", sub: "Find your way" },
  agenda: { tab: "agenda", title: "Meeting Agenda", sub: "Dec 6 – Dec 10" },
  attire: { tab: "agenda", title: "Weather & Attire", sub: "What to wear" },
  faq: { tab: "support", title: "FAQ", sub: "Quick answers" },
  support: { tab: "support", title: "Get Support", sub: "Your leadership crew" },
};
const SUB: Record<string, [ScreenId, string][]> = {
  home: [["home", "Home"], ["photos", "Photo Wall"]],
  trip: [["checklist", "Before You Go"], ["travel", "Travel Day"], ["arriving", "Arriving"]],
  resort: [["resort", "Resort"], ["dining", "Dining"], ["map", "Map"]],
  agenda: [["agenda", "Agenda"], ["attire", "Attire"]],
  support: [["support", "Support"], ["faq", "FAQ"]],
};
const TABS: [string, string, ScreenId][] = [
  ["home", "Home", "home"], ["trip", "Trip", "checklist"], ["resort", "Resort", "resort"],
  ["agenda", "Agenda", "agenda"], ["support", "Support", "support"],
];
const CHECK: [string, string][] = [
  ["pass", "Passport current — photograph it, email the copy to yourself and family"],
  ["carrier", "Confirm your carrier's international plan for Mexico"],
  ["wa", "Download WhatsApp and join the convention group"],
  ["resort", "Share the resort contact info with your family"],
  ["buddy", "Trade buddy and family contact info with a colleague"],
  ["away", "Written away plan to your Direct Supervisor by November 24"],
  ["bank", "Notify your bank and credit cards of international travel"],
  ["alarm", "Set multiple alarms for your flight"],
  ["pack", "Pack meds in original containers, sunscreen, aloe, layers"],
  ["leave", "Leave valuables, alcohol, vapes and cannabis at home"],
];
const VENUES: [string, string, string, [string, string][]][] = [
  ["Auma", "Steak", "6 pm – 11 pm", [["Menu", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239817/dx/wp/cunqrhh-hilton-cancun/pdf/MENU%20AUMA%20CANCUN%20EN%20FINAL-ua_leylbt.pdf"], ["Desserts", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239816/dx/wp/cunqrhh-hilton-cancun/pdf/AUMA%20Postres%20EN%20FINAL-ua_umet2r.pdf"], ["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=2"]]],
  ["Maxal", "Mexican", "6 pm – 11 pm", [["Menu", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239818/dx/wp/cunqrhh-hilton-cancun/pdf/MENU%20MAXAL%202026%20EN%20FINAL-ua_g23ozk.pdf"], ["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=0"]]],
  ["Maxal Taqueria", "Tacos", "Walk-up window", [["Menu", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1757590588/dx/wp/hiltoncancun/pdf/MAXAL%20TAQUERIA%20EN%20FINAL-ua_gfao1n.pdf"], ["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=1"]]],
  ["La Luce", "Italian", "6 pm – 11 pm", [["Menu", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239818/dx/wp/cunqrhh-hilton-cancun/pdf/menu%20La%20Luce%20Cancun%20EN%20FINAL-ua_b2fpy4.pdf"], ["Desserts", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239964/dx/wp/cunqrhh-hilton-cancun/pdf/Postres%20La%20Luce%20EN%20FINAL-ua_icyxw2.pdf"], ["Kids", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239818/dx/wp/cunqrhh-hilton-cancun/pdf/Menu%20kids%20La%20Luce%20EN%20FINAL-ua_jca5xe.pdf"], ["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=3"]]],
  ["Sunan", "Asian", "11 am – 4 pm · 6 pm – 11 pm", [["Lunch", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1767982102/dx/wp/cunqrhh-hilton-cancun/pdf/MENU%20SUNAN%20LUNCH%20%281%29%20EN%20FINAL-ua_w3jmmj.pdf"], ["Dinner", "https://assets.hiltonstatic.com/hilton-asset-cache/image/upload/v1785239842/dx/wp/cunqrhh-hilton-cancun/pdf/MENU%20SUNAN%20DINNER%202026%20EN%20FINAL-ua_gfd63j.pdf"], ["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=4"]]],
  ["Vela", "Food hall", "7–11 am · 12–5 pm · 6–11 pm", []],
  ["Azulinda Lobby Bar", "Bar", "Daily", []],
  ["Azulinda Market & Café", "Coffee", "Daily", [["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=7"]]],
  ["La Churrería", "Churros", "Daily", [["360°", "https://visitingmedia.com/tt8/?ttid=hilton-cancun-all-inclusive-resort#/360?group=1&tour=6"]]],
];
const AGENDA: [string, string, string][] = [
  ["Sunday, Dec 6", "Above-store", "Leadership Meeting, 6:00–8:00 pm"],
  ["Monday, Dec 7", "Kick-off", "Attendees arrive · Kick-off with the full CMG family, 5:00–8:00 pm · Market team dinners, 8:30 pm"],
  ["Tuesday, Dec 8", "Free PM", "Meeting, 9:00 am–12:30 pm · Afternoon and evening free"],
  ["Wednesday, Dec 9", "Big night", "Meeting, 9:00 am–12:30 pm · Afternoon free · Final Night Celebration & Awards, 6:00–10:00 pm"],
  ["Thursday, Dec 10", "Fly home", "Travel home"],
];
const FAQ: [string, string][] = [
  ["Is English widely spoken?", "Cancun is tourist-heavy — nearly 90% of the local population speaks and understands English."],
  ["Is there Wi-Fi?", "Yes, free standard in-room and lobby Wi-Fi, plus free Wi-Fi at the Cancun airport."],
  ["Do I need pesos?", "Your all-inclusive plan covers meals, drinks and most activities. Bring a small amount of cash for off-site expenses and souvenirs. Most places take US dollars."],
  ["Can I drink the tap water?", "No — skip the faucet. Filtered and bottled water is provided, and water and ice served at resort venues is safe."],
  ["What is the smoking policy?", "Smoke-free with designated outdoor areas. Cannabis may not be brought into Mexico — that is a US federal crime."],
  ["Is there a safe for valuables?", "In-room safes are in every room. The resort is not liable for items left unattended in public areas."],
  ["What is the tipping policy?", "Taxes, tips and gratuities are included. Extra gratuities are welcome if service exceeds expectations."],
  ["Who do I contact for help?", "Start with your Direct Supervisor, then your company's Senior Leadership. Register in the app to see their numbers."],
];
const ARRIVAL = [
  "Clear Mexican Passport Control.",
  "Walk past the salespeople outside — free is not free. Give out no information.",
  "Find the greeter holding a sign with the CMG brand logos.",
  "Board only the AmStar vehicle your greeter points you to.",
];
const PERKS: [string, string][] = [
  ["Your leadership crew", "Direct numbers for your Direct Supervisor and Senior Leadership"],
  ["Passport on file", "Encrypted upload, so a lost passport is not a crisis"],
  ["Personalized email", "Itineraries, rooming and reminders sent to you"],
  ["Your room and roommate", "As soon as your Direct Supervisor publishes the list"],
];
const BRANDS: Brand[] = ["Apricus QSR", "Mitra QSR", "Prime QSR", "SOAR QSR"];
const CHEER =["Let us begin", "Off to a start", "Rolling now", "Halfway there", "Nearly packed", "Beach ready"];
const PROMPTS = ["Your crew at the kick-off", "Best plate of the trip", "Sunrise from your balcony", "Awards night fit", "Someone mid-churro"];

// Load the display fonts once (self-hosting comes with the offline PR).
function useFonts() {
  useEffect(() => {
    if (document.getElementById("cancun-fonts")) return;
    const l = document.createElement("link");
    l.id = "cancun-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Source+Sans+3:ital,wght@0,400;0,600;0,700&display=swap";
    document.head.appendChild(l);
  }, []);
}

const card: React.CSSProperties = { background: "#FFFFFF", borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 8px rgba(10,60,70,0.09)" };
const eyebrow = (color: string): React.CSSProperties => ({ fontFamily: ARCH, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color, margin: "0 0 10px" });

// Placeholder for the not-yet-bundled image assets.
function Slot({ label, ratio = "16 / 9" }: { label: string; ratio?: string }) {
  return (
    <div style={{ aspectRatio: ratio, width: "100%", borderRadius: 10, border: "1.5px dashed #BBD0D3", background: "#F1F7F8", display: "grid", placeItems: "center", textAlign: "center", padding: 12, boxSizing: "border-box" }}>
      <span style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.4, color: "#8B9AA3" }}>Image pending · {label}</span>
    </div>
  );
}

interface CxProfile { brand: Brand | null; full_name: string | null; checklist: Record<string, boolean>; passport_uploaded: boolean }
interface Contact { step: string; name: string; role: string; phone: string }

export function CancunApp() {
  useFonts();
  const { profile: sbProfile } = useAuth();
  const uid = sbProfile?.id;
  const [view, setView] = useState<ScreenId>("home");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [photos, setPhotos] = useState<{ url: string; by: string }[]>([]);
  const [cx, setCx] = useState<CxProfile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [authMode, setAuthMode] = useState<"gate" | "register">("gate");
  const [form, setForm] = useState({ name: "", brand: "SOAR QSR" as Brand });
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  // Load this user's convention profile (brand + checklist + passport flag).
  useEffect(() => {
    if (!uid) return;
    let live = true;
    supabase.from("cancun_profiles").select("brand, full_name, checklist, passport_uploaded").eq("user_id", uid).maybeSingle()
      .then(({ data }) => { if (live && data) setCx({ ...data, checklist: (data.checklist as Record<string, boolean>) || {} }); });
    return () => { live = false; };
  }, [uid]);

  const registered = !!cx?.brand;
  const firstName = (cx?.full_name || sbProfile?.full_name || "there").trim().split(" ")[0];
  const email = sbProfile?.email || "";
  const checklist = cx?.checklist ?? {};

  // The leadership crew is RLS-gated: this returns rows only once registered.
  useEffect(() => {
    if (!uid || !registered) { setContacts([]); return; }
    let live = true;
    supabase.from("cancun_contacts").select("step, name, role, phone").order("step")
      .then(({ data }) => { if (live) setContacts((data as Contact[]) || []); });
    return () => { live = false; };
  }, [uid, registered]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const patch = (p: Partial<CxProfile>) => setCx((c) => ({ brand: null, full_name: null, checklist: {}, passport_uploaded: false, ...c, ...p }));
  const go = (v: ScreenId) => { setView(v); setOpenFaq(null); setError(""); };
  const toggleCheck = async (id: string) => {
    if (!uid) return;
    const next = { ...checklist, [id]: !checklist[id] };
    patch({ checklist: next });
    await supabase.from("cancun_profiles").upsert({ user_id: uid, checklist: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  };
  const addPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const by = registered ? firstName : "You";
    setPhotos((p) => files.map((f) => ({ url: URL.createObjectURL(f), by })).concat(p));
    e.target.value = "";
  };
  const setField = (k: keyof typeof form, v: string) => { setForm((s) => ({ ...s, [k]: v })); setError(""); };
  const register = async () => {
    if (!uid) return;
    const full_name = form.name.trim() || sbProfile?.full_name || "";
    if (!full_name) { setError("Add your name to finish registering."); return; }
    const { data, error: err } = await supabase.from("cancun_profiles")
      .upsert({ user_id: uid, brand: form.brand, full_name, registered_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .select("brand, full_name, checklist, passport_uploaded").single();
    if (err) { setError(err.message); return; }
    setCx({ ...(data as CxProfile), checklist: (data?.checklist as Record<string, boolean>) || {} });
    setView("support"); setError("");
  };
  const leave = async () => {
    if (!uid) return;
    patch({ brand: null });
    setAuthMode("gate"); setView("support");
    await supabase.from("cancun_profiles").update({ brand: null, registered_at: null, updated_at: new Date().toISOString() }).eq("user_id", uid);
  };
  const togglePassport = async () => {
    if (!uid) return;
    const next = !cx?.passport_uploaded;
    patch({ passport_uploaded: next });
    await supabase.from("cancun_profiles").upsert({ user_id: uid, passport_uploaded: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  };

  const authed = registered;
  const gated = view === "support" && !registered;
  const effView = gated ? (authMode === "gate" ? "gate" : "auth") : view;
  const cur = NAV[view] || NAV.home;
  const tabId = cur.tab;
  const sub = SUB[tabId] || [];

  const daysOut = useMemo(() => Math.max(0, Math.round((new Date(2026, 11, 7).getTime() - now.getTime()) / 86400000)), [now]);
  const doneCount = CHECK.filter((c) => checklist[c[0]]).length;
  const pct = Math.round((doneCount / CHECK.length) * 100);
  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const screenTitle = effView === "gate" ? "Members Only" : effView === "auth" ? "Register" : cur.title;
  const headerSub = registered && view === "support" ? cx!.brand! : cur.sub;
  const tagPill = (bg: string, fg: string): React.CSSProperties => ({ fontFamily: ARCH, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0, background: bg, color: fg, borderRadius: 999, padding: "4px 9px", whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 24px" }}>
      <div style={{ width: "min(430px, 100%)", height: "min(86vh, 880px)", background: CREAM, borderRadius: 28, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(10,60,70,0.18)", fontFamily: SANS }}>

        {/* Header */}
        <div style={{ flex: "none", background: ACCENT, color: "#FFFFFF", padding: "14px 20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: ARCH, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: "#BDEDEF" }}>
            <span>{clock}</span>
            <span>Cancun · 82° · sunny</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 16px" }}>
            <span style={{ flex: "none", background: "#FFFFFF", color: ACCENT, padding: "6px 10px", borderRadius: 8, fontFamily: ARCH, fontWeight: 800, fontSize: 13, letterSpacing: "0.02em" }}>CMG</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: ARCH, fontSize: 16, fontWeight: 800, letterSpacing: "-0.015em", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{screenTitle}</p>
              <p style={{ fontFamily: SANS, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9FE0E3", margin: "2px 0 0" }}>{headerSub}</p>
            </div>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.16)", borderRadius: 999, padding: "4px 9px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7FE3B0" }} />
              <span style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Beta</span>
            </div>
          </div>
        </div>

        {/* Sub-nav */}
        {sub.length > 1 && (
          <div style={{ flex: "none", display: "flex", gap: 6, background: ACCENT, padding: "0 16px 12px", overflowX: "auto" }}>
            {sub.map(([id, label]) => {
              const on = id === view;
              return (
                <button key={id} type="button" onClick={() => go(id)} style={{ flex: "none", background: on ? "#FFFFFF" : "rgba(255,255,255,0.16)", color: on ? ACCENT : "#DFF3F4", border: "none", borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: ARCH, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</button>
              );
            })}
          </div>
        )}

        {/* Screen */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 18px 26px" }}>
          {effView === "home" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative", overflow: "hidden", background: "#0E8C93", borderRadius: 20, padding: "22px 20px" }}>
                <span style={{ position: "absolute", top: -40, right: -30, width: 130, height: 130, borderRadius: "50%", background: "#FFB13B", opacity: 0.85 }} />
                <span style={{ position: "absolute", top: 14, right: 14, width: 48, height: 48, borderRadius: "50%", background: "#FF6B4A" }} />
                <p style={{ position: "relative", ...eyebrow("#BDEDEF"), letterSpacing: "0.16em" }}>{registered ? `Hola, ${firstName}` : "Hola CMG"}</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 58, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.03em", color: "#FFFFFF", margin: 0 }}>{daysOut}</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 17, fontWeight: 700, color: CREAM, margin: "6px 0 0" }}>days till Cancun</p>
                <p style={{ position: "relative", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.45, color: "#BDEDEF", margin: "6px 0 0" }}>Primary travel: Monday, December 7 to Thursday, December 10</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Before You Go", note: `${doneCount} of ${CHECK.length} done`, go: "checklist" as ScreenId, accent: false },
                  { label: "Dining", note: "9 venues, menus offline", go: "dining" as ScreenId, accent: false },
                  { label: "Photo Wall", note: "Share the trip", go: "photos" as ScreenId, accent: false },
                  { label: authed ? "My Support" : "Unlock Support", note: registered ? `${cx!.brand} crew` : "Register to see leadership", go: "support" as ScreenId, accent: true },
                ].map((t) => (
                  <button key={t.label} type="button" onClick={() => go(t.go)} style={{ textAlign: "left", background: t.accent ? "#FF6B4A" : "#FFFFFF", border: "none", borderRadius: 18, padding: 16, cursor: "pointer", boxShadow: t.accent ? "0 2px 8px rgba(196,50,20,0.22)" : "0 2px 8px rgba(10,60,70,0.09)" }}>
                    <span style={{ display: "block", fontFamily: ARCH, fontSize: 16, fontWeight: 800, color: t.accent ? "#FFFFFF" : ACCENT, marginBottom: 3 }}>{t.label}</span>
                    <span style={{ display: "block", fontFamily: SANS, fontSize: 12.5, lineHeight: 1.4, color: t.accent ? "#FFE3D8" : "#8B9AA3" }}>{t.note}</span>
                  </button>
                ))}
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Your trip at a glance</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    ["Room", authed ? "Tower 2 · 1418" : "Register to view", authed ? "#21313C" : "#A2B4BA"],
                    ["Roommate", authed ? "Assigned Nov 24" : "Register to view", authed ? "#21313C" : "#A2B4BA"],
                    ["Away plan due", "November 24", "#C4581F"],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontFamily: SANS, fontSize: 14.5, color: "#6B7C86" }}>{label}</span>
                      <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderRadius: 18, padding: "16px 18px", background: "#FFC14B" }}>
                <p style={eyebrow("#C4581F")}>One CMG family</p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {BRANDS.map((b) => (
                    <span key={b} title={b} style={{ height: 42, width: 42, borderRadius: "50%", border: "2px solid #FFFFFF", background: "#0E8C93", color: "#FFFFFF", display: "grid", placeItems: "center", fontFamily: ARCH, fontSize: 13, fontWeight: 800 }}>{b[0]}</span>
                  ))}
                </div>
                <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#6B4A2A", margin: "12px 0 0" }}>Apricus, Mitra, Prime and SOAR QSR — four brands, one beach.</p>
              </div>
            </div>
          )}

          {effView === "checklist" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <p style={{ fontFamily: ARCH, fontSize: 15, fontWeight: 700, color: ACCENT, margin: 0 }}>{doneCount} of {CHECK.length} done</p>
                  <p style={{ fontFamily: ARCH, fontSize: 12.5, fontWeight: 600, color: "#FF6B4A", margin: 0 }}>{CHEER[Math.min(CHEER.length - 1, Math.floor(doneCount / 2))]}</p>
                </div>
                <div style={{ height: 10, borderRadius: 999, background: "#E7F1F2", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "#FF6B4A" }} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {CHECK.map(([id, label]) => {
                  const on = !!checklist[id];
                  return (
                    <button key={id} type="button" onClick={() => toggleCheck(id)} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: on ? "#EAF7EF" : "#FFFFFF", border: `1.5px solid ${on ? "#B4E0C4" : "transparent"}`, borderRadius: 14, padding: "13px 14px", cursor: "pointer", boxShadow: "0 2px 8px rgba(10,60,70,0.07)" }}>
                      <span style={{ flex: "none", width: 23, height: 23, borderRadius: 8, display: "grid", placeItems: "center", fontFamily: ARCH, fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: on ? "#2FA36A" : "#DCE7E8" }}>{on ? "✓" : ""}</span>
                      <span style={{ flex: 1, fontFamily: SANS, fontSize: 14.5, lineHeight: 1.45, textAlign: "left", color: "#21313C" }}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {effView === "travel" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#FF6B4A", borderRadius: 18, padding: 20 }}>
                <p style={{ ...eyebrow("#FFE3D8"), letterSpacing: "0.16em" }}>Do not be that person</p>
                <p style={{ fontFamily: ARCH, fontSize: 30, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#FFFFFF", margin: 0 }}>Airport 2 hours early</p>
                <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#FFE3D8", margin: "8px 0 0" }}>International flight. Carpool or get a ride — airport parking needs your Direct Supervisor's approval first.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Your itinerary</p>
                <p style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.55, color: "#21313C", margin: 0 }}>Itineraries email out the first week of November. Check your name spelling, birthday, dates, times and destination — then <strong>email confirmation of receipt to your SDO</strong>.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>At the gate</p>
                <ul style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 18, margin: 0, fontFamily: SANS, fontSize: 14.5, lineHeight: 1.45, color: "#21313C" }}>
                  <li>Download your airline app and add your passport details before you travel.</li>
                  <li>Gates change without notice — keep checking the app.</li>
                  <li>Southwest: check in exactly 24 hours out for the best boarding position.</li>
                </ul>
              </div>
            </div>
          )}

          {effView === "arriving" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={card}>
                <p style={eyebrow("#FF6B4A")}>Four steps to the beach</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {ARRIVAL.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: "#0E8C93", color: "#FFFFFF", display: "grid", placeItems: "center", fontFamily: ARCH, fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                      <span style={{ flex: 1, fontFamily: SANS, fontSize: 14.5, lineHeight: 1.45, color: "#21313C" }}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>What to look for</p>
                <Slot label="AmStar greeter with CMG-branded sign" ratio="4 / 3" />
                <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#6B7C86", margin: "10px 0" }}>AmStar staff wait just outside customs in a blue patterned uniform shirt with an AmStar name badge. No CMG sign? Do not accept help — call your Senior Leadership.</p>
                <Slot label="AmStar shuttle vehicles" ratio="16 / 9" />
                <p style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.5, color: "#8B9AA3", margin: "8px 0 0" }}>A 55-seat motorcoach, a Mercedes-Benz Sprinter, or a Toyota Hiace — all AmStar branded.</p>
              </div>
            </div>
          )}

          {effView === "resort" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={card}>
                <p style={{ fontFamily: ARCH, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: ACCENT, margin: "0 0 6px" }}>Hilton Cancun, an All-Inclusive Resort</p>
                <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#6B7C86", margin: "0 0 12px" }}>Carr Federal Libre 307 Cancun-Tulum Km 248-868, 77580 Cancún, Q.R.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href="tel:+529984320300" style={{ flex: 1, textAlign: "center", background: "#0E8C93", color: "#FFFFFF", textDecoration: "none", borderRadius: 12, padding: 12, fontFamily: ARCH, fontSize: 13.5, fontWeight: 700 }}>Call resort</a>
                  <a href="https://www.hilton.com/en/hotels/cunqrhh-hilton-cancun/" target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", background: "#E7F1F2", color: ACCENT, textDecoration: "none", borderRadius: 12, padding: 12, fontFamily: ARCH, fontSize: 13.5, fontWeight: 700 }}>Resort site</a>
                </div>
              </div>
              <div style={{ background: "#0E8C93", borderRadius: 18, padding: "18px 20px" }}>
                <p style={eyebrow("#BDEDEF")}>All of this is included</p>
                <ul style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 18, margin: 0, fontFamily: SANS, fontSize: 14.5, lineHeight: 1.45, color: "#FFFFFF" }}>
                  <li>Every meal and snack across 12 dining experiences</li>
                  <li>Minibar refreshed daily — and unlimited ice cream and churros</li>
                  <li>24-hour room service, pool and beach service</li>
                  <li>Two infinity pools, fitness center, nightly entertainment</li>
                  <li>Wi-Fi, taxes and gratuities</li>
                </ul>
              </div>
              <div style={{ background: "#FFEFD6", borderRadius: 18, padding: "16px 18px" }}>
                <p style={eyebrow("#C4581F")}>What is not included</p>
                <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: "#6B4A2A", margin: 0 }}>Do not charge anything to your room. If a price or a "$" shows on a menu, it is not free. Spa, gift shops, US phone calls, in-room movies and off-site activities bill back to you personally.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Phone use in Mexico</p>
                <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: "#21313C", margin: 0 }}>Stay on Wi-Fi and turn on Wi-Fi calling. Use WhatsApp for calls and texts. Never use the hotel phone to call the States — it bills by the minute, back to you.</p>
              </div>
            </div>
          )}

          {effView === "dining" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#6B7C86", margin: "0 0 2px" }}>Five specialty restaurants, a food hall, five bars, and a churro shop that never closes. Tap a menu to cache it before you fly.</p>
              {VENUES.map(([name, cuisine, hours, links]) => (
                <div key={name} style={{ ...card, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <p style={{ fontFamily: ARCH, fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: ACCENT, margin: 0 }}>{name}</p>
                    <p style={tagPill("#FFEFD6", "#C4581F")}>{cuisine}</p>
                  </div>
                  <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.45, color: "#8B9AA3", margin: "4px 0 0" }}>{hours}</p>
                  <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
                    {links.length === 0 ? <span style={{ color: "#8B9AA3" }}>No published menu</span> : links.map(([label, href], i) => (
                      <span key={label}>{i ? " · " : ""}<a href={href} target="_blank" rel="noreferrer" style={{ color: "#0E8C93", fontWeight: 700 }}>{label}</a></span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          )}

          {effView === "map" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ ...card, padding: 12 }}>
                <Slot label="Hilton Cancun resort map" ratio="4 / 3" />
                <p style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.5, color: "#8B9AA3", margin: "8px 4px 2px" }}>Pinch to zoom. Cached for offline use.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Meeting rooms</p>
                <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.55, color: "#21313C", margin: 0 }}>16 Lobby Terrace · 17 Waldorf Astoria Ballroom · 18 Azul Ballroom · 19 Pre-Function · 20 Hilton Arena</p>
              </div>
            </div>
          )}

          {effView === "agenda" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: "#FFEFD6", borderRadius: 18, padding: "14px 16px" }}>
                <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#6B4A2A", margin: 0 }}>Mornings are ours, afternoons are yours. Meetings are mandatory, and no alcohol during morning sessions.</p>
              </div>
              {AGENDA.map(([day, tg, items]) => (
                <div key={day} style={{ ...card, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                    <p style={{ fontFamily: ARCH, fontSize: 15, fontWeight: 800, color: ACCENT, margin: 0 }}>{day}</p>
                    <p style={tagPill("#E7F1F2", ACCENT)}>{tg}</p>
                  </div>
                  <p style={{ fontFamily: SANS, fontSize: 14.5, lineHeight: 1.5, color: "#21313C", margin: 0 }}>{items}</p>
                </div>
              ))}
            </div>
          )}

          {effView === "attire" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative", overflow: "hidden", background: "#FFB13B", borderRadius: 18, padding: "18px 20px" }}>
                <span style={{ position: "absolute", top: -30, right: -20, width: 110, height: 110, borderRadius: "50%", background: "#FF6B4A", opacity: 0.75 }} />
                <p style={{ position: "relative", ...eyebrow("#7A4408"), letterSpacing: "0.16em" }}>December in Cancun</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em", color: "#3E2205", margin: 0 }}>82° day · 70° night · 80° water</p>
                <p style={{ position: "relative", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#5C3308", margin: "8px 0 0" }}>Tropical and humid, inside and out. Bring a layer for cool evenings.</p>
              </div>
              <div style={{ ...card, padding: "14px 16px" }}>
                <p style={eyebrow(ACCENT)}>Resort casual</p>
                <Slot label="Resort casual outfit examples" ratio="16 / 9" />
                <div style={{ height: 10 }} />
                <Slot label="Resort casual guide — him / her / both" ratio="16 / 9" />
                <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: "#6B7C86", margin: "10px 0 0" }}>Formalwear is strongly recommended for the final night; business casual is the minimum. No swimwear outside the pool and beach, and shoes inside every building.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Restaurant dress codes</p>
                <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.5, color: "#21313C", margin: 0 }}><strong>Casual:</strong> beach robes allowed, shoes required; no swimwear, beachwear, flip flops or tank tops. <strong>Smart casual:</strong> no swimwear, beachwear, robes, flip flops, tank tops or shorts.</p>
              </div>
            </div>
          )}

          {effView === "faq" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {FAQ.map(([q, a], i) => {
                const on = openFaq === i;
                return (
                  <button key={i} type="button" onClick={() => setOpenFaq(on ? null : i)} style={{ textAlign: "left", background: "#FFFFFF", border: "none", borderRadius: 16, padding: "14px 16px", cursor: "pointer", boxShadow: "0 2px 8px rgba(10,60,70,0.09)" }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontFamily: ARCH, fontSize: 14.5, fontWeight: 700, color: ACCENT }}>{q}</span>
                      <span style={{ fontFamily: ARCH, fontSize: 18, fontWeight: 700, color: "#FF6B4A" }}>{on ? "−" : "+"}</span>
                    </span>
                    {on && <span style={{ display: "block", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.55, color: "#6B7C86", marginTop: 9 }}>{a}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {effView === "photos" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative", overflow: "hidden", background: "#FF6B4A", borderRadius: 20, padding: 20 }}>
                <span style={{ position: "absolute", bottom: -40, right: -24, width: 120, height: 120, borderRadius: "50%", background: "#FFB13B", opacity: 0.9 }} />
                <p style={{ position: "relative", ...eyebrow("#FFE3D8"), letterSpacing: "0.16em" }}>Shared album</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 27, fontWeight: 800, lineHeight: 1.12, letterSpacing: "-0.02em", color: "#FFFFFF", margin: 0 }}>Every brand, one photo wall</p>
                <p style={{ position: "relative", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#FFE3D8", margin: "8px 0 0" }}>{photos.length === 1 ? "1 photo added" : `${photos.length} photos added`} · uploads sync when you are back on Wi-Fi.</p>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", textAlign: "center", background: "#FFFFFF", border: "1.5px dashed #BBD0D3", borderRadius: 18, padding: "22px 18px", cursor: "pointer", boxShadow: "0 2px 8px rgba(10,60,70,0.07)" }}>
                <span style={{ fontFamily: ARCH, fontSize: 16, fontWeight: 800, color: ACCENT }}>{authed ? "Add photos" : "Add photos as a guest"}</span>
                <span style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.45, color: "#8B9AA3" }}>{registered ? `Posting as ${firstName} · ${cx!.brand}` : "Register to have your name on your photos"}</span>
                <input type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: "none" }} />
              </label>
              {photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#E7F1F2", boxShadow: "0 2px 8px rgba(10,60,70,0.09)" }}>
                      <img src={p.url} alt={`Convention photo ${i + 1}`} style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }} />
                      <span style={{ position: "absolute", left: 8, bottom: 8, background: "rgba(10,60,70,0.78)", color: "#FFFFFF", borderRadius: 999, padding: "3px 9px", fontFamily: ARCH, fontSize: 11, fontWeight: 700 }}>{p.by}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Photo challenges</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {PROMPTS.map((p) => <span key={p} style={{ background: "#FFEFD6", color: "#C4581F", borderRadius: 999, padding: "8px 12px", fontFamily: ARCH, fontSize: 12.5, fontWeight: 700 }}>{p}</span>)}
                </div>
                <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: "#6B7C86", margin: "12px 0 0" }}>Winners shown on the big screen at the Final Night Celebration.</p>
              </div>
            </div>
          )}

          {effView === "gate" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative", overflow: "hidden", background: ACCENT, borderRadius: 20, padding: "22px 20px" }}>
                <span style={{ position: "absolute", bottom: -46, right: -26, width: 130, height: 130, borderRadius: "50%", background: "#0E8C93" }} />
                <p style={{ position: "relative", ...eyebrow("#FFB13B"), letterSpacing: "0.16em" }}>Members only</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 28, fontWeight: 800, lineHeight: 1.12, letterSpacing: "-0.02em", color: "#FFFFFF", margin: 0 }}>Register to unlock your support crew</p>
                <p style={{ position: "relative", fontFamily: SANS, fontSize: 14, lineHeight: 1.55, color: "#BDEDEF", margin: "10px 0 0" }}>Leadership phone numbers are only shown to registered CMG travelers.</p>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>An account gets you</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {PERKS.map(([title, note]) => (
                    <div key={title} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                      <span style={{ flex: "none", width: 22, height: 22, borderRadius: 7, background: "#0E8C93", color: "#FFFFFF", display: "grid", placeItems: "center", fontFamily: ARCH, fontSize: 12, fontWeight: 700 }}>✓</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontFamily: ARCH, fontSize: 14.5, fontWeight: 700, color: "#21313C" }}>{title}</span>
                        <span style={{ display: "block", fontFamily: SANS, fontSize: 13, lineHeight: 1.45, color: "#6B7C86" }}>{note}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" onClick={() => { setAuthMode("register"); setError(""); }} style={{ background: "#FF6B4A", color: "#FFFFFF", border: "none", borderRadius: 14, padding: 15, cursor: "pointer", fontFamily: ARCH, fontSize: 15, fontWeight: 700 }}>Register for the convention</button>
              </div>
            </div>
          )}

          {effView === "auth" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.55, color: "#6B7C86", margin: 0 }}>Registering ties your CMG convention profile to your SoarHub sign-in and unlocks your leadership contacts, passport upload and personalized email.</p>
              <div style={{ ...card, display: "flex", flexDirection: "column", gap: 13 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: ARCH, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT }}>Full name</span>
                  <input type="text" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder={sbProfile?.full_name || "Dana Whitfield"} style={{ border: "1.5px solid #DCE7E8", borderRadius: 11, padding: "12px 13px", fontFamily: SANS, fontSize: 15, color: "#21313C", background: "#FBFDFD" }} />
                </label>
                <div>
                  <span style={{ display: "block", fontFamily: ARCH, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: ACCENT, marginBottom: 8 }}>Your brand</span>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {BRANDS.map((b) => {
                      const on = form.brand === b;
                      return <button key={b} type="button" onClick={() => setField("brand", b)} style={{ background: on ? "#0E8C93" : "#F1F7F8", color: on ? "#FFFFFF" : ACCENT, border: `1.5px solid ${on ? "#0E8C93" : "#DCE7E8"}`, borderRadius: 999, padding: "9px 13px", cursor: "pointer", fontFamily: ARCH, fontSize: 12.5, fontWeight: 700 }}>{b}</button>;
                    })}
                  </div>
                </div>
              </div>
              {error && <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#C4321F", background: "#FFECE7", borderRadius: 12, padding: "12px 14px", margin: 0 }}>{error}</p>}
              <button type="button" onClick={register} style={{ background: "#0E8C93", color: "#FFFFFF", border: "none", borderRadius: 14, padding: 15, cursor: "pointer", fontFamily: ARCH, fontSize: 15, fontWeight: 700 }}>Register and unlock support</button>
              <button type="button" onClick={() => { setAuthMode("gate"); setError(""); }} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: ACCENT, textDecoration: "underline" }}>Back</button>
              <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: "#8B9AA3", margin: 0 }}>Accounts are verified against the CMG traveler list. Passport images are encrypted and visible only to your Senior Leadership.</p>
            </div>
          )}

          {effView === "support" && authed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative", overflow: "hidden", background: ACCENT, borderRadius: 20, padding: 20 }}>
                <span style={{ position: "absolute", top: -34, right: -24, width: 110, height: 110, borderRadius: "50%", background: "#0E8C93" }} />
                <p style={{ position: "relative", ...eyebrow("#FFB13B"), letterSpacing: "0.16em" }}>{cx!.brand} · registered</p>
                <p style={{ position: "relative", fontFamily: ARCH, fontSize: 26, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#FFFFFF", margin: 0 }}>Your crew, {firstName}</p>
                <p style={{ position: "relative", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5, color: "#BDEDEF", margin: "8px 0 0" }}>Travel, itinerary, rooming or an emergency — they resolve it or escalate it.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {contacts.length === 0 && <p style={{ fontFamily: SANS, fontSize: 13.5, color: "#8B9AA3", margin: "0 2px" }}>Your crew is being finalized — check back soon.</p>}
                {contacts.map((c) => (
                  <div key={c.step} style={{ display: "flex", alignItems: "center", gap: 12, background: "#FFFFFF", borderRadius: 16, padding: "14px 16px", boxShadow: "0 2px 8px rgba(10,60,70,0.09)" }}>
                    <span style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", background: "#E7F1F2", display: "grid", placeItems: "center", fontFamily: ARCH, fontSize: 13, fontWeight: 700, color: ACCENT }}>{c.step}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontFamily: ARCH, fontSize: 15, fontWeight: 700, color: "#21313C" }}>{c.name}</span>
                      <span style={{ display: "block", fontFamily: SANS, fontSize: 12.5, color: "#8B9AA3" }}>{c.role}</span>
                    </span>
                    {c.phone
                      ? <a href={`tel:${c.phone}`} style={{ flex: "none", background: "#FF6B4A", color: "#FFFFFF", textDecoration: "none", borderRadius: 999, padding: "8px 14px", fontFamily: ARCH, fontSize: 12.5, fontWeight: 700 }}>Call</a>
                      : <span style={{ flex: "none", background: "#F1F7F8", color: "#8B9AA3", borderRadius: 999, padding: "8px 14px", fontFamily: ARCH, fontSize: 12.5, fontWeight: 700 }}>No number</span>}
                  </div>
                ))}
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Passport on file</p>
                <button type="button" onClick={togglePassport} style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left", width: "100%", cursor: "pointer", borderRadius: 14, padding: 15, background: cx?.passport_uploaded ? "#EAF7EF" : "#F8FBFB", border: `1.5px ${cx?.passport_uploaded ? "solid #B4E0C4" : "dashed #BBD0D3"}` }}>
                  <span style={{ fontFamily: ARCH, fontSize: 14.5, fontWeight: 700, color: "#21313C" }}>{cx?.passport_uploaded ? "Passport on file · marked" : "Mark passport as ready"}</span>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.45, color: "#6B7C86" }}>{cx?.passport_uploaded ? "Tap to clear. (Encrypted file upload arrives in the next update.)" : "Tap to flag it's ready. Encrypted file upload arrives in the next update."}</span>
                </button>
              </div>
              <div style={card}>
                <p style={eyebrow(ACCENT)}>Your personalized email</p>
                <p style={{ fontFamily: SANS, fontSize: 14, lineHeight: 1.55, color: "#21313C", margin: "0 0 10px" }}>Itineraries, rooming and reminders go to <strong>{email}</strong>.</p>
                <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: "#6B7C86", margin: 0 }}>Room: Tower 2 · 1418. Roommate assigned November 24. Requests due to your Direct Supervisor by November 1.</p>
              </div>
              <div style={{ background: "#FFEFD6", borderRadius: 18, padding: "16px 18px" }}>
                <p style={eyebrow("#C4581F")}>Reminders</p>
                <ul style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 18, margin: 0, fontFamily: SANS, fontSize: 14, lineHeight: 1.45, color: "#6B4A2A" }}>
                  <li>Carry your passport off the resort; safe it otherwise.</li>
                  <li>Buddy system at all times, and obey local law and custom.</li>
                  <li>Be mindful with alcohol and respect anyone not drinking.</li>
                </ul>
              </div>
              <button type="button" onClick={leave} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: "#8B9AA3", textDecoration: "underline" }}>Sign out</button>
            </div>
          )}
        </div>

        {/* Bottom tabs */}
        <div style={{ flex: "none", display: "flex", background: "#FFFFFF", borderTop: "1px solid #E7F1F2", padding: "8px 6px 14px" }}>
          {TABS.map(([id, label, target]) => {
            const on = id === tabId;
            return (
              <button key={id} type="button" onClick={() => go(target)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, background: "none", border: "none", padding: "6px 2px", cursor: "pointer", color: on ? ACCENT : "#A2B4BA" }}>
                <span style={{ width: 22, height: 4, borderRadius: 999, background: on ? "#FF6B4A" : "#DCE7E8" }} />
                <span style={{ fontFamily: ARCH, fontSize: 11, fontWeight: 700, letterSpacing: "0.02em" }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
