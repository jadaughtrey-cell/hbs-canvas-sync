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

const WORKFLOW_KEY = "hbs_workflow_prefs";

interface WorkflowPrefs {
  cheatSheet: boolean;
  outlook: boolean;
  onedrive: boolean;
  autoRun: boolean;
}

const DEFAULT_PREFS: WorkflowPrefs = { cheatSheet: true, outlook: false, onedrive: false, autoRun: false };

export default function Home() {
  const [assignments, setAssignments] = useState<CanvasAssignment[] | null>(null);
  const [token, setToken]             = useState("");
  const [canvasUrl, setCanvasUrl]     = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [stepIndex, setStepIndex]     = useState(0);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [prefs, setPrefs]             = useState<WorkflowPrefs>(DEFAULT_PREFS);
  const [showWorkflow, setShowWorkflow] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(WORKFLOW_KEY);
    if (saved) { try { setPrefs(JSON.parse(saved)); } catch { /* ignore */ } }
  }, []);

  function savePrefs(next: WorkflowPrefs) {
    setPrefs(next);
    localStorage.setItem(WORKFLOW_KEY, JSON.stringify(next));
  }

  useEffect(() => {
    if (loading) {
      setStepIndex(0);
      stepTimer.current = setInterval(() => setStepIndex(i => i < LOADING_STEPS.length - 1 ? i + 1 : i), 1800);
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
    setCanvasUrl(url);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: canvasToken, canvasUrl: url, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch assignments");
      setAssignments(data.assignments);
      setShowWorkflow(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }


  async function handleRunSelected() {
    if (!assignments || !prefs.cheatSheet) return;
    for (const assignment of assignments) {
      try {
        const res = await fetch('/api/cheatsheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignment, token }),
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = assignment.course_code + ' - ' + assignment.name + '.docx';
        a.click(); URL.revokeObjectURL(url);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) { console.error('Cheatsheet failed for', assignment.name, e); }
    }
  }

  const progressPct = ((stepIndex + 1) / LOADING_STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#A41034] text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="text-2xl font-bold tracking-tight">HBS Canvas Sync</div>
          <div className="text-sm text-red-200 mt-0.5">Canvas → Outlook · Cheat Sheets · OneDrive</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {!assignments && !loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <h1 className="text-2xl font-semibold text-gray-800 mb-2">Weekly Class Prep, Automated</h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-2xl">
              Connect your Canvas account to pull upcoming assignments, generate AI-written case analyses, and sync everything to your calendar and OneDrive.
            </p>
            <div className="mt-6 flex flex-wrap gap-4 text-sm text-gray-400">
              {["Canvas integration","AI case analyses","Outlook sync","OneDrive upload"].map(f => (
                <span key={f} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#A41034]" />{f}
                </span>
              ))}
            </div>
          </div>
        )}

        <SetupForm onFetch={handleFetch} loading={loading} />

        {loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5">
              <div className="h-full bg-[#A41034] rounded-full transition-all duration-700" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-1">
                {[0,150,300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-[#A41034] animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </div>
              <span className="text-sm text-gray-600 font-medium">{LOADING_STEPS[stepIndex]}</span>
            </div>
            <div className="flex gap-1.5 items-center">
              {LOADING_STEPS.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i <= stepIndex ? "bg-[#A41034]" : "bg-gray-200"} ${i === stepIndex ? "w-6" : "w-2"}`} />
              ))}
              <span className="ml-2 text-xs text-gray-400">Step {stepIndex + 1} of {LOADING_STEPS.length}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-5 py-3 text-sm">{error}</div>
        )}

        {/* Workflow builder — shown after a successful fetch */}
        {showWorkflow && assignments !== null && !loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-700">What do you want to do with these assignments?</h2>
              <span className="text-xs text-gray-400">{assignments.length} assignment{assignments.length !== 1 ? "s" : ""} found</span>
            </div>

            <div className="space-y-3 mb-5">
              {([
                { key: "cheatSheet", label: "Generate AI case analyses (.docx)", sub: "AI writes 2–4 page answers using case PDFs and questions", ready: true },
                { key: "outlook",    label: "Outlook Calendar Sync",  sub: "⛔ Blocked — HBS IT has not granted Calendars.ReadWrite access. Requires admin authorization.",  ready: false },
                { key: "onedrive",   label: "OneDrive Upload",  sub: "⛔ HBS OneDrive blocked (same tenant). Personal OneDrive possible but OAuth not yet built.",  ready: false },
              ] as const).map(({ key, label, sub, ready }) => (
                <label key={key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${prefs[key] ? "border-[#A41034]/30 bg-red-50/40" : "border-gray-100 hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={prefs[key]} onChange={e => savePrefs({ ...prefs, [key]: e.target.checked })}
                    className="mt-0.5 accent-[#A41034]" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">{label}</span>
                      {!ready && <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">Blocked</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={prefs.autoRun} onChange={e => savePrefs({ ...prefs, autoRun: e.target.checked })}
                  className="accent-[#A41034]" />
                Run automatically every time I fetch
              </label>
              <button
                onClick={handleRunSelected}
                className="bg-[#A41034] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#8a0d2b] transition">
                Run Selected
              </button>
            </div>
          </div>
        )}

        {assignments && assignments.length > 0 && (
          <AssignmentList assignments={assignments} token={token} />
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-8">
        HBS Canvas Sync · Built for RC MBA 2026 · DSAIL Final Project
      </footer>
    </div>
  );
}
