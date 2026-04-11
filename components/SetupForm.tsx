"use client";
import { useState, useEffect } from "react";

const TOKEN_KEY = "hbs_canvas_token";
const URL_KEY   = "hbs_canvas_url";

interface Props {
  onFetch: (token: string, canvasUrl: string, startDate: string, endDate: string) => void;
  loading: boolean;
}

function mondayStr() {
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split("T")[0];
}
function fridayStr() {
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1) + 4);
  return d.toISOString().split("T")[0];
}

export default function SetupForm({ onFetch, loading }: Props) {
  const [token, setToken]         = useState("");
  const [canvasUrl, setCanvasUrl] = useState("");
  const [startDate, setStartDate] = useState(mondayStr());
  const [endDate, setEndDate]     = useState(fridayStr());
  const [showToken, setShowToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUrl   = localStorage.getItem(URL_KEY);
    if (savedToken) { setToken(savedToken); setTokenSaved(true); }
    if (savedUrl)   setCanvasUrl(savedUrl);
  }, []);

  function handleTokenChange(val: string) { setToken(val); setTokenSaved(false); }
  function handleUrlChange(val: string)   {
    // Strip protocol if pasted, keep just the hostname
    const clean = val.replace(/^https?:\/\//, "").replace(/\/$/, "");
    setCanvasUrl(clean);
  }

  function validate() {
    if (!canvasUrl.trim()) return "Canvas URL is required (e.g. hbs.instructure.com).";
    if (!token.trim())     return "Canvas API token is required.";
    const start = new Date(startDate); const end = new Date(endDate);
    if (start > end) return "Start date must be before end date.";
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > 14) return `Range is ${days} days — max is 14.`;
    return "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setValidationError(err); return; }
    setValidationError("");
    localStorage.setItem(TOKEN_KEY, token.trim());
    localStorage.setItem(URL_KEY, canvasUrl.trim());
    setTokenSaved(true);
    onFetch(token.trim(), canvasUrl.trim(), startDate, endDate);
  }

  function handleClearToken() { localStorage.removeItem(TOKEN_KEY); setToken(""); setTokenSaved(false); }

  const tokenSettingsUrl = canvasUrl
    ? `https://${canvasUrl}/profile/settings`
    : "https://yourschool.instructure.com/profile/settings";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
      <h2 className="text-base font-semibold text-gray-700">Connect to Canvas</h2>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Canvas URL */}
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1.5">
            Canvas URL
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400 shrink-0">https://</span>
            <input
              type="text"
              value={canvasUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="hbs.instructure.com"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]"
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            The homepage of your school&apos;s Canvas site. For HBS: <span className="font-mono">hbs.instructure.com</span>
          </p>
        </div>

        {/* API Token */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-600">
              Canvas API Token
            </label>
            <button
              type="button"
              onClick={() => setShowInstructions(!showInstructions)}
              className="text-xs text-[#A41034] underline"
            >
              {showInstructions ? "Hide instructions" : "How do I get a token?"}
            </button>
          </div>

          {showInstructions && (
            <div className="mb-3 bg-blue-50 border border-blue-100 rounded-lg p-4 text-xs text-gray-600 space-y-1.5">
              <p className="font-semibold text-gray-700">How to generate your Canvas API token:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href={tokenSettingsUrl} target="_blank" rel="noreferrer" className="text-[#A41034] underline">{tokenSettingsUrl}</a></li>
                <li>Scroll down to <strong>Approved Integrations</strong></li>
                <li>Click <strong>+ New Access Token</strong></li>
                <li>Give it a name (e.g. &quot;Canvas Sync&quot;) — leave expiry blank</li>
                <li>Click <strong>Generate Token</strong> and copy it immediately</li>
              </ol>
              <p className="text-gray-500 mt-1">Your token is stored only in your browser and sent directly to Canvas — never to any third-party server.</p>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="Paste your Canvas API token"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]"
            />
            <button type="button" onClick={() => setShowToken(!showToken)}
              className="px-3 py-2 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-gray-50">
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between">
            {tokenSaved
              ? <p className="text-xs text-green-600">✓ Token saved in your browser</p>
              : <p className="text-xs text-gray-400">Saved locally — never sent to any server.</p>}
            {tokenSaved && (
              <button type="button" onClick={handleClearToken}
                className="text-xs text-gray-400 hover:text-red-500 underline">Clear saved token</button>
            )}
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              End Date <span className="text-gray-400 font-normal">(max 14 days)</span>
            </label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]" />
          </div>
        </div>

        {validationError && <p className="text-sm text-red-600">{validationError}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-[#A41034] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#8a0d2b] transition disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? "Fetching assignments…" : "Fetch Assignments"}
        </button>
      </form>
    </div>
  );
}