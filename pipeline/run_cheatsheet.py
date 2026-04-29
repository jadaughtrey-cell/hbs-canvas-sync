"""
HBS Canvas Scraper
Jim Daughtrey | RC MBA 2026
============================================================
PURPOSE:
  Hits the Canvas REST API at hbs.instructure.com to fetch
  assignments for a given date range, then parses each assignment's
  HTML description to extract:
    • Assignment questions
    • HBSP case/reading links and product numbers
    • Required file metadata

  Returns a list of CLASS_ENTRY dicts compatible with
  class_prep_workflow_v2 and run_cheatsheet.py.

CANVAS TOKEN:
  Generate at: https://hbs.instructure.com/profile/settings
  → Approved Integrations → + New Access Token

  Store as environment variable:  HBS_CANVAS_TOKEN
  Or pass directly:               scrape_week(token="your_token_here")

USAGE:
  from canvas_scraper import scrape_week

  entries = scrape_week("2026-04-13", "2026-04-17")
  # returns list of CLASS_ENTRY dicts ready for run_cheatsheet.py

DEPENDENCIES:
  pip install requests beautifulsoup4

HISTORY:
  2026-04-12  v1.0  Initial implementation.
"""

import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

# ─── PATH SETUP ───────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Load .env from project folder if present (allows running from sandbox without
# re-entering API keys every session).
_env_path = os.path.join(_HERE, ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

from class_prep_workflow_v2 import COURSES, validate_date_range

CANVAS_BASE = "https://hbs.instructure.com"

# Path where Claude writes pre-fetched Canvas data (via browser JS) when
# the sandbox proxy blocks direct API calls.
CANVAS_CACHE_FILE = os.path.join(_HERE, "canvas_assignments_cache.json")


class CanvasProxyBlockedError(RuntimeError):
    """Raised when the sandbox proxy blocks outbound Canvas API requests."""
    pass


# ─── CANVAS API HELPERS ───────────────────────────────────────────────────────

def _get_token(token=None):
    t = token or os.environ.get("HBS_CANVAS_TOKEN", "").strip()
    if not t:
        raise ValueError(
            "Canvas token required. Pass token= or set HBS_CANVAS_TOKEN env var.\n"
            "Generate at: https://hbs.instructure.com/profile/settings\n"
            "→ Approved Integrations → + New Access Token"
        )
    return t


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _paginate(url, headers, params=None):
    """Fetch all pages of a Canvas API endpoint, return combined list.
    Raises CanvasProxyBlockedError if the sandbox proxy blocks the request."""
    try:
        import requests
    except ImportError:
        raise ImportError("requests is required: pip install requests")

    results = []
    while url:
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=30)
        except requests.exceptions.ProxyError:
            raise CanvasProxyBlockedError(
                "Sandbox proxy is blocking Canvas API calls. "
                "Falling back to canvas_assignments_cache.json."
            )
        # Sandbox proxy may also return 403 with X-Proxy-Error header
        if resp.status_code == 403 and "blocked-by-allowlist" in resp.headers.get("X-Proxy-Error", ""):
            raise CanvasProxyBlockedError(
                "Sandbox proxy is blocking Canvas API calls. "
                "Falling back to canvas_assignments_cache.json."
            )
        resp.raise_for_status()
        results.extend(resp.json())
        # Canvas uses Link header for pagination
        link = resp.headers.get("Link", "")
        url = None
        params = None  # only on first request
        for part in link.split(","):
            if 'rel="next"' in part:
                match = re.search(r"<([^>]++>", part)
                if match:
                    url = match.group(1)
    return results


# ─── EXTERNAL LINK PARSER ────────────────────────────────────────────────────

# Patterns for HBSP product numbers
_HBSP_NUM_RE   = re.compile(r'\b(\d{3}-\d{3})\b')   # e.g. 726-048

# Domains to ignore — Canvas navigation/infrastructure links, NOT file downloads
# Note: hbs.instructure.com is partially allowed — file download URLs are
# detected separately by _CANVAS_FILE_RE and passed through.
_INTERNAL_DOMAINS = {
    "canvas.instructure.com",
    "instructure.com", "canvaslms.com",
}

