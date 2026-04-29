"""
HBS AI Case Analyzer
Jim Daughtrey | RC MBA 2026
============================================================
PURPOSE:
  Reads one or more case PDFs (+ optional exhibits), sends the full
  text to the Anthropic API with the HBS cheat sheet analysis prompt,
  and returns a structured `sections` list compatible with
  gen_cheatsheets_v2.build_cheatsheet().

USAGE:
  from ai_case_analyzer import analyze_case

  sections = analyze_case(
      pdf_paths=["/path/to/case.pdf", "/path/to/exhibits.pdf"],   # list of files
      questions=["Q1 text?", "Q2 text?"],                         # assignment questions
      api_key=None,            # if None, reads ANTHROPIC_API_KEY env var
      model="claude-sonnet-4-6", # or claude-opus-4-6 for deeper analysis
      max_tokens=8000,
  )

  # then pass sections into the doc builder:
  from gen_cheatsheets_v2 import build_cheatsheet
  build_cheatsheet(cls_entry, sections)

RETURNED SECTIONS:
  The function returns a list of section dicts understood by
  gen_cheatsheets_v2 (v2.1+), including the new `argument_table` type:

  section types:
    info_table      – 2-col metadata table (label | value)
    prose           – narrative paragraph / bullet list
    qa              – Q&A block (bold question + shaded answer)
    argument_table  – side-by-side argument comparison table (NEW in v2.1)

  Full schema documented in gen_cheatsheets_v2.py module docstring.

DEPENDENCIES:
  pip install anthropic pdfplumber --break-system-packages

HISTORY:
  2026-04-12  v1.0  Initial implementation.
"""

import os
import json
import re
import textwrap

# ─── LOAD .env IF PRESENT ─────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_env_path = os.path.join(_HERE, ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ─── TEXT EXTRACTION (PDF + DOCX) ────────────────────────────────────────────

def extract_pdf_text(pdf_path: str, max_chars: int = 80_000) -> str:
    """
    Extract plain text from a PDF file using pdfplumber.
    Truncates to max_chars to stay within token limits.
    Falls back to a minimal error message if extraction fails.
    """
    try:
        import pdfplumber
    except ImportError:
        raise ImportError(
            "pdfplumber is required for PDF extraction.\n"
            "Install it: pip install pdfplumber --break-system-packages"
        )

    pages = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
    except Exception as e:
        return f"[PDF extraction failed for {os.path.basename(pdf_path)}: {e}]"

    full_text = "\n\n".join(pages)
    if len(full_text) > max_chars:
        full_text = full_text[:max_chars] + "\n\n[... text truncated for token budget ...]"
    return full_text


