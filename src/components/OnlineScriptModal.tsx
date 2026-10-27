import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Terminal,
  Cloud,
  FileCode,
  Github,
  Play,
  CheckCircle2,
} from 'lucide-react';

interface OnlineScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  countryCode: string;
}

export const OnlineScriptModal: React.FC<OnlineScriptModalProps> = ({
  isOpen,
  onClose,
  countryCode,
}) => {
  const [activeTab, setActiveTab] = useState<'worker' | 'python' | 'node' | 'github' | 'curl'>('worker');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const scripts = {
    worker: `/**
 * Cloudflare Worker / Vercel Edge (100% Serverless & Runs Online 24/7)
 * Deploy to Cloudflare Workers for free. Runs continuously without any local server.
 */
export default {
  async scheduled(event, env, ctx) {
    await fetchAndSyncMatches();
  },
  async fetch(request, env, ctx) {
    const data = await fetchAndSyncMatches();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  }
};

async function fetchAndSyncMatches() {
  const url = "https://api.goscorer.com/api/v2/getTopMatches";
  const payload = { cc: "${countryCode}" };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "CrexOnlineScorer/1.0"
    },
    body: JSON.stringify(payload)
  });

  const matches = await response.json();
  console.log(\`[ONLINE CRON] Fetched \${Object.keys(matches).length} matches\`);

  // Log live scores or send webhook notification
  for (const [id, m] of Object.entries(matches)) {
    if (m.d === 1 || m.j) {
      console.log(\`[LIVE] Match \${id}: Innings 1=\${m.j || "none"}, Innings 2=\${m.k || "none"}, Status=\${m.res || "Live"}\`);
    }
  }

  return matches;
}`,

    python: `import time
import requests
from datetime import datetime

# Crex Online Cricket Live Scorer Script
# Runs 24/7 online on any cloud VM, Railway, Render, or PythonAnywhere (No local server needed)

API_URL = "https://api.goscorer.com/api/v2/getTopMatches"
PAYLOAD = {"cc": "${countryCode}"}
POLL_INTERVAL_SECONDS = 10

def fetch_top_matches():
    try:
        response = requests.post(API_URL, json=PAYLOAD, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetched {len(data)} matches successfully.")
        
        for match_id, m in data.items():
            team1 = m.get("b", "Team1")
            team2 = m.get("c", "Team2")
            score1 = m.get("j", "-")
            score2 = m.get("k", "-")
            status = m.get("res", "In progress" if m.get("d") == 1 else "Scheduled")
            
            # Print live matches with scores
            if m.get("d") == 1 or m.get("j"):
                print(f"  🔴 [LIVE] {team1} vs {team2} | Scores: {score1} vs {score2} | {status}")
                
    except Exception as e:
        print(f"[ERROR] Fetch failed: {e}")

if __name__ == "__main__":
    print("Crex Live Scorer Daemon started online...")
    while True:
        fetch_top_matches()
        time.sleep(POLL_INTERVAL_SECONDS)`,

    node: `/**
 * Standalone Node.js / Bun / Deno Online Runner
 * Run online on Heroku, Railway, Render, or any VPS.
 */
const API_URL = "https://api.goscorer.com/api/v2/getTopMatches";
const PAYLOAD = { cc: "${countryCode}" };
const POLL_INTERVAL_MS = 10000;

async function pollLiveScores() {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PAYLOAD)
    });
    
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const data = await res.json();
    
    const count = Object.keys(data).length;
    console.log(\`[\${new Date().toLocaleTimeString()}] Live matches synced: \${count}\`);
    
    for (const [id, m] of Object.entries(data)) {
      if (m.d === 1 || m.j) {
        console.log(\`🔴 LIVE: \${m.b} vs \${m.c} | \${m.j || 'yet to bat'} | \${m.res || 'Live'}\`);
      }
    }
  } catch (err) {
    console.error("Live fetch error:", err.message);
  }
}

// Start continuous online live loop
console.log("Starting online Crex live extractor loop...");
pollLiveScores();
setInterval(pollLiveScores, POLL_INTERVAL_MS);`,

    github: `name: Crex Live Cricket Online Scraper
# Runs online in GitHub Cloud on schedule (Every 5 minutes, 100% free, zero local servers!)
on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  scrape-cricket:
    runs-on: ubuntu-latest
    steps:
      - name: Fetch Crex Live Matches
        run: |
          curl -s -X POST https://api.goscorer.com/api/v2/getTopMatches \\
            -H "Content-Type: application/json" \\
            -d '{"cc":"${countryCode}"}' > latest_matches.json
          
          echo "Top matches extracted successfully:"
          cat latest_matches.json | head -c 500`,

    curl: `curl -X POST https://api.goscorer.com/api/v2/getTopMatches \\
  -H "Content-Type: application/json" \\
  -d '{"cc":"${countryCode}"}'`,
  };

  const currentCode = scripts[activeTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Online Automated Scripts
              </h2>
              <p className="text-xs text-slate-400">
                Run continuously online 24/7 without needing any local server
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info callout */}
        <div className="px-5 pt-4">
          <div className="p-3.5 bg-emerald-950/30 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                Current App Status: Already running 100% online in your browser!
              </strong>
              This web app connects directly to{' '}
              <code className="text-emerald-200 bg-emerald-950/60 px-1 py-0.5 rounded font-mono">
                https://api.goscorer.com/api/v2/getTopMatches
              </code>{' '}
              with live auto-refreshing polling. If you also need an independent cloud runner (serverless cron or background daemon), choose a script below:
            </div>
          </div>
        </div>

        {/* Script Selection Tabs */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto no-scrollbar text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('worker')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'worker'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cloudflare Worker (Serverless)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('python')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'python'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Python Daemon</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('node')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'node'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-blue-400" />
              <span>Node.js / Bun</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('github')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'github'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Github className="w-3.5 h-3.5 text-purple-400" />
              <span>GitHub Actions</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('curl')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'curl'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-slate-300" />
              <span>cURL</span>
            </button>
          </div>
        </div>

        {/* Code Box */}
        <div className="p-5 flex-1 overflow-hidden flex flex-col">
          <div className="relative flex-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 text-xs">
              <span className="font-mono text-slate-400 text-[11px]">
                Payload: {`{"cc": "${countryCode}"}`}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Code'}</span>
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-emerald-300 overflow-auto flex-1 leading-relaxed selection:bg-emerald-900/50">
              {currentCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
