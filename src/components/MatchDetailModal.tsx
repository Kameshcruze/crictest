import React, { useState } from 'react';
import {
  X,
  MapPin,
  Calendar,
  Award,
  TrendingUp,
  Copy,
  Check,
  Code,
  Flame,
  CheckCircle2,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';

interface MatchDetailModalProps {
  match: ParsedCricketMatch | null;
  onClose: () => void;
}

export const MatchDetailModal: React.FC<MatchDetailModalProps> = ({ match, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (!match) return null;

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(match.raw, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="truncate pr-4">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              {match.format} · {match.board || 'ICC'}
            </span>
            <h2 className="text-base font-bold text-white truncate">
              {match.seriesName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* Status Alert Banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
              isLive
                ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                : isCompleted
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {isLive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>LIVE IN PROGRESS</span>
                </>
              ) : isCompleted ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>COMPLETED RESULT</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>UPCOMING FIXTURE</span>
                </>
              )}
            </div>
            <span className="text-xs font-medium text-slate-200">
              {match.resultText || match.statusLabel}
            </span>
          </div>

          {/* Teams Header Scoreboard */}
          <div className="grid grid-cols-2 gap-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
            {/* Team 1 */}
            <div className="flex flex-col items-center text-center p-2 rounded-lg">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-base shadow-md mb-2"
                style={{
                  backgroundColor: match.team1.color,
                  color: match.team1.textColor || '#ffffff',
                }}
              >
                {match.team1.shortName.slice(0, 3)}
              </div>
              <span className="font-semibold text-sm text-white">
                {match.team1.name}
              </span>
              <span className="text-xs text-slate-400">
                ({match.team1.shortName})
              </span>
              {match.team1Score ? (
                <div className="mt-2">
                  <div className="text-xl font-bold font-mono-numbers text-white">
                    {match.team1Score.runs}/{match.team1Score.wickets}
                  </div>
                  <div className="text-xs text-slate-400 font-mono-numbers">
                    {match.team1Score.overs} overs (CRR: {match.team1Score.runRate})
                  </div>
                </div>
              ) : (
                <span className="text-xs text-slate-500 mt-2">Yet to bat</span>
              )}
            </div>

            {/* Team 2 */}
            <div className="flex flex-col items-center text-center p-2 rounded-lg border-l border-slate-800/80">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-base shadow-md mb-2"
                style={{
                  backgroundColor: match.team2.color,
                  color: match.team2.textColor || '#ffffff',
                }}
              >
                {match.team2.shortName.slice(0, 3)}
              </div>
              <span className="font-semibold text-sm text-white">
                {match.team2.name}
              </span>
              <span className="text-xs text-slate-400">
                ({match.team2.shortName})
              </span>
              {match.team2Score ? (
                <div className="mt-2">
                  <div className="text-xl font-bold font-mono-numbers text-white">
                    {match.team2Score.runs}/{match.team2Score.wickets}
                  </div>
                  <div className="text-xs text-slate-400 font-mono-numbers">
                    {match.team2Score.overs} overs (CRR: {match.team2Score.runRate})
                  </div>
                </div>
              ) : (
                <span className="text-xs text-slate-500 mt-2">
                  {match.status === 'upcoming' ? 'Scheduled' : 'Yet to bat'}
                </span>
              )}
            </div>
          </div>

          {/* Innings Breakdown Table */}
          {match.innings.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Innings Breakdown
              </h3>
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/60 text-slate-400 font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Innings</th>
                      <th className="py-2.5 px-3">Team</th>
                      <th className="py-2.5 px-3">Score</th>
                      <th className="py-2.5 px-3">Overs</th>
                      <th className="py-2.5 px-3">Run Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono-numbers text-slate-200">
                    {match.innings.map((inn, idx) => {
                      const teamName =
                        idx === 0
                          ? match.team1.shortName
                          : idx === 1
                          ? match.team2.shortName
                          : `Innings ${idx + 1}`;
                      return (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-slate-400">Innings {idx + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-white">{teamName}</td>
                          <td className="py-2.5 px-3 font-bold text-white">
                            {inn.runs}/{inn.wickets}
                          </td>
                          <td className="py-2.5 px-3">{inn.overs}</td>
                          <td className="py-2.5 px-3 text-emerald-400">{inn.runRate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live Equation / Target Info */}
          {match.target && (
            <div className="p-3.5 bg-slate-800/40 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div>
                <span className="text-slate-400">Target: </span>
                <span className="font-bold text-white font-mono-numbers">{match.target} runs</span>
              </div>
              {match.requiredRunRate !== undefined && (
                <div>
                  <span className="text-slate-400">Required Run Rate (RRR): </span>
                  <span className="font-bold text-amber-400 font-mono-numbers">
                    {match.requiredRunRate}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Win Probability */}
          {match.winProbability && (
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-medium">
                  {match.team1.name}: {match.winProbability.team1Prob}%
                </span>
                <span className="font-semibold text-slate-500">Live Win Probability</span>
                <span className="font-medium">
                  {match.team2.name}: {match.winProbability.team2Prob}%
                </span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${match.winProbability.team1Prob}%`,
                    backgroundColor: match.team1.color,
                  }}
                />
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${match.winProbability.team2Prob}%`,
                    backgroundColor: match.team2.color,
                  }}
                />
              </div>
            </div>
          )}

          {/* Venue & Fixture Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
            <div className="flex items-start gap-2 text-slate-300">
              <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-500 block text-[11px]">Venue</span>
                <span>{match.venueName}</span>
              </div>
            </div>
            <div className="flex items-start gap-2 text-slate-300">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-500 block text-[11px]">Start Time</span>
                <span>{match.startTime.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Raw JSON Toggle */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white font-medium"
              >
                <Code className="w-3.5 h-3.5 text-emerald-400" />
                <span>{showRaw ? 'Hide Raw Crex Node' : 'View Raw Crex Node JSON'}</span>
              </button>
              {showRaw && (
                <button
                  type="button"
                  onClick={copyJson}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              )}
            </div>

            {showRaw && (
              <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-48 leading-relaxed">
                {JSON.stringify(match.raw, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
