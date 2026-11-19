import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Code2,
  Play,
  Copy,
  Check,
  Download,
  Search,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { RawApiResponse } from '../types/cricket';
import { API_ENDPOINT } from '../services/cricketApi';

interface ApiInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPayload: string;
  rawData: RawApiResponse | null;
  onPayloadSend: (countryCode: string) => Promise<void>;
  isFetching: boolean;
  latencyMs: number;
}

export const ApiInspectorModal: React.FC<ApiInspectorModalProps> = ({
  isOpen,
  onClose,
  rawData,
  onPayloadSend,
  isFetching,
  latencyMs,
}) => {
  const [countryCode, setCountryCode] = useState('IN');
  const [searchKey, setSearchKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const filteredData = useMemo(() => {
    if (!rawData || !searchKey.trim()) return rawData;
    const q = searchKey.toLowerCase();
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      const matchStr = JSON.stringify(v).toLowerCase();
      if (k.toLowerCase().includes(q) || matchStr.includes(q)) {
        result[k] = v;
      }
    }
    return result;
  }, [rawData, searchKey]);

  if (!isOpen) return null;

  const handleTest = async () => {
    await onPayloadSend(countryCode);
  };

  const handleCopy = () => {
    if (!rawData) return;
    navigator.clipboard.writeText(JSON.stringify(rawData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!rawData) return;
    const blob = new Blob([JSON.stringify(rawData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crex_top_matches_${countryCode}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-[var(--sf)] border border-[var(--bd)] rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-[var(--sf)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--rds)] flex items-center justify-center text-[var(--rdt)]">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--tx)]">
                Crex API Live Inspector
              </h2>
              <p className="text-xs text-[var(--mu)]">
                Inspect raw endpoint response and test payload live
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close API Inspector"
            className="p-1.5 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg hover:bg-[var(--sf-2)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Request Config Row */}
          <div className="bg-[var(--sf-2)] p-3.5 rounded-xl border border-[var(--bd)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[var(--ok-bg)] text-[var(--ok-tx)] font-mono shrink-0">
                  POST
                </span>
                <span className="text-xs font-mono text-[var(--tx)] truncate">
                  {API_ENDPOINT}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[var(--mu)]">Country Code:</span>
                <input
                  type="text"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                  className="w-16 bg-[var(--sf)] border border-[var(--bd)] rounded-lg px-2 py-1 text-xs text-center font-mono text-[var(--tx)] focus:outline-none focus:border-[var(--rd)]"
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isFetching}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-[var(--rd)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-opacity"
                >
                  <Play className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                  <span>{isFetching ? 'Sending...' : 'Send Request'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mu)] border-t border-[var(--bd)] pt-2 font-mono">
              <span>
                Payload: <span className="text-[var(--tx)] font-semibold">{`{"cc": "${countryCode}"}`}</span>
              </span>
              <div className="flex items-center gap-3 tabular-nums">
                <span className="text-[var(--ok-tx)] flex items-center gap-1 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK
                </span>
                <span className="text-[var(--mu)] flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {latencyMs}ms
                </span>
                <span>
                  Matches: {rawData ? Object.keys(rawData).length : 0}
                </span>
              </div>
            </div>
          </div>

          {/* JSON Explorer */}
          <div className="flex-1 bg-[var(--sf-2)] border border-[var(--bd)] rounded-xl overflow-hidden flex flex-col">
            <div className="px-3.5 py-2 bg-[var(--sf)] border-b border-[var(--bd)] flex items-center justify-between gap-3 text-xs">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-[var(--mu)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                  placeholder="Filter keys or values..."
                  className="w-full bg-[var(--sf-2)] border border-[var(--bd)] rounded-lg pl-7 pr-2 py-1 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:outline-none focus:border-[var(--rd)]"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!rawData}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors disabled:opacity-50"
                  title="Download JSON file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!rawData}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors disabled:opacity-50"
                  title="Copy full JSON"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[var(--ok-tx)]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
            </div>

            <pre
              className="p-4 text-xs font-mono overflow-auto flex-1 leading-relaxed"
              style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-tx)' }}
            >
              {filteredData
                ? JSON.stringify(filteredData, null, 2)
                : '// No data loaded yet. Click "Send Request" to fetch live data.'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
