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

    // Fetch all courses the user is actively enrolled in
    const coursesRes = await fetch(
      `${CANVAS_BASE}/courses?enrollment_type=student&enrollment_state=active&per_page=50`,
      { headers }
    );
    if (!coursesRes.ok) {
      const body = await coursesRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `Canvas returned HTTP ${coursesRes.status}: ${body.slice(0, 300)}` },
        { status: 401 }
      );
    }
    const courses = await coursesRes.json();
    if (!Array.isArray(courses)) {
      return NextResponse.json(
        { error: "Unexpected response from Canvas. Check your token." },
        { status: 400 }
      );
    }

    const allAssignments: CanvasAssignment[] = [];
    const startTs = new Date(startDate + "T00:00:00").getTime();
    const endTs   = new Date(endDate   + "T23:59:59").getTime();

    // Fetch assignments for every enrolled course in parallel
    await Promise.all(
      courses.map(async (course: Record<string, unknown>) => {
        try {
          const courseId   = course.id as number;
          const courseName = (course.name as string) || `Course ${courseId}`;

          // Use our known short code if available, otherwise derive from Canvas course_code
          const canvasCode = ((course.course_code as string) || "")
            .split(/[\s_]/)[0]
            .toUpperCase();
          const courseCode = HBS_COURSES[courseId] || canvasCode || "COURSE";

          const assignRes = await fetch(
            `${CANVAS_BASE}/courses/${courseId}/assignments?per_page=50`,
            { headers }
          );
          if (!assignRes.ok) return;

          const assignments = await assignRes.json();
          if (!Array.isArray(assignments)) return;

          for (const a of assignments) {
            if (!a.due_at) continue;
            const dueTs = new Date(a.due_at).getTime();
            if (dueTs >= startTs && dueTs <= endTs) {
              allAssignments.push({
                id:          a.id,
                name:        a.name,
                course_id:   courseId,
                course_name: courseName,
                course_code: courseCode,
                due_at:      a.due_at,
                description: a.description || null,
                questions:   extractQuestions(a.description),
                html_url:    a.html_url,
              });
            }
          }
        } catch {
          // Skip any course that errors — don't fail the whole request
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
