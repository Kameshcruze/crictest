export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const countryCode = req.body?.cc || req.query?.cc || 'IN';
  const now = Date.now();

  const matches: Record<string, any> = {};
  let mapping: { teams?: any[]; venues?: any[]; series?: any[] } = {};

  try {
    // 1. Fetch full Crex desktopTopMatchesRaw pool (contains all 31+ live, upcoming, completed fixtures)
    const crexController = new AbortController();
    const crexTimeout = setTimeout(() => crexController.abort(), 2500);

    const htmlRes = await fetch('https://crex.com/cricket-live-score', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: crexController.signal,
    }).catch(() => null);
    clearTimeout(crexTimeout);

    if (htmlRes && htmlRes.ok) {
      const html = await htmlRes.text();
      const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        if (m[1].includes('ssr-bootstrap-v1') && m[1].includes('desktopTopMatchesRaw')) {
          const idx = m[1].indexOf('{&q;language&q;');
          if (idx !== -1) {
            const raw = m[1]
              .slice(idx)
              .replace(/&q;/g, '"')
              .replace(/&s;/g, "'")
              .replace(/&amp;/g, '&');
            const parsed = JSON.parse(raw);
            if (parsed.desktopTopMatchesRaw) {
              Object.assign(matches, parsed.desktopTopMatchesRaw);
            }
            const homeMap =
              parsed['https://oc.crickapi.com/mapping/getHomeMapDatahome'] ||
              parsed['https://oc.crickapi.com/mapping/getHomeMapDatahomeAtf'];
            if (homeMap) {
              mapping = {
                teams: homeMap.t,
                venues: homeMap.v,
                series: homeMap.s,
              };
            }
            break;
          }
        }
      }
    }

    // 2. Ultra-fast Goscorer API fetch with cache-busting to overwrite with fresh live scores
    const apiController = new AbortController();
    const apiTimeout = setTimeout(() => apiController.abort(), 2000);

    const apiRes = await fetch(`https://api.goscorer.com/api/v2/getTopMatches?_t=${now}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ cc: countryCode, _t: now }),
      signal: apiController.signal,
    }).catch(() => null);
    clearTimeout(apiTimeout);

    if (apiRes && apiRes.ok) {
      const liveData = (await apiRes.json()) || {};
      for (const [id, item] of Object.entries(liveData)) {
        matches[id] = { ...(matches[id] || {}), ...(item as any) };
      }
    }

    return res.status(200).json({
      matches,
      mapping,
      count: Object.keys(matches).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message, matches: {} });
  }
}
