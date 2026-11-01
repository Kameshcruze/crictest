import { TeamInfo } from '../types/cricket';

// Generate deterministic pleasant color for unknown team codes
export function getDeterministicColor(str: string): { color: string; darkColor: string } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [200, 220, 160, 280, 340, 25, 45, 180, 260];
  const hue = hues[Math.abs(hash) % hues.length];
  return {
    color: `hsl(${hue}, 70%, 45%)`,
    darkColor: `hsl(${hue}, 80%, 25%)`,
  };
}

// Known teams mapping from Crex cricket data & official tournaments
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
  '11': { key: '11', name: 'United Arab Emirates', shortName: 'UAE', color: '#cc7a25', textColor: '#ffffff', darkColor: '#a1152b' },
  'UA': { key: 'UA', name: 'United Arab Emirates', shortName: 'UAE', color: '#cc7a25', textColor: '#ffffff', darkColor: '#a1152b' },
  '6V': { key: '6V', name: 'Kenya', shortName: 'KEN', color: '#b3b3b3', textColor: '#0f172a', darkColor: '#5e5e5e' },
  'UG': { key: 'UG', name: 'Uganda', shortName: 'UGA', color: '#eab308', textColor: '#0f172a', darkColor: '#713f12' },

  // Women's Big Bash League (WBBL)
  '50': { key: '50', name: 'Sydney Sixers Women', shortName: 'SYS-W', color: '#d90583', textColor: '#ffffff', darkColor: '#a61e6f' },
  '4T': { key: '4T', name: 'Hobart Hurricanes Women', shortName: 'HBH-W', color: '#5c3592', textColor: '#ffffff', darkColor: '#442282' },
  '4S': { key: '4S', name: 'Brisbane Heat Women', shortName: 'BH-W', color: '#0197a1', textColor: '#ffffff', darkColor: '#02636a' },
  '8W': { key: '8W', name: 'Sydney Thunder Women', shortName: 'SYT-W', color: '#a8c44c', textColor: '#0f172a', darkColor: '#5d7a29' },
  '4V': { key: '4V', name: 'Melbourne Renegades Women', shortName: 'MLR-W', color: '#d7102b', textColor: '#ffffff', darkColor: '#781724' },
  '4X': { key: '4X', name: 'Perth Scorchers Women', shortName: 'PRS-W', color: '#f64e06', textColor: '#ffffff', darkColor: '#f6b220' },
  '4W': { key: '4W', name: 'Melbourne Stars Women', shortName: 'MLS-W', color: '#35a552', textColor: '#ffffff', darkColor: '#0d5f23' },
  '4U': { key: '4U', name: 'Adelaide Strikers Women', shortName: 'AS-W', color: '#0090d4', textColor: '#ffffff', darkColor: '#004770' },

  // Big Bash League (BBL) Men's Teams
  '21': { key: '21', name: 'Hobart Hurricanes', shortName: 'HUR', color: '#5c3592', textColor: '#ffffff', darkColor: '#442282' },
  '22': { key: '22', name: 'Adelaide Strikers', shortName: 'STR', color: '#0090d4', textColor: '#ffffff', darkColor: '#004770' },
  '23': { key: '23', name: 'Sydney Thunder', shortName: 'THU', color: '#a8c44c', textColor: '#0f172a', darkColor: '#5d7a29' },
  '24': { key: '24', name: 'Sydney Sixers', shortName: 'SIX', color: '#d90583', textColor: '#ffffff', darkColor: '#a61e6f' },
  '25': { key: '25', name: 'Brisbane Heat', shortName: 'HEA', color: '#0197a1', textColor: '#ffffff', darkColor: '#02636a' },
  '26': { key: '26', name: 'Melbourne Renegades', shortName: 'REN', color: '#d7102b', textColor: '#ffffff', darkColor: '#781724' },
  '27': { key: '27', name: 'Melbourne Stars', shortName: 'STA', color: '#35a552', textColor: '#ffffff', darkColor: '#0d5f23' },
  '28': { key: '28', name: 'Perth Scorchers', shortName: 'SCO', color: '#f64e06', textColor: '#ffffff', darkColor: '#f6b220' },

  // Hong Kong Sixes
  '1DP': { key: '1DP', name: 'Australia Sixes', shortName: 'AUS-S', color: '#35a552', textColor: '#ffffff', darkColor: '#0d5f23' },
  '1DM': { key: '1DM', name: 'Afghanistan Sixes', shortName: 'AFG-S', color: '#5c99ea', textColor: '#ffffff', darkColor: '#375d8f' },
  '1DS': { key: '1DS', name: 'India Sixes', shortName: 'IND-S', color: '#3f71be', textColor: '#ffffff', darkColor: '#254b85' },
  '1DT': { key: '1DT', name: 'Pakistan Sixes', shortName: 'PAK-S', color: '#01984b', textColor: '#ffffff', darkColor: '#01572b' },
  '1DV': { key: '1DV', name: 'Bangladesh Sixes', shortName: 'BAN-S', color: '#b75a0e', textColor: '#ffffff', darkColor: '#3e4d1c' },
  '1DX': { key: '1DX', name: 'Hong Kong Sixes', shortName: 'HK-S', color: '#c83d33', textColor: '#ffffff', darkColor: '#2b3237' },
  '1DW': { key: '1DW', name: 'Sri Lanka Sixes', shortName: 'SL-S', color: '#3b5fb9', textColor: '#ffffff', darkColor: '#213c7f' },
  '1LQ': { key: '1LQ', name: 'Scotland Sixes', shortName: 'SCO-S', color: '#34669f', textColor: '#ffffff', darkColor: '#00244d' },
  '1DR': { key: '1DR', name: 'United Arab Emirates Sixes', shortName: 'UAE-S', color: '#cc7a25', textColor: '#ffffff', darkColor: '#a1152b' },
  '1LP': { key: '1LP', name: 'Oman Sixes', shortName: 'OMA-S', color: '#c63226', textColor: '#ffffff', darkColor: '#911d1d' },
  '1DQ': { key: '1DQ', name: 'England Sixes', shortName: 'ENG-S', color: '#4662ac', textColor: '#ffffff', darkColor: '#213365' },
  '1DO': { key: '1DO', name: 'South Africa Sixes', shortName: 'SA-S', color: '#30af6a', textColor: '#ffffff', darkColor: '#156c3d' },

  // South Africa Domestic (CSA Pro T20 Cup)
  'JF': { key: 'JF', name: 'Eastern Storm', shortName: 'ES', color: '#2251e3', textColor: '#ffffff', darkColor: '#0d2480' },
  'J9': { key: 'J9', name: 'Garden Route Badgers', shortName: 'GRB', color: '#7dcf99', textColor: '#0f172a', darkColor: '#183f1d' },
  'J7': { key: 'J7', name: 'Western Province', shortName: 'WP', color: '#2b50a9', textColor: '#ffffff', darkColor: '#1c346e' },
  '6C': { key: '6C', name: 'Warriors', shortName: 'WAR', color: '#bdf412', textColor: '#0f172a', darkColor: '#8f020a' },
  '6A': { key: '6A', name: 'Dolphins', shortName: 'DOL', color: '#08cc5c', textColor: '#ffffff', darkColor: '#076732' },
  'JG': { key: 'JG', name: 'Rocks', shortName: 'Rocks', color: '#f5c275', textColor: '#0f172a', darkColor: '#895e29' },
  'J8': { key: 'J8', name: 'Titans', shortName: 'TIT', color: '#5bc5f2', textColor: '#0f172a', darkColor: '#136f97' },
  'JA': { key: 'JA', name: 'Lions', shortName: 'LIO', color: '#f4b324', textColor: '#0f172a', darkColor: '#996b07' },
  '6D': { key: '6D', name: 'Knights', shortName: 'KNI', color: '#e67325', textColor: '#ffffff', darkColor: '#8f3d08' },
  'JB': { key: 'JB', name: 'North West Dragons', shortName: 'NWD', color: '#782e88', textColor: '#ffffff', darkColor: '#471552' },

  // New Zealand Domestic (Ford Trophy / Super Smash)
  '52': { key: '52', name: 'Otago', shortName: 'OTG', color: '#f1e15b', textColor: '#0f172a', darkColor: '#1b3697' },
  '56': { key: '56', name: 'Central Stags', shortName: 'CS', color: '#f1e251', textColor: '#0f172a', darkColor: '#2b5749' },
  '53': { key: '53', name: 'Auckland', shortName: 'AKL', color: '#0084c9', textColor: '#ffffff', darkColor: '#003b6d' },
  '54': { key: '54', name: 'Canterbury', shortName: 'CAN', color: '#d81a23', textColor: '#ffffff', darkColor: '#8c0d12' },
  '55': { key: '55', name: 'Northern Districts', shortName: 'ND', color: '#9e1b32', textColor: '#ffffff', darkColor: '#5b0c1a' },
  '51': { key: '51', name: 'Wellington', shortName: 'WEL', color: '#f9a01b', textColor: '#0f172a', darkColor: '#995904' },

  // Global T20 Canada
  '2K': { key: '2K', name: 'Montreal Warriors', shortName: 'MW', color: '#7fd0fa', textColor: '#0f172a', darkColor: '#025fc0' },
  '2J': { key: '2J', name: 'Vancouver Guardians', shortName: 'VG', color: '#0f8dab', textColor: '#ffffff', darkColor: '#03172d' },
  'RC': { key: 'RC', name: 'Mississauga Skyhawks', shortName: 'MS', color: '#ffc300', textColor: '#0f172a', darkColor: '#002754' },
  '6P': { key: '6P', name: 'Brampton Blazers', shortName: 'BB', color: '#fedb84', textColor: '#0f172a', darkColor: '#2d2112' },
  '2I': { key: '2I', name: 'Toronto Kings', shortName: 'TK', color: '#fbd538', textColor: '#0f172a', darkColor: '#563502' },
  '2L': { key: '2L', name: 'Surrey Jaguars', shortName: 'SJ', color: '#88c057', textColor: '#ffffff', darkColor: '#366012' },

  // Emirates D20 League
  'DC': { key: 'DC', name: 'Abu Dhabi', shortName: 'ABD', color: '#bf3738', textColor: '#ffffff', darkColor: '#171516' },
  'DE': { key: 'DE', name: 'Dubai', shortName: 'DUB', color: '#bd4591', textColor: '#ffffff', darkColor: '#1961a9' },
  'DD': { key: 'DD', name: 'Emirates Blues', shortName: 'EMB', color: '#d9d9fc', textColor: '#0f172a', darkColor: '#07069d' },
  'DG': { key: 'DG', name: 'Sharjah', shortName: 'SHA', color: '#f47823', textColor: '#ffffff', darkColor: '#203e8f' },
  'DF': { key: 'DF', name: 'Ajman', shortName: 'AJM', color: '#5c99ea', textColor: '#ffffff', darkColor: '#1e3a8a' },
  'DH': { key: 'DH', name: 'Fujairah', shortName: 'FUJ', color: '#c63226', textColor: '#ffffff', darkColor: '#7f1d1d' },

  // Nepal Premier League
  'PU': { key: 'PU', name: 'Biratnagar Kings', shortName: 'BK', color: '#fed740', textColor: '#0f172a', darkColor: '#022952' },
  'ZY': { key: 'ZY', name: 'Sudurpaschim Royals', shortName: 'SPR', color: '#fcdc29', textColor: '#0f172a', darkColor: '#414c9b' },
  'PV': { key: 'PV', name: 'Janakpur Bolts', shortName: 'JKB', color: '#e4397e', textColor: '#ffffff', darkColor: '#162b5b' },
  'PW': { key: 'PW', name: 'Pokhara Avengers', shortName: 'PKA', color: '#018fd6', textColor: '#ffffff', darkColor: '#173962' },
  'PS': { key: 'PS', name: 'Lumbini Lions', shortName: 'LBL', color: '#f97316', textColor: '#ffffff', darkColor: '#9a3412' },
  'ZV': { key: 'ZV', name: 'Chitwan Rhinos', shortName: 'CWR', color: '#ea580c', textColor: '#ffffff', darkColor: '#7c2d12' },
  'ZW': { key: 'ZW', name: 'Karnali Yaks', shortName: 'KNY', color: '#8b5cf6', textColor: '#ffffff', darkColor: '#5b21b6' },
  'ZX': { key: 'ZX', name: 'Kathmandu Gurkhas', shortName: 'KTG', color: '#10b981', textColor: '#ffffff', darkColor: '#065f46' },

  // Women's International Teams
  '16': { key: '16', name: 'India Women', shortName: 'IND-W', color: '#2563eb', textColor: '#ffffff', darkColor: '#1d4ed8' },
  '6I': { key: '6I', name: 'Zimbabwe Women', shortName: 'ZIM-W', color: '#b91c1c', textColor: '#ffffff', darkColor: '#7f1d1d' },
  '7Q': { key: '7Q', name: 'Australia Women', shortName: 'AUS-W', color: '#eab308', textColor: '#0f172a', darkColor: '#713f12' },
  '7N': { key: '7N', name: 'England Women', shortName: 'ENG-W', color: '#0284c7', textColor: '#ffffff', darkColor: '#0c4a6e' },
  '7P': { key: '7P', name: 'South Africa Women', shortName: 'SA-W', color: '#15803d', textColor: '#ffffff', darkColor: '#14532d' },
  '7R': { key: '7R', name: 'New Zealand Women', shortName: 'NZ-W', color: '#334155', textColor: '#ffffff', darkColor: '#0f172a' },
  '7U': { key: '7U', name: 'Pakistan Women', shortName: 'PAK-W', color: '#047857', textColor: '#ffffff', darkColor: '#064e3b' },
  '7T': { key: '7T', name: 'Sri Lanka Women', shortName: 'SL-W', color: '#1e40af', textColor: '#ffffff', darkColor: '#172554' },
  '7W': { key: '7W', name: 'Bangladesh Women', shortName: 'BAN-W', color: '#166534', textColor: '#ffffff', darkColor: '#14532d' },
  '7V': { key: '7V', name: 'West Indies Women', shortName: 'WI-W', color: '#881337', textColor: '#ffffff', darkColor: '#4c0519' },
  '7Z': { key: '7Z', name: 'Ireland Women', shortName: 'IRE-W', color: '#16a34a', textColor: '#ffffff', darkColor: '#14532d' },
  '7S': { key: '7S', name: 'Scotland Women', shortName: 'SCO-W', color: '#3b82f6', textColor: '#ffffff', darkColor: '#1e3a8a' },

  // 'A' Teams & Development Teams
  '6S': { key: '6S', name: 'India A', shortName: 'IND-A', color: '#3f71be', textColor: '#ffffff', darkColor: '#254b85' },
  'M1': { key: 'M1', name: 'New Zealand A', shortName: 'NZ-A', color: '#c6112f', textColor: '#ffffff', darkColor: '#092167' },
  '6Q': { key: '6Q', name: 'Australia A', shortName: 'AUS-A', color: '#facc15', textColor: '#0f172a', darkColor: '#854d0e' },
  '6N': { key: '6N', name: 'England Lions', shortName: 'ENG-A', color: '#4662ac', textColor: '#ffffff', darkColor: '#213365' },
  '17V': { key: '17V', name: 'England A', shortName: 'ENG-A', color: '#4662ac', textColor: '#ffffff', darkColor: '#213365' },
  'VI': { key: 'VI', name: 'West Indies A', shortName: 'WI-A', color: '#a01d48', textColor: '#ffffff', darkColor: '#761031' },
  '6R': { key: '6R', name: 'South Africa A', shortName: 'SA-A', color: '#30af6a', textColor: '#ffffff', darkColor: '#156c3d' },
  '6T': { key: '6T', name: 'Pakistan Shaheens', shortName: 'PAK-A', color: '#01984b', textColor: '#ffffff', darkColor: '#01572b' },

  // Indian Premier League (IPL)
  '4': { key: '4', name: 'Chennai Super Kings', shortName: 'CSK', color: '#fdb913', textColor: '#0f172a', darkColor: '#a17300' },
  '5': { key: '5', name: 'Delhi Capitals', shortName: 'DC', color: '#004c97', textColor: '#ffffff', darkColor: '#002652' },
  '6': { key: '6', name: 'Punjab Kings', shortName: 'PBKS', color: '#ed1b24', textColor: '#ffffff', darkColor: '#8e0d13' },
  '7': { key: '7', name: 'Kolkata Knight Riders', shortName: 'KKR', color: '#3a225d', textColor: '#ffffff', darkColor: '#211337' },
  '8': { key: '8', name: 'Mumbai Indians', shortName: 'MI', color: '#004b87', textColor: '#ffffff', darkColor: '#002847' },
  '9': { key: '9', name: 'Rajasthan Royals', shortName: 'RR', color: '#ea1a85', textColor: '#ffffff', darkColor: '#8a0a4b' },
  '10': { key: '10', name: 'Royal Challengers Bengaluru', shortName: 'RCB', color: '#ec1c24', textColor: '#ffffff', darkColor: '#8a0b10' },
  '20': { key: '20', name: 'Sunrisers Hyderabad', shortName: 'SRH', color: '#f26522', textColor: '#ffffff', darkColor: '#973b0a' },
  '2A': { key: '2A', name: 'Lucknow Super Giants', shortName: 'LSG', color: '#a0e633', textColor: '#0f172a', darkColor: '#578413' },
  '2C': { key: '2C', name: 'Gujarat Titans', shortName: 'GT', color: '#1b2133', textColor: '#ffffff', darkColor: '#0a0d14' },
};