# Canvas file download URL pattern: /courses/{id}/files/{file_id}[/download]
_CANVAS_FILE_RE = re.compile(
    r'https?://hbs\.instructure\.com/courses/(\d+)/files/(\d+)',
    re.I,
)

# Video-hosting domains — useful for reference, not downloaded
_VIDEO_DOMAINS = {
    "youtube.com", "youtu.be", "vimeo.com",
    "kaltura.com", "harvard.hosted.panopto.com",
}

# HBSP domains — these require the LTI download flow
_HBSP_DOMAINS = {
    "hbsp.harvard.edu", "services.hbsp.harvard.edu", "hbs.me",
}


def _extract_external_links(html_text):
    """
    Find ALL external (non-Canvas) links in the assignment description HTML.

    Returns a list of dicts — one per unique URL:
      {
        "url"       : full href string,
        "link_text" : visible anchor text (e.g. "supplementary spreadsheet"),
        "label"     : text immediately BEFORE the link in its parent block,
        "hbsp_num"  : "226-061" or None,
        "is_hbsp"   : True if URL is on Hbsp.harvard.edu / hbs.me,
        "is_video"  : True if URL is on a known video platform,
        "domain"    : netloc of the URL (e.g. "hbsp.harvard.edu"),
      }

    No keyword-based file-type classification is done here.
    The downloader detects the actual file type from the HTTP Content-Type header.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        raise ImportError("beautifulsoup4 is required: pip install beautifulsoup4")

    soup = BeautifulSoup(html_text or "", "html.parser")
    results   = []
    seen_urls = set()

    for a_tag in soup.find_all("a"):
        href = (a_tag.get("href") or "").strip()
        if not href or href.startswith("#") or href.startswith("mailto:"):
            continue
        if href in seen_urls:
            continue

        # Parse domain for classification
        try:
            parsed = urlparse(href)
            domain = parsed.netloc.lower().lstrip("www.")
        except Exception:
            continue

        # Canvas file download URLs — allow through; flag separately
        is_canvas_file = bool(_CANVAS_FILE_RE.match(href))

        # Skip Canvas-internal URLs that are NOT file downloads
        if not is_canvas_file and any(domain == d or domain.endswith("." + d)
                                      for d in _INTERNAL_DOMAINS):
            continue

        # Also skip hbs.instructure.com non-file pages (assignments, modules, etc.)
        if domain == "hbs.instructure.com" and not is_canvas_file:
            continue

        # Skip bare relative or non-http links
        if parsed.scheme not in ("http", "https", ""):
            continue

        seen_urls.add(href)

        # ── Anchor text ───────────────────────────────────────────────────────
        link_text = a_tag.get_text(" ", strip=True)

        # ── Preceding label text (text before this <a> in its parent) ─────────
        label_raw = ""
        parent = a_tag.parent
        if parent:
            for child in parent.children:
                if child is a_tag:
                    break
                text = (child.get_text(" ", strip=True)
                        if hasattr(child, "get_text") else str(child).strip())
                if text:
                    label_raw = text
        label = label_raw.strip().rstrip(":").strip()

        # ── HBSP product number ───────────────────────────────────────────────
        hbsp_num = None
        for text in [link_text, label_raw, href]:
            m = _HBSP_NUM_RE.search(text)
            if m:
                hbsp_num = m.group(1)
                break

        is_hbsp        = any(domain == d or domain.endswith("." + d) for d in _HBSP_DOMAINS)
        is_video       = any(domain == d or domain.endswith("." + d) for d in _VIDEO_DOMAINS)

        # Extract Canvas file_id if this is a Canvas-hosted file
        canvas_file_id = None
        if is_canvas_file:
            m = _CANVAS_FILE_RE.match(href)
            if m:
                canvas_file_id = m.group(2)

        # For video links, derive a display title from link_text / label
        video_title = ""
        if is_video:
            video_title = link_text if link_text else label

        results.append({
            "url":            href,
            "link_text":      link_text,
            "label":          label,
            "hbsp_num":       hbsp_num,
            "is_hbsp":        is_hbsp,
            "is_video":       is_video,
            "is_canvas_file": is_canvas_file,
            "canvas_file_id": canvas_file_id,
            "video_title":    video_title,
            "domain":         domain,
        })

    return results


# ─── ASSIGNMENT QUESTION PARSER ───────────────────────────────────────────────

def _extract_questions(html_text):
    """
    Parse assignment HTML description and extract assignment questions.
    Handles numbered lists (1. ... 2. ...) and question marks.
    Returns list of question strings.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        raise ImportError("beautifulsoup4 is required: pip install beautifulsoup4")

    soup = BeautifulSoup(html_text or "", "html.parser")
    questions = []

    # Strategy 1: ordered list items
    for ol in soup.find_all("ol"):
        for li in ol.find_all("li"):
            text = li.get_text(" ", strip=True)
            if text:
                questions.append(text)

    if questions:
        return questions

    # Strategy 2: paragraphs or divs that look like numbered questions
    full_text = soup.get_text("\n", strip=True)
    # Match lines like "1. What is..." or "1) What is..."
    numbered = re.findall(r'(?:^|\n)\s*\d+[.)]\s+(.+?)(?=\n\s*\d+[.)]|\Z)',
                          full_text, re.DOTALL)
    if numbered:
        return [q.strip().replace("\n", " ") for q in numbered if q.strip()]

    # Strategy 3: any sentence ending in "?"
    sentences = re.findall(r'[^.!?\n]{20,}[?]', full_text)
    if sentences:
        return [s.strip() for s in sentences[:6]]  # cap at 6

    return []


