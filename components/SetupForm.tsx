"use client";

import { useState } from "react";

interface Props {
  onFetch: (token: string, startDate: string, endDate: string) => void;
  loading: boolean;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function mondayStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}
function fridayStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + 4;
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

export default function SetupForm({ onFetch, loading }: Props) {
  const [token, setToken] = useState("");
  const [startDate, setStartDate] = useState(mondayStr());
  const [endDate, setEndDate] = useState(fridayStr());
  const [showToken, setShowToken] = useState(false);
  const [validationError, setValidationError] = useState("");

  function validate() {
    if (!token.trim()) return "Canvas API token is required.";
    const start = new Date(startDate);
    const end   = new Date(endDate);
    const today = new Date();
    if (start > end) return "Start date must be before end date.";
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > 5) return `Range is ${days} days — max is 5.`;
    if (start > today) return "Start date cannot be in the future.";
    return "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setValidationError(err); return; }
    setValidationError("");
    onFetch(token.trim(), startDate, endDate);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-base font-semibold text-gray-700 mb-5">Connect to Canvas</h2>
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Token field */}
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1.5">
            Canvas API Token
            <a
              href="https://canvas.harvard.edu/profile/settings"
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-xs text-[#A41034] underline font-normal"
            >
              Get token →
            </a>
          </label>
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Canvas API token"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="px-3 py-2 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Your token is sent directly to Canvas and never stored.
          </p>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              max={todayStr()}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              End Date <span className="text-gray-400 font-normal">(max 5 days)</span>
            </label>
            <input
              type="date"
              value={endDate}
              max={todayStr()}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A41034]/30 focus:border-[#A41034]"
            />
          </div>
        </div>

        {validationError && (
          <p className="text-sm text-red-600">{validationError}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#A41034] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#8a0d2b] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Fetching assignments…" : "Fetch Assignments"}
        </button>
      </form>
    </div>
  );
}
