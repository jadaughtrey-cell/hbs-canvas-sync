"""
HBSP Case Downloader
Jim Daughtrey | RC MBA 2026
============================================================
PURPOSE:
  Downloads case PDFs from HBSP (hbsp.harvard.edu) using Playwright.
  Uses a saved browser session so you only log in once — after that,
  downloads run silently in the background.

HOW IT WORKS:
  HBSP access requires Harvard LTI/SSO authentication that can't be
  extracted as cookies. This script uses Playwright's lightweight
  Chromium browser (separate from your regular Chrome) and saves your
  authenticated session to hbsp_auth.json after a one-time setup step.

  FIRST TIME (one-time setup, ~2 minutes):
    python hbsp_downloader.py --setup
    → Opens a visible browser window
    → You log into HBS Canvas and click any HBSP case link
    → Confirm the PDF opens, press Enter
    → Session saved to hbsp_auth.json

  EVERY SUBSEQUENT RUN (automatic, ~10-20 seconds per case):
    Downloads happen headlessly using the saved session.
    Re-run --setup if downloads start failing (session expired).

REQUIREMENTS:
  pip install playwright
  python -m playwright install chromium    ← one-time browser download

USAGE:
  from hbsp_downloader import download_case, download_all

  path = download_case(
      hbsp_url  = "https://hbsp.harvard.edu/tu/abc123",
      dest_path = "C:/path/to/21 Senegal - Case.pdf",
  )

  results = download_all(class_entries)

HISTORY:
  2026-04-12  v1.0  Cookie extraction (abandoned — HBSP uses LTI auth)
  2026-04-12  v2.0  Chrome profile (abandoned — profile too heavy for PW)
  2026-04-13  v3.0  Saved auth state — setup once, reuse silently
"""

import os
import re
import sys
import time
import json

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from class_prep_workflow_v2 import COURSES

# Where to store the saved browser session
AUTH_FILE = os.path.join(_HERE, "hbsp_auth.json")


# ─── PLAYWRIGHT IMPORT CHECK ─────────────────────────────────────────────────

def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright
        return sync_playwright
    except ImportError:
        raise ImportError(
            "Playwright is required.\n"
            "Run:  pip install playwright\n"
            "Then: python -m playwright install chromium"
        )


# ─── ONE-TIME SETUP ───────────────────────────────────────────────────────────

def setup_auth(auth_file=None):
    """
    One-time interactive setup: opens a visible browser so you can log in
    to HBS Canvas and confirm HBSP access, then saves the session.

    Run this once:
        python hbsp_downloader.py --setup
    """
    if auth_file is None:
        auth_file = AUTH_FILE

    sync_playwright = _require_playwright()

    print("\n" + "="*60)
    print("  HBSP ONE-TIME AUTH SETUP")
    print("="*60)
    print("""
  A browser window will open. Please:

    1. Wait for Canvas to fully load, then log in if prompted
    2. Open any course  →  find an assignment with an HBSP case link
    3. Click the HBSP link — it opens in a new tab
    4. Wait for the case to fully load in that new tab

  The script auto-detects when HBSP auth is captured and
  will close the browser for you. No need to press anything.

  (Press Ctrl+C to finish manually if auto-detect takes too long)
""")
    input("  Press Enter to open the browser...")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            slow_mo=50,
            args=["--disable-popup-blocking"],
        )
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )

        page = context.new_page()
        try:
            page.goto(
                "https://hbs.instructure.com",
                wait_until="commit",
                timeout=30_000,
            )
        except Exception:
            pass  # Canvas keeps loading in background — that's fine

        print("\n  Browser is open. Log in and click an HBSP case link.")
        print("  Checking for HBSP cookies every 5 seconds (up to 10 min)...")
        print("  Press Ctrl+C to finish manually.\n")

        found = False
        try:
            for i in range(120):          # max 10 minutes
                # ↓ This keeps Playwright's event loop alive — popups CAN load now
                page.wait_for_timeout(5_000)

                cookies = context.cookies()
                hbsp_c = [
                    c for c in cookies
                    if "hbsp" in c.get("domain", "").lower()
                    or (
                        "harvard" in c.get("domain", "").lower()
                        and "instructure" not in c.get("domain", "").lower()
                    )
                ]
                if len(hbsp_c) >= 4:
                    print(f"\n  ✓ Auth detected! {len(hbsp_c)} HBSP cookies captured.")
                    found = True
                    break
                mins, secs = divmod((i + 1) * 5, 60)
                status = f"{len(hbsp_c)} HBSP cookie(s) so far" if hbsp_c else "no HBSP cookies yet"
                print(f"  [{mins:02d}:{secs:02d}] Waiting... ({status})")
        except KeyboardInterrupt:
            print("\n  Ctrl+C — saving current session state...")

        context.storage_state(path=auth_file)
        browser.close()

    # Final verification
    with open(auth_file) as f:
        state = json.load(f)
    hbsp_cookies = [
        c for c in state.get("cookies", [])
        if "hbsp" in c.get("domain", "").lower()
        or (
            "harvard" in c.get("domain", "").lower()
            and "instructure" not in c.get("domain", "").lower()
        )
    ]

    print(f"\n  Auth state saved: {auth_file}")
    if hbsp_cookies:
        print(f"  ✓ {len(hbsp_cookies)} HBSP cookies confirmed. Ready to download!\n")
    else:
        print("  ⚠  No HBSP cookies found. Re-run --setup and open an HBSP case fully.\n")

    return auth_file


