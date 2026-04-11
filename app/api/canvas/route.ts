import { NextRequest, NextResponse } from "next/server";
import { validateDateRange } from "@/lib/dateValidation";
import { HBS_COURSES, type CanvasAssignment } from "@/lib/types";

const CANVAS_BASE = "https://hbs.instructure.com/api/v1";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
  const questions = lines.filter((l) => l.match(/^\d+[\.)]\ /) || l.endsWith("?") || l.match(/^Q\d+:/i));
  return questions.length > 0 ? questions : lines.slice(0, 5);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, startDate, endDate } = body;
    if (!token) return NextResponse.json({ error: "Canvas API token is required." }, { status: 400 });
    const validation = validateDateRange(startDate, endDate);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const headers = { Authorization: `Bearer ${token}` };
    const startTs = new Date(startDate + "T00:00:00").getTime();
    const endTs   = new Date(endDate   + "T23:59:59").getTime();

    // --- Step 1: get courses (try multiple endpoints) ---
    const [r1, r2] = await Promise.all([
      fetch(`${CANVAS_BASE}/courses?per_page=100`, { headers }),
      fetch(`${CANVAS_BASE}/courses?enrollment_type=student&per_page=100`, { headers }),
    ]);
    const [b1, b2] = await Promise.all([r1.json().catch(() => null), r2.json().catch(() => null)]);

    let courses: Record<string, unknown>[] = [];
    if (Array.isArray(b1) && b1.length > 0) courses = b1;
    else if (Array.isArray(b2) && b2.length > 0) courses = b2;

    if (courses.length === 0) {
      return NextResponse.json({
        error: `Canvas token is valid but returned no courses. endpoint1: ${r1.status} (${Array.isArray(b1) ? b1.length : "err"}), endpoint2: ${r2.status} (${Array.isArray(b2) ? b2.length : "err"}). Try regenerating your token at canvas.harvard.edu/profile/settings.`,
        assignments: [],
      });
    }

    const courseNameMap: Record<number, string> = {};
    const courseCodeMap: Record<number, string> = {};
    for (const c of courses) {
      const id = c.id as number;
      courseNameMap[id] = (c.name as string) || `Course ${id}`;
      const cc = ((c.course_code as string) || "").split(/[\s_]/)[0].toUpperCase();
      courseCodeMap[id] = HBS_COURSES[id] || cc || "COURSE";
    }
    const contextCodes = courses.map((c) => `course_${c.id}`);
    const courseNames = courses.map((c) => c.name as string);

    // --- Step 2: fetch assignments per-course directly (most reliable) ---
    const allRaw: { name: string; due_at: string | null; course_id: number }[] = [];
    const assignResults = await Promise.all(
      courses.map(async (c) => {
        const id = c.id as number;
        const res = await fetch(`${CANVAS_BASE}/courses/${id}/assignments?per_page=100&order_by=due_at`, { headers });
        if (!res.ok) return [];
        const data = await res.json().catch(() => []);
        return Array.isArray(data) ? data : [];
      })
    );

    const allAssignments: CanvasAssignment[] = [];
    for (let i = 0; i < courses.length; i++) {
      const courseId = courses[i].id as number;
      for (const a of assignResults[i]) {
        allRaw.push({ name: a.name, due_at: a.due_at, course_id: courseId });
        if (!a.due_at) continue;
        const dueTs = new Date(a.due_at).getTime();
        if (dueTs >= startTs && dueTs <= endTs) {
          allAssignments.push({
            id: a.id, name: a.name,
            course_id: courseId,
            course_name: courseNameMap[courseId] || `Course ${courseId}`,
            course_code: courseCodeMap[courseId] || "COURSE",
            due_at: a.due_at,
            description: a.description || null,
            questions: extractQuestions(a.description),
            html_url: a.html_url,
          });
        }
      }
    }

    allAssignments.sort((a, b) => new Date(a.due_at || "").getTime() - new Date(b.due_at || "").getTime());

    // Build debug: show nearest upcoming assignments so we know what dates Canvas has
    const withDates = allRaw.filter(a => a.due_at).sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    const upcoming = withDates.filter(a => new Date(a.due_at!).getTime() >= Date.now()).slice(0, 5);
    const _debug = {
      courseCount: courses.length,
      courseNames,
      totalAssignmentsFound: allRaw.length,
      assignmentsWithDueDate: withDates.length,
      nearestUpcoming: upcoming.map(a => ({ name: a.name, due_at: a.due_at })),
      matchedRange: allAssignments.length,
    };

    if (allAssignments.length === 0) {
      const upcomingStr = _debug.nearestUpcoming && (_debug.nearestUpcoming as {name:string;due_at:string}[]).length > 0
        ? (_debug.nearestUpcoming as {name:string;due_at:string}[]).map(a => `${a.name} (due ${new Date(a.due_at).toLocaleDateString()})`).join(", ")
        : "none found";
      return NextResponse.json({
        error: `No assignments due ${startDate} ÃÂ¢ÃÂÃÂ ${endDate}. Canvas returned: ${_debug.courseCount} courses, ${_debug.totalAssignmentsFound} total assignments, ${_debug.assignmentsWithDueDate} with a due date. Next upcoming: ${upcomingStr}`,
        assignments: [],
      }, { status: 400 });
    }
    return NextResponse.json({ assignments: allAssignments });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
