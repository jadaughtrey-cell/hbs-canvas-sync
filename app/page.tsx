"use client";
import { useState, useEffect, useRef } from "react";
import SetupForm from "@/components/SetupForm";
import AssignmentList from "@/components/AssignmentList";
import type { CanvasAssignment } from "@/lib/types";

const LOADING_STEPS = [
  "Connecting to Canvas…",
  "Authenticating token…",
  "Loading your courses…",
  "Scanning assignments…",
  "Filtering by date range…",
  "Almost there…",
];

export default function Home() {
  const [assignments, setAssignments] = useState<CanvasAssignment[] | null>(null);
  const [token, setToken]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [stepIndex, setStepIndex]     = useState(0);
  const stepTimer                     = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef                      = useRef<HTMLElement>(null);

  useEffect(() => {
    if (loading) {
      setStepIndex(0);
      stepTimer.current = setInterval(
        () => setStepIndex(i => (i < LOADING_STEPS.length - 1 ? i + 1 : i)),
        1800
      );
    } else {
      if (stepTimer.current) clearInterval(stepTimer.current);
    }
    return () => { if (stepTimer.current) clearInterval(stepTimer.current); };
  }, [loading]);

  async function handleFetch(canvasToken: string, url: string, startDate: string, endDate: string) {
    setLoading(true);
    setAssignments(null);
    setError("");
    setToken(canvasToken);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: canvasToken, canvasUrl: url, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch assignments");
      setAssignments(data.assignments);
      setTimeout(() => fetchRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const progressPct = ((stepIndex + 1) / LOADING_STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-[#080b12] text-[#e8eaf0]">

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#080b12]/90 backdrop-blur border-b border-white/[.06] px-6 h-14 flex items-center gap-6">
        <div className="text-sm font-black tracking-tight text-white">
          <span className="text-[#a41034]">HBS</span> Canvas Sync
        </div>
        <div className="flex gap-5 ml-auto items-center">
          <a href="#how-it-works" className="text-xs font-medium text-[#8892a4] hover:text-white transition-colors hidden sm:block">How it works</a>
          <a href="#calendar"     className="text-xs font-medium text-[#8892a4] hover:text-white transition-colors hidden sm:block">Calendar viz</a>
          <a href="#fetch"        className="text-xs font-bold bg-[#a41034] hover:bg-[#7a0c26] text-white px-3 py-1.5 rounded-lg transition-colors">
            Fetch Assignments
          </a>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="pt-20 pb-16 px-6 text-center" style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(164,16,52,.18) 0%, transparent 70%)" }}>
        <div className="inline-block text-[11px] font-bold tracking-widest uppercase text-[#a41034] bg-[#a41034]/10 border border-[#a41034]/25 px-3 py-1 rounded-full mb-5">
          RC MBA 2026 · DSAIL Final Project
        </div>
        <h1 className="text-4xl sm:text-5xl font-black tracking-[-0.04em] leading-[1.08] mb-5">
          Weekly class prep,<br />
          <span className="text-[#a41034]">fully automated.</span>
        </h1>
        <p className="text-[#8892a4] max-w-lg mx-auto text-base leading-[1.75] mb-8">
          One command Sunday night. By Monday your calendar is renamed, every case file is attached,
          and the week&apos;s assignments are waiting — no manual work.
        </p>
        <div className="flex flex-wrap gap-2.5 justify-center mb-10">
          {["✓ Canvas integration", "✓ AI case analyses", "✓ Outlook sync", "✓ OneDrive upload"].map((p, i) => (
            <span key={i} className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              i === 0 ? "bg-[#34d399]/[.07] border-[#34d399]/25 text-[#34d399]" :
              i === 1 ? "bg-[#4f8ef7]/[.07] border-[#4f8ef7]/25 text-[#7fb3ff]" :
              i === 2 ? "bg-[#fbbf24]/[.07] border-[#fbbf24]/25 text-[#fcd05a]" :
                        "bg-[#f87171]/[.07] border-[#f87171]/25 text-[#ffaaaa]"
            }`}>{p}</span>
          ))}
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <a href="#fetch" className="bg-[#a41034] hover:bg-[#7a0c26] text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors">
            Fetch This Week&apos;s Assignments →
          </a>
          <a href="#calendar" className="border border-white/15 hover:border-white/30 text-[#8892a4] hover:text-white font-semibold text-sm px-6 py-3 rounded-xl transition-colors">
            See Calendar Before / After
          </a>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-16 px-6 bg-[#0d1117] border-t border-white/[.06]">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] font-bold tracking-widest uppercase text-[#a41034] mb-2">The Pipeline</p>
          <h2 className="text-2xl font-black tracking-tight mb-2">Four steps, zero manual work.</h2>
          <p className="text-[#8892a4] text-sm mb-8 max-w-md">Every Sunday night, a single command kicks off a ~47-second automated sequence.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { n:"1", icon:"📡", title:"Canvas Scrape",    body:"Pulls all assignments and case metadata for the week via the Canvas REST API." },
              { n:"2", icon:"🤖", title:"AI Analysis",      body:"Claude generates a cheatsheet per case: Q&A, argument map, hidden assumptions — from the actual PDF text." },
              { n:"3", icon:"📅", title:"Outlook Sync",     body:"Every calendar event renamed with full case title. Files attached. Video links in the event body." },
              { n:"4", icon:"☁️", title:"OneDrive Upload",  body:"All cheatsheets and PDFs land in the right OneDrive folder, named and sorted." },
            ].map(s => (
              <div key={s.n} className="bg-[#1a2236] border border-white/[.08] rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#a41034] mb-2">Step {s.n}</p>
                <div className="text-2xl mb-2">{s.icon}</div>
                <h3 className="text-sm font-bold mb-1">{s.title}</h3>
                <p className="text-xs text-[#8892a4] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CURRENT LIMITATIONS ─────────────────────────────────────── */}
      <section className="py-10 px-6 bg-[#080b12] border-t border-white/[.06]">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-4">
          <div className="bg-[#f87171]/[.05] border border-[#f87171]/20 rounded-xl p-4">
            <p className="text-xs font-bold text-[#ff9999] mb-1">⛔ Outlook Sync — Blocked</p>
            <p className="text-xs text-[#8892a4] leading-relaxed">
              HBS IT has not granted <code className="bg-white/10 px-1 rounded text-[11px]">Calendars.ReadWrite</code> access.
              Requires admin authorization — one IT decision away from running automatically for every enrolled student.
            </p>
          </div>
          <div className="bg-[#fbbf24]/[.05] border border-[#fbbf24]/20 rounded-xl p-4">
            <p className="text-xs font-bold text-[#fcd05a] mb-1">⚠ OneDrive Upload — HBS Tenant Blocked</p>
            <p className="text-xs text-[#8892a4] leading-relaxed">
              HBS OneDrive blocked by the same tenant policy. Personal OneDrive possible but OAuth not yet built.
              The local Python pipeline uploads directly without this restriction.
            </p>
          </div>
        </div>
      </section>

      {/* ── CALENDAR VIZ ────────────────────────────────────────────── */}
      <section id="calendar" className="py-16 px-6 bg-[#0d1117] border-t border-white/[.06]">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] font-bold tracking-widest uppercase text-[#a41034] mb-2">The Transformation</p>
          <h2 className="text-2xl font-black tracking-tight mb-2">Before and after, side by side.</h2>
          <p className="text-[#8892a4] text-sm mb-6">Toggle between your raw HBS calendar and what the pipeline produces every Sunday night.</p>
        </div>
        <div className="mt-6 rounded-2xl overflow-hidden border border-white/[.08] overflow-x-auto" style={{ height: "1900px" }}>
            <iframe
              src="https://jadaughtrey-cell.github.io/hbs-case-prep-site/calendar-before-after.html"
              style={{ width: "1400px", minWidth: "1400px", height: "100%", border: "none", background: "#0c0c18" }}
              title="Calendar before and after the pipeline runs"
            />
          </div>
      </section>

      {/* ── FETCH ASSIGNMENTS ───────────────────────────────────────── */}
      <section id="fetch" ref={fetchRef as React.RefObject<HTMLElement>} className="py-16 px-6 bg-[#080b12] border-t border-white/[.06]">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] font-bold tracking-widest uppercase text-[#a41034] mb-2">Live Canvas Fetch</p>
          <h2 className="text-2xl font-black tracking-tight mb-2">See this week&apos;s assignments.</h2>
          <p className="text-[#8892a4] text-sm mb-8">
            Enter your Canvas API token and date range to pull your actual assignments right now.
          </p>

          <div className="grid sm:grid-cols-[360px_1fr] gap-6 items-start">
            <SetupForm onFetch={handleFetch} loading={loading} />

            <div>
              {loading && (
                <div className="bg-[#1a2236] border border-white/10 rounded-2xl p-6">
                  <div className="w-full h-1.5 bg-white/10 rounded-full mb-5 overflow-hidden">
                    <div className="h-full bg-[#a41034] rounded-full transition-all duration-700" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="flex items-center gap-3">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-2 h-2 rounded-full bg-[#a41034] animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                    <span className="text-sm font-medium text-[#8892a4]">{LOADING_STEPS[stepIndex]}</span>
                  </div>
                  <p className="text-xs text-[#4a5568] mt-3">Step {stepIndex + 1} of {LOADING_STEPS.length}</p>
                </div>
              )}
              {error && (
                <div className="bg-[#f87171]/10 border border-[#f87171]/25 rounded-2xl p-4 text-sm text-[#ff9999]">
                  ❌ {error}
                </div>
              )}
              {assignments && !loading && (
                <AssignmentList assignments={assignments} />
              )}
              {!loading && !assignments && !error && (
                <div className="bg-[#1a2236] border border-white/10 rounded-2xl p-10 text-center text-[#8892a4]">
                  <div className="text-4xl mb-3">📡</div>
                  <p className="text-sm">Enter your token and dates, then click <strong className="text-white">Fetch Assignments</strong>.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[.06] py-8 px-6 text-center text-xs text-[#4a5568]">
        HBS Canvas Sync &nbsp;·&nbsp; RC MBA 2026 &nbsp;·&nbsp; DSAIL Final Project &nbsp;·&nbsp; Jim Daughtrey
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://github.com/jadaughtrey-cell/hbs-canvas-sync" target="_blank" rel="noopener noreferrer" className="hover:text-[#8892a4] transition-colors">GitHub</a>
      </footer>

    </div>
  );
}
