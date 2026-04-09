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
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      setStepIndex(0);
      stepTimer.current = setInterval(() => {
        setStepIndex((i) => (i < LOADING_STEPS.length - 1 ? i + 1 : i));
      }, 1800);
    } else {
      if (stepTimer.current) clearInterval(stepTimer.current);
    }
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, [loading]);

  async function handleFetch(canvasToken: string, startDate: string, endDate: string) {
    setLoading(true);
    setAssignments(null);
    setError("");
    setToken(canvasToken);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: canvasToken, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch assignments");
      setAssignments(data.assignments);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const progressPct = ((stepIndex + 1) / LOADING_STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#A41034] text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="text-2xl font-bold tracking-tight">HBS Canvas Sync</div>
          <div className="text-sm text-red-200 mt-0.5">
            Canvas → Outlook · Cheat Sheets · OneDrive
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Intro */}
        {!assignments && !loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <h1 className="text-2xl font-semibold text-gray-800 mb-2">
              Weekly Class Prep, Automated
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-2xl">
              Connect your HBS Canvas account to automatically pull assignment questions,
              required readings, and case summaries for a selected week — then generate
              formatted cheat sheets and push everything to your Outlook calendar and OneDrive.
            </p>
            <div className="mt-6 flex gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A41034]" /> Canvas integration
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A41034]" /> Auto cheat sheets
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A41034]" /> Outlook sync
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A41034]" /> OneDrive upload
              </span>
            </div>
          </div>
        )}

        {/* Setup form */}
        <SetupForm onFetch={handleFetch} loading={loading} />

        {/* Loading indicator */}
        {loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5">
              <div
                className="h-full bg-[#A41034] rounded-full transition-all duration-700 ease-in-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Step message with bouncing dots */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[#A41034] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#A41034] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#A41034] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm text-gray-600 font-medium">{LOADING_STEPS[stepIndex]}</span>
            </div>

            {/* Step indicators */}
            <div className="flex gap-1.5 items-center">
              {LOADING_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i <= stepIndex ? "bg-[#A41034]" : "bg-gray-200"
                  } ${i === stepIndex ? "w-6" : "w-2"}`}
                />
              ))}
              <span className="ml-2 text-xs text-gray-400">
                Step {stepIndex + 1} of {LOADING_STEPS.length}
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-5 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {assignments && (
          <AssignmentList assignments={assignments} token={token} />
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 py-8">
        HBS Canvas Sync · Built for RC MBA 2026 · DSAIL Final Project
      </footer>
    </div>
  );
}
