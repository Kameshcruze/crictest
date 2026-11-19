/**
 * Canonical Match Format Classification & Filtering
 *
 * Used across server ingestion, strategy evaluation, admin diagnostics,
 * public format filtering, and Entry Radar so every layer agrees on the
 * exact detected format of a match.
 */

export type CanonicalMatchFormat = 'T10' | 'T20' | 'ODI' | 'TEST' | 'HUNDRED' | 'UNKNOWN';
export type EvaluableMatchFormat = Exclude<CanonicalMatchFormat, 'UNKNOWN'>;

export const ALL_KNOWN_FORMATS: readonly EvaluableMatchFormat[] = [
  'T10',
  'T20',
  'ODI',
  'TEST',
  'HUNDRED',
] as const;

export const DEFAULT_STRATEGY_ALLOWED_FORMATS: readonly EvaluableMatchFormat[] = [
  'T10',
  'T20',
] as const;

const KNOWN_FORMAT_SET = new Set<string>(ALL_KNOWN_FORMATS);

function normalizeSingleValue(val: unknown): CanonicalMatchFormat {
  if (val === null || val === undefined) return 'UNKNOWN';
  // Crex/Goscorer frequently sends raw.t = 0 or epoch timestamps; numbers are never valid formats.
  if (typeof val === 'number' || typeof val === 'boolean') return 'UNKNOWN';

  const trimmed = String(val).trim();
  if (!trimmed) return 'UNKNOWN';

  // Pure numeric strings (e.g. "0", "1", "1730000000") are not formats.
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return 'UNKNOWN';

  const lower = trimmed.toLowerCase();
  if (lower === 'match' || lower === 'unknown' || lower === 'n/a' || lower === '-' || lower === 'none') {
    return 'UNKNOWN';
  }

  // 1. T10 (must check before T20/ODI/Test)
  if (
    /^(?:w?t[-\s]?10i?|ten10|10[-\s]?overs?)$/i.test(trimmed) ||
    /\b(?:w?t[-\s]?10i?)\b/i.test(trimmed)
  ) {
    return 'T10';
  }

  // 2. T20 (T20, T20I, WT20, WT20I, T-20, Twenty20, etc.)
  if (
    /^(?:w?t[-\s]?20i?|twenty[-\s]?20|20[-\s]?overs?)$/i.test(trimmed) ||
    /\b(?:w?t[-\s]?20i?|twenty[-\s]?20)\b/i.test(trimmed)
  ) {
    return 'T20';
  }

  // 3. The Hundred / 100-ball
  if (/\b(?:hundred|100[-\s]?ball)\b/i.test(trimmed)) {
    return 'HUNDRED';
  }

  // 4. ODI / One Day / List A (Crex commonly sends "One Day")
  if (
    /^(?:w?odi|odis?|one[-\s]?day(?:\s+international)?|list[-\s]?a|50[-\s]?overs?)$/i.test(trimmed) ||
    /\b(?:w?odi|one[-\s]?day|list[-\s]?a)\b/i.test(trimmed)
  ) {
    return 'ODI';
  }

  // 5. Test / First Class / Multi-day
  if (
    /^(?:w?tests?|test\s+match|first[-\s]?class|fc|4[-\s]?day|5[-\s]?day|multi[-\s]?day)$/i.test(trimmed) ||
    /\b(?:w?tests?|first[-\s]?class|4[-\s]?day|5[-\s]?day)\b/i.test(trimmed)
  ) {
    return 'TEST';
  }

  return 'UNKNOWN';
}

/**
 * Classifies a match's format from raw.fo (primary) and optional raw.t (fallback).
 * Never treats missing, empty, "Match", or numeric values (such as raw.t = 0) as evaluable.
 */
export function normalizeMatchFormat(
  rawFo?: unknown,
  rawT?: unknown
): CanonicalMatchFormat {
  const fromFo = normalizeSingleValue(rawFo);
  if (fromFo !== 'UNKNOWN') return fromFo;
  if (rawT !== undefined) {
    return normalizeSingleValue(rawT);
  }
  return 'UNKNOWN';
}

/**
 * Sanitizes an array of canonical evaluable formats (deduplicated, canonical uppercase).
 * Falls back to `fallback` when input is not an array.
 */
export function sanitizeCanonicalFormatList(
  raw: unknown,
  fallback: readonly EvaluableMatchFormat[] = DEFAULT_STRATEGY_ALLOWED_FORMATS
): EvaluableMatchFormat[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<EvaluableMatchFormat>();
  const out: EvaluableMatchFormat[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const upper = item.trim().toUpperCase();
    let canonical: CanonicalMatchFormat = KNOWN_FORMAT_SET.has(upper)
      ? (upper as EvaluableMatchFormat)
      : normalizeSingleValue(item);
    if (canonical !== 'UNKNOWN' && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

/**
 * Returns true ONLY if the match's detected format is known and present in `allowedFormats`.
 * Missing/UNKNOWN formats ALWAYS return false.
 */
export function isFormatAllowedForStrategy(
  rawFoOrFormat: unknown,
  allowedFormats: readonly EvaluableMatchFormat[] = DEFAULT_STRATEGY_ALLOWED_FORMATS,
  rawT?: unknown
): boolean {
  const detected = normalizeMatchFormat(rawFoOrFormat, rawT);
  if (detected === 'UNKNOWN') return false;
  return allowedFormats.includes(detected);
}

/**
 * Returns true if a match should be visible to public visitors under `publicVisibleFormats`.
 * Empty `publicVisibleFormats` means show everything the server tracks (default).
 */
export function isFormatVisibleToPublic(
  rawFoOrFormat: unknown,
  publicVisibleFormats: readonly EvaluableMatchFormat[] = [],
  rawT?: unknown
): boolean {
  if (!publicVisibleFormats || publicVisibleFormats.length === 0) return true;
  const detected = normalizeMatchFormat(rawFoOrFormat, rawT);
  if (detected === 'UNKNOWN') return false;
  return publicVisibleFormats.includes(detected);
}

export function formatDisplayLabel(fmt: CanonicalMatchFormat): string {
  switch (fmt) {
    case 'T10':
      return 'T10';
    case 'T20':
      return 'T20';
    case 'ODI':
      return 'ODI';
    case 'TEST':
      return 'Test';
    case 'HUNDRED':
      return 'Hundred';
    default:
      return 'Unknown';
  }
}