// Known Venues mapping from Crex cricket data
export const KNOWN_VENUES: Record<string, string> = {
  '87': 'Drummoyne Oval, Sydney',
  '7F': 'Mission Road Ground, Mong Kok, Hong Kong',
  'JL': 'Namibia Cricket Ground, Windhoek',
  '38': 'Arnos Vale Stadium, Kingstown, St Vincent',
  '6F': 'Recreation Ground Oudtshoorn',
  '4R': "St George's Park, Gqeberha",
  '4J': 'Kingsmead, Durban',
  '4D': 'Newlands, Cape Town',
  '2B': 'Seddon Park, Hamilton',
  '6Q': 'Western Australia Cricket Association Ground, Perth',
  '2E': 'University of Otago Oval, Dunedin',
  '29': 'Gaddafi Stadium, Lahore',
  '6C': 'Hagley Oval, Christchurch',
  '64': 'Sher-e-Bangla National Stadium, Mirpur, Dhaka',
  '6U': 'Sharjah Cricket Stadium, Sharjah',
  'B0': 'Tribhuvan University International Cricket Ground, Kirtipur',
  '34': 'Gymkhana Club Ground, Nairobi Kenya',
  '70': 'Cricket Academy, Dubai',
  'GR': 'Karwan Cricket Ground, Ajman',
  'CD': 'Conaree Sports Club, Basseterre, St Kitts',
  'A3': 'Kotambi Stadium, Vadodara',
  '6B': 'Basin Reserve, Wellington',
  'BH': 'Bert Sutcliffe Oval, Lincoln',
  'JS': 'HPC Oval, Windhoek, Namibia',
  'MC': 'Melbourne Cricket Ground (MCG)',
  'SCG': 'Sydney Cricket Ground',
  'LD': "Lord's Cricket Ground, London",
  'OV': 'The Oval, London',
  'ED': 'Eden Gardens, Kolkata',
  'WS': 'Wankhede Stadium, Mumbai',
  'CH': 'M. Chinnaswamy Stadium, Bengaluru',
  'AH': 'Narendra Modi Stadium, Ahmedabad',
  'GA': 'Adelaide Oval, Adelaide',
  'BR': 'The Gabba, Brisbane',
  'BE': 'Bellerive Oval, Hobart',
  'P1': 'Perth Stadium, Perth',
};

