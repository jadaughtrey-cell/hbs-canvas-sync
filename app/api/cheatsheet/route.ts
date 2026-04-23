import { NextRequest, NextResponse } from "next/server";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, HeadingLevel, AlignmentType,
  TableLayoutType,
} from "docx";
import type { CanvasAssignment } from "@/lib/types";
import { COURSE_COLORS } from "@/lib/types";

// ── Color helpers ──────────────────────────────────────────────────────────
function hexToBgr(hex: string) {
  return hex.replace("#", "").toUpperCase();
}
function lightHex(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lighten = (c: number) => Math.round(c + (255 - c) * 0.88);
  return [lighten(r), lighten(g), lighten(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// ── HTML → plain text ──────────────────────────────────────────────────────
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
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function extractQuestions(html: string | null): string[] {
  if (!html) return [];
  const text = stripHtml(html);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
  const q = lines.filter(
    (l) => l.match(/^\d+[\.\)]/) || l.endsWith("?") || l.match(/^Q\d+:/i)
  );
  return q.length > 0 ? q.slice(0, 5) : lines.slice(0, 5);
}

// ── Claude API call ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert analyst creating a high-quality AI-generated case study cheat sheet for an HBS MBA student.
Return ONLY a valid JSON object — no prose, no markdown fences, no explanation.

JSON SCHEMA:
{
  "executive_summary": ["5-6 tight bullets covering situation, key decision, and stakes"],
  "core_tension": "2-3 sentence X vs Y dilemma with stakes on both sides",
  "key_actors": [
    {"name": "Name / Organization", "role": "Their role", "incentives": "What they want", "constraints": "What limits them"}
  ],
  "key_risks": ["Risk: mechanism and impact (3 items max)"],
  "hidden_assumptions": ["Assumption: what is assumed and why it could be wrong (2 items max)"],
  "qa_answers": [
    {"question": "Exact question text", "answer": "Thorough answer. Use \\n for line breaks. Use • for bullets."}
  ]
}

REQUIREMENTS:
- executive_summary: 4-5 bullets max. Include the key decision frame. Be specific, not generic.
- core_tension: genuine dilemma with stakes on both sides. 2-3 sentences. Not a summary.
- key_actors: top 3-4 stakeholders. Incentives and constraints are mandatory. Skip minor players.
- key_risks: top 3 by severity. One sentence each with causal mechanism.
- hidden_assumptions: top 2 most important. Skip if case is short.
- qa_answers: answer EVERY assignment question. 3-4 bullets per answer. Be direct and analytical.
- OMIT any section that adds no unique insight. Never return empty arrays.
- Write as if advising a student who needs to contribute in class in 2 hours.`;

async function callClaude(caseContext: string, questions: string[]): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const qBlock = questions.length > 0
    ? "\n\nASSIGNMENT QUESTIONS (answer each in qa_answers):\n" +
      questions.map((q, i) => `  Q${i + 1}: ${q}`).join("\n")
    : "";

  const userPrompt = `Here are the case materials:${qBlock}

---BEGIN CASE MATERIALS---
${caseContext}
---END CASE MATERIALS---

Return the JSON analysis object now. No markdown, no explanation — only the JSON object.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    let raw: string = data?.content?.[0]?.text?.trim() ?? "";
    // Strip markdown fences if model wrapped them
    raw = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Document builders ──────────────────────────────────────────────────────
function headerBar(accent: string, assignment: CanvasAssignment) {
  const dueDate = assignment.due_at
    ? new Date(assignment.due_at).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "";
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.SOLID, color: hexToBgr(accent), fill: hexToBgr(accent) },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        children: [new Paragraph({
          children: [
            new TextRun({ text: assignment.course_code, bold: true, color: "FFFFFF", size: 22 }),
            new TextRun({ text: "  |  CLASS PREP  |  ", color: "FFFFFF", size: 20 }),
            new TextRun({ text: dueDate, color: "FFFFFF", size: 20 }),
          ],
        })],
      })],
    })],
  });
}

function sectionHeading(text: string, accent: string) {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: hexToBgr(accent), size: 22 })],
    spacing: { before: 220, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hexToBgr(accent) } },
  });
}

function bulletPara(text: string, light: string) {
  return new Paragraph({
    children: [new TextRun({ text: "• " + text, size: 19 })],
    spacing: { after: 60 },
    shading: { type: ShadingType.SOLID, color: light, fill: light },
    indent: { left: 180 },
  });
}

function actorsTable(actors: Array<{name: string; role: string; incentives: string; constraints: string}>, accent: string) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: ["Actor", "Role", "Incentives", "Constraints"].map((h) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: hexToBgr(accent), fill: hexToBgr(accent) },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 18 })] })],
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
      })
    ),
  });

  const dataRows = actors.map((a, idx) => {
    const bg = idx % 2 === 0 ? "F9F9F9" : "FFFFFF";
    return new TableRow({
      children: [a.name, a.role, a.incentives, a.constraints].map((val) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, color: bg, fill: bg },
          children: [new Paragraph({ children: [new TextRun({ text: val ?? "", size: 18 })] })],
        })
      ),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...dataRows],
  });
}

