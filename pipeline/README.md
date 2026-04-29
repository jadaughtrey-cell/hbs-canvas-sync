# HBS Case Prep Pipeline — Python Scripts

**RC MBA 2026 · DSAIL Final Project · Jim Daughtrey**

These scripts automate the full weekly case preparation workflow: scraping Canvas for assignments, downloading case PDFs from HBSP, generating AI-powered study cheatsheets, and syncing everything to Outlook calendar events.

---

## Quick Start

```bash
python weekly_prep.py 2026-04-13 2026-04-17
```

That single command runs all four steps for the given week. See options below.

---

## Setup (One Time)

### 1. Install dependencies
```bash
pip install anthropic requests beautifulsoup4 python-docx playwright pywin32 PyMuPDF
python -m playwright install chromium
```

### 2. Set environment variables
```
HBS_CANVAS_TOKEN    — Canvas API token (generate at hbs.instructure.com → Settings → Approved Integrations)
ANTHROPIC_API_KEY   — Anthropic API key (console.anthropic.com)
```

Create a `.env` file in this folder:
```
HBS_CANVAS_TOKEN=your_token_here
ANTHROPIC_API_KEY=your_key_here
```

### 3. Authenticate with HBSP (one time, ~2 minutes)
```bash
python hbsp_downloader.py --setup
```
This opens a browser window. Log into HBS Canvas, click any HBSP case link, confirm the PDF opens, then press Enter. Your session is saved and all future downloads run automatically.

---

## Scripts

| Script | Purpose |
|--------|--------|
| `weekly_prep.py` | **Master runner** — runs all four steps with one command |
| `canvas_scraper.py` | Hits the Canvas API to fetch assignments and extract HBSP links |
| `hbsp_downloader.py` | Downloads case PDFs from HBSP using a saved browser session |
| `ai_case_analyzer.py` | Sends case text to Claude Sonnet and returns structured analysis |
| `run_cheatsheet.py` | Entry point for generating a single cheatsheet from PDF(s) |
| `gen_cheatsheets_v2.py` | Builds the formatted .docx cheatsheet document |
| `outlook_sync.py` | Renames Outlook calendar events and attaches case files |

---

## weekly_prep.py — Options

```bash
# Full week, all courses
python weekly_prep.py 2026-04-13 2026-04-17

# Specific courses only
python weekly_prep.py 2026-04-13 2026-04-17 --courses BGIE FIN2

# Skip PDF downloads (use files already on disk)
python weekly_prep.py 2026-04-13 2026-04-17 --skip-download

# Also push to Outlook calendar (rename events + attach files)
python weekly_prep.py 2026-04-13 2026-04-17 --sync-outlook

# Use a more powerful model for deeper analysis
python weekly_prep.py 2026-04-13 2026-04-17 --model claude-opus-4-6
```

---

## run_cheatsheet.py — Single Cheatsheet

```python
from run_cheatsheet import run_one

path = run_one(
    pdf_paths  = ["C:/path/to/case.pdf"],
    course     = "FIN2",
    class_num  = 21,
    date       = "2026-04-14",
    topic      = "Turnaround at Mattel, 2017 (Day 2)",
    event_time = "3:15 PM – 4:35 PM",
    questions  = ["How should the CEO prioritize the turnaround?"],
    depth      = "intermediate",   # basic | intermediate | advanced
    output_dir = "C:/temp"
)
print(f"Saved to: {path}")
```

---

## Cost

Each intermediate-depth cheatsheet costs approximately **$0.10–0.15** in Anthropic API calls (Claude Sonnet). A full week of 4–5 cases runs roughly $0.50–0.75.

---

## Notes

- HBSP session tokens expire periodically. If downloads start failing, re-run `python hbsp_downloader.py --setup`.
- Outlook sync requires Microsoft Outlook to be installed and open on Windows.
- The pipeline was built and is operated using [Claude Cowork](https://claude.ai) as the agentic runtime — all scripts were vibe-coded with AI assistance.