// Known Series mapping from Crex cricket data
export const KNOWN_SERIES: Record<string, string> = {
  '2KG': 'Womens Big Bash League 2026',
  '2GV': 'Hong Kong Sixes 2026',
  '2NU': 'Ireland tour of Namibia 2026',
  '2GR': 'India tour of New Zealand 2026',
  '2O5': 'Global T20 Canada 2026',
  '2MT': 'CSA Pro T20 Cup 2026',
  '2EW': 'Australia tour of South Africa 2026',
  '2LU': 'The Ford Trophy 2026-27',
  '2M3': 'ODI Tri Series in Pakistan 2026',
  '2MF': 'India A tour of New Zealand 2026',
  '2BJ': 'West Indies tour of Bangladesh 2026',
  '2MO': 'Afghanistan vs Zimbabwe in UAE 2026',
  '2LV': 'Nepal Premier League 2026',
  '1WE': "Men's CWC Challenge League A 2024-26",
  '1JK': "Men's CWC League 2 2023-27",
  '2O6': 'Emirates D20 League 2026',
  '2O1': 'England A tour of West Indies 2026',
  '2I5': 'Zimbabwe Women tour of India 2026',
  '2KM': 'Sheffield Shield 2026-27',
  '2NS': 'Bangladesh National League 2026',
  '2MV': 'Ranji Trophy Elite 2026-27',
  '2MW': 'Ranji Trophy Plate 2026-27',
};