# ─── CANVAS FILES API HELPER ─────────────────────────────────────────────────

def _resolve_canvas_file(file_id: str, course_id: int, headers: dict) -> dict | None:
    """
    Use the Canvas Files API to get metadata + download URL for a Canvas-native file.
    Returns a dict with: filename, content_type, size, download_url — or None on error.
    """
    try:
        import requests as _req
        url = f"{CANVAS_BASE}/api/v1/files/{file_id}"
        resp = _req.get(url, headers=headers, timeout=20)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return {
            "filename":     data.get("filename") or data.get("display_name") or f"file_{file_id}",
            "content_type": data.get("content-type") or data.get("mime_class") or "",
            "size":         data.get("size") or 0,
            "download_url": data.get("url") or "",   # pre-authenticated download URL
        }
    except Exception:
        return None


def _fetch_course_files_for_assignment(course_id: int, assignment_id: int,
                                        class_num: int, course_key: str,
                                        headers: dict) -> list:
    """
    Use Canvas Files API to discover ALL files posted in a course that are
    referenced by this assignment's module items.

    This catches files uploaded directly to Canvas (not linked in HTML body).
    Returns a list of file-entry dicts compatible with the files list.
    """
    try:
        import requests as _req
    except ImportError:
        return []

    # Strategy: list module items for the course and find items whose
    # content_id matches this assignment, or whose type is "File".
    # Simpler fallback: list files uploaded to the course folder prefixed
    # with the class number.
    results = []

    try:
        # Get all module items of type "File" in this course
        mods_url = f"{CANVAS_BASE}/api/v1/courses/{course_id}/modules"
        mods = _paginate(mods_url, headers, params={"per_page": 50, "include[]": "items"})
        for mod in mods:
            for item in mod.get("items", []):
                if item.get("type") != "File":
                    continue
                fid = str(item.get("content_id") or "")
                if not fid:
                    continue
                meta = _resolve_canvas_file(fid, course_id, headers)
                if not meta or not meta["download_url"]:
                    continue
                fname = meta["filename"]
                ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else "unknown"
                results.append({
                    "type":           "canvas_file",
                    "title":          fname,
                    "hbsp_num":       "",
                    "hbsp_url":       meta["download_url"],
                    "canvas_url":     f"{CANVAS_BASE}/courses/{course_id}/files/{fid}/download",
                    "filename":       f"{class_num} {course_key} {fname}",
                    "ext":            ext,
                    "is_hbsp":        False,
                    "is_video":       False,
                    "is_canvas_file": True,
                    "canvas_file_id": fid,
                    "domain":         "hbs.instructure.com",
                    "link_text":      fname,
                })
    except Exception:
        pass

    return results


