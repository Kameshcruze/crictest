import { TeamInfo } from '../types/cricket';

// Known teams mapping from Crex cricket data
export const KNOWN_TEAMS: Record<string, TeamInfo> = {
  // International Men's Teams
  'O': { key: 'O', name: 'India', shortName: 'IND', color: '#1d4ed8', textColor: '#ffffff', darkColor: '#1e3a8a' },
  'Q': { key: 'Q', name: 'Australia', shortName: 'AUS', color: '#eab308', textColor: '#0f172a', darkColor: '#713f12' },
  'R': { key: 'R', name: 'New Zealand', shortName: 'NZ', color: '#1e293b', textColor: '#ffffff', darkColor: '#0f172a' },
  'P': { key: 'P', name: 'South Africa', shortName: 'SA', color: '#15803d', textColor: '#ffffff', darkColor: '#14532d' },
  'U': { key: 'U', name: 'Pakistan', shortName: 'PAK', color: '#047857', textColor: '#ffffff', darkColor: '#064e3b' },
  'T': { key: 'T', name: 'Sri Lanka', shortName: 'SL', color: '#1e40af', textColor: '#ffffff', darkColor: '#172554' },
  'W': { key: 'W', name: 'Bangladesh', shortName: 'BAN', color: '#166534', textColor: '#ffffff', darkColor: '#14532d' },
  'V': { key: 'V', name: 'West Indies', shortName: 'WI', color: '#881337', textColor: '#ffffff', darkColor: '#4c0519' },
  'Y': { key: 'Y', name: 'Afghanistan', shortName: 'AFG', color: '#2563eb', textColor: '#ffffff', darkColor: '#1e3a8a' },
  'X': { key: 'X', name: 'Zimbabwe', shortName: 'ZIM', color: '#dc2626', textColor: '#ffffff', darkColor: '#7f1d1d' },
  'Z': { key: 'Z', name: 'Ireland', shortName: 'IRE', color: '#16a34a', textColor: '#ffffff', darkColor: '#14532d' },
  '12': { key: '12', name: 'Netherlands', shortName: 'NED', color: '#ea580c', textColor: '#ffffff', darkColor: '#7c2d12' },
  '6X': { key: '6X', name: 'Namibia', shortName: 'NAM', color: '#0284c7', textColor: '#ffffff', darkColor: '#0c4a6e' },
  '15': { key: '15', name: 'Oman', shortName: 'OMA', color: '#e11d48', textColor: '#ffffff', darkColor: '#881337' },
  '8X': { key: '8X', name: 'Papua New Guinea', shortName: 'PNG', color: '#ca8a04', textColor: '#ffffff', darkColor: '#713f12' },
  'CB': { key: 'CB', name: 'Qatar', shortName: 'QAT', color: '#9d174d', textColor: '#ffffff', darkColor: '#700732' },
  'N': { key: 'N', name: 'England', shortName: 'ENG', color: '#0284c7', textColor: '#ffffff', darkColor: '#0c4a6e' },
  'NP': { key: 'NP', name: 'Nepal', shortName: 'NEP', color: '#dc2626', textColor: '#ffffff', darkColor: '#7f1d1d' },
  'SC': { key: 'SC', name: 'Scotland', shortName: 'SCO', color: '#3b82f6', textColor: '#ffffff', darkColor: '#1e3a8a' },
  'US': { key: 'US', name: 'United States', shortName: 'USA', color: '#2563eb', textColor: '#ffffff', darkColor: '#1e3a8a' },
  'CA': { key: 'CA', name: 'Canada', shortName: 'CAN', color: '#ef4444', textColor: '#ffffff', darkColor: '#991b1b' },
  'UA': { key: 'UA', name: 'United Arab Emirates', shortName: 'UAE', color: '#64748b', textColor: '#ffffff', darkColor: '#334155' },

  // Women's Teams
  '16': { key: '16', name: 'India Women', shortName: 'IND-W', color: '#2563eb', textColor: '#ffffff', darkColor: '#1d4ed8' },
  '6I': { key: '6I', name: 'Zimbabwe Women', shortName: 'ZIM-W', color: '#b91c1c', textColor: '#ffffff', darkColor: '#7f1d1d' },
  '7Q': { key: '7Q', name: 'Australia Women', shortName: 'AUS-W', color: '#eab308', textColor: '#0f172a', darkColor: '#713f12' },
  '7N': { key: '7N', name: 'England Women', shortName: 'ENG-W', color: '#0284c7', textColor: '#ffffff', darkColor: '#0c4a6e' },
  '7P': { key: '7P', name: 'South Africa Women', shortName: 'SA-W', color: '#15803d', textColor: '#ffffff', darkColor: '#14532d' },
  '7R': { key: '7R', name: 'New Zealand Women', shortName: 'NZ-W', color: '#334155', textColor: '#ffffff', darkColor: '#0f172a' },

  // A Teams
  '6S': { key: '6S', name: 'India A', shortName: 'IND-A', color: '#3b82f6', textColor: '#ffffff', darkColor: '#1e40af' },
  'M1': { key: 'M1', name: 'New Zealand A', shortName: 'NZ-A', color: '#475569', textColor: '#ffffff', darkColor: '#1e293b' },
  '6Q': { key: '6Q', name: 'Australia A', shortName: 'AUS-A', color: '#facc15', textColor: '#0f172a', darkColor: '#854d0e' },
  '6N': { key: '6N', name: 'England Lions', shortName: 'ENG-A', color: '#38bdf8', textColor: '#0f172a', darkColor: '#0369a1' },

  // Nepal Premier League
  'ZY': { key: 'ZY', name: 'Sudurpaschim Royals', shortName: 'SPR', color: '#6366f1', textColor: '#ffffff', darkColor: '#3730a3' },
  'PS': { key: 'PS', name: 'Lumbini Lions', shortName: 'LBL', color: '#f97316', textColor: '#ffffff', darkColor: '#9a3412' },
  'ZV': { key: 'ZV', name: 'Chitwan Rhinos', shortName: 'CWR', color: '#ea580c', textColor: '#ffffff', darkColor: '#7c2d12' },
  'PU': { key: 'PU', name: 'Biratnagar Kings', shortName: 'BK', color: '#0284c7', textColor: '#ffffff', darkColor: '#075985' },
  'ZW': { key: 'ZW', name: 'Karnali Yaks', shortName: 'KNY', color: '#8b5cf6', textColor: '#ffffff', darkColor: '#5b21b6' },
  'PV': { key: 'PV', name: 'Janakpur Bolts', shortName: 'JKB', color: '#ec4899', textColor: '#ffffff', darkColor: '#9d174d' },

  // Global T20 Canada & Emirates D20
  'DD': { key: 'DD', name: 'Emirates Blues', shortName: 'EMB', color: '#3b82f6', textColor: '#ffffff', darkColor: '#1d4ed8' },
  'DG': { key: 'DG', name: 'Sharjah', shortName: 'SHA', color: '#f97316', textColor: '#ffffff', darkColor: '#c2410c' },
  '2K': { key: '2K', name: 'Montreal Warriors', shortName: 'MW', color: '#06b6d4', textColor: '#ffffff', darkColor: '#0e7490' },
  '2I': { key: '2I', name: 'Toronto Kings', shortName: 'TK', color: '#eab308', textColor: '#0f172a', darkColor: '#a16207' },
  'RC': { key: 'RC', name: 'Mississauga Skyhawks', shortName: 'MS', color: '#0284c7', textColor: '#ffffff', darkColor: '#0369a1' },
  '6P': { key: '6P', name: 'Brampton Blazers', shortName: 'BB', color: '#d97706', textColor: '#ffffff', darkColor: '#78350f' },
};