/**
 * Register or update dynamic team definition (e.g. from odds speech_names or live match headers)
 */
export function registerDynamicTeam(
  key: string,
  name: string,
  shortName?: string,
  color?: string,
  darkColor?: string
): TeamInfo {
  const cleanKey = key.replace(/^[\^&$#]+/, '');
  const existing = KNOWN_TEAMS[cleanKey];

  if (existing && !existing.name.startsWith('Team ')) {
    return existing;
  }

  const { color: defColor, darkColor: defDark } = getDeterministicColor(cleanKey);
  const team: TeamInfo = {
    key: cleanKey,
    name,
    shortName: shortName || (name.length > 5 ? name.slice(0, 4).toUpperCase() : name.toUpperCase()),
    color: color || existing?.color || defColor,
    textColor: '#ffffff',
    darkColor: darkColor || existing?.darkColor || defDark,
  };

  KNOWN_TEAMS[cleanKey] = team;
  KNOWN_TEAMS[key] = team;
  return team;
}

export function resolveTeam(key: string | undefined): TeamInfo {
  if (!key) {
    return {
      key: 'UNK',
      name: 'Team TBA',
      shortName: 'TBA',
      color: '#64748b',
      textColor: '#ffffff',
      darkColor: '#334155',
    };
  }

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
    darkColor,
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
