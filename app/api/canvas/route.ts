import { NextRequest, NextResponse } from "next/server";
import { validateDateRange } from "@/lib/dateValidation";
import { HBS_COURSES, type CanvasAssignment } from "@/lib/types";

const CANVAS_BASE = "https://canvas.harvard.edu/api/v1";

// Strip HTML tags and extract plain text
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

// Extract questions / key lines from Canvas HTML description
function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 10);
  const questions = lines.filter(
    (l) =>
      l.match(/^\d+[\.)]\ /) ||
      l.endsWith("?") ||
      l.match(/^Q\d+:/i)
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

    const validation = validateDateRange(startDate, endDate);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const headers = { Authorization: `Bearer ${token}` };

    // Use Canvas Calendar Events API — designed for date-range queries.
    // Returns every assignment visible on the Canvas calendar for that window,
    // regardless of whether due_at is set directly on the assignment object.
    const params = new URLSearchParams({
      type:        "assignment",
      start_date:  startDate,
      end_date:    endDate,
      all_courses: "1",
      per_page:    "100",
    });

    const calRes = await fetch(
      `${CANVAS_BASE}/calendar_events?${params}`,
      { headers }
    );

    if (!calRes.ok) {
      const errBody = await calRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `Canvas returned HTTP ${calRes.status}: ${errBody.slice(0, 300)}` },
        { status: 401 }
      );
    }

    const calEvents = await calRes.json();
    if (!Array.isArray(calEvents)) {
      return NextResponse.json(
        { error: "Unexpected response from Canvas. Check your token." },
        { status: 400 }
      );
    }

    const allAssignments: CanvasAssignment[] = [];

    for (const event of calEvents) {
      // Calendar events of type "assignment" have an assignment sub-object
      const a = event.assignment;
      if (!a) continue;

      // Derive course info from context_code, e.g. "course_12345"
      const contextCode: string = event.context_code || "";
      const courseIdMatch = contextCode.match(/course_(\d+)/);
      const courseId = courseIdMatch ? Number(courseIdMatch[1]) : 0;

      const courseName: string = event.context_name || `Course ${courseId}`;
      const canvasCode = ((a.course_code as string) || "")
        .split(/[\s_]/)[0]
        .toUpperCase();
      const courseCode = HBS_COURSES[courseId] || canvasCode || "COURSE";

      const dueAt: string = event.start_at || a.due_at || null;

      allAssignments.push({
        id:          a.id,
        name:        event.title || a.name,
        course_id:   courseId,
        course_name: courseName,
        course_code: courseCode,
        due_at:      dueAt,
        description: a.description || null,
        questions:   extractQuestions(a.description),
        html_url:    a.html_url || event.html_url,
      });
    }

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
