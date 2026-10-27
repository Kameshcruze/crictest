export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=4');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const countryCode = req.body?.cc || req.query?.cc || 'IN';

  try {
    // 1. Fetch Goscorer API
    let apiMatches: Record<string, any> = {};
    const apiPromise = fetch('https://api.goscorer.com/api/v2/getTopMatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    })
      .then((r) => r.json())
      .catch(() => ({}));

    // 2. Fetch Crex live score pool
    let crexMatches: Record<string, any> = {};
    let extractedMapping: { teams?: any[]; venues?: any[]; series?: any[] } = {};

    const crexPromise = fetch('https://crex.com/cricket-live-score', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
      .then((r) => r.text())
      .then((html) => {
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
              break;
            }
          }
        }
      })
      .catch(() => {});

    await Promise.all([apiPromise, crexPromise]);
    apiMatches = (await apiPromise) || {};

    const mergedMatches: Record<string, any> = { ...crexMatches };
    for (const [id, m] of Object.entries(apiMatches)) {
      mergedMatches[id] = { ...(mergedMatches[id] || {}), ...m };
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