// Known Venues mapping
export const KNOWN_VENUES: Record<string, string> = {
  'A3': 'Kotambi Stadium, Vadodara',
  '4D': 'Newlands, Cape Town',
  '6B': 'Basin Reserve / Wellington',
  '29': 'Gaddafi Stadium, Lahore',
  'BH': 'Bert Sutcliffe Oval, Lincoln',
  '64': 'Sher-e-Bangla Stadium, Mirpur, Dhaka',
  '6U': 'Sharjah Cricket Stadium, UAE',
  'B0': 'Tribhuvan University Ground, Kirtipur',
  'JS': 'HPC Oval, Windhoek, Namibia',
  '34': 'Gymkhana Club Ground, Nairobi',
  '70': 'ICC Academy, Dubai',
  'GR': 'Karwan Cricket Ground, Ajman',
  '38': 'Arnos Vale Stadium, Kingstown',
  'MC': 'Melbourne Cricket Ground (MCG)',
  'SCG': 'Sydney Cricket Ground',
  'LD': 'Lord\'s Cricket Ground, London',
  'OV': 'The Oval, London',
  'ED': 'Eden Gardens, Kolkata',
  'WS': 'Wankhede Stadium, Mumbai',
  'CH': 'M. Chinnaswamy Stadium, Bengaluru',
  'AH': 'Narendra Modi Stadium, Ahmedabad',
};

