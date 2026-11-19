import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Save,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  Volume2,
  Megaphone,
  Filter,
  Eye,
} from 'lucide-react';
import {
  ALL_KNOWN_FORMATS,
  EvaluableMatchFormat,
  formatDisplayLabel,
} from '../../services/strategy/formatFilter';
import {
  fetchAdminSettings,
  previewAdminSeriesFilter,
  saveAdminSettings,
  AdminSiteSettings,
  ReadOnlyRefreshIntervals,
  SeriesPreviewResponse,
  AdminSessionExpiredError,
} from '../../services/adminApi';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminSettingsSectionProps {
  onSessionExpired: (msg?: string) => void;
}

function formatMsInterval(ms: number): string {
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export const AdminSettingsSection: React.FC<AdminSettingsSectionProps> = ({
  onSessionExpired,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [savedSettings, setSavedSettings] = useState<AdminSiteSettings | null>(null);
  const [intervals, setIntervals] = useState<ReadOnlyRefreshIntervals | null>(null);
  const [liveMatchesCount, setLiveMatchesCount] = useState<number>(0);

  // Editable form fields
  const [defaultCountryCode, setDefaultCountryCode] = useState('IN');
  const [defaultSoundEnabled, setDefaultSoundEnabled] = useState(true);
  const [allowedSeriesFilter, setAllowedSeriesFilter] = useState<string[]>([]);
  const [publicVisibleFormats, setPublicVisibleFormats] = useState<EvaluableMatchFormat[]>([]);
  const [seriesInput, setSeriesInput] = useState('');
  const [maintenanceBannerEnabled, setMaintenanceBannerEnabled] = useState(false);
  const [maintenanceBannerText, setMaintenanceBannerText] = useState('');

  // Confirm modal state for series filter impact
  const [seriesPreview, setSeriesPreview] = useState<SeriesPreviewResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetchAdminSettings();
      setSavedSettings(res.data);
      setIntervals(res.refreshIntervals);
      setLiveMatchesCount(res.liveMatchesCount ?? 0);
      setDefaultCountryCode(res.data.defaultCountryCode);
      setDefaultSoundEnabled(res.data.defaultSoundEnabled);
      setAllowedSeriesFilter(res.data.allowedSeriesFilter || []);
      setPublicVisibleFormats(res.data.publicVisibleFormats || []);
      setMaintenanceBannerEnabled(res.data.maintenanceBannerEnabled);
      setMaintenanceBannerText(res.data.maintenanceBannerText || '');
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load admin settings',
      });
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const addSeriesEntries = () => {
    const parts = seriesInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    setAllowedSeriesFilter((prev) => {
      const seen = new Set(prev.map((x) => x.toLowerCase()));
      const next = [...prev];
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) {
          seen.add(p.toLowerCase());
          next.push(p.slice(0, 120));
        }
      }
      return next;
    });
    setSeriesInput('');
  };

  const removeSeriesEntry = (entry: string) => {
    setAllowedSeriesFilter((prev) => prev.filter((item) => item !== entry));
  };

  const commitSave = async (finalFilter: string[]) => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await saveAdminSettings({
        defaultCountryCode: defaultCountryCode.trim().toUpperCase(),
        defaultSoundEnabled,
        allowedSeriesFilter: finalFilter,
        publicVisibleFormats,
        maintenanceBannerEnabled,
        maintenanceBannerText: maintenanceBannerText.trim(),
      });
      setSavedSettings(res.data);
      setIntervals(res.refreshIntervals);
      setDefaultCountryCode(res.data.defaultCountryCode);
      setDefaultSoundEnabled(res.data.defaultSoundEnabled);
      setAllowedSeriesFilter(res.data.allowedSeriesFilter);
      setPublicVisibleFormats(res.data.publicVisibleFormats || []);
      setMaintenanceBannerEnabled(res.data.maintenanceBannerEnabled);
      setMaintenanceBannerText(res.data.maintenanceBannerText);
      setSeriesPreview(null);

      const prunedNote =
        typeof res.prunedMatchesCount === 'number' && res.prunedMatchesCount > 0
          ? ` Excluded ${res.prunedMatchesCount} match${res.prunedMatchesCount === 1 ? '' : 'es'} immediately.`
          : '';
      setBanner({
        type: 'ok',
        text: `Settings saved to PostgreSQL and applied immediately without restart.${prunedNote}`,
      });
    } catch (err: unknown) {
      setSeriesPreview(null);
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);

    const cc = defaultCountryCode.trim().toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(cc)) {
      setBanner({
        type: 'error',
        text: 'Default country code must be 2 to 6 letters (for example IN, AU, GB).',
      });
      return;
    }

    // Merge any pending text left in the series input box before previewing/saving
    let candidateFilter = [...allowedSeriesFilter];
    if (seriesInput.trim()) {
      const extra = seriesInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set(candidateFilter.map((x) => x.toLowerCase()));
      for (const p of extra) {
        if (!seen.has(p.toLowerCase())) {
          seen.add(p.toLowerCase());
          candidateFilter.push(p.slice(0, 120));
        }
      }
      setAllowedSeriesFilter(candidateFilter);
      setSeriesInput('');
    }

    const prevFilter = savedSettings?.allowedSeriesFilter || [];
    const seriesChanged =
      JSON.stringify(prevFilter.map((s) => s.toLowerCase())) !==
      JSON.stringify(candidateFilter.map((s) => s.toLowerCase()));

    if (seriesChanged) {
      setSaving(true);
      try {
        const preview = await previewAdminSeriesFilter(candidateFilter);
        setSeriesPreview(preview);
      } catch (err: unknown) {
        if (err instanceof AdminSessionExpiredError) {
          onSessionExpired(err.message);
          return;
        }
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to preview series filter impact',
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    await commitSave(candidateFilter);
  };

  const buildPreviewDescription = (preview: SeriesPreviewResponse): string => {
    if (preview.allowedSeriesFilter.length === 0) {
      return `Clearing the allowed series filter will allow ALL live tournaments (currently ${preview.totalLive} live match${preview.totalLive === 1 ? '' : 'es'} tracked). No live matches will be excluded.`;
    }
    if (preview.excludedLive.length === 0) {
      return `Filter [${preview.allowedSeriesFilter.join(', ')}] will take effect immediately without restart. 0 currently live matches (out of ${preview.totalLive}) would be excluded.`;
    }
    return `Filter [${preview.allowedSeriesFilter.join(', ')}] will take effect immediately without restart and exclude ${preview.excludedLive.length} of ${preview.totalLive} currently live match${preview.totalLive === 1 ? '' : 'es'} listed below:`;
  };

  const buildPreviewListText = (preview: SeriesPreviewResponse): string | undefined => {
    if (preview.excludedLive.length === 0) return undefined;
    return preview.excludedLive
      .map((m) => `• ${m.title} (${m.format}) — ${m.seriesName} [${m.id}]`)
      .join('\n');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">Site &amp; Feed Settings</h2>
          <p className="text-xs text-[var(--mu)]">
            Public defaults, live allowed series filter, maintenance banner, and server polling intervals.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-[var(--sf)] hover:bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          <span>Refresh</span>
        </button>
      </div>

      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            banner.type === 'ok'
              ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)] text-[var(--ok-tx)]'
              : 'bg-[var(--rds)] border-[var(--rd)]/35 text-[var(--rdt)]'
          }`}
        >
          {banner.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Public Visitor Defaults */}
        <section
          className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-[var(--tx)]">Public Visitor Defaults</h3>
          </div>
          <p className="text-xs text-[var(--mu)]">
            Served via <code className="font-mono">GET /api/public/config</code>. Applied to public visitors unless they override the setting locally in their browser.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-default-cc"
                className="block text-xs font-semibold text-[var(--tx)]"
              >
                Default Country Code
              </label>
              <input
                id="admin-default-cc"
                type="text"
                maxLength={6}
                value={defaultCountryCode}
                onChange={(e) => setDefaultCountryCode(e.target.value.toUpperCase())}
                placeholder="IN"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono uppercase text-[var(--tx)] focus:border-[var(--rd)]"
              />
              <p className="text-[11px] text-[var(--mu)]">
                2–6 letter feed region code (e.g. IN, AU, GB, AE).
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Volume2 className="w-4 h-4 text-[var(--mu)] mt-0.5 shrink-0" strokeWidth={1.8} />
                <div>
                  <div className="text-xs font-semibold text-[var(--tx)]">Default Sound Alerts</div>
                  <p className="text-[11px] text-[var(--mu)] mt-0.5">
                    Initial sound state for new visitors (boundaries &amp; wickets).
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={defaultSoundEnabled}
                aria-label="Default sound setting"
                onClick={() => setDefaultSoundEnabled((v) => !v)}
                className={`min-h-[44px] min-w-[64px] px-3 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                  defaultSoundEnabled
                    ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                    : 'bg-[var(--sf)] text-[var(--mu)] border-[var(--bd)]'
                }`}
              >
                {defaultSoundEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </section>

        {/* Allowed Series Filter */}
        <section
          className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
              <h3 className="text-sm font-bold text-[var(--tx)]">Allowed Series Filter</h3>
            </div>
            <span className="text-[11px] font-semibold text-[var(--mu)] tabular-nums">
              {liveMatchesCount} live match{liveMatchesCount === 1 ? '' : 'es'} currently tracked
            </span>
          </div>
          <p className="text-xs text-[var(--mu)]">
            Restricts server match ingestion, SSE stream, and alerts to matching series names or keys (case-insensitive substring match). Leave empty to allow all live series. Saving changes previews which live matches would be excluded before applying.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="admin-series-input"
              type="text"
              value={seriesInput}
              onChange={(e) => setSeriesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSeriesEntries();
                }
              }}
              placeholder="Add series name or key (e.g. IPL, Big Bash, 2KG)..."
              aria-label="Add allowed series entry"
              className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs text-[var(--tx)] focus:border-[var(--rd)]"
            />
            <button
              type="button"
              onClick={addSeriesEntries}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--bd)]/35 border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              <span>Add Series</span>
            </button>
          </div>

          {allowedSeriesFilter.length === 0 ? (
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-dashed border-[var(--bd)] text-xs text-[var(--mu)]">
              No series restrictions active — all live tournaments are allowed.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {allowedSeriesFilter.map((entry) => (
                  <span
                    key={entry}
                    className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)]"
                  >
                    <span>{entry}</span>
                    <button
                      type="button"
                      onClick={() => removeSeriesEntry(entry)}
                      aria-label={`Remove ${entry}`}
                      className="w-7 h-7 rounded-lg hover:bg-[var(--rds)] hover:text-[var(--rdt)] text-[var(--mu)] inline-flex items-center justify-center transition-colors"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAllowedSeriesFilter([])}
                className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-[var(--rdt)] hover:bg-[var(--rds)] transition-colors"
              >
                Clear all filters (allow all series)
              </button>
            </div>
          )}
        </section>

        {/* Formats Shown to Visitors */}
        <section
          className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3.5"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
              <h3 className="text-sm font-bold text-[var(--tx)]">Formats Shown to Visitors</h3>
            </div>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)]">
              {publicVisibleFormats.length === 0
                ? 'All server-tracked formats'
                : publicVisibleFormats.map(formatDisplayLabel).join(', ')}
            </span>
          </div>
          <p className="text-xs text-[var(--mu)]">
            Optional display filter served via <code className="font-mono">GET /api/public/config</code>. Leave all unchecked to show every format the server tracks (default). Does not stop server timeline tracking or change strategy format rules.
          </p>

          <div className="flex flex-wrap gap-2">
            {ALL_KNOWN_FORMATS.map((fmt) => {
              const checked = publicVisibleFormats.includes(fmt);
              return (
                <label
                  key={fmt}
                  className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
                    checked
                      ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                      : 'bg-[var(--sf-2)] text-[var(--mu)] border-[var(--bd)] hover:text-[var(--tx)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setPublicVisibleFormats((prev) =>
                        prev.includes(fmt)
                          ? prev.filter((item) => item !== fmt)
                          : [...prev, fmt]
                      );
                    }}
                    className="w-4 h-4 accent-[var(--rd)]"
                  />
                  <span>{formatDisplayLabel(fmt)}</span>
                </label>
              );
            })}
          </div>

          {publicVisibleFormats.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setPublicVisibleFormats([])}
                className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-[var(--rdt)] hover:bg-[var(--rds)] transition-colors"
              >
                Show all server-tracked formats (default)
              </button>
            </div>
          )}
        </section>

        {/* Maintenance Banner */}
        <section
          className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-[var(--warn-tx)]" strokeWidth={1.8} />
              <div>
                <h3 className="text-sm font-bold text-[var(--tx)]">Public Maintenance Banner</h3>
                <p className="text-[11px] text-[var(--mu)]">
                  Displayed across the top of all public visitor screens when enabled.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={maintenanceBannerEnabled}
              aria-label="Enable maintenance banner"
              onClick={() => setMaintenanceBannerEnabled((v) => !v)}
              className={`min-h-[44px] min-w-[72px] px-3.5 rounded-xl text-xs font-bold border transition-colors ${
                maintenanceBannerEnabled
                  ? 'bg-[var(--warn-bg)] text-[var(--warn-tx)] border-[var(--warn-bd)]'
                  : 'bg-[var(--sf-2)] text-[var(--mu)] border-[var(--bd)]'
              }`}
            >
              {maintenanceBannerEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="admin-maintenance-text"
              className="block text-xs font-semibold text-[var(--tx)]"
            >
              Banner Message
            </label>
            <textarea
              id="admin-maintenance-text"
              rows={2}
              maxLength={500}
              value={maintenanceBannerText}
              onChange={(e) => setMaintenanceBannerText(e.target.value)}
              placeholder="e.g. Scheduled odds provider maintenance at 18:00 UTC. Live scores remain active."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs text-[var(--tx)] focus:border-[var(--rd)] resize-y"
            />
            <div className="flex items-center justify-between text-[11px] text-[var(--mu)] tabular-nums">
              <span>Plain text only (max 500 characters).</span>
              <span>{maintenanceBannerText.length} / 500</span>
            </div>
          </div>

          {maintenanceBannerEnabled && maintenanceBannerText.trim() && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-[var(--mu)]">Live Visitor Preview</div>
              <div className="p-3 rounded-xl bg-[var(--warn-bg)] border border-[var(--warn-bd)] text-[var(--warn-tx)] text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                <span>{maintenanceBannerText.trim()}</span>
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || loading}
            className="min-h-[44px] px-5 rounded-xl bg-[var(--rd)] hover:opacity-90 text-white text-xs font-semibold inline-flex items-center gap-2 transition-opacity disabled:opacity-45"
          >
            <Save className="w-4 h-4" strokeWidth={1.8} />
            <span>{saving ? 'Checking & Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>

      {/* Read-Only Refresh Intervals */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--mu)]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-[var(--tx)]">Server Refresh Intervals (Read-Only)</h3>
          </div>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)]">
            Server-Controlled
          </span>
        </div>

        {intervals && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs tabular-nums">
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Goscorer Feed</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                {formatMsInterval(intervals.goscorerPollMs)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Crex Match Pool</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                {formatMsInterval(intervals.crexPoolPollMs)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Live Odds Poll</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                {formatMsInterval(intervals.oddsPollMs)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Timeline Persist</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                {formatMsInterval(intervals.timelineSaveMs)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">DB Config Sync</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                {formatMsInterval(intervals.telegramConfigSyncMs)}
              </div>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={seriesPreview !== null}
        title="Confirm Allowed Series Filter Change"
        description={seriesPreview ? buildPreviewDescription(seriesPreview) : ''}
        previewText={seriesPreview ? buildPreviewListText(seriesPreview) : undefined}
        confirmLabel="Apply Series Filter"
        danger={Boolean(seriesPreview && seriesPreview.excludedLive.length > 0)}
        busy={saving}
        onConfirm={() => {
          if (seriesPreview) {
            void commitSave(seriesPreview.allowedSeriesFilter);
          }
        }}
        onCancel={() => setSeriesPreview(null)}
      />
    </div>
  );
};
