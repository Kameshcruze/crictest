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

  try {
    // 1. Ultra-fast Goscorer API fetch with cache-busting
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

    let apiMatches: Record<string, any> = {};
    if (apiRes && apiRes.ok) {
      apiMatches = (await apiRes.json()) || {};
    }

    return res.status(200).json({
      matches: apiMatches,
      count: Object.keys(apiMatches).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

