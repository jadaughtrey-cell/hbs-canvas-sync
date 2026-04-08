import { NextRequest, NextResponse } from "next/server";
import { validateDateRange } from "@/lib/dateValidation";
import { HBS_COURSES, type CanvasAssignment } from "@/lib/types";

const CANVAS_BASE = "https://canvas.harvard.edu/api/v1";

// Strip HTML tags and extract plain text lines
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Extract assignment questions from Canvas description HTML
function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 10);

  // Heuristic: lines that look like questions
  const questions = lines.filter(
    (l) =>
      l.match(/^\d+[\.\)]\s/) ||          // numbered: "1. What is..."
      l.endsWith("?") ||                   // ends with question mark
      l.match(/^Q\d+:/i)                   // labeled: "Q1: ..."
  );

  return questions.length > 0 ? questions : lines.slice(0, 5);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, startDate, endDate } = body;

    if (!token) {
      return NextResponse.json({ error: "Canvas API token is required." }, { status: 400 });
    }

    // Validate date range
    const validation = validateDateRange(startDate, endDate);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const headers = { Authorization: `Bearer ${token}` };
    const courseIds = Object.keys(HBS_COURSES).map(Number);

    const allAssignments: CanvasAssignment[] = [];

    // Fetch assignments for each HBS course in parallel
    await Promise.all(
      courseIds.map(async (courseId) => {
        try {
          // Get course info
          const courseRes = await fetch(`${CANVAS_BASE}/courses/${courseId}`, { headers });
          if (!courseRes.ok) return; // skip courses user can't access

          const course = await courseRes.json();

          // Fetch assignments due in the date range
          const params = new URLSearchParams({
            "bucket": "due_after",
            "per_page": "50",
          });

          const assignRes = await fetch(
            `${CANVAS_BASE}/courses/${courseId}/assignments?${params}`,
            { headers }
          );
          if (!assignRes.ok) return;

          const assignments = await assignRes.json();

          // Filter by due date within range
          const startTs = new Date(startDate + "T00:00:00").getTime();
          const endTs   = new Date(endDate   + "T23:59:59").getTime();

          for (const a of assignments) {
            if (!a.due_at) continue;
            const dueTs = new Date(a.due_at).getTime();

            // Include assignments due in range OR due just before (same-day prep)
            // We use a 2-day lookback so assignments due Monday show on Sunday prep
            if (dueTs >= startTs - 2 * 86400000 && dueTs <= endTs + 86400000) {
              allAssignments.push({
                id:          a.id,
                name:        a.name,
                course_id:   courseId,
                course_name: course.name || `Course ${courseId}`,
                course_code: HBS_COURSES[courseId] || "OTHER",
                due_at:      a.due_at,
                description: a.description || null,
                questions:   extractQuestions(a.description),
                html_url:    a.html_url,
              });
            }
          }
        } catch {
          // Skip courses that error — don't fail the whole request
        }
      })
    );

    // Sort by due date
    allAssignments.sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

    return NextResponse.json({ assignments: allAssignments });
  } catch (e: unknown) {
    console.error("Canvas API error:", e);
    return NextResponse.json(
      { error: "Failed to fetch Canvas data. Check your token and try again." },
      { status: 500 }
    );
  }
}
