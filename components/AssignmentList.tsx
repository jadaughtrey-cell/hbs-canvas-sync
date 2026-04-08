"use client";

import { useState } from "react";
import type { CanvasAssignment } from "@/lib/types";
import { COURSE_COLORS } from "@/lib/types";

interface Props {
  assignments: CanvasAssignment[];
  token: string;
}

function formatDate(iso: string | null) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function AssignmentList({ assignments, token }: Props) {
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState<Set<number>>(new Set());

  if (assignments.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
        No assignments found in this date range. Try expanding the window or check your Canvas token.
      </div>
    );
  }

  async function handleCheatSheet(assignment: CanvasAssignment) {
    setDownloading(assignment.id);
    try {
      const res = await fetch("/api/cheatsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment, token }),
      });
      if (!res.ok) throw new Error("Failed to generate cheat sheet");

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${assignment.course_code} - ${assignment.name}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded((prev) => new Set(prev).add(assignment.id));
    } catch (e) {
      console.error(e);
      alert("Failed to generate cheat sheet. Please try again.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-700">
          {assignments.length} Assignment{assignments.length !== 1 ? "s" : ""} Found
        </h2>
        <span className="text-xs text-gray-400">Click any card to generate a cheat sheet</span>
      </div>

      {assignments.map((a) => {
        const color = COURSE_COLORS[a.course_code] || COURSE_COLORS.OTHER;
        const isLoading   = downloading === a.id;
        const isDone      = downloaded.has(a.id);

        return (
          <div
            key={a.id}
            className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
          >
            {/* Color bar + header */}
            <div
              className="px-5 py-3 flex items-center justify-between"
              style={{ backgroundColor: color }}
            >
              <div className="flex items-center gap-3">
                <span className="text-white font-bold text-sm tracking-wide">
                  {a.course_code}
                </span>
                <span className="text-white/70 text-sm">{a.course_name}</span>
              </div>
              <span className="text-white/70 text-xs">{formatDate(a.due_at)}</span>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <h3 className="font-semibold text-gray-800 text-sm mb-3">{a.name}</h3>

              {/* Questions */}
              {a.questions.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Assignment Questions
                  </p>
                  <ul className="space-y-1">
                    {a.questions.map((q, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-gray-300 shrink-0">Q{i + 1}</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-gray-50">
                <button
                  onClick={() => handleCheatSheet(a)}
                  disabled={isLoading}
                  className="flex-1 text-sm py-2 rounded-lg font-medium text-white transition disabled:opacity-50"
                  style={{ backgroundColor: isDone ? "#1A5C4A" : color }}
                >
                  {isLoading ? "Generating…" : isDone ? "✓ Downloaded" : "Download Cheat Sheet (.docx)"}
                </button>
                <a
                  href={a.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition"
                >
                  Canvas ↗
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