# ─── FILE TYPE CLASSIFIER ─────────────────────────────────────────────────────

def _classify_file_type(title, url=""):
    """Guess file type from title/URL keywords."""
    title_l = (title or "").lower()
    url_l   = (url or "").lower()
    combined = title_l + " " + url_l

    if any(k in combined for k in ["exhibit", "excel", ".xlsx", "spreadsheet", "financial"]):
        return "exhibits"
    if any(k in combined for k in ["course note", "course pack", "background note", "note on"]):
        return "course_note"
    if any(k in combined for k in ["supplement", "supplemental", "technical"]):
        return "supplement"
    if any(k in combined for k in ["case", "hbs case", "hbsp"]):
        return "case"
    return "other"


# One-word / trivial anchor texts that add no descriptive value to a filename
_GENERIC_ANCHORS = {
    "case", "pdf", "here", "click here", "link", "download", "file",
    "reading", "material", "document", "exhibit", "exhibits", "note",
    "supplement", "course note", "course notes", "case study",
}

# Pattern: strip leading "COURSE Class N" or "Course N | " or "Class N - " style prefixes
_COURSE_PREFIX_RE = re.compile(
    r'^[A-Z]{2,6}\s*\d*[\s|]*(?:class\s*\d+\s*)?[\s|:–\-]+',
    re.I
)


def _make_filename(class_num, course, link_text, label, title="", ext="unknown"):
    """
    Build filename with a class-number prefix and the most descriptive slug available.
    Priority:
      1. link_text  — if it's multi-word and not a generic type word
      2. title      — assignment topic, with any "COURSE Class N" prefix stripped
      3. label      — text immediately before the link
      4. "Reading"  — last resort

    Extension defaults to "unknown"; the downloader renames based on Content-Type.

    Examples:
      "21 Supplementary Spreadsheet.unknown"
      "22 South Africa - Colonialism and Imperialism Note.pdf"
      "23 South Africa The Road to Democracy.unknown"
    """
    lt = (link_text or "").strip()
    lt_lower = lt.lower()

    # Use link_text if it is informative (multi-word and not a generic type label)
    if lt and lt_lower not in _GENERIC_ANCHORS and len(lt.split()) > 1:
        raw = lt
    elif title:
        # Strip "BGIE Class 23 | " / "FIN2 Class 17 - " style prefixes from topic
        cleaned = _COURSE_PREFIX_RE.sub("", title).strip().lstrip("–-:|").strip()
        # If cleaning wiped everything (title was JUST the course prefix), keep lt or label
        raw = cleaned if cleaned else (lt or (label or "").strip().rstrip(":.,;") or "Reading")
    else:
        raw = lt or (label or "").strip().rstrip(":.,;") or "Reading"

    # Strip trailing colon / punctuation
    raw = raw.rstrip(":.,;").strip()
    # Remove characters illegal in Windows filenames
    safe = re.sub(r'[<>:"/\\|?*]', '', raw)
    # Collapse whitespace
    safe = re.sub(r'\s+', ' ', safe).strip()
    # Cap length (leave room for class prefix + extension)
    if len(safe) > 60:
        safe = safe[:60].rsplit(' ', 1)[0]
    if not safe:
        safe = "Reading"
    return f"{class_num} {course} {safe}.{ext}"


# ─── ASSIGNMENT → CLASS_ENTRY MAPPER ────────────────────────────────────────

# Map Canvas course IDs back to course keys
_COURSE_ID_MAP = {v["canvas_course_id"]: k
                  for k, v in COURSES.items()
                  if v.get("canvas_course_id")}