def extract_docx_text(docx_path: str, max_chars: int = 80_000) -> str:
    """
    Extract plain text from a Word .docx file using python-docx.
    Preserves paragraph structure. Truncates to max_chars.
    Falls back to a minimal error message if extraction fails.

    Requires: pip install python-docx --break-system-packages
    """
    try:
        from docx import Document
    except ImportError:
        raise ImportError(
            "python-docx is required for Word document extraction.\n"
            "Install it: pip install python-docx --break-system-packages"
        )

    try:
        doc = Document(docx_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # Also extract text from tables
        for table in doc.tables:
            for row in table.rows:
                row_text = "  |  ".join(
                    cell.text.strip() for cell in row.cells if cell.text.strip()
                )
                if row_text:
                    paragraphs.append(row_text)
        full_text = "\n\n".join(paragraphs)
    except Exception as e:
        return f"[DOCX extraction failed for {os.path.basename(docx_path)}: {e}]"

    if len(full_text) > max_chars:
        full_text = full_text[:max_chars] + "\n\n[... text truncated for token budget ...]"
    return full_text


def extract_file_text(file_path: str, max_chars: int = 80_000) -> str:
    """
    Route a file to the correct extractor based on extension.
    Supports: .pdf, .docx, .doc (legacy — text extraction may be limited).
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return extract_pdf_text(file_path, max_chars=max_chars)
    elif ext in (".docx", ".doc"):
        return extract_docx_text(file_path, max_chars=max_chars)
    else:
        return f"[Unsupported file type for text extraction: {ext} — {os.path.basename(file_path)}]"


def get_page_count(pdf_paths: list) -> int:
    """
    Return the total page count across all PDFs.
    For .docx files, estimates pages from paragraph count (~25 paras/page).
    Returns 0 if extraction fails.
    """
    try:
        import pdfplumber
    except ImportError:
        pdfplumber = None

    total = 0
    for path in pdf_paths:
        ext = os.path.splitext(path)[1].lower()
        if ext == ".pdf" and pdfplumber:
            try:
                with pdfplumber.open(path) as pdf:
                    total += len(pdf.pages)
            except Exception:
                pass
        elif ext in (".docx", ".doc"):
            try:
                from docx import Document
                doc = Document(path)
                paras = len([p for p in doc.paragraphs if p.text.strip()])
                total += max(1, paras // 25)   # rough page estimate
            except Exception:
                total += 5   # conservative fallback
    return total


def extract_all_pdfs(pdf_paths: list, max_chars_each: int = 60_000) -> str:
    """
    Extract text from multiple case files (PDF or DOCX) and concatenate
    with clear separators. max_chars_each limits each file individually.

    Accepts: .pdf, .docx, .doc
    Note: parameter is named pdf_paths for backward compatibility but now
    accepts any supported case file format.
    """
    parts = []
    for path in pdf_paths:
        basename = os.path.basename(path)
        text = extract_file_text(path, max_chars=max_chars_each)
        parts.append(f"=== FILE: {basename} ===\n{text}\n=== END: {basename} ===")
    return "\n\n".join(parts)


# ─── PROMPT BUILDER ──────────────────────────────────────────────────────────

# ─── DEPTH TIERS ─────────────────────────────────────────────────────────────
#
# Three analysis depths with different JSON schemas and token budgets.
# Cost per case (Sonnet 4.6, ~16k input tokens fixed):
#   simple       → ~4k output  → ~$0.11/case
#   intermediate → ~10k output → ~$0.20/case  ← recommended
#   detailed     → ~16k output → ~$0.29/case
#
DEPTH_CONFIG = {
    "simple": {
        "max_tokens":   2_500,
        "label":        "Simple",
        "cost_per_case": 0.07,
        "description":  "Key facts, decision frame, and Q&A only. Fast and cheap.",
    },
    "intermediate": {
        "max_tokens":   5_000,
        "label":        "Intermediate (Recommended)",
        "cost_per_case": 0.13,
        "description":  "Full stakeholder map, timeline, argument tables, and Q&A.",
    },
    "detailed": {
        "max_tokens":   7_000,
        "label":        "Detailed",
        "cost_per_case": 0.18,
        "description":  "Everything — second-order effects, analogies, disconfirming evidence.",
    },
}

# ─── LENGTH CALIBRATION ───────────────────────────────────────────────────────
# Maps case page count → target word budget for the full cheat sheet.
# Hard cap: 5 pages ≈ 2,000 words.  Scale proportionally below that.
def _length_target(page_count: int) -> str:
    """Return a concise length instruction string for the prompt."""
    if page_count <= 4:
        return "~400–600 words total (the case is very short; be proportionally brief)"
    elif page_count <= 8:
        return "~600–900 words total"
    elif page_count <= 12:
        return "~900–1,300 words total"
    elif page_count <= 16:
        return "~1,300–1,700 words total"
    else:
        return "~1,700–2,000 words total (HARD CAP: never exceed 5 pages / ~2,000 words)"

_STYLE_BLOCK = """
STYLE:
- Dense with insight. No generic statements. No padding.
- Causal reasoning over description.
  BAD: "Costs increased." GOOD: "Costs increased due to X, which compressed margins, ultimately threatening Y."
- Write like a top-tier consultant or investor memo.
- LENGTH IS CRITICAL: the output word count must be proportional to the case length.
  A 4-page case needs a tight 1-page cheat sheet. A 15-page case warrants up to 4 pages.
  NEVER exceed 5 pages / ~2,000 words regardless of case length.
  If a section adds no new insight, omit it entirely rather than padding.
""".strip()

# ── SIMPLE ────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT_SIMPLE = textwrap.dedent("""
You are an expert analyst creating a concise AI-generated case study cheat sheet for an HBS MBA student.
Return ONLY a valid JSON object — no prose, no markdown fences, no explanation.

JSON SCHEMA:
{
  "executive_summary": [
    "3-4 tight bullets covering the situation, key decision, and stakes"
  ],
  "core_tension": "1-2 sentence description of the central X vs Y dilemma and its stakes",
  "key_risks": [
    "Risk: mechanism and impact (3 items max)"
  ],
  "qa_answers": [
    {
      "question": "Exact question text",
      "answer": "Concise answer with key point + supporting evidence. Use • for bullets."
    }
  ]
}

REQUIREMENTS:
- executive_summary: exactly 3 bullets max. Decision frame mandatory. Omit if redundant with Q&A.
- core_tension: one crisp sentence per side of the dilemma. 1-2 sentences total.
- key_risks: top 2-3 by severity. One sentence each. Skip entirely if case is ≤5 pages.
- qa_answers: answer every assignment question. Be direct. 2-3 bullets per answer max.
""").strip() + "\n\n" + _STYLE_BLOCK

# ── INTERMEDIATE ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT_INTERMEDIATE = textwrap.dedent("""
You are an expert analyst creating a high-quality AI-generated case study cheat sheet for an HBS MBA student.
Return ONLY a valid JSON object — no prose, no markdown fences, no explanation.

JSON SCHEMA:
{
  "executive_summary": [
    "5-6 bullets covering situation, key decision, and stakes"
  ],
  "core_tension": "2-3 sentence X vs Y dilemma with stakes on both sides",
  "timeline": [
    "YYYY: event description (6-8 entries max)"
  ],
  "key_actors": [
    {
      "name": "Name / Organization",
      "role": "Their role",
      "incentives": "What they want",
      "constraints": "What limits them"
    }
  ],
  "key_questions": [
    "The 2-3 central questions the case is trying to answer"
  ],
  "argument_analyses": [
    {
      "question": "The key question being analyzed",
      "dimensions": [
        {"dimension": "Claim",           "for": "...", "against": "..."},
        {"dimension": "Evidence",        "for": "...", "against": "..."},
        {"dimension": "Reasoning (Why)", "for": "...", "against": "..."},
        {"dimension": "Implications",    "for": "...", "against": "..."}
      ]
    }
  ],
  "key_risks": [
    "Risk: mechanism and impact (4 items max)"
  ],
  "hidden_assumptions": [
    "Assumption: what is assumed and why it could be wrong (3 items max)"
  ],
  "qa_answers": [
    {
      "question": "Exact question text",
      "answer": "Thorough answer. Use \\n for line breaks. Use • for bullets."
    }
  ]
}

REQUIREMENTS:
- executive_summary: 3-4 bullets max. Include decision frame. Skip if Q&A covers it.
- core_tension: genuine dilemma. Stakes on both sides. 2 sentences max.
- timeline: chronological, specific dates. 4-5 entries max. Omit for short cases.
- key_actors: 2-4 most important stakeholders only. Incentives and constraints mandatory.
- key_questions: 2 central questions max.
- argument_analyses: one block per key question. Both sides. Keep each cell to 1 sentence.
- key_risks: top 3 by severity × likelihood. One sentence each. Skip for short cases.
- hidden_assumptions: 2 most important only. Omit for short cases.
- qa_answers: answer every assignment question. 3-4 bullets per answer max.
- OMIT any section that is redundant or adds no unique insight given space constraints.
""").strip() + "\n\n" + _STYLE_BLOCK

# ── DETAILED ──────────────────────────────────────────────────────────────────
SYSTEM_PROMPT_DETAILED = textwrap.dedent("""
You are an expert analyst creating a comprehensive AI-generated case study cheat sheet for an HBS MBA student.
Return ONLY a valid JSON object — no prose, no markdown fences, no explanation.

JSON SCHEMA:
{
  "executive_summary": ["5-8 tight bullets"],
  "core_tension": "2-4 sentence X vs Y dilemma",
  "timeline": ["YYYY: event description"],
  "key_actors": [
    {"name": "...", "role": "...", "incentives": "...", "constraints": "..."}
  ],
  "key_questions": ["The 2-4 central questions"],
  "argument_analyses": [
    {
      "question": "...",
      "dimensions": [
        {"dimension": "Claim",           "for": "...", "against": "..."},
        {"dimension": "Evidence",        "for": "...", "against": "..."},
        {"dimension": "Reasoning (Why)", "for": "...", "against": "..."},
        {"dimension": "Implications",    "for": "...", "against": "..."}
      ]
    }
  ],
  "key_risks": ["Risk: mechanism and impact"],
  "second_order_effects": ["Effect: trigger and why it matters"],
  "hidden_assumptions": ["Assumption: what is assumed and why it could be wrong"],
  "what_would_change_your_mind": ["Specific disconfirming evidence that would flip the analysis"],
  "analogies": ["Comparable real-world case and what it teaches"],
  "qa_answers": [
    {"question": "Exact question text", "answer": "Detailed answer. Use \\n and •."}
  ]
}

REQUIREMENTS:
- executive_summary: 4-5 bullets max. Key takeaway and decision frame mandatory.
- core_tension: genuine dilemma. Stakes on both sides. 2-3 sentences max.
- timeline: chronological, specific dates. 5-6 entries max. Omit for cases ≤6 pages.
- key_actors: top 3-4 stakeholders. Incentives and constraints mandatory. Omit minor players.
- key_questions: 2-3 central questions.
- argument_analyses: one block per key question. Both sides. 1 sentence per cell. Cite exhibits if present.
- key_risks: top 3-4. One sentence each with causal mechanism.
- second_order_effects: top 2 only. One sentence each.
- hidden_assumptions: top 2-3. Skip if case is short and obvious.
- what_would_change_your_mind: 2 specific data points max.
- analogies: 1-2 max. One sentence each.
- qa_answers: answer every assignment question. 3-5 bullets per answer max.
- OMIT any optional section if total word count is approaching the length target.
""").strip() + "\n\n" + _STYLE_BLOCK

# Map depth string → system prompt
_SYSTEM_PROMPTS = {
    "simple":       SYSTEM_PROMPT_SIMPLE,
    "intermediate": SYSTEM_PROMPT_INTERMEDIATE,
    "detailed":     SYSTEM_PROMPT_DETAILED,
}

# Keep backward-compatible alias (old code that imports SYSTEM_PROMPT directly)
SYSTEM_PROMPT = SYSTEM_PROMPT_DETAILED


def build_user_prompt(case_text: str, questions: list, page_count: int = 0) -> str:
    q_block = ""
    if questions:
        q_block = "\n\nASSIGNMENT QUESTIONS (answer each in qa_answers):\n"
        for i, q in enumerate(questions, start=1):
            q_block += f"  Q{i}: {q}\n"

    length_instruction = ""
    if page_count > 0:
        target = _length_target(page_count)
        length_instruction = (
            f"\n\nCASE LENGTH: {page_count} pages. "
            f"TARGET OUTPUT LENGTH: {target}. "
            f"Scale section depth and bullet counts proportionally. "
            f"Omit optional sections if they would push the output over the length target."
        )

    return f"""Here are the case materials:{length_instruction}{q_block}

---BEGIN CASE MATERIALS---
{case_text}
---END CASE MATERIALS---

Return the JSON analysis object now. No markdown, no explanation — only the JSON object."""


# ─── ANTHROPIC API CALL ───────────────────────────────────────────────────────

def call_anthropic(
    case_text: str,
    questions: list,
    api_key: str = None,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = None,
    depth: str = "intermediate",
    page_count: int = 0,
) -> dict:
    """
    Call the Anthropic API and return the parsed JSON response dict.
    Uses requests library directly (no anthropic SDK required).
    """
    import requests as _requests

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError(
            "Anthropic API key required. Pass api_key= or set ANTHROPIC_API_KEY env var."
        )

    # Resolve depth → system prompt and token budget
    depth = depth.lower() if depth else "intermediate"
    if depth not in _SYSTEM_PROMPTS:
        raise ValueError(f"depth must be one of: {list(_SYSTEM_PROMPTS)}. Got: {depth!r}")
    system_prompt = _SYSTEM_PROMPTS[depth]
    if max_tokens is None:
        max_tokens = DEPTH_CONFIG[depth]["max_tokens"]

    user_prompt = build_user_prompt(case_text, questions, page_count=page_count)

    cfg = DEPTH_CONFIG[depth]
    print(f"  → Calling {model} | depth={depth} | max_tokens={max_tokens} | est. cost ~${cfg['cost_per_case']:.2f}/case")

    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }

    resp = _requests.post(
        "https://api.anthropic.com/v1/messages",
        headers=headers,
        json=payload,
        timeout=300,
        verify=False,  # sandbox proxy uses self-signed cert
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Anthropic API error {resp.status_code}: {resp.text[:500]}"
        )

    data = resp.json()
    raw = data["content"][0]["text"].strip()

    # Strip markdown fences if the model wrapped them anyway
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw.strip())

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Anthropic response was not valid JSON.\nError: {e}\n"
            f"Raw response (first 500 chars):\n{raw[:500]}"
        )


# ─── SECTIONS BUILDER ─────────────────────────────────────────────────────────

def analysis_to_sections(analysis: dict, questions: list) -> list:
    """
    Convert the parsed AI JSON analysis into a sections list
    compatible with gen_cheatsheets_v2.build_cheatsheet().
    """
    sections = []

    # ── 1. Executive Summary —──────────────────────────────────────────────────
    bullets = analysis.get("executive_summary", [])
    if bullets:
        body = "\n".join(f"• {b}" for b in bullets)
        sections.append({
            "type":  "prose",
            "title": "Executive Summary",
            "body":  body,
        })

    # ── 2. Core Tension ──────────────────────────────────────────────────────
    tension = analysis.get("core_tension", "")
    if tension:
        sections.append({
            "type":  "prose",
            "title": "Core Tension",
            "body":  tension,
        })

    # ── 3. Key Actors — rendered as info_table ────────────────────────────────
    actors = analysis.get("key_actors", [])
    if actors:
        rows = []
        for a in actors:
            name = a.get("name", "")
            role = a.get("role", "")
            incentives = a.get("incentives", "")
            constraints = a.get("constraints", "")
            value = f"{role}\nIncentives: {incentives}\nConstraints: {constraints}"
            rows.append((name, value))
        sections.append({
            "type": "info_table",
            "rows": rows,
        })

    # ── 4. Timeline ───────────────────────────────────────────────────────────
    timeline = analysis.get("timeline", [])
    if timeline:
        body = "\n".join(f"• {t}" for t in timeline)
        sections.append({
            "type":  "prose",
            "title": "Timeline of Key Events",
            "body":  body,
        })

    # ── 5. Key Questions ──────────────────────────────────────────────────────
    key_qs = analysis.get("key_questions", [])
    if key_qs:
        body = "\n".join(f"• {q}" for q in key_qs)
        sections.append({
            "type":  "prose",
            "title": "Key Questions & Decisions",
            "body":  body,
        })

    # ── 6. Argument Analysis Tables ───────────────────────────────────────────
    arg_analyses = analysis.get("argument_analyses", [])
    for aa in arg_analyses:
        sections.append({
            "type":       "argument_table",
            "question":   aa.get("question", ""),
            "dimensions": aa.get("dimensions", []),
        })

    # ── 7. Assignment Q&A ─────────────────────────────────────────────────────
    qa_answers = analysis.get("qa_answers", [])
    if qa_answers:
        items = [{"question": qa["question"], "answer": qa["answer"]}
                 for qa in qa_answers]
        sections.append({
            "type":  "qa",
            "title": "Assignment Q&A",
            "items": items,
        })
    elif questions:
        # Fallback: render questions without AI answers
        items = [{"question": q, "answer": "(AI answer not generated)"}
                 for q in questions]
        sections.append({
            "type":  "qa",
            "title": "Assignment Q&A",
            "items": items,
        })

    # ── 8. Additional Sections ────────────────────────────────────────────────
    additional = [
        ("key_risks",                   "Key Risks & Uncertainties"),
        ("second_order_effects",        "Second-Order Effects"),
        ("hidden_assumptions",          "Hidden Assumptions"),
        ("what_would_change_your_mind", "What Would Change Your Mind?"),
        ("analogies",                   "Analogies & Comparable Cases"),
    ]
    for key, title in additional:
        items = analysis.get(key, [])
        if items:
            body = "\n".join(f"• {item}" for item in items)
            sections.append({
                "type":  "prose",
                "title": title,
                "body":  body,
            })

    return sections


# ─── PUBLIC ENTRY POINT ───────────────────────────────────────────────────────

def analyze_case(
    pdf_paths: list,
    questions: list = None,
    api_key: str = None,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = None,
    depth: str = "intermediate",
    max_chars_per_pdf: int = 60_000,
) -> list:
    """
    Full pipeline: PDF text extraction → Anthropic analysis → sections list.

    Args:
        pdf_paths:         List of case file paths (.pdf, .docx, or .doc).
                           Parameter name retained for backward compatibility.
        questions:         Assignment questions from Canvas (list of strings).
        api_key:           Anthropic API key. Falls back to ANTHROPIC_API_KEY env var.
        model:             Anthropic model to use. Default: claude-opus-4-6.
        max_tokens:        Max tokens for the response. Default: 8000.
        max_chars_per_pdf: Max chars extracted per PDF before truncation. Default: 60,000.

    Returns:
        List of section dicts for gen_cheatsheets_v2.build_cheatsheet().
    """
    if questions is None:
        questions = []

    print(f"  [ai_case_analyzer] Extracting text from {len(pdf_paths)} case file(s)...")
    page_count = get_page_count(pdf_paths)
    case_text = extract_all_pdfs(pdf_paths, max_chars_each=max_chars_per_pdf)
    print(f"  [ai_case_analyzer] Extracted {len(case_text):,} chars total ({page_count} pages).")
    if page_count > 0:
        print(f"  [ai_case_analyzer] Length target: {_length_target(page_count)}")

    analysis = call_anthropic(case_text, questions, api_key=api_key,
                               model=model, max_tokens=max_tokens, depth=depth,
                               page_count=page_count)

    sections = analysis_to_sections(analysis, questions)
    print(f"  [ai_case_analyzer] Generated {len(sections)} sections.")
    return sections


# ─── CLI SMOKE TEST ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Quick CLI test:
        python ai_case_analyzer.py /path/to/case.pdf "Q1 text?" "Q2 text?"

    Requires ANTHROPIC_API_KEY in environment.
    """
    import sys

    if len(sys.argv) < 2:
        print("Usage: python ai_case_analyzer.py <case.pdf> [<exhibits.pdf> ...] [questions...]")
        print("  PDFs are detected by .pdf extension; remaining args are questions.")
        sys.exit(1)

    args = sys.argv[1:]
    _case_exts = (".pdf", ".docx", ".doc")
    pdfs = [a for a in args if a.lower().endswith(_case_exts)]
    qs   = [a for a in args if not a.lower().endswith(_case_exts)]

    print(f"PDFs   : {pdfs}")
    print(f"Questions: {qs}")
    print()

    sections = analyze_case(pdfs, questions=qs)

    print(f"\nReturned {len(sections)} sections:")
    for s in sections:
        stype = s.get("type")
        title = s.get("title", s.get("question", ""))
        if stype == "argument_table":
            ndims = len(s.get("dimensions", []))
            print(f"  [{stype}] {title!r} — {ndims} dimension rows")
        elif stype == "info_table":
            nrows = len(s.get("rows", []))
            print(f"  [{stype}] — {nrows} rows")
        elif stype == "qa":
            nitems = len(s.get("items", []))
            print(f"  [{stype}] {title!r} — {nitems} Q&A pairs")
        else:
            body = s.get("body", "")
            print(f"  [{stype}] {title!r} — {len(body)} chars")
