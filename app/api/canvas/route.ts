import { NextRequest, NextResponse } from "next/server";
import { validateDateRange } from "@/lib/dateValidation";
import { HBS_COURSES, type CanvasAssignment } from "@/lib/types";

const CANVAS_BASE = "https://canvas.harvard.edu/api/v1";

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

function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
  const questions = lines.filter(
    (l) => l.match(/^\d+[\.)]\ /) || l.endsWith("?") || l.match(/^Q\d+:/i)
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

    // Step 1: get enrolled courses so we can pass explicit context_codes
    const coursesRes = await fetch(
      `${CANVAS_BASE}/courses?enrollment_type=student&per_page=100`,
      { headers }
    );
    if (!coursesRes.ok) {
      const errBody = await coursesRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `Canvas returned HTTP ${coursesRes.status}: ${errBody.slice(0, 300)}` },
        { status: 401 }
      );
    }
    const courses = await coursesRes.json();
    if (!Array.isArray(courses) || courses.length === 0) {
      return NextResponse.json(
        { error: `No active Canvas courses found. Courses response: ${JSON.stringify(courses).slice(0, 200)}` },
        { status: 400 }
      );
    }

    // Build context_codes[] list
    const contextCodes = courses.map((c: Record<string, unknown>) => `course_${c.id}`);

    // Build course lookup maps
    const courseNameMap: Record<number, string> = {};
    const courseCodeMap: Record<number, string> = {};
    for (const c of courses) {
      const id = c.id as number;
      courseNameMap[id] = (c.name as string) || `Course ${id}`;
      const canvasCode = ((c.course_code as string) || "").split(/[\s_]/)[0].toUpperCase();
      courseCodeMap[id] = HBS_COURSES[id] || canvasCode || "COURSE";
    }

    // Step 2: Calendar Events API with explicit context_codes
    const params = new URLSearchParams({
      type:       "assignment",
      start_date: startDate,
      end_date:   endDate,
      per_page:   "100",
    });
    for (const code of contextCodes) {
      params.append("context_codes[]", code);
    }

    const calRes = await fetch(
      `${CANVAS_BASE}/calendar_events?${params}`,
      { headers }
    );

    if (!calRes.ok) {
      const errBody = await calRes.text().catch(() => "(no body)");
      return NextResponse.json(
        { error: `Canvas calendar API returned HTTP ${calRes.status}: ${errBody.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const calEvents = await calRes.json();
    if (!Array.isArray(calEvents)) {
      return NextResponse.json(
        { error: `Unexpected calendar response: ${JSON.stringify(calEvents).slice(0, 200)}` },
        { status: 400 }
      );
    }

    const allAssignments: CanvasAssignment[] = [];

    for (const event of calEvents) {
      const a = event.assignment;
      if (!a) continue;

      const contextCode: string = event.context_code || "";
      const courseIdMatch = contextCode.match(/course_(\d+)/);
      const courseId = courseIdMatch ? Number(courseIdMatch[1]) : 0;

      const courseName = courseNameMap[courseId] || event.context_name || `Course ${courseId}`;
      const courseCode = courseCodeMap[courseId] || "COURSE";
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

    allAssignments.sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

    // Include debug info so we can diagnose if results are empty
    const debug = {
      courseCount:       courses.length,
      courseNames:       courses.map((c: Record<string, unknown>) => c.name),
      calEventCount:     calEvents.length,
      firstEventSample:  calEvents[0] ? JSON.stringify(calEvents[0]).slice(0, 400) : null,
    };

    return NextResponse.json({ assignments: allAssignments, _debug: debug });
  } catch (e: unknown) {
    console.error("Canvas API error:", e);
    return NextResponse.json(
      { error: "Failed to fetch Canvas data. Check your token and try again." },
      { status: 500 }
    );
  }
}