def _assignment_to_entry(assignment, course_key, class_counter):
    """
    Convert a Canvas assignment dict to a CLASS_ENTRY dict.
    class_counter is a running int used as class_num when the true number
    cannot be inferred from the assignment title.
    """
    title = assignment.get("name", "Untitled")
    desc  = assignment.get("description", "") or ""
    due   = assignment.get("due_at") or assignment.get("lock_at") or ""

    # Parse date
    if due:
        dt = datetime.fromisoformat(due.replace("Z", "+00:00"))
        date_str = dt.astimezone().strftime("%Y-%m-%d")
        day_name = dt.astimezone().strftime("%A")
    else:
        date_str = datetime.today().strftime("%Y-%m-%d")
        day_name = datetime.today().strftime("%A")

    # Try to extract class number from assignment title (e.g. "Class 21" or "#21")
    num_match = re.search(r'(?:class\s*#?|#)\s*(\d+)', title, re.I)
    class_num = int(num_match.group(1)) if num_match else class_counter

    # All external links → files list (deduplicate URLs, disambiguate filenames)
    ext_links   = _extract_external_links(desc)
    files       = []
    seen_fnames = {}   # fname → count, for suffix disambiguation

    for link in ext_links:
        url       = link["url"]
        link_text = link.get("link_text", "")
        label     = link.get("label", "")
        hbsp_num  = link.get("hbsp_num") or ""
        is_hbsp   = link.get("is_hbsp", False)
        is_video  = link.get("is_video", False)
        domain    = link.get("domain", "")

        # Extension defaults to "unknown"; downloader renames based on Content-Type.
        # For HBSP/canvas files we expect PDF/XLSX; for video links we skip download.
        is_canvas_file = link.get("is_canvas_file", False)
        canvas_file_id = link.get("canvas_file_id")
        video_title    = link.get("video_title", "")

        if is_video:
            ext = "url"     # not downloaded — stored as reference only
        else:
            ext = "unknown"  # downloader detects and renames

        # Build filename: link_text first; falls back to stripped assignment title
        base_fname = _make_filename(class_num, course_key, link_text, label,
                                    title=title, ext=ext)

        # Disambiguate if two links produce the same filename
        if base_fname in seen_fnames:
            seen_fnames[base_fname] += 1
            stem = base_fname[: base_fname.rfind(".")]
            base_fname = f"{stem} ({seen_fnames[base_fname]}).{ext}"
        else:
            seen_fnames[base_fname] = 1

        files.append({
            "type":           "video" if is_video else ("hbsp" if is_hbsp else
                              "canvas_file" if is_canvas_file else "other"),
            "title":          title,
            "hbsp_num":       hbsp_num,
            "hbsp_url":       url,        # kept as "hbsp_url" for downloader compatibility
            "canvas_url":     assignment.get("html_url", ""),
            "filename":       base_fname,
            "ext":            ext,
            "is_hbsp":        is_hbsp,
            "is_video":       is_video,
            "is_canvas_file": is_canvas_file,
            "canvas_file_id": canvas_file_id,
            "video_title":    video_title,
            "domain":         domain,
            "link_text":      link_text,
        })

    # Questions — deduplicate while preserving order
    raw_questions = _extract_questions(desc)
    seen_q = set()
    questions = []
    for q in raw_questions:
        q_norm = q.strip().lower()
        if q_norm and q_norm not in seen_q:
            seen_q.add(q_norm)
            questions.append(q.strip())

    return {
        "date":                  date_str,
        "day":                   day_name,
        "course":                course_key,
        "class_num":             class_num,
        "topic":                 title,
        "event_name":            f"{course_key} C",
        "event_time":            "",    # filled in by _enrich_with_times()
        "event_start":           "",    # "HH:MM" 24h local, filled in by _enrich_with_times()
        "event_end":             "",    # "HH:MM" 24h local, filled in by _enrich_with_times()
        "canvas_assignment_id":  assignment.get("id", 0),
        "canvas_url":            assignment.get("html_url", ""),
        "files":                 files,
        "questions":             questions,
        "notes":                 "",
        "no_cheatsheet":         len(files) == 0,
    }


# ─── BROWSER-CACHE SCRAPE ────────────────────────────────────────────────────

