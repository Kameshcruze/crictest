import React, { useState, useEffect } from 'react';
import {
  X,
  MapPin,
  Calendar,
  Copy,
  Check,
  Code,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';

interface MatchDetailModalProps {
  match: ParsedCricketMatch | null;
  onClose: () => void;
}

export const MatchDetailModal: React.FC<MatchDetailModalProps> = ({ match, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!match) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [match, onClose]);

  if (!match) return null;

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(match.raw, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-[var(--sf)] border border-[var(--bd)] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-[var(--sf)]">
          <div className="truncate pr-4">
            <span className="text-xs font-semibold text-[var(--rdt)] uppercase tracking-wider">
              {match.format} · {match.board || 'ICC'}
            </span>
            <h2 className="text-base font-bold text-[var(--tx)] truncate">
              {match.seriesName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close match details"
            className="p-1.5 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg hover:bg-[var(--sf-2)] transition-colors"
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
                ? 'bg-[var(--rds)] border-[var(--rd)]/30 text-[var(--rdt)]'
                : isCompleted
                ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)] text-[var(--ok-tx)]'
                : 'bg-[var(--warn-bg)] border-[var(--warn-bd)] text-[var(--warn-tx)]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {isLive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-[var(--rdt)] animate-ping" />
                  <span>LIVE IN PROGRESS</span>
                </>
              ) : isCompleted ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>COMPLETED RESULT</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  <span>UPCOMING FIXTURE</span>
                </>
              )}
            </div>
            <span className="text-xs font-medium text-[var(--tx)]">
              {match.resultText || match.statusLabel}
            </span>
          </div>

          {/* Teams Header Scoreboard */}
          <div className="grid grid-cols-2 gap-3 bg-[var(--sf-2)] p-4 rounded-xl border border-[var(--bd)]">
            <div className="flex flex-col items-center text-center p-2 rounded-lg">
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm mb-2 bg-[var(--rds)] text-[var(--rdt)]">
                {match.team1.shortName.slice(0, 3)}
              </div>
              <span className="font-semibold text-sm text-[var(--tx)]">
                {match.team1.name}
              </span>
              <span className="text-xs text-[var(--mu)]">
                ({match.team1.shortName})
              </span>
              {match.team1Score ? (
                <div className="mt-2 tabular-nums">
                  <div className="text-xl font-bold text-[var(--tx)]">
                    {match.team1Score.runs}/{match.team1Score.wickets}
                  </div>
                  <div className="text-xs text-[var(--mu)]">
                    {match.team1Score.overs} overs (CRR: {match.team1Score.runRate})
                  </div>
                </div>
              ) : (
                <span className="text-xs text-[var(--mu)] mt-2">Yet to bat</span>
              )}
            </div>

            <div className="flex flex-col items-center text-center p-2 rounded-lg border-l border-[var(--bd)]">
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm mb-2 bg-[var(--rds)] text-[var(--rdt)]">
                {match.team2.shortName.slice(0, 3)}
              </div>
              <span className="font-semibold text-sm text-[var(--tx)]">
                {match.team2.name}
              </span>
              <span className="text-xs text-[var(--mu)]">
                ({match.team2.shortName})
              </span>
              {match.team2Score ? (
                <div className="mt-2 tabular-nums">
                  <div className="text-xl font-bold text-[var(--tx)]">
                    {match.team2Score.runs}/{match.team2Score.wickets}
                  </div>
                  <div className="text-xs text-[var(--mu)]">
                    {match.team2Score.overs} overs (CRR: {match.team2Score.runRate})
                  </div>
                </div>
              ) : (
                <span className="text-xs text-[var(--mu)] mt-2">
                  {match.status === 'upcoming' ? 'Scheduled' : 'Yet to bat'}
                </span>
              )}
            </div>
          </div>

          {/* Innings Breakdown Table */}
          {match.innings.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--mu)] uppercase tracking-wider mb-2">
                Innings Breakdown
              </h3>
              <div className="border border-[var(--bd)] rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--sf-2)] text-[var(--mu)] font-semibold border-b border-[var(--bd)]">
                    <tr>
                      <th className="py-2.5 px-3">Innings</th>
                      <th className="py-2.5 px-3">Team</th>
                      <th className="py-2.5 px-3">Score</th>
                      <th className="py-2.5 px-3">Overs</th>
                      <th className="py-2.5 px-3">Run Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)] tabular-nums text-[var(--tx)]">
                    {match.innings.map((inn, idx) => {
                      const teamName =
                        idx === 0
                          ? match.team1.shortName
                          : idx === 1
                          ? match.team2.shortName
                          : `Innings ${idx + 1}`;
                      return (
                        <tr key={idx} className="hover:bg-[var(--sf-2)]">
                          <td className="py-2.5 px-3 text-[var(--mu)]">Innings {idx + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-[var(--tx)]">{teamName}</td>
                          <td className="py-2.5 px-3 font-bold text-[var(--tx)]">
                            {inn.runs}/{inn.wickets}
                          </td>
                          <td className="py-2.5 px-3">{inn.overs}</td>
                          <td className="py-2.5 px-3 text-[var(--ok-tx)] font-semibold">{inn.runRate}</td>
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
            <div className="p-3.5 bg-[var(--sf-2)] border border-[var(--bd)] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs tabular-nums">
              <div>
                <span className="text-[var(--mu)]">Target: </span>
                <span className="font-bold text-[var(--tx)]">{match.target} runs</span>
              </div>
              {match.requiredRunRate !== undefined && (
                <div>
                  <span className="text-[var(--mu)]">Required Run Rate (RRR): </span>
                  <span className="font-bold text-[var(--warn-tx)]">
                    {match.requiredRunRate}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Win Probability */}
          {match.winProbability && (
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--mu)] mb-1.5 tabular-nums">
                <span className="font-semibold text-[var(--tx)]">
                  {match.team1.name}: {match.winProbability.team1Prob}%
                </span>
                <span className="font-medium">Win probability</span>
                <span className="font-semibold text-[var(--tx)]">
                  {match.team2.name}: {match.winProbability.team2Prob}%
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--bar)] rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[var(--rd)] transition-all"
                  style={{ width: `${match.winProbability.team1Prob}%` }}
                />
              </div>
            </div>
          )}

          {/* Venue & Fixture Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[var(--sf-2)] p-3.5 rounded-xl border border-[var(--bd)]">
            <div className="flex items-start gap-2 text-[var(--tx)]">
              <MapPin className="w-4 h-4 text-[var(--mu)] shrink-0 mt-0.5" />
              <div>
                <span className="text-[var(--mu)] block text-[11px]">Venue</span>
                <span>{match.venueName}</span>
              </div>
            </div>
            <div className="flex items-start gap-2 text-[var(--tx)]">
              <Calendar className="w-4 h-4 text-[var(--mu)] shrink-0 mt-0.5" />
              <div>
                <span className="text-[var(--mu)] block text-[11px]">Start Time</span>
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
                className="flex items-center gap-1.5 text-xs text-[var(--mu)] hover:text-[var(--tx)] font-medium"
              >
                <Code className="w-3.5 h-3.5 text-[var(--rdt)]" />
                <span>{showRaw ? 'Hide Raw Crex Node' : 'View Raw Crex Node JSON'}</span>
              </button>
              {showRaw && (
                <button
                  type="button"
                  onClick={copyJson}
                  className="flex items-center gap-1 text-[11px] text-[var(--tx)] px-2 py-1 rounded bg-[var(--sf-2)] border border-[var(--bd)]"
                >
                  {copied ? <Check className="w-3 h-3 text-[var(--ok-tx)]" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              )}
            </div>

            {showRaw && (
              <pre
                className="p-3 rounded-xl border border-[var(--bd)] text-[11px] font-mono overflow-x-auto max-h-48 leading-relaxed"
                style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-tx)' }}
              >
                {JSON.stringify(match.raw, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
