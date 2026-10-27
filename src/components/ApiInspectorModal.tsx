import React, { useState, useMemo } from 'react';
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

  // Filter raw data keys if user searches
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Crex API Live Inspector
              </h2>
              <p className="text-xs text-slate-400">
                Inspect raw endpoint response and test payload live
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

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Request Config Row */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 font-mono">
                  POST
                </span>
                <span className="text-xs font-mono text-slate-300 truncate">
                  {API_ENDPOINT}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Country Code:</span>
                <input
                  type="text"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-center font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isFetching}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded transition-colors"
                >
                  <Play className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                  <span>{isFetching ? 'Sending...' : 'Send Request'}</span>
                </button>
              </div>
            </div>

            {/* Request Payload Display */}
            <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-2 font-mono">
              <span>
                Payload: <span className="text-emerald-400">{`{"cc": "${countryCode}"}`}</span>
              </span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK
                </span>
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {latencyMs}ms
                </span>
                <span>
                  Matches: {rawData ? Object.keys(rawData).length : 0}
                </span>
              </div>
            </div>
          </div>

          {/* JSON Explorer */}
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            {/* Toolbar */}
            <div className="px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-3 text-xs">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                  placeholder="Filter keys or values..."
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!rawData}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                  title="Download JSON file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!rawData}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                  title="Copy full JSON"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
            </div>

            {/* JSON Code Viewer */}
            <pre className="p-4 text-xs font-mono text-emerald-300/90 overflow-auto flex-1 leading-relaxed selection:bg-emerald-900/40">
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