def scrape_week_from_json(raw_assignments, start_str, end_str, courses=None, verbose=True):
    """
    Build CLASS_ENTRY list from a pre-fetched list of Canvas assignment dicts.

    Used when the sandbox proxy blocks direct API calls. Claude fetches the
    data via fetch_canvas_assignments.js in the browser and passes the result
    here (or saves it to CANVAS_CACHE_FILE and calls this automatically via
    scrape_week's fallback).

    Args:
        raw_assignments : list of dicts — each must have at minimum:
                          id, name, due_at, description, html_url,
                          course_id (int), course_code (str), course_name (str)
        start_str       : "YYYY-MM-DD"
        end_str         : "YYYY-MM-DD"
        courses         : list of course keys to include, or None for all
        verbose         : print progress

    Returns:
        list of CLASS_ENTRY dicts, sorted by date then course.
    """
    start, end = validate_date_range(start_str, end_str)

    # Build course_id → course_key map from COURSES config
    id_to_key = {v["canvas_course_id"]: k for k, v in COURSES.items()
                 if v.get("canvas_course_id")}

    all_entries = []
    class_counter = 1

    for a in raw_assignments:
        due = a.get("due_at") or a.get("lock_at") or ""
        if not due:
            continue

        due_dt   = datetime.fromisoformat(due.replace("Z", "+00:00")).astimezone()
        due_date = due_dt.date()
        if not (start <= due_date <= end):
            continue

        # Resolve course key
        course_id  = a.get("course_id")
        # Try id map first, then parse from course_code (e.g. "DSAI��C" → "DSAIL")
        course_key = id_to_key.get(course_id)
        if not course_key:
            raw_code   = a.get("course_code", "")
            course_key = raw_code.split("-")[0].upper() if raw_code else "UNKNOWN"

        if courses and course_key not in courses:
            continue

        # Normalise to the shape _assignment_to_entry expects
        normalised = {
            "id":          a.get("id", 0),
            "name":        a.get("name", "Untitled"),
            "due_at":      due,
            "description": a.get("description") or "",
            "html_url":    a.get("html_url", ""),
        }

        entry = _assignment_to_entry(normalised, course_key, class_counter)

        # If questions were pre-extracted in the browser, use them directly
        # (avoids re-parsing raw HTML that wasn't included in the cache)
        if "questions" in a and isinstance(a["questions"], list):
            entry["questions"] = [q.strip() for q in a["questions"] if q.strip()]

        # When coming from browser cache there are no HBSP link entries,
        # but weekly_prep.py finds PDFs via glob — so never skip cheatsheet
        # generation based solely on an empty files list.
        if not entry["files"]:
            entry["no_cheatsheet"] = False

        all_entries.append(entry)
        class_counter += 1

        if verbose:
            print(f"      ✓ {entry['date']} [{course_key}] {entry['topic'][:50]}"
                  f"  ({len(entry['files'])} file(s), {len(entry['questions'])} Q(s))")

    all_entries.sort(key=lambda e: (e["date"], e["course"]))

    if verbose:
        print(f"\n  Found {len(all_entries)} assignment(s) in range (from browser cache).")

    return all_entries


# ─── MAIN SCRAPE FUNCTION ────────────────────────────────────────────────────

