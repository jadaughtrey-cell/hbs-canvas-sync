'use client';
import { useEffect } from 'react';

export default function PipelineDiagram() {
  useEffect(() => {
    function drawArrow(wrapId: string, svgId: string) {
      const wrap = document.getElementById(wrapId);
      const svg = document.getElementById(svgId) as SVGSVGElement | null;
      if (!wrap || !svg) return;
      function draw() {
        const W = wrap!.offsetWidth, H = 52;
        svg!.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg!.setAttribute('height', String(H));
        const badges = wrap!.querySelectorAll('.pd-stage-badge');
        const centers: number[] = [];
        const wrapRect = wrap!.getBoundingClientRect();
        badges.forEach((b) => {
          const r = b.getBoundingClientRect();
          centers.push(r.left - wrapRect.left + r.width / 2);
        });
        const y = 24, gid = 'g' + wrapId;
        let html = `<defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#22c55e;stop-opacity:.85"/>
          <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:.85"/>
        </linearGradient></defs>`;
        const x1 = centers[0], x2 = centers[centers.length - 1] - 12;
        html += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="url(#${gid})" stroke-width="3.5" stroke-linecap="round"/>`;
        html += `<polygon points="${x2},${y-9} ${x2+18},${y} ${x2},${y+9}" fill="#3b82f6" opacity=".85"/>`;
        centers.forEach((cx, i) => {
          if (i > 0 && i < centers.length - 1)
            html += `<circle cx="${cx}" cy="${y}" r="5" fill="#080b13" stroke="#22c55e" stroke-width="2.5" opacity=".8"/>`;
          html += `<line x1="${cx}" y1="${y+5}" x2="${cx}" y2="${y+14}" stroke="#22c55e" stroke-width="1.5" opacity=".35"/>`;
        });
        svg!.innerHTML = html;
      }
      setTimeout(draw, 120);
      window.addEventListener('resize', draw);
    }
    drawArrow('pd-flow-built', 'pd-svg-built');
    drawArrow('pd-flow-reality', 'pd-svg-reality');
  }, []);

  return (
    <>
      <style>{`
        .pd-wrap { font-family: -apple-system, 'Inter', sans-serif; color: #e8eaf0; }
        .pd-section-row { display:flex;align-items:center;gap:10px;margin-bottom:10px; }
        .pd-section-line { flex:1;height:1px;background:rgba(255,255,255,.07); }
        .pd-section-label { font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;padding:0 2px; }
        .pd-grid4 { display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:8px;align-items:start; }
        .pd-flow-wrap { position:relative;margin-bottom:10px; }
        .pd-flow-wrap svg { position:absolute;top:0;left:0;width:100%;height:52px;overflow:visible;pointer-events:none; }
        .pd-badge-row { display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:8px;position:relative;z-index:2;padding-top:13px; }
        .pd-stage-badge { display:flex;flex-direction:column;align-items:center;gap:3px; }
        .pd-num-green { width:26px;height:26px;border-radius:50%;background:#22c55e;color:#0a1a0a;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(34,197,94,.2);flex-shrink:0; }
        .pd-num-yellow { width:26px;height:26px;border-radius:50%;background:#fbbf24;color:#1a1000;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(251,191,36,.2);flex-shrink:0; }
        .pd-name-green { font-size:8.5px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.08em;text-align:center;line-height:1.3; }
        .pd-name-yellow { font-size:8.5px;font-weight:700;color:#fde68a;text-transform:uppercase;letter-spacing:.08em;text-align:center;line-height:1.3; }
        .pd-built-card { background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.1);border-radius:10px;padding:11px 10px 10px;position:relative; }
        .pd-vc-badge { position:absolute;top:-1px;right:-1px;background:#1a2a1a;border:1px solid #22c55e;color:#86efac;font-size:8px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:0 9px 0 6px; }
        .pd-built-icon { font-size:16px;margin-bottom:5px; }
        .pd-built-title { font-size:11px;font-weight:700;color:#e8eaf0;margin-bottom:2px; }
        .pd-built-script { font-family:monospace;font-size:8.5px;color:#4a5268;margin-bottom:5px; }
        .pd-built-desc { font-size:9.5px;color:#6a7490;line-height:1.5; }
        .pd-sub { border-radius:6px;padding:6px 8px;margin-top:6px; }
        .pd-sub-ok { background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2); }
        .pd-sub-block { background:rgba(164,16,52,.1);border:1px solid rgba(164,16,52,.3); }
        .pd-sub-label { font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px; }
        .pd-sub-ok .pd-sub-label { color:#4ade80; }
        .pd-sub-block .pd-sub-label { color:#fca5a5; }
        .pd-sub-desc { font-size:9px;line-height:1.5; }
        .pd-sub-ok .pd-sub-desc { color:#86efac; }
        .pd-sub-block .pd-sub-desc { color:#f08098; }
        .pd-api-note { font-size:8.5px;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.2);border-radius:5px;padding:4px 7px;margin-top:6px;line-height:1.45;color:#a0884a; }
        .pd-api-note strong { color:#fbbf24; }
        .pd-intent-bar { background:rgba(59,130,246,.08);border:1.5px solid rgba(59,130,246,.25);border-radius:10px;padding:12px 16px;margin:16px 0;display:flex;align-items:center;gap:14px; }
        .pd-intent-icon { font-size:24px;flex-shrink:0; }
        .pd-intent-label { font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#60a5fa;margin-bottom:3px; }
        .pd-intent-desc { font-size:11px;color:#93c5fd;line-height:1.6; }
        .pd-intent-sub { font-size:10px;color:#4a6080;line-height:1.5;margin-top:2px; }
        .pd-connector { display:flex;align-items:center;justify-content:center;padding:8px 0 4px;gap:6px; }
        .pd-conn-arrow { font-size:18px;color:#4a5168; }
        .pd-conn-label { font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4a5168; }
        .pd-card { border-radius:10px;padding:11px 10px 10px;display:flex;flex-direction:column;gap:5px; }
        .pd-mixed   { background:rgba(251,191,36,.05);border:1.5px solid rgba(251,191,36,.28); }
        .pd-clean   { background:rgba(34,197,94,.06);border:1.5px solid rgba(34,197,94,.2); }
        .pd-blocked { background:rgba(164,16,52,.09);border:1.5px solid rgba(164,16,52,.35); }
        .pd-r-icon { font-size:16px; }
        .pd-r-title { font-size:11px;font-weight:700; }
        .pd-mixed .pd-r-title   { color:#fde68a; }
        .pd-clean .pd-r-title   { color:#bbf7d0; }
        .pd-blocked .pd-r-title { color:#fda4af; }
        .pd-msg { border-radius:5px;padding:5px 7px;font-size:9px;line-height:1.5; }
        .pd-ok    { background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#86efac; }
        .pd-block { background:rgba(164,16,52,.15);border:1px solid rgba(164,16,52,.35);color:#f08098; }
        .pd-agent { background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);color:#fde68a; }
        .pd-msg strong { font-weight:800;display:block;margin-bottom:2px;font-size:8px;text-transform:uppercase;letter-spacing:.07em; }
        .pd-ok strong    { color:#4ade80; }
        .pd-block strong { color:#fca5a5; }
        .pd-agent strong { color:#fbbf24; }
        .pd-bridge-connectors { display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:8px;margin-top:4px; }
        .pd-bconn { display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0; }
        .pd-bconn-line { width:2px;height:14px;background:linear-gradient(to bottom,rgba(251,191,36,.6),rgba(251,191,36,.9));border-radius:2px; }
        .pd-bconn-arrow { font-size:10px;color:#fbbf24;line-height:1; }
        .pd-bconn-label { font-size:8px;font-style:italic;color:#806040;text-align:center; }
        .pd-bridge-row { display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:8px;margin-bottom:4px;align-items:start; }
        .pd-bridge-card { background:rgba(251,191,36,.07);border:1.5px solid rgba(251,191,36,.3);border-radius:10px;padding:11px 10px 10px; }
        .pd-bridge-title { font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#fbbf24;margin-bottom:6px;display:flex;align-items:center;gap:6px; }
        .pd-bridge-title::before { content:'';width:8px;height:8px;border-radius:50%;background:#fbbf24;flex-shrink:0; }
        .pd-bridge-desc { font-size:9px;color:#fde68a;line-height:1.55; }
        .pd-consequence { background:rgba(164,16,52,.07);border:1.5px solid rgba(164,16,52,.3);border-radius:10px;padding:13px 16px;margin:16px 0;display:flex;align-items:flex-start;gap:14px; }
        .pd-cons-icon { font-size:22px;flex-shrink:0;margin-top:1px; }
        .pd-cons-label { font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f08098;margin-bottom:4px; }
        .pd-cons-desc { font-size:11px;color:#fca5a5;line-height:1.6; }
        .pd-cons-sub { font-size:10px;color:#7a4050;margin-top:3px;line-height:1.55; }
        .pd-unlock { background:rgba(34,197,94,.06);border:1.5px solid rgba(34,197,94,.22);border-radius:10px;padding:13px 16px;margin-top:6px;display:flex;align-items:flex-start;gap:14px; }
        .pd-unlock-icon { font-size:22px;flex-shrink:0;margin-top:1px; }
        .pd-unlock-label { font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#4ade80;margin-bottom:4px; }
        .pd-unlock-desc { font-size:11px;color:#86efac;line-height:1.6; }
        .pd-unlock-sub { font-size:10px;color:#4ade80;opacity:.7;margin-top:3px;line-height:1.55; }
        .pd-live-chip { display:inline-flex;align-items:center;gap:4px;margin-top:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.3);border-radius:5px;padding:3px 8px;font-size:8.5px;font-weight:700;color:#93c5fd;text-decoration:none;transition:background .15s; }
        .pd-live-chip:hover { background:rgba(59,130,246,.22); }
        .pd-live-dot { width:6px;height:6px;border-radius:50%;background:#3b82f6;animation:pd-pulse 2s infinite; }
        @keyframes pd-pulse { 0%,100%{opacity:1}50%{opacity:.4} }
      `}</style>

      <div className="pd-wrap">
        {/* ① WHAT WE BUILT */}
        <div className="pd-section-row">
          <div className="pd-section-line" />
          <div className="pd-section-label" style={{color:'#22c55e'}}>① What We Built — Vibe-Coded Python Scripts, All Tested Locally</div>
          <div className="pd-section-line" />
        </div>

        <div className="pd-flow-wrap" id="pd-flow-built">
          <svg id="pd-svg-built" />
          <div className="pd-badge-row">
            <div className="pd-stage-badge"><div className="pd-num-green">1</div><div className="pd-name-green">Canvas Scrape<br/>+ Case Fetch</div></div>
            <div className="pd-stage-badge"><div className="pd-num-green">2</div><div className="pd-name-green">AI<br/>Analysis</div></div>
            <div className="pd-stage-badge"><div className="pd-num-green">3</div><div className="pd-name-green">Cheatsheet<br/>Build</div></div>
            <div className="pd-stage-badge"><div className="pd-num-green">4</div><div className="pd-name-green">Outlook<br/>Sync</div></div>
          </div>
        </div>

        <div className="pd-grid4" style={{marginBottom:'16px'}}>
          <div className="pd-built-card">
            <span className="pd-vc-badge">Vibe coded</span>
            <div className="pd-built-icon">🎓📥</div>
            <div className="pd-built-title">Canvas Scrape + Case Fetch</div>
            <div className="pd-built-script">canvas_scraper.py · hbsp_downloader.py</div>
            <div className="pd-built-desc">One logical step: Canvas holds both the assignment metadata and the HBSP case link. Two scripts handle the two parts of the same operation.</div>
            <div className="pd-sub pd-sub-ok">
              <div className="pd-sub-label">Metadata — REST API ✓</div>
              <div className="pd-sub-desc">Class name, case title, time, location, discussion questions</div>
            </div>
            <div className="pd-sub pd-sub-block">
              <div className="pd-sub-label">Case PDF — LTI click-through ✗</div>
              <div className="pd-sub-desc">HBSP link lives inside Canvas but requires a live authenticated browser session to access the case, which is not stored on Canvas but on HBSP (where students do not have API access)</div>
            </div>
          </div>
          <div className="pd-built-card">
            <span className="pd-vc-badge">Vibe coded</span>
            <div className="pd-built-icon">🤖</div>
            <div className="pd-built-title">AI Analysis</div>
            <div className="pd-built-script">ai_case_analyzer.py</div>
            <div className="pd-built-desc">Full case text → Claude Sonnet → structured JSON with Q&A, timeline, arguments, hidden assumptions</div>
            <div className="pd-api-note"><strong>Requires:</strong> Anthropic API key. Billed per run (~$0.10–0.15 per case).</div>
          </div>
          <div className="pd-built-card">
            <span className="pd-vc-badge">Vibe coded</span>
            <div className="pd-built-icon">📄</div>
            <div className="pd-built-title">Cheatsheet Build</div>
            <div className="pd-built-script">gen_cheatsheets_v2.py</div>
            <div className="pd-built-desc">JSON → formatted .docx via python-docx, length scaled to case page count</div>
            <div className="pd-api-note"><strong>Requires:</strong> Output from AI Analysis — Anthropic API key needed upstream.</div>
          </div>
          <div className="pd-built-card">
            <span className="pd-vc-badge">Vibe coded</span>
            <div className="pd-built-icon">📅</div>
            <div className="pd-built-title">Outlook Sync</div>
            <div className="pd-built-script">outlook_sync.py</div>
            <div className="pd-built-desc">Renames calendar events, attaches case files &amp; cheatsheets, embeds discussion questions via Microsoft Graph API</div>
          </div>
        </div>

        {/* Intended Architecture */}
        <div className="pd-intent-bar">
          <div className="pd-intent-icon">🌐</div>
          <div>
            <div className="pd-intent-label">The Intended Architecture</div>
            <div className="pd-intent-desc">A hosted web app — any HBS RC student enters their Canvas token, hits a button Sunday night, and all scripts run on a server. Outlook Calendar updated with case name, case file(s), AI cheatsheets, and answers to discussion questions generated and attached to each Outlook event.</div>
            <div className="pd-intent-sub">This is what hbs-canvas-sync.vercel.app was meant to be: a full pipeline host, not just a demo site.</div>
          </div>
        </div>

        <div className="pd-connector">
          <div className="pd-conn-arrow">↓</div>
          <div className="pd-conn-label">Reality check — permission walls block the hosted version</div>
          <div className="pd-conn-arrow">↓</div>
        </div>

        {/* ② WHAT ACTUALLY HAPPENS */}
        <div className="pd-section-row">
          <div className="pd-section-line" />
          <div className="pd-section-label" style={{color:'#a41034'}}>② What Actually Happens — Where the Pipeline Hits Walls</div>
          <div className="pd-section-line" />
        </div>

        <div className="pd-flow-wrap" id="pd-flow-reality">
          <svg id="pd-svg-reality" />
          <div className="pd-badge-row">
            <div className="pd-stage-badge"><div className="pd-num-yellow">1</div><div className="pd-name-yellow">Canvas Scrape<br/>+ Case Fetch</div></div>
            <div className="pd-stage-badge"><div className="pd-num-green">2</div><div className="pd-name-green">AI<br/>Analysis</div></div>
            <div className="pd-stage-badge"><div className="pd-num-green">3</div><div className="pd-name-green">Cheatsheet<br/>Build</div></div>
            <div className="pd-stage-badge"><div className="pd-num-yellow">4</div><div className="pd-name-yellow">Outlook<br/>Sync</div></div>
          </div>
        </div>

        <div className="pd-grid4" style={{marginBottom:'0'}}>
          <div className="pd-card pd-mixed">
            <div className="pd-r-icon">🎓📥</div>
            <div className="pd-r-title">Canvas Scrape + Case Fetch</div>
            <div className="pd-msg pd-ok">
              <strong>Metadata — Server-Ready ✓</strong>
              Class name, case title, time, location &amp; discussion questions via Canvas REST API.
              <a href="#fetch" className="pd-live-chip">
                <span className="pd-live-dot" />
                Fetch Assignments — live on this app →
              </a>
            </div>
            <div className="pd-msg pd-block">
              <strong>Case PDF — Permission Wall ✗</strong>
              The HBSP download link is a session-bound LTI token. A server has no live HBS session to click through, and students have no direct API access to HBSP.
            </div>
          </div>
          <div className="pd-card pd-clean">
            <div className="pd-r-icon">🤖</div>
            <div className="pd-r-title">AI Analysis</div>
            <div className="pd-msg pd-ok">
              <strong>Runs Properly ✓</strong>
              Pure Anthropic API call. Works on any server with a valid API key. No browser, no session, no agent needed.
            </div>
          </div>
          <div className="pd-card pd-clean">
            <div className="pd-r-icon">📄</div>
            <div className="pd-r-title">Cheatsheet Build</div>
            <div className="pd-msg pd-ok">
              <strong>Runs Properly ✓</strong>
              Pure python-docx generation. Works on any server. No browser, no session, no agent needed.
            </div>
          </div>
          <div className="pd-card pd-blocked">
            <div className="pd-r-icon">📅</div>
            <div className="pd-r-title">Outlook Sync</div>
            <div className="pd-msg pd-ok">
              <strong>Script Is Built &amp; Works ✓</strong>
              outlook_sync.py can push renames, attachments, and body content directly into a student&apos;s enterprise Outlook calendar — if it can authenticate.
            </div>
            <div className="pd-msg pd-block">
              <strong>Permission Wall ✗</strong>
              HBS IT controls OAuth consent for the HBS tenant. Without admin approval on Calendars.ReadWrite, Microsoft blocks authorization before the script can run.
            </div>
          </div>
        </div>

        {/* Bridge connectors */}
        <div className="pd-bridge-connectors">
          <div className="pd-bconn">
            <div className="pd-bconn-line" />
            <div className="pd-bconn-arrow">▼</div>
            <div className="pd-bconn-label">because of this wall</div>
          </div>
          <div />
          <div />
          <div className="pd-bconn">
            <div className="pd-bconn-line" />
            <div className="pd-bconn-arrow">▼</div>
            <div className="pd-bconn-label">because of this wall</div>
          </div>
        </div>

        {/* Agentic bridge boxes */}
        <div className="pd-bridge-row" style={{marginBottom:'16px'}}>
          <div className="pd-bridge-card">
            <div className="pd-bridge-title">Agentic Bridge</div>
            <div className="pd-bridge-desc">Claude clicks the HBSP link inside an authenticated browser, waits for the OS Save As dialog, and presses Enter to save the file.</div>
          </div>
          <div />
          <div />
          <div className="pd-bridge-card">
            <div className="pd-bridge-title">Agentic Bridge</div>
            <div className="pd-bridge-desc">Claude navigates Outlook web manually — opens each calendar event, renames it, and attaches files through the browser UI.</div>
          </div>
        </div>

        {/* Consequence */}
        <div className="pd-consequence">
          <div className="pd-cons-icon">🚫</div>
          <div>
            <div className="pd-cons-label">Why the Web App Couldn&apos;t Launch at Scale</div>
            <div className="pd-cons-desc">A server can&apos;t click through a live HBS browser session to download HBSP cases, or pass Microsoft&apos;s OAuth gate without admin-level Graph API consent. The pipeline works end-to-end — but only when Claude is running locally on an authenticated user&apos;s machine as an agentic bridge.</div>
            <div className="pd-cons-sub">Result: The web app became a demo site. The full pipeline requires a user to run Claude locally, using its agentic capabilities to bridge the permission gaps — not a scalable hosted service.</div>
          </div>
        </div>

        {/* ③ PATH FORWARD */}
        <div className="pd-section-row" style={{marginTop:'18px'}}>
          <div className="pd-section-line" />
          <div className="pd-section-label" style={{color:'#60a5fa'}}>③ The Path Forward — 2 IT Decisions Remove the Need for the Bridge</div>
          <div className="pd-section-line" />
        </div>

        <div className="pd-unlock">
          <div className="pd-unlock-icon">🔓</div>
          <div style={{flex:1}}>
            <div className="pd-unlock-label">All Scripts Already Exist. The Code Is Done.</div>
            <div className="pd-unlock-desc">Grant (1) HBSP institutional download tokens so case PDFs can be fetched server-side, and (2) Microsoft Graph Calendars.ReadWrite admin consent for the HBS tenant — and the entire pipeline runs headlessly on Vercel. No browser. No agent. No local machine. One cron job, Sunday night, for every enrolled student.</div>
            <div className="pd-unlock-sub">The agentic AI was never the product. It was the bridge that proved the product works.</div>
          </div>
        </div>
      </div>
    </>
  );
}
