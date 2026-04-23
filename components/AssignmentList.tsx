"use client";

import type { CanvasAssignment } from "@/lib/types";
import { COURSE_COLORS } from "@/lib/types";

interface Props {
  assignments: CanvasAssignment[];
}

function formatDate(iso: string | null) {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s{3,}/g, "\n\n").trim();
}

function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 10);
  const q = lines.filter(l => l.match(/^\d+[\.\)]/) || l.endsWith("?") || l.match(/^Q\d+:/i));
  return q.length > 0 ? q.slice(0, 5) : [];
}

export default function AssignmentList({ assignments }: Props) {
  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 p-8 text-center text-[#8892a4] text-sm bg-[#1a2236]">
        No assignments found in this date range. Try expanding the window or check your Canvas token.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#8892a4] font-medium uppercase tracking-wide">
        {assignments.length} assignment{assignments.length !== 1 ? "s" : ""} found
        &nbsp;·&nbsp; click any card to open in Canvas
      </p>
      {assignments.map((a) => {
        const accent = COURSE_COLORS[a.course_code] ?? "#555555";
        const questions = extractQuestions(a.description ?? null);
        return (
          <div
            key={a.id}
            style={{ borderLeft: `3px solid ${accent}` }}
            className="bg-[#1a2236] border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span
                className="text-[11px] font-black tracking-wider px-2 py-0.5 rounded flex-shrink-0 mt-0.5"
                style={{ background: accent + "22", color: accent }}
              >
                {a.course_code}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#e8eaf0] leading-snug">{a.name}</p>
                  {a.html_url && (
                    <a
                      href={a.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#4f8ef7] hover:underline flex-shrink-0"
                    >
                      Canvas ↗
                    </a>
                  )}
                </div>
                <p className="text-xs text-[#8892a4] mt-0.5">
                  📅 {formatDate(a.due_at)} &nbsp;·&nbsp; {a.course_name}
                </p>
                {questions.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#8892a4]">
                      Discussion Questions
                    </p>
                    {questions.map((q, i) => (
                      <p key={i} className="text-xs text-[#c8d0dc] leading-relaxed pl-2 border-l border-white/10">
                        {q}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