def scrape_week(start_str, end_str, token=None, courses=None, verbose=True):
    """
    Fetch Canvas assignments for all active courses within [start_str, end_str].

    Args:
        start_str : "YYVY-MM-DD" — first day of target range.
        end_str   : "YYYY-MM-DD" — last day of target range.
        token     : Canvas API token. Falls back to HBS_CANVAS_TOKEN env var.
        courses   : list of course keys to include, e.g. ["BGIE", "FIN2"].
                    None = all courses with a canvas_course_id configured.
        verbose   : print progress to stdout.

    Returns:
        list of CLASS_ENTRY dicts, sorted by date then course.
    """
    start, end = validate_date_range(start_str, end_str)
    tok = _get_token(token)
    headers = _headers(tok)

    # Filter to courses that have a canvas_course_id
    active_courses = {
        k: v for k, v in COURSES.items()
        if v.get("canvas_course_id") and (courses is None or k in courses)
    }

    if not active_courses:
        raise ValueError("No courses with canvas_course_id configured in COURSES.")

    if verbose:
        print(f"\n  Canvas scrape: {start_str} → {end_str}")
        print(f"  Courses: {list(active_courses.keys())}")

    # Canvas API expects ISO 8601 UTC for bucket_start/end
    start_iso = datetime(start.year, start.month, start.day,
                         0, 0, 0, tzinfo=timezone.utc).isoformat()
    end_iso   = datetime(end.year, end.month, end.day,
                         23, 59, 59, tzinfo=timezone.utc).isoformat()

    all_entries = []
    class_counter = 1

    for course_key, cfg in active_courses.items():
        course_id = cfg["canvas_course_id"]
        url = f"{CANVAS_BASE}/api/v1/courses/{course_id}/assignments"
        params = {
            "bucket":        "future",   # include upcoming
            "per_page":      50,
            "order_by":      "due_at",
        }

        if verbose:
            print(f"    Fetching {course_key} (course_id={course_id})...")

        try:
            assignments = _paginate(url, headers, params=params)
        except CanvasProxyBlockedError:
            # Sandbox proxy is blocking — fall back to browser cache if available
            if os.path.exists(CANVAS_CACHE_FILE):
                if verbose:
                    print(f"\n  Proxy blocked direct API. Falling back to browser cache: {CANVAS_CACHE_FILE}")
                import json as _json
                with open(CANVAS_CACHE_FILE) as _f:
                    cached = _json.load(_f)
                return scrape_week_from_json(cached, start_str, end_str,
                                             courses=courses, verbose=verbose)
            raise CanvasProxyBlockedError(
                "Sandbox proxy blocked Canvas API and no cache file found.\n"
                "Run fetch_canvas_assignments.js in the browser tab, then retry."
            )
        except Exception as e:
            print(f"    WARNING: Could not fetch {course_key}: {e}")
            continue

        for a in assignments:
            due = a.get("due_at") or a.get("lock_at") or ""
            if not due:
  �۝[�YB�YW�H]][YK����Z\�ٛܛX]
