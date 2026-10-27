// Vercel Serverless Function for /api/top-matches
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=5');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const countryCode = req.body?.cc || req.query?.cc || 'IN';

  try {
    // 1. Direct fetch to Goscorer API (responds in ~15ms)
    let apiMatches: Record<string, any> = {};
    const apiRes = await fetch('https://api.goscorer.com/api/v2/getTopMatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    });

    if (apiRes.ok) {
      apiMatches = await apiRes.json();
    }

    return res.status(200).json({
      matches: apiMatches,
      totalCount: Object.keys(apiMatches).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
