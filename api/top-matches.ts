export default async function handler(req: any, res: any) {
  // Enable CORS for Vercel deployment
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const countryCode = req.body?.cc || req.query?.cc || 'IN';

  try {
    // 1. Fetch Goscorer API
    let apiMatches: Record<string, any> = {};
    try {
      const apiRes = await fetch('https://api.goscorer.com/api/v2/getTopMatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cc: countryCode }),
      });
      if (apiRes.ok) {
        apiMatches = await apiRes.json();
      }
    } catch (e: any) {
      console.warn('Goscorer fetch error:', e.message);
    }

    // 2. Fetch full matches pool from Crex live score page
    let crexMatches: Record<string, any> = {};
    let extractedMapping: { teams?: any[]; venues?: any[]; series?: any[] } = {};

    try {
      const html = await fetch('https://crex.com/cricket-live-score', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }).then((r) => r.text());

      const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        if (match[1].includes('ssr-bootstrap-v1') && match[1].includes('desktopTopMatchesRaw')) {
          const idx = match[1].indexOf('{&q;language&q;');
          if (idx !== -1) {
            const raw = match[1]
              .slice(idx)
              .replace(/&q;/g, '"')
              .replace(/&s;/g, "'")
              .replace(/&amp;/g, '&');
            const parsed = JSON.parse(raw);
            if (parsed.desktopTopMatchesRaw) {
              crexMatches = parsed.desktopTopMatchesRaw;
            }
            const homeMap =
              parsed['https://oc.crickapi.com/mapping/getHomeMapDatahome'] ||
              parsed['https://oc.crickapi.com/mapping/getHomeMapDatahomeAtf'];
            if (homeMap) {
              extractedMapping = {
                teams: homeMap.t,
                venues: homeMap.v,
                series: homeMap.s,
              };
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('Crex scrape error:', e.message);
    }

    // Merge: Goscorer API + Crex desktop pool
    const mergedMatches: Record<string, any> = { ...crexMatches };
    for (const [id, m] of Object.entries(apiMatches)) {
      if (mergedMatches[id]) {
        mergedMatches[id] = { ...mergedMatches[id], ...m };
      } else {
        mergedMatches[id] = m;
      }
    }

    return res.status(200).json({
      matches: mergedMatches,
      mapping: extractedMapping,
      totalCount: Object.keys(mergedMatches).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