YK��\X�J�������JK�\�[Y^�ۙJ
B�YW�]HHYW��]J
B�Y���
�\�HYW�]HH[�
N���۝[�YB��[��HH�\��YۛY[����[��JK��\��W��^K�\�����[�\�B�[�[��Y\˘\[�
[��JB��\�����[�\�
�HB��Y��\����N��W���[�H[�[��VȜ]Y\�[ۜȗJB�����[�H[�[��Vș�[\ȗJB��[�
��8�$��[��V��]I�_H����\��W��^_WH�[��V���X��V΍L_H����
ٗ���[�H�[J�K�W���[�H]Y\�[ۊ�JH�B���[��X�[��Y\��]X�X[�\���\��[�[Y\����H�[��\��[[�\���[��X���]�[Y\�[�[��Y\�X�]�W���\��\��\��\��[��\��XY\���\����JB����ܝ�H]K[���\��B�[�[��Y\˜�ܝ
�^O[[X�HN�
Vș]H�KVȘ��\��H�JJB��Y��\����N���[�
�����[��[�[�[��Y\�_H\��YۛY[�
�H[��[��K��B���]\��[�[��Y\��Y��[��X���]�[Y\�[��Y\�X�]�W���\��\��\��\��[��\��XY\���\����JN�������]��[��\��[[�\�]�[���܈XX���\��H[�X]�[H�[��Y\�H]K�[][��]�[���\��]�[��[��]�[��[YHۈXX�[��K����[��\��[[�\�]�[��\�HHX�X[�\���\��[ۜ�
K�ˈ���QH�\���ȊB�[��\��H�X�\�H�\��]�[��][Y\�[\˂�������Z[H���\�
��\��W��^K]W���H8���
�\���SK[���SK\�^W���B�[YW�X\H�B���܈��\��W��^Kٙ�[�X�]�W���\��\˚][\�
N����\��W�YHٙ�Ș�[��\����\��W�Y�B�\�H����S��T�АT�_K�\K݌K��[[�\��]�[�Ȃ���۝^���\��H]\��H\��Y\�H\�و\\����\]Y\��[���\�]\��\X]Y\�[\Έ�۝^���\��OX��\��W��\�[\�H
��۝^���\��H�����\��W����\��W�YH�K�
��\��]H��\��\��ΌLJK�
�[��]H�[��\��ΌLJK�
�\��Y�H�
L
K�
�\H��]�[��K�B��N��]�[��H�Y�[�]J\�XY\��\�[\�\\�[\�B�^�\^�\[ۈ\�^��Y��\����N���[�
���T��S�Έ��[���]��[[�\�]�[���܈���\��W��^_N��^H�B��۝[�YB���܈]�[�]�[�΂��\��]H]���]
��\��]�H܈���[��]H]���]
�[��]�H܈���Y����\��]���۝[�YB��N���H]][YK����Z\�ٛܛX]
�\��]��\X�J�������JK�\�[Y^�ۙJ
B�HH]][YK����Z\�ٛܛX]
[��]��\X�J�������JK�\�[Y^�ۙJ
HY�[��][�H]W��^HH˜���[YJ�VKI[KIY�B�W��\�H˜���[YJ�R�SH�B�W�[�HK����[YJ�R�SH�B��	KRH�ܚ��ۈ[�^�\�H	RH[���\
��H�܈�[���\�H
�����[�
˜���[YJ	�RI�JJ_N��˜���[YJ	�SH	\	�_H8�$��������[�
K����[YJ	�RI�JJ_N��K����[YJ	�SH	\	�_H�B�[YW�X\���\��W��^K]W��^JWHH
W��\�W�[�\�
B�^�\^�\[ێ���۝[�YB���\H�[��Y\�܈[��H[�[��Y\΂��^HH
[��VȘ��\��H�K[��Vș]H�JB�Y��^H[�[YW�X\��W��\�W�[�\�H[YW�X\��^WB�[��Vș]�[���\��HHW��\��[��Vș]�[��[��HHW�[��[��Vș]�[��[YH�HH\��[Y��\����H[�[��K��]
�]�[���\��HOH������[[�H��\8�%�[[�\�]�[���[��܈\�\��YۛY[�]B�\����8� 8� 8� �H8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� 8� ��Y��ۘ[YW��OH���XZ[��Ȏ������]ZX��\���]ۈ�[��\���ܘ\\��H���L
LL����L
LM��\]Z\�\�����S��T����S�[�[��\�ۛY[�������[\ܝ�\���ۂ��Y�[��\˘\�݊H΂��[�
�\�Y�N�]ۈ�[��\���ܘ\\��H�T��UHS��UH���T��LH��T��L����H�B��[�
�^[\N�]ۈ�[��\���ܘ\\��H���L
LL����L
LMȊB��[�
�^[\N�]ۈ�[��\���ܘ\\��H���L
LL����L
LM���QH�S���B��\˙^]
JB���\�H�\˘\�ݖ�WB�[�H�\˘\�ݖ̗B���\��Wٚ[\�H�\˘\�ݖ�ΗHY�[��\˘\�݊H��[�H�ۙB��[��Y\�H�ܘ\W��YZ��\�[���\��\�X��\��Wٚ[\�B���[�
�����Iʍ�H�B��[�
���T�S��[�[��Y\�_H�\���\��[ۊ�H�B��[�
����Iʍ�H�B��܈H[�[��Y\΂��[�
�����V����\��I�_H�V���\��۝[I�_WH�V���X��_H�B��[�
��]H��V��]I�_H
�V��^I�_JH�B��[�
��]Y\�[ۜΈ�[�V��]Y\�[ۜ��J_H�B��܈H[�V��]Y\�[ۜ��N���[�
��8�(��VΎ_H�B��[�
���[��\���K��]
	��[��\��\�	�	��_H�B��[�
���[\���[�V�ٚ[\��J_H�B��܈�[�V�ٚ[\��N��Y�H��QSȈY����]
�\�ݚY[ȊH[�H
����Y����]
�\�����H[�H�ș�XZ[��JB��[�
��8�(���Y�WHٖ�ٚ[[�[YI�_H�B��[�
��[��^�ً��]
	�[���^	�	��_H�B��[�
��T��ٖ�����\�	�_H�B