// Known Series mapping
export const KNOWN_SERIES: Record<string, string> = {
  '2I5': 'Zimbabwe Women tour of India 2026',
  '2EW': 'Australia tour of South Africa 2026',
  '2GR': 'India tour of New Zealand 2026',
  '2M3': 'ODI Tri Series in Pakistan 2026',
  '2MF': 'India A tour of New Zealand 2026',
  '2BJ': 'West Indies tour of Bangladesh 2026',
  '2MO': 'Afghanistan vs Zimbabwe in UAE 2026',
  '2LV': 'Nepal Premier League 2026',
  '2NU': 'Ireland tour of Namibia 2026',
  '1WE': 'ICC CWC Challenge League A 2024-26',
  '1JK': 'ICC CWC League 2 2023-27',
  '2O6': 'Emirates D20 League 2026',
  '2O5': 'Global T20 Canada 2026',
  '2MT': 'CSA Pro T20 Cup 2026',
  '2KM': 'Sheffield Shield 2026-27',
  '2NS': 'Bangladesh National League 2026',
  '2MV': 'Ranji Trophy Elite 2026-27',
  '2MW': 'Ranji Trophy Plate 2026-27',
};

// Generate deterministic pleasant color for unknown team codes
function getDeterministicColor(str: string): { color: string; darkColor: string } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [200, 220, 160, 280, 340, 25, 45, 180, 260];
  const hue = hues[Math.abs(hash) % hues.length];
  return {
    color: `hsl(${hue}, 70%, 45%)`,
    darkColor: `hsl(${hue}, 80%, 25%)`
  };
}

export function resolveTeam(key: string | undefined): TeamInfo {
  if (!key) {
    return {
      key: 'UNK',
      name: 'Team TBA',
      shortName: 'TBA',
      color: '#64748b',
      textColor: '#ffffff',
      darkColor: '#334155'
    };
  }

  // Check known map
  const cleanKey = key.replace(/^[\^&$#]+/, '');
  if (KNOWN_TEAMS[key]) return KNOWN_TEAMS[key];
  if (KNOWN_TEAMS[cleanKey]) return KNOWN_TEAMS[cleanKey];

  // Try uppercase or trimmed
  const upper = cleanKey.toUpperCase();
  if (KNOWN_TEAMS[upper]) return KNOWN_TEAMS[upper];

  // Fallback with clean deterministic shortName and palette
  const { color, darkColor } = getDeterministicColor(cleanKey);
  return {
    key: cleanKey,
    name: `Team ${cleanKey}`,
    shortName: cleanKey.length > 5 ? cleanKey.slice(0, 4).toUpperCase() : cleanKey.toUpperCase(),
    color,
    textColor: '#ffffff',
    darkColor
  };
}

export function resolveVenue(key: string | undefined): string {
  if (!key) return 'Cricket Ground';
  const cleanKey = key.replace(/^[\^&$#]+/, '');
  return KNOWN_VENUES[key] || KNOWN_VENUES[cleanKey] || `Venue ${cleanKey}`;
}

export function resolveSeries(key: string | undefined): string {
  if (!key) return 'Cricket Series';
  const cleanKey = key.replace(/^[\^&$#]+/, '');
  return KNOWN_SERIES[key] || KNOWN_SERIES[cleanKey] || `International Tour ${cleanKey}`;
}