# ─── PDF DOWNLOAD ─────────────────────────────────────────────────────────────

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


_BINARY_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/vnd.ms-excel",
    "application/octet-stream",
    "application/msword",  # legacy .doc
}

# Map content-type → file extension
_CT_TO_EXT = {
    "application/pdf":    "pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/msword": "doc",
    "application/zip":    "zip",
    "text/html":          "html",
}

# Magic bytes for non-ZIP formats (checked first)
_MAGIC_NON_ZIP = [
    (b"%PDF", "pdf"),
]

# ZIP-based Office format signatures — look inside the ZIP central directory
# for the primary content part name to distinguish xlsx vs docx vs pptx.
_ZIP_CONTENT_TYPE_MARKERS = {
    b"xl/":            "xlsx",
    b"word/":          "docx",
    b"ppt/":           "pptx",
}


def _detect_ext(data, content_type=""):
    """
    Determine the real file extension from magic bytes + Content-Type.

    For PDF: magic bytes are authoritative (%PDF).
    For ZIP-based Office formats (xlsx/docx/pptx): the content-type header is
    the most reliable signal because both xlsx and docx share the same ZIP magic
    bytes. Falls back to scanning for xl/ or docx vs pptx.
_ZIP_CONTENT_TYPE_MARKERS = {
    b"xl/":            "xlsx",
    b"word/":          "docx",
    b"ppt/":           "pptx",
}


def _detect_ext(data, content_type=""):
    """
    Determine the real file extension from magic bytes + Content-Type.

    For PDF: magic bytes are authoritative (%PDF).
    For ZIP-based Office formats (xlsx/docx/pptx): the content-type header is
    the most reliable signal because both xlsx and docx share the same ZIP magic
    bytes. Falls back to scanning for xl/ or docx marker inside the ZIP
    if the content-type is generic (application/octet-stream, application/zip).

    Returns a string like "pdf", "docx", "xlsx", "html", or "bin".
    """
    # 1. Non-ZIP magic bytes (PDF, etc.)
    if data and len(data) >= 4:
        for magic, ext in _MAGIC_NON_ZIP:
            if data[:len(magic)] == magic:
                return ext

    # 2. Content-type is authoritative for Office MIME types
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CT_TO_EXT:
        return _CT_TO_EXT[ct]

    # 3. ZIP-based file: scan first 4 KB for directory markers
 },]
    if data and len(data) >= 4 and data[:4] == b"PK\x03\x04":
        sample = data[:4096]
        for marker, ext in _ZIP_CONTENT_TYPE_MARKERS.items():
            if marker in sample:
                return ext
        return "xlsx"   # safe fallback — most common ZIP Office format here

    return _CT_TO_EXT.get(ct, "bin")


def _rename_unknown(dest_path, real_ext):
    """
    If dest_path ends with '.unknown', rename it to use real_ext.
    Returns the final path (renamed or original).
    """
    if dest_path.endswith(".unknown"):
        new_path = dest_path[+8name] + real_ext
        if os.path.exists(dest_path):
            os.rename(dest_path, new_path)
        return new_path
    return dest_path


def _attach_file_listener(page, store):
    """
    Wire a response listener that captures the first downloadable file
    (PDF or Excel) body into store.
    store format: [bytes_or_None, suggested_filename_or_None, content_type_or_None]
    """
    def _on_resp(resp):
        if store[0] is not None:
            return
        ct = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if ct in _BINARY_CONTENT_TYPES or "pdf" in ct or "excel" in ct or "spreadsheet" in ct or "word" in ct or "msword" in ct:
            try:
                data = resp.body()
                if len(data) > 5_000:
                    store[0] = data
                    store[1] = resp.url.split("/")[-1].split("?")[0] or "file"
                    store[2] = ct
                    label = "PDF" if "pdf" in ct else "Excel"
                    print(f"  [hbsp]   {label} intercepted ({len(data)//1024} KB)")
            except Exception:
                pass
    page.on("response", _on_resp)


# Keep backward-compatible alias used elsewhere
def _attach_pdf_listener(page, store):
    _attach_file_listener(page, store)


# ─── CANVAS SESSION COOKIES ──────────────────────────────────────────────────

def _load_canvas_cookies(auth_file=None):
    """
    Extract Canvas session cookies from hbsp_auth.json for authenticated
    downloads of Canvas-native files.

    Returns a dict of {name: value} for cookies on hbs.instructure.com.
    """
    if auth_file is None:
        auth_file = AUTH_FILE
    try:
        import json as _json
        with open(auth_file, encoding="utf-8") as f:
            data = _json.load(f)
        cookies = {}
        for c in data.get("cookies", []):
            domain = (c.get("domain") or "").lstrip(".")
            if "instructure.com" in domain or "hbs.edu" in domain:
                cookies[c["name"]] = c["value"]
        return cookies
    except Exception:
        return {}


_CANVAS_FILE_URL_RE = re.compile(
    r'https?://hbs\.instructure\.com/courses/\d+/files/\d+',
    re.I,
)


# ─── DIRECT DOWNLOAD (non-HBSP external links) ────────────────────────────────

def _download_direct(url, dest_path, retries=2, auth_file=None):
    """
    HTTP download for non-HBSP links — external PDFs, Excel models, and
    Canvas-native files.

    For Canvas URLs (hbs.instructure.com/courses/.../files/...):
      - Injects session cookies from hbsp_auth.json so authenticated files
        are served instead of an HTML login redirect.
      - Canvas returns a redirect to a pre-signed S3 URL; requests follows it.

    For all other URLs:
      - Plain unauthenticated GET.

    Detects actual file type from Content-Type / magic bytes and renames
    .unknown extension accordingly.

    Returns the final saved path.
    """
    try:
        import requests
    except ImportError:
        raise ImportError("requests is required: pip install requests")

    headers = {
        "User-Agent": _UA,
        "Accept": "*/*",
    }

    # Inject Canvas session cookies for Canvas-hosted files
    cookies = {}
    if _CANVAS_FILE_URL_RE.match(url):
        cookies = _load_canvas_cookies(auth_file)
        # Ensure we get a download, not a preview page
        if "download_frd=1" not in url and "download" not in url:
            sep = "&" if "?" in url else "?"
            url = url + sep + "download_frd=1"

    last_err = None
    for attempt in range(1, retries + 2):
        try:
            resp = requests.get(url, headers=headers, cookies=cookies or None,
                                timeout=60, stream=True, verify=False,
                                allow_redirects=True)
            resp.raise_for_status()
            data = resp.content
            if len(data) < 1_000:
                # Could be an error page — check content type before giving up
                ct_check = resp.headers.get("content-type", "").lower()
                if "html" in ct_check:
                    raise RuntimeError(
                        f"Got HTML ({len(data)} bytes) instead of a file — "
                        "Canvas session may be expired. Re-run hbsp_downloader.py --setup"
                    )
                raise RuntimeError($����I�����͔�ѽ��͵������������ф���ѕ̤��P������䁅����ɽȁ������((�������������Ѐ�ɕ���������̹��Р����ѕ�е���������������Р�숥l�t���ɥ������ݕȠ�(������������ɕ��}��Ѐ�}��ѕ��}��С��ф���Ф((�������������̹�������̡�̹��Ѡ���ɹ�����̹��Ѡ������Ѡ�����}��Ѡ��������}���Q�Ք�(������������ݥѠ����������}��Ѡ���݈����́���(��������������������ɥє���ф�((�����������������}��Ѡ��}ɕ����}չ���ݸ�����}��Ѡ��ɕ��}��Ф(�������������ɥ�С����m��ɕ��t����rH��������ф��������-���ɕ��}�������(�홥���}��ѡ�(������������ɕ��ɸ������}��Ѡ(���������ፕ�Ёፕ�ѥ����́��(����������������}��Ȁ�(�����������������ѕ��Ѐ��ɕ�ɥ���(�����������������ɥ�С����m��ɕ��t���I������ѕ��������������(����������������ѥ���ͱ����Ȥ((����Ʌ�͔�Iչѥ���ɽȡ���ɕ�Ё��ݹ��������������ѕȁ�ɕ�ɥ�̬���ѕ����������}����(()����}���}��ݹ����}���ѽ�����������ѕ�а����}�ѽɔ��ѥ�����}�����|�����(�������(����
��������������ݹ��������ѽ�́���ѡ�������(����I���ɹ́����}��Ѡ�������ɽ�͕ȵ��ݹ�����������́��՝���9�����ѡ��ݥ͔�(�������(����͕���ѽ�̀�l(������������ѽ�顅̵ѕ�Р��ݹ��������(����������顅̵ѕ�Р��ݹ�����A����(����������顅̵ѕ�Р��ݹ��������(���������m�ɥ����������ݹ�������t��(���������mѥѱ����ݹ�������t��(����������m��ݹ����t��(����t(������ȁ͕�����͕���ѽ���(������������(�������������Ѹ��������Օ��}͕���ѽȡ͕��(�����������������Ё�Ѹ�(�������������������ѥ�Ք(����������������(����������������ݥѠ������������}��ݹ�����ѥ������ѥ�����}�̤��́��}�����(���������������������Ѹ��������(����������������ɕ��ɸ���}�����م�Ք����������������ȁٕ́ͅѼ�����(�������������ፕ�Ёፕ�ѥ���(�����������������Ѹ����������������������������������ݥѡ��Ё��ݹ�����������ȃ�P�����Ё͕Ё���}�ѽɔ(���������������������݅��}���}ѥ����Р�|����(����������������������}�ѽɕl�t��́��Ё9����(��������������������ɕ��ɸ����ѕɍ��ѕ��(���������ፕ�Ёፕ�ѥ���(���������������ѥ�Ք(����ɕ��ɸ�9���(()����}��}���}�ɰ��ɰ��(�������!��ɥ�ѥ�聑��́ѡ�́UI0���������������ɕ�Ё������A��]�ɐ���ȁፕ���������������(����ɕ��ɸ����������ɰ���ȁ�����l(���������͍����̈�����ѕ�̼�����������ѥ��������(���������������������������̈�����������������������ݹ��������������Ј�(����t�(()����}��ݹ����}��������}�ɰ������}��Ѡ����ѡ}���������م�}�ɰ�9�����ѥ�����}�����|�����(�������(�����ݹ�������ͥ�����!	M@���͔�A�٥��
��م́1Q$�((����M�Ʌѕ���(������ĸ�I����ѕȁ���ѕ�й�����������	=I�����������P�ͼ�ѡ��A�ɕ����͔(������������ѕ��ȁ�́��х�����ѡ�����х�Ё������������̰�ݥѠ����Ʌ��������ѥ���(������ȸ�9�٥��є�Ѽ�ѡ��
��م́��ͥ�����а����������������ѡ��!	M@������(������̸�Q���1Q$�A=MP��ɥ������!	M@�ɕ��ɕ��́ѡ����������ɕ�ѱ�Ѽ�ѡ��A�UI0�(������и�Q���ɕ����͔����ѕ��ȁ��э��́ѡ��A���ѕ́��������и(������Ը���������ɔ���э��ѡ��������́������UI0�����Н́��A��������и(�������(�����幍}�����ɥ��Ѐ�}ɕ�եɕ}�����ɥ��Р�(�����ɽ�������ɥ��й�幍}���������ЁQ�������ɽȁ�́A]Q������(�����ɽ���ɱ�������͔������Ё�ɱ���͔((���������Ё���م�}�ɰ�(��������Ʌ�͔�Iչѥ���ɽȠ(����������������م�}�ɰ��́ɕ�եɕ����ȁ!	M@���ݹ����̹q��(�������������I���ո����م�}͍Ʌ��ȹ��Ѽ���Ё���ɕ͠����Ё������ɥ�́ݥѠ����م�}�ɰ��(���������((����ݥѠ��幍}�����ɥ��Р���́��(����������U͔������հ��٥ͥ������ɽ�͕ȃ�P��������́
�ɽ��մ���́���A�٥�ݕ�(������������ѕ�ͥ����ͼ�!	M@�͕�ٕ́ѡ��!Q50�ɕ���ȁ���ѕ��������٥��ѥ���Ѽ(����������ѡ��A�UI0���!����հ���������ɽ�́ɕ����ɽ�͕ȁ����٥��ȸ(���������ɽ�͕Ȁ�����ɽ��մ���չ���(�����������������������͔�(�������������ɝ��l�����ͅ�������������������t�(������������ͱ��}������(���������(�����������ѕ�Ѐ�ɽ�͕ȹ���}���ѕ�Р(�������������ѽɅ��}�хє���ѡ}�����(������������������}��ݹ������Q�Ք�(�������������͕�}������}U�(���������((������������}�ѽɔ����m9�����9�����9���t����m��ѕ̰��՝���ѕ�}�������������ѕ��}����t(����������ݹ����}�����m9���t���������������A����ɥ��Ё�ݹ�������ȁ�ɽ�͕ȵ�ɥ���ɕ��ٕͅ�(�������������}����̀��mt��������������������܁х�́������((�����������R�R �-�䁙��聅�х������ѕ���́	=I�����������R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (������������}��}���}��������}������(�����������������}����̹����������}�����(������������}��х��}����}���ѕ��ȡ���}����������}�ѽɔ�((���������������ͼ���э���ɽ�͕ȵ��ݹ������ٕ��̀�ፕ������͕́�ٕ���́��ݹ����̤(����������������}��}��ݹ���������(���������������������ݹ����}���l�t��́9����(����������������������ݹ����}���l�t�􁑰(���������������������ɥ�С����m����t���	ɽ�͕ȁ��ݹ�����푰��՝���ѕ�}���������(���������������}�����������ݹ�������}��}��ݹ�����((�����������ѕ�й�����������}��}���}�����((�����������R�R �Mѕ���聱����
��م́��ͥ�����Ё������R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (�������������􁍽�ѕ�й���}������(��������}��х��}����}���ѕ��ȡ����������}�ѽɔ��������ٕȁͅ���х����٥��ѥ���ѽ�((���������ɥ�С����m����t���1�������
��م́��ͥ�����и����(������������(�������������������Ѽ����م�}�ɰ��݅��}չѥ�􉹕�ݽɭ�������ѥ��������|����(���������ፕ�ЁA]Q�������(����������������((�������������䡭܁���������ɰ���ݕȠ����ȁ�܁���l����������ͥ�����t��(�������������ɽ�͕ȹ���͔��(������������Ʌ�͔�Iչѥ���ɽȠ(�����������������
��م͕́�ͥ�������ɕ���I���ո���͕����Ѽ�ɕ�ɕ͠���Ѡ�q��(������������������I���ɕ�ѕ��Ѽ��������ɱ�(�������������((���������ɥ�С����m����t���
��م́�������������ѥѱ���l���u�((�����������R�R �Mѕ���聙����!	M@�������R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (������������}��Ѡ���ɱ���͔�����}�ɰ����Ѡ(��������������(������������������Օ��}͕���ѽȡ���m�ɕ��������}��ѡ�t��(�������������ȁ������Օ��}͕���ѽȠ��m�ɕ��􉡉������مɐ���ԉt��(�������������ȁ������Օ��}͕���ѽȠ��m�ɕ��􉡉̹���t��(���������(�������������Ё�����(�����������������݅��}���}ѥ����Р�|����(������������������(����������������������Օ��}͕���ѽȡ���m�ɕ��������}��ѡ�t��(�����������������ȁ������Օ��}͕���ѽȠ��m�ɕ��􉡉������مɐ���ԉt��(�������������(�������������Ё�����(������������͹����Ѐ���������ѕ�Р�l����t�ɕ�������q��������(�������������ɽ�͕ȹ���͔��(������������Ʌ�͔�Iչѥ���ɽȠ(������������������9��!	M@��������չ�����
��م́��ͥ�����Ё�����q��(������������������UI0�퍅�م�}�ɱ�q��(������������������A����͹�������͹������(�������������((�����������R�R �Mѕ���聍������P����ѕ�й�������������ɕ́	=I����ɕ����͔��R�R�R�R�R (���������ɥ�С����m����t���
��������!	M@�������1Q$�����͡���������(��������������������((�����������ٔ�ѡ���������������ЁѼ�����(�������������݅��}���}ѥ����Р�|����((����������%���������������ɕ���݅�Ё���Q!P������ͼ���́�ٕ��́�ɔ��ɽ���͕�(����������������}������(��������������͕}����}��ɱ�������}�����l��t(�������������ɥ�С����m����t���A�������������P�݅�ѥ������Ѽ��ԁ́��ȁA�����(��������������]��Ё��ȁ������Ѽ�ɕ�������ݽɭ������MA�����͡�́A$�����̤(����������������(������������������͕}����}��ɱ�݅��}���}����}�хє�����ݽɭ�������ѥ��������|����(�������������ፕ�Ёፕ�ѥ���(��������������������(����������������Ʉ��ՙ����MA���䁹�٥��є�Ѽ�A�UI0���ѕȁ���ݽɭ����(��������������͕}����}��ɱ�݅��}���}ѥ����Р��|����(����������͔�(��������������9���������Ѓ�P��������������ѡ�����������(�������������ɥ�С����m����t���]��ѥ�����ȁA�ɕ����͔�����Ѽ����̤�����(��������������ȁ|����Ʌ���������(���������������������݅��}���}ѥ����Р����(�����������������������}�ѽɕl�t��́��Ё9����(���������������������ɕ��((������������}ٕͅ}���}ɕ��ɸ���ф����􈈤�(�������������̹�������̡�̹��Ѡ���ɹ�����̹��Ѡ������Ѡ�����}��Ѡ��������}���Q�Ք�(������������ݥѠ����������}��Ѡ���݈����́���(��������������������ɥє���ф�(�������������ɽ�͕ȹ���͔��(������������ɕ��}��Ѐ���}��ѕ��}��С��ф���Ф(�����������������}��Ѡ��}ɕ����}չ���ݸ�����}��Ѡ��ɕ��}��Ф(������������ɕ��ɸ������}��Ѡ((�����������R�R �Mѕ��ф�ɕ����͔����ѕ��ȁ��՝�Ё�������ѕ̃�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (���������������}�ѽɕl�t�������������}�ѽɕl�t�����|����(�������������ɥ�С����m����t���
����ɕ��٥��ɕ����͔���ѕɍ��Ј�(������������ɕ��ɸ�}ٕͅ}���}ɕ��ɸ�����}�ѽɕl�t������}�ѽɕl�t��Ȁ���((�����������R�R �Mѕ��ш聉ɽ�͕ȁ��ݹ������ٕ�Ѐ�ፕ������́�ɥ���ȁѡ�̤��R�R�R�R�R�R�R�R (�������������ݹ����}���l�t��́��Ё9����(��������������ݹ����}���l�t�ٕͅ}�̡����}��Ѡ�(�������������ɽ�͕ȹ���͔��(�������������ɥ�С����m����t���
����ɕ��٥���ɽ�͕ȁ��ݹ������(������������ɕ��ɸ�����}��Ѡ((�����������R�R �Mѕ��ь�ɔ���э��ѡ��������́������UI0��R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (����������͕}�����������}�����l��t���������}����́��͔�����(�������������}�ɰ�􁍅͕}������ɰ(���������ɥ�С����m����t���A���������������홥���}�ɱl���u�((�����������}��}���}�ɰ������}�ɰ��(�������������ɥ�С����m����t���I����э�����������ɽ��������UI0�����(����������������(����������������ɕ���􁍽�ѕ�йɕ�Օ�й��С�����}�ɰ�(�����������������Ѐ���ɕ���������̹��Р����ѕ�е����������(����������������������������й��ݕȠ����ȁ�����l���������ፕ�������ɕ��͡��Ј�����ѕЈ���ݽɐ������ݽɐ�t��(����������������������ф��ɕ������䠤(�����������������������������ф�����|����(�������������������������ɥ�С����m����t���
����ɕ��٥��UI0�ɔ���э����������ф��������-���(������������������������ɕ��ɸ�}ٕͅ}���}ɕ��ɸ���ф���Ф(�������������ፕ�Ёፕ�ѥ����́��(�����������������ɥ�С����m����t���I����э�����������((�����������R�R �Mѕ��ѐ���䁑�ݹ��������ѽ���R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R (���������ɥ�С����m����t���1���������ȁ��ݹ��������ѽ�����퍅͕}�����ѥѱ���l���u�(������������(��������������͕}�����݅��}���}����}�хє�����ݽɭ�������ѥ��������|����(���������ፕ�ЁA]Q�������(����������������(����������͕}�����݅��}���}ѥ����Р�|����((��������ɕ�ձЀ�}���}��ݹ����}���ѽ����͕}���������ѕ�а�����}�ѽɔ�(�����������ɕ�ձЀ�􀉥�ѕɍ��ѕ�����������}�ѽɕl�t�(������������ɕ��ɸ�}ٕͅ}���}ɕ��ɸ�����}�ѽɕl�t������}�ѽɕl�t��Ȁ���(�����������ɕ�ձЁ����ɕ�ձЀ�􀉥�ѕɍ��ѕ���(������������ɕ�ձйٕͅ}�̡����}��Ѡ�(�������������ɽ�͕ȹ���͔��(������������ɕ��}��Ѐ���}��ѕ��}��С���������}��Ѡ���Ɉ���ɕ���र����(������������ɕ��ɸ�}ɕ����}չ���ݸ�����}��Ѡ��ɕ��}��Ф(���������������}�ѽɕl�t�������������}�ѽɕl�t�����|����(������������ɕ��ɸ�}ٕͅ}���}ɕ��ɸ�����}�ѽɕl�t������}�ѽɕl�t��Ȁ���(�������������ݹ����}���l�t��́��Ё9����(��������������ݹ����}���l�t�ٕͅ}�̡����}��Ѡ�(�������������ɽ�͕ȹ���͔��(������������ɕ��ɸ�����}��Ѡ((��������ѥѱ����􁍅͕}�����ѥѱ���(���������ɰ�����􁍅͕}������ɰ(��������͹����Ѐ􁍅͕}��������ѕ�Р�l����t�ɕ�������q��������(���������ɽ�͕ȹ���͔��((�����������ѕ�Ё!	M@�����������P�ѡ�́ɕͽ�ɍ���͸�Ё��ɕ�ѱ䁑�ݹ���������(����������I���她��ݥ�����ٕȁ�����Ʌ�͔������ѥ��Ё���ͅ���ͼ���ݹ����}����ͭ��́�и(��������}!	MA}}Q%Q1L���(����������������مɐ���ͥ���́�����Ё��Ս�ѥ����(�����������������������مɐ���ͥ���́�Չ��͡�����(����������������مɐ���ͥ���́�Չ��͡�����(���������(�����������ѥѱ����ɥ������ݕȠ�����}!	MA}}Q%Q1L�(������������Ʌ�͔�Iչѥ���ɽȠ(������������������M-%@�!	M@�ɕͽ�ɍ���́��Ё��ݹ����������������������ɭ�ѥ���������q��(������������������Q��́�́�����䁄����������Ё�ȁ��ѕɅ�ѥٔ���ɍ�͔����䁅م��������(���������������������ѡ��!	M@�ɕ���ȃ�P����A�Ѽ���ݹ�����q�UI0������}�ɱ�(�������������((��������Ʌ�͔�Iչѥ���ɽȠ(��������������
�ձ����Ё���Ʌ�Ё������ɽ��!	M@�٥�ݕȹq��(��������������Q�ѱ�����ѥѱ��q��(��������������UI0�������ɱ�q��(��������������M��������͹�����l����u�q�q��(�������������Iո�ݥѠ������՜�Ѽ�������Ёѡ�������٥�Յ��丈(���������(((���R�R�R �AU	1%�A$��R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R�R ()������ݹ����}��͔�����}�ɰ������}��Ѡ�����م�}�ɰ�9�������ѡ}�����9�����ɕ�ɥ���Ȥ�(�������(�����ݹ�������ͥ�����!	M@���͔�A��䁹�٥��ѥ���ѡɽ՝��ѡ��
��م�(������ͥ�����Ё�����Ѽ��ɥ���ȁѡ��1Q$�����͡����((����ɝ��(������������}�ɰ����!	M@���͔�UI0�������������輽��������مɐ���Խ�Խ�����̈(������������}��Ѡ���ձ�������Ё��Ѡ�����Ց�������������(�����������م�}�ɰ��
��م́��ͥ�����Ё!Q50�UI0��ɕ�եɕ����ȁ1Q$���Ѡ��(��������������������������������輽��̹�����Ս��ɔ���������͕̼������ͥ������̼����(����������ѡ}�������A�Ѡ�Ѽ�ٕͅ����Ѡ�)M=8�����ձ�聡���}��Ѡ��ͽ�����͍ɥ�Ё��ȸ(��������ɕ�ɥ�̀����I���䁅�ѕ���́��������ɔ�((����I���ɹ��(�����������聑���}��Ѡ�����Ս���̸(�������(���������ѡ}������́9����(����������ѡ}������UQ!}%1((���������Ё�̹��Ѡ�����̡��ѡ}������(��������Ʌ�͔�Iչѥ���ɽȠ(��������������9��ٕͅ����Ѡ�͕�ͥ�����չ�������ѡ}�����q��(�������������Iո�͕���������老��ѡ�������}��ݹ�����ȹ�䀴�͕����(���������((�����̹�������̡�̹��Ѡ���ɹ�����̹��Ѡ������Ѡ�����}��Ѡ��������}���Q�Ք�((��������̹��Ѡ�����̡����}��Ѡ�������̹��Ѡ����ͥ锡����}��Ѡ������|����(���������ɥ�С����m����t�M-%@������̤���̹��Ѡ���͕���������}��Ѡ��(��������ɕ��ɸ�����}��Ѡ((��������}��Ȁ�9���(������ȁ��ѕ��Ё���Ʌ����İ�ɕ�ɥ�̀��Ȥ�(������������(�������������ɥ�С����m����t��ݹ����������̹��Ѡ���͕���������}��Ѡ��(����������������������������ѕ��Ё��ѕ������������ѕ��Ѐ��ā��͔�����(��������������Ѡ��}��ݹ����}��������}�ɰ������}��Ѡ����ѡ}���������م�}�ɰ����م�}�ɰ�(������������ͥ销�̹��Ѡ����ͥ锡��Ѡ�(�������������ɥ�С����m����t����rL��ͥ锼������-��H�푕��}��ѡ�(������������ɕ��ɸ���Ѡ(���������ፕ�Ёፕ�ѥ����́��(����������������}��Ȁ�(���������������M-%@舁�ɕ��������́ɕ��她��ݥ�����ٕȁ������P�������������ѕ��(�����������������ȡ����х���ݥѠ��M-%@舤�(����������������Ʌ�͔(�����������������ѕ��Ѐ��ɕ�ɥ���(�����������������ɥ�С����m����t���I���䁥���̸���������(����������������ѥ���ͱ����̤((����Ʌ�͔�Iչѥ���ɽȠ(������������������ѕȁ�ɕ�ɥ�̬���ѕ�������̹��Ѡ���͕���������}��Ѡ��q��(����������1��Ё��ɽ�������}����(�����(()������ݹ����}���������}���ɥ�̰���ѡ}�����9�����(�������(�����ݹ�����������͔�A̀��ፕ�������́��ȁ�����Ё���
1MM}9QId�����̸((����I��ѥ���������(�����������}٥����Q�Ք�����H�ͭ����٥��������́�ɔ�ɕ��ɕ��������(�����������}�����Q�Ք������H�
��م́1Q$����܁٥����ݹ����}��͔��(����������ٕ��ѡ������͔��H���ɕ�Ё!QQ@���ݹ�����٥��}��ݹ����}��ɕ�Р�((����������ѕ�ͥ����́��݅�́ɕͽ�ٕ���ɽ��
��ѕ�еQ��������������ѕ́��(������ݹ�����ѥ��쁙�������́�����������չ���ݸ��ɔ���Ѽ�ɕ������((����I���ɹ��(�������������쁑���}��Ѡ耉�������ͭ������������ɽ�耸�����(�������(����ɕ�ձ�̀���((������
�չЁ���䁑�ݹ�������������̀����٥���̤(������ݹ����������l(��������������(����������ȁ����������}���ɥ��(����������ȁ������l�����̉t(���������������Р�����}�ɰ���������Ё����Р���}٥�����(����t(����ѽх��􁱕����ݹ���������(������������((������ȁ����䰁�������ݹ���������(�������������Ȁ�
=UIML���С�����l�����͔�t��������Р������Ȉ������(�����������Ѐ���̹��Ѡ�����������Ȱ��l����������t�(�����������������(����������}�����􁘹��Р���}�������Q�Ք����������ձЁQ�Ք���ȁ����݅ɐ�������(��������х�������!	M@�������}�������͔�����Р�������������ɕ�Ј�((���������ɥ�С��q���m푽�����ѽх��t�m�х��t�핹���l�����͔�u�핹���l������}�մ�u�(������������������P��l����������u�((����������M���������ɕ����������ɕ��䁕���̀���䁕�ѕ�ͥ���مɥ��Ф(���������ѕ��􁑕�й�����Р�����ĥl�t(������������̀�(�������������̹��Ѡ�����̡���Ф������̹��Ѡ����ͥ锡���Ф�����|���(�������������ȁ���(�����������������̹��Ѡ�����̡�ѕ����������ँ�����̹��Ѡ����ͥ锡�ѕ����������ऀ����|���(������������������ȁ����������������������̈��������(�������������(���������(�����������������(�������������ɥ�С����m��t�M-%@������̤��(������������ɕ�ձ��m����t��ͭ������(���������������ѥ�Ք((�����������م�}�ɰ�􁘹��Р����م�}�ɰ����ȁ����九�Р����م�}�ɰ������((������������(��������������}���م�}�����􁘹��Р"is_canvas_file", False)
            if is_hbsp:
                final_path = download_case(
                    f["hbsp_url"], dest,
                    canvas_url=canvas_url,
                    auth_file=auth_file,
                )
            elif is_canvas_file:
                # Canvas-native file: inject session cookies
                final_path = _download_direct(f["hbsp_url"], dest,
                                              auth_file=auth_file)
            else:
                final_path = _download_direct(f["hbsp_url"], dest,
                                              auth_file=auth_file)

            # Update the entry dict so weekly_prep.py sees the actual filename/ext
            actual_basename = os.path.basename(final_path)
            actual_ext      = os.path.splitext(actual_basename)[1].lstrip(".").lower()
            f["filename"] = actual_basename
            f["ext"]      = actual_ext

            results[final_path] = "ok"
        except Exception as e:
            print(f"  [dl] ERROR: {e}")
            results[dest] = f"error: {e}"

    ok      = sum(1 for v in results.values() if v == "ok")
    skipped = sum(1 for v in results.values() if v == "skipped")
    errors  = sum(1 for v in results.values() if v.startswith("error"))
    print(f"\n  Summary: {ok} downloaded, {skipped} skipped, {errors} errors")
    return results


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _debug_session(hbsp_url=None, canvas_url=None, auth_file=None):
    """
    Diagnostic: navigate through Canvas LTI to HBSP in a visible browser,
    then dump all interactive elements so we can find the download button.

    Usage:
        python hbsp_downloader.py --debug <hbsp_url> <canvas_url>
    """
    if auth_file is None:
        auth_file = AUTH_FILE

    if not os.path.exists(auth_file):
        print(f"  No auth file found: {auth_file}")
        print("  Run setup first: python hbsp_downloader.py --setup")
        return

    sync_playwright = _require_playwright()
    from playwright.sync_api import TimeoutError as PWTimeout
    from urllib.parse import urlparse

    print(f"\n  Opening visible browser via Canvas LTI...")
    print(f"  Canvas: {canvas_url}")
    print(f"  HBSP  : {hbsp_url}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            slow_mo=50,
            args=["--disable-popup-blocking"],
        )
        context = browser.new_context(
            storage_state=auth_file,
            accept_downloads=True,
            user_agent=_UA,
        )

        pdf_store = [None]
        responses_seen = []

        def _on_resp(resp):
            ct = resp.headers.get("content-type", "")
            if any(x in ct for x in ["html", "json", "pdf"]):
                responses_seen.append((resp.status, ct[:35], resp.url[:90]))
            if "application/pdf" in ct and pdf_store[0] is None:
                try:
                    data = resp.body()
                    if len(data) > 5_000:
                        pdf_store[0] = data
                        print(f"\n  *** PDF INTERCEPTED: {len(data)//1024} KB ***")
                except Exception:
                    pass

        page = context.new_page()
        page.on("response", _on_resp)

        if canvas_url:
            try:
                page.goto(canvas_url, wait_until="networkidle", timeout=45_000)
            except PWTimeout:
                pass

            hbsp_path = urlparse(hbsp_url).path if hbsp_url else ""
            link = (
                page.query_selector(f'a[href*="{hbsp_path}"]')
                or page.query_selector('a[href*="hbsp.harvard.edu"]')
            )
            if link:
                print("  Found HBSP link — clicking to trigger LTI handshake...")
                try:
                    with context.expect_page(timeout=20_000) as popup_info:
                        link.click()
                    case_page = popup_info.value
                    case_page.on("response", _on_resp)
                except PWTimeout:
                    case_page = page

                try:
                    case_page.wait_for_load_state("networkidle", timeout=60_000)
                except PWTimeout:
                    pass
                case_page.wait_for_timeout(8_000)   # extra time for JS render
            else:
                print("  No HBSP link found on Canvas page — inspecting Canvas page.")
                case_page = page
        else:
            try:
                page.goto(hbsp_url, wait_until="networkidle", timeout=30_000)
            except Exception:
                pass
            page.wait_for_timeout(8_000)
            case_page = page

        # ── Dump diagnostics ─────────────────────────────────────────
        title   = case_page.title()
        url     = case_page.url
        content = case_page.content()

        print(f"\n  === Page info ===")
        print(f"  Title  : {title}")
        print(f"  URL    : {url}")
        print(f"  HTML   : {len(content)} chars")

        # Dump all buttons and links — find download candidates
        elements = case_page.evaluate("""
            () => {
                const result = [];
                const nodes = document.querySelectorAll('button, a, [role="button"]');
                for (const el of nodes) {
                    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
                    const href = el.getAttribute('href') || '';
                    const cls  = el.className || '';
                    const id   = el.id || '';
                    if (text || href) {
                        result.push({ tag: el.tagName, text: text.slice(0,60),
                                      href: href.slice(0,80), cls: cls.slice(0,60),
                                      id: id.slice(0,40) });
                    }
                }
                return result;
            }
        """)

        print(f"\n  === Interactive elements ({len(elements)} total) ===")
        for el in elements:
            line = f"  <{el['tag'].lower()}>"
            if el['text']:  line += f" text={el['text']!r}"
            if el['href']:  line += f" href={el['href']!r}"
            if el['id']:    line += f" id={el['id']!r}"
            if el['cls']:   line += f" class={el['cls']!r}"
            print(line)

        print(f"\n  === Network responses (last 15) ===")
        for status, ct, u in responses_seen[-15:]:
            print(f"  [{status}] {ct:30s}  {u}")

        if pdf_store[0]:
            print(f"\n  ✓ PDF was intercepted ({len(pdf_store[0])//1024} KB) — "
                  "a response listener would catch it automatically.")

        input("\n  Browser is open — inspect it visually, then press Enter to close...")
        browser.close()


if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup_auth()
        sys.exit(0)

    if "--debug" in sys.argv:
        args = [a for a in sys.argv[1:] if not a.startswith("--")]
        _debug_session(
            hbsp_url   = args[0] if len(args) >= 1 else None,
            canvas_url = args[1] if len(args) >= 2 else None,
        )
        sys.exit(0)

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print("Usage:")
        print("  First time:  python hbsp_downloader.py --setup")
        print("  Download:    python hbsp_downloader.py <hbsp_url> <output.pdf> <canvas_url>")
        print("  Debug:       python hbsp_downloader.py --debug <hbsp_url> <canvas_url>")
        sys.exit(1)

    canvas_url = args[2] if len(args) >= 3 else None
    download_case(args[0], args[1], canvas_url=canvas_url)