function qaBlock(q: string, a: string, light: string, accent: string) {
  const answerLines = a.split(/\\n|\n/).filter(Boolean);
  return [
    new Paragraph({
      children: [new TextRun({ text: q, bold: true, size: 20 })],
      spacing: { before: 160, after: 60 },
    }),
    ...answerLines.map((line) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 19 })],
        spacing: { after: 50 },
        shading: { type: ShadingType.SOLID, color: light, fill: light },
        indent: { left: 200 },
      })
    ),
  ];
}

// ── Main handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { assignment }: { assignment: CanvasAssignment; token: string } = body;

    const accent = COURSE_COLORS[assignment.course_code] ?? "#555555";
    const light = lightHex(accent);

    const questions = extractQuestions(assignment.description ?? null);
    const caseContext = stripHtml(assignment.description ?? "").slice(0, 12000);

    // Call Claude for real analysis
    const ai = await callClaude(
      caseContext || `Case: ${assignment.name}\nCourse: ${assignment.course_name}`,
      questions
    );

    const sections: (Paragraph | Table)[] = [];

    // Header
    sections.push(headerBar(accent, assignment));
    sections.push(new Paragraph({ text: "", spacing: { after: 120 } }));

    // Title
    sections.push(new Paragraph({
      children: [new TextRun({ text: assignment.name, bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 60 },
    }));
    sections.push(new Paragraph({
      children: [
        new TextRun({ text: `${assignment.course_code} – ${assignment.course_name}   `, size: 19, color: "666666" }),
        new TextRun({ text: "Generated by HBS Canvas Sync", italics: true, size: 18, color: "999999" }),
      ],
      spacing: { after: 200 },
    }));
    
    if (ai) {
      const execSum = ai.executive_summary as string[] | undefined;
      if (execSum?.length) {
        sections.push(sectionHeading("Executive Summary", accent));
        execSum.forEach((b) => sections.push(bulletPara(b, light)));
      }
      const tension = ai.core_tension as string | undefined;
      if (tension) {
        sections.push(sectionHeading("Core Tension", accent));
        sections.push(new Paragraph({
          children: [new TextRun({ text: tension, italics: true, size: 20 })],
          spacing: { after: 100 },
          shading: { type: ShadingType.SOLID, color: light, fill: light },
          indent: { left: 180 },
        }));
      }
      const actors = ai.key_actors as Array<{name: string; role: string; incentives: string; constraints: string}> | undefined;
      if (actors?.length) {
        sections.push(sectionHeading("Key Actors", accent));
        sections.push(actorsTable(actors, accent));
        sections.push(new Paragraph({ text: "", spacing: { after: 80 } }));
      }
      const risks = ai.key_risks as string[] | undefined;
      if (risks?.length) {
        sections.push(sectionHeading("Key Risks", accent));
        risks.forEach((r) => sections.push(bulletPara(r, light)));
      }
      const assumptions = ai.hidden_assumptions as string[] | undefined;
      if (assumptions?.length) {
        sections.push(sectionHeading("Hidden Assumptions", accent));
        assumptions.forEach((a) => sections.push(bulletPara(a, light)));
      }
      const qaAnswers = ai.qa_answers as Array<{question: string; answer: string}> | undefined;
      if (qaAnswers?.length) {
        sections.push(sectionHeading("Assignment Questions", accent));
        qaAnswers.forEach(({ question, answer }) => {
          qaBlock(question, answer, light, accent).forEach((p) => sections.push(p));
        });
      }
    } else {
      sections.push(sectionHeading("Assignment Questions", accent));
      if (questions.length) {
        questions.forEach((q) => {
          sections.push(new Paragraph({ children: [new TextRun({ text: q, bold: true, size: 20 })], spacing: { before: 160, after: 60 } }));
          sections.push(new Paragraph({
            children: [new TextRun({ text: "[Your analysis here — fill in before class]", italics: true, color: "999999", size: 19 })],
            shading: { type: ShadingType.SOLID, color: light, fill: light },
            indent: { left: 200 },
            spacing: { after: 80 },
          }));
        });
      }
      sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));
      sections.push(new Paragraph({
        children: [new TextRun({ text: "⚠ Set ANTHROPIC_API_KEY in Vercel environment variables to enable AI-generated analysis.", italics: true, color: "AA0000", size: 18 })],
      }));
    }

    const doc = new Document({ sections: [{ children: sections }] });
    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${assignment.course_code} - ${assignment.name}.docx"`,
      },
    });
  } catch (err) {
    console.error("Cheatsheet error:", err);
    return NextResponse.json({ error: "Failed to generate cheat sheet" }, { status: 500 });
  }
}
