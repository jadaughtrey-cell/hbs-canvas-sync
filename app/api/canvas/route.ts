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

    // Try multiple course endpoints to diagnose which works on Harvard Canvas
    const [res1, res2, res3] = await Promise.all([
      fetch(`${CANVAS_BASE}/courses?per_page=100`, { headers }),
      fetch(`${CANVAS_BASE}/courses?enrollment_type=student&per_page=100`, { headers }),
      fetch(`${CANVAS_BASE}/users/self/courses?per_page=100`, { headers }),
    ]);

    const [body1, body2, body3] = await Promise.all([
      res1.json().catch(() => null),
      res2.json().catch(() => null),
      res3.json().catch(() => null),
    ]);

    // Use whichever returned courses
    let courses: Record<string, unknown>[] = [];
    let usedEndpoint = "";
    if (Array.isArray(body1) && body1.length > 0) {
      courses = body1;
      usedEndpoint = "/courses (no filter)";
    } else if (Array.isArray(body2) && body2.length > 0) {
      courses = body2;
      usedEndpoint = "/courses?enrollment_type=student";
    } else if (Array.isArray(body3) && body3.length > 0) {
      courses = body3;
      usedEndpoint = "/users/self/courses";
    }

    // Always return debug info so we can see what each endpoint returned
    const debug = {
      usedEndpoint,
      endpoint1: { status: res1.status, count: Array.isArray(body1) ? body1.length : "not array", sample: Array.isArray(body1) ? JSON.stringify(body1[0]).slice(0, 200) : JSON.stringify(body1).slice(0, 200) },
      endpoint2: { status: res2.status, count: Array.isArray(body2) ? body2.length : "not array" },
      endpoint3: { status: res3.status, count: Array.isArray(body3) ? body3.length : "not array", sample: Array.isArray(body3) ? JSON.stringify(body3[0]).slice(0, 200) : JSON.stringify(body3).slice(0, 200) },
    };

    if (courses.length === 0) {
      return NextResponse.json({ error: "No courses found on any endpoint.", assignments: [], _debug: debug });
    }

    // Build course lookup maps
    const courseNameMap: Record<number, string> = {};
    const courseCodeMap: Record<number, string> = {};
    for (const c of courses) {
      const id = c.id as number;
      courseNameMap[id] = (c.name as string) || `Course ${id}`;
      const canvasCode = ((c.course_code as string) || "").split(/[\s_]/)[0].toUpperCase();
      courseCodeMap[id] = HBS_COURSES[id] || canvasCode || "COURSE";
    }

    const contextCodes = courses.map((c) => `course_${c.id}`);

    const params = new URLSearchParams({
      type:       "assignment",
      start_date: startDate,
      end_date:   endDate,
      per_page:   "100",
    });
    for (const code of contextCodes) {
      params.append("context_codes[]", code);
    }

    const calRes = await fetch(`${CANVAS_BASE}/calendar_events?${params}`, { headers });
    const calEvents = await calRes.json().catch(() => []);

    const allAssignments: CanvasAssignment[] = [];
    if (Array.isArray(calEvents)) {
      for (const event of calEvents) {
        const a = event.assignment;
        if (!a) continue;
        const contextCode: string = event.context_code || "";
        const courseIdMatch = contextCode.match(/course_(\d+)/);
        const courseId = courseIdMatch ? Number(courseIdMatch[1]) : 0;
        allAssignments.push({
          id:          a.id,
          name:        event.title || a.name,
          course_id:   courseId,
          course_name: courseNameMap[courseId] || event.context_name || `Course ${courseId}`,
          course_code: courseCodeMap[courseId] || "COURSE",
          due_at:      event.start_at || a.due_at || null,
          description: a.description || null,
          questions:   extractQuestions(a.description),
          html_url:    a.html_url || event.html_url,
        });
      }
      allAssignments.sort((a, b) => new Date(a.due_at || "").getTime() - new Date(b.due_at || "").getTime());
    }

    debug.calendarStatus = calRes.status;
    debug.calEventCount = Array.isArray(calEvents) ? calEvents.length : "not array";

    return NextResponse.json({ assignments: allAssignments, _debug: debug });
  } catch (e: unknown) {
    console.error("Canvas API error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
