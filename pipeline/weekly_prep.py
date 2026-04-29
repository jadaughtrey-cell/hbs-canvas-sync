"""
HBS Weekly Prep — Master Runner
Jim Daughtrey | RC MBA 2026
============================================================
PURPOSE:
  One command to prep an entire week of HBS classes:

    Step 1 — Canvas scrape:   fetch assignments, questions, HBSP links
    Step 2 — HBSP download:   pull case PDFs to course folders
    Step 3 — AI cheatsheets:  generate .docx cheat sheets via Anthropic
    Step 4 — Outlook sync:    attach files + rename calendar events (optional)

USAGE:
  python weekly_prep.py 2026-04-13 2026-04-17

  Options:
    --courses BGIE FIN2     only these courses (default: all)
    --skip-download         skip PDF downloads (use existing files)
    --skip-cheatsheets      skip cheat sheet generation
    --sync-outlook          push files to Outlook calendar + rename events
    --model claude-opus-4-6 override AI model (default: claude-sonnet-4-6)
    --browser edge          browser for HBSP cookies (default: auto)

ENVIRONMENT VARIABLES REQUIRED:
  HBS_CANVAS_TOKEN    — Canvas API token from hbs.instructure.com
  ANTHROPIC_API_KEY   — Anthropic API key from console.anthropic.com

HISTORY:
  2026-04-12  v1.0  Initial implementation.
  2026-04-13  v1.1  Add TEM course, Outlook sync step.
"""

import os
import sys
import glob
import argparse

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from canvas_scraper      import scrape_week
from hbsp_downloader     import download_all
from run_cheatsheet      import run_one
from ai_case_analyzer    import DEPTH_CONFIG
from class_prep_workflow_v2 import COURSES, validate_date_range


def run_weekly_prep(
    start_str,
    end_str,
    courses         = None,
    skip_download   = False,
    skip_cheatsheets= False,
    sync_outlook    = False,
    model           = "claude-sonnet-4-6",
    depth           = "intermediate",
):
    from canvas_scraper import scrape_week
    from hbsp_downloader import download_all
    from run_cheatsheet import run_one
    from ai_case_analyzer import DEPTH_CONFIG
    from class_prep_workflow_v2 import COURSES, validate_date_range
    validate_date_range(start_str, end_str)
    print(f"\n{'='*60}")
    print(f"  HBS WEEKLY PREP  |  {start_str} -> {end_str}")
    print(f"{'='*60}")
    print(f"\n  STEP 1: Scraping Canvas...")
    entries = scrape_week(start_str, end_str, courses=courses)
    if not entries:
        print("  No assignments found in this date range. Done.")
        return {"entries": [], "downloads": {}, "cheatsheets": []}
    print(f"\n  Found {len(entries)} class session(s).")
    download_results = {}
    if not skip_download:
        print(f"\n  STEP 2: Downloading case PDFs from HBSP...")
        if any(e["files"] for e in entries):
            download_results = download_all(entries)
    cheatsheet_paths = []
    if not skip_cheatsheets:
        cfg = DEPTH_CONFIG.get(depth, DEPTH_CONFIG["intermediate"])
        print(f"\n  STEP 3: Generating AI cheat sheets (model={model}, depth={depth})")
        for entry in entries:
            if entry.get("no_cheatsheet"):
                continue
            course_cfg = COURSES.get(entry["course"], {})
            folder = course_cfg.get("folder", ".")
            pdf_paths = []
            for f in entry["files"]:
                if f.get("is_video"):
                    continue
                fname = f["filename"]
                stem = fname.rsplit(".", 1)[0]
                for ext in ["", ".pdf", ".docx", ".doc"]:
                    c = os.path.join(folder, stem + ext) if ext else os.path.join(folder, fname)
                    if os.path.exists(c) and os.path.getsize(c) > 5000:
                        pdf_paths.append(c)
                        break
            if pdf_paths:
                try:
                    path = run_one(
                        pdf_paths=pdf_paths, course=entry["course"],
                        class_num=entry["class_num"], date=entry["date"],
                        topic=entry["topic"], event_time=entry.get("event_time", ""),
                        questions=entry.get("questions", []), model=model, depth=depth,
                    )
                    cheatsheet_paths.append(path)
                except Exception as exc:
                    print(f"  ERROR: {entry['course']} {entry['class_num']}: {exc}")
    outlook_results = {}
    if sync_outlook:
        print(f"\n  STEP 4: Syncing to Outlook calendar...")
        try:
            from outlook_sync import sync_week
            outlook_results = sync_week(entries)
        except Exception as exc:
            print(f"  ERROR during Outlook sync: {exc}")
    print(f"\n{'='*60}")
    print(f"  WEEKLY PREP COMPLETE")
    print(f"  Classes: {len(entries)}  |  Cheatsheets: {len(cheatsheet_paths)}")
    print(f"{'='*60}\n")
    return {"entries": entries, "downloads": download_results,
            "cheatsheets": cheatsheet_paths, "outlook": outlook_results}


def _parse_args():
    import argparse
    parser = argparse.ArgumentParser(description="HBS weekly prep pipeline.")
    parser.add_argument("start")
    parser.add_argument("end")
    parser.add_argument("--courses", nargs="+", default=None)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--skip-cheatsheets", action="store_true")
    parser.add_argument("--sync-outlook", action="store_true")
    parser.add_argument("--model", default="claude-sonnet-4-6")
    parser.add_argument("--depth", default="intermediate",
                        choices=["simple", "intermediate", "detailed"])
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run_weekly_prep(
        start_str=args.start, end_str=args.end, courses=args.courses,
        skip_download=args.skip_download, skip_cheatsheets=args.skip_cheatsheets,
        sync_outlook=args.sync_outlook, model=args.model, depth=args.depth,
    )
