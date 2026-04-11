import { NextRequest, NextResponse } from "next/server";
import { validateDateRange } from "@/lib/dateValidation";
import { HBS_COURSES, type CanvasAssignment } from "@/lib/types";

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>/gi,"\n").replace(/<\/li>/gi,"\n")
    .replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text.split("\n").map(l=>l.trim()).filter(l=>l.length>10);
  const q = lines.filter(l=>l.match(/^\d+[\.)]\ /)||l.endsWith("?")||l.match(/^Q\d+:/i));
  return q.length>0 ? q : lines.slice(0,5);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, canvasUrl, startDate, endDate } = body;

    if (!token)     return NextResponse.json({ error: "Canvas API token is required." }, { status: 400 });
    if (!canvasUrl) return NextResponse.json({ error: "Canvas URL is required." }, { status: 400 });

    const validation = validateDateRange(startDate, endDate);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const BASE = `https://${canvasUrl}/api/v1`;
    const headers = { Authorization: `Bearer ${token}` };
    const startTs = new Date(startDate + "T00:00:00").getTime();
    const endTs   = new Date(endDate   + "T23:59:59").getTime();

    // Fetch courses — try both with and without enrollment_type filter
    const [r1, r2] = await Promise.all([
      fetch(`${BASE}/courses?per_page=100`, { headers }),
      fetch(`${BASE}/courses?enrollment_type=student&per_page=100`, { headers }),
    ]);
    const [b1, b2] = await Promise.all([r1.json().catch(()=>null), r2.json().catch(()=>null)]);

    let courses: Record<string,unknown>[] = [];
    if (Array.isArray(b1) && b1.length>0) courses = b1;
    else if (Array.isArray(b2) && b2.length>0) courses = b2;

    if (courses.length === 0) {
      return NextResponse.json({
        error: `Canvas returned no courses (HTTP ${r1.status}). Check your token or try regenerating it at https://${canvasUrl}/profile/settings`,
        assignments: [],
      }, { status: 401 });
    }

    const nameMap: Record<number,string> = {};
    const codeMap: Record<number,string> = {};
    for (const c of courses) {
      const id = c.id as number;
      nameMap[id] = (c.name as string) || `Course ${id}`;
      const cc = ((c.course_code as string)||"").split(/[\s_]/)[0].toUpperCase();
      codeMap[id] = HBS_COURSES[id] || cc || "COURSE";
    }

    // Fetch assignments for every course
    const assignResults = await Promise.all(
      courses.map(async (c) => {
        const id = c.id as number;
        const res = await fetch(`${BASE}/courses/${id}/assignments?per_page=100&order_by=due_at`, { headers });
        if (!res.ok) return [];
        const data = await res.json().catch(()=>[]);
        return Array.isArray(data) ? data : [];
      })
    );

    const allAssignments: CanvasAssignment[] = [];
    for (let i=0; i<courses.length; i++) {
      const courseId = courses[i].id as number;
      for (const a of assignResults[i]) {
        if (!a.due_at) continue;
        const dueTs = new Date(a.due_at).getTime();
        if (dueTs >= startTs && dueTs <= endTs) {
          allAssignments.push({
            id: a.id, name: a.name,
            course_id: courseId,
            course_name: nameMap[courseId] || `Course ${courseId}`,
            course_code: codeMap[courseId] || "COURSE",
            due_at: a.due_at,
            description: a.description || null,
            questions: extractQuestions(a.description),
            html_url: a.html_url,
          });
        }
      }
    }

    allAssignments.sort((a,b) => new Date(a.due_at||"").getTime() - new Date(b.due_at||"").getTime());
    return NextResponse.json({ assignments: allAssignments });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}