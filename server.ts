import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// In-memory cache for Crex HTML scrape to optimize speed
let crexCache: {
  timestamp: number;
  matches: Record<string, any>;
  mapping: { teams?: any[]; venues?: any[]; series?: any[] };
} | null = null;

async function getCrexMatches() {
  const now = Date.now();
  if (crexCache && now - crexCache.timestamp < 4000) {
    return { matches: crexCache.matches, mapping: crexCache.mapping };
  }

  try {
    const html = await fetch('https://crex.com/cricket-live-score', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }).then((r) => r.text());

    const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let extractedMatches: Record<string, any> = {};
    let extractedMapping: { teams?: any[]; venues?: any[]; series?: any[] } = {};

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
            extractedMatches = parsed.desktopTopMatchesRaw;
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

    crexCache = {
      timestamp: now,
      matches: extractedMatches,
      mapping: extractedMapping,
    };

    return { matches: extractedMatches, mapping: extractedMapping };
  } catch (err: any) {
    console.error('Crex scrape error:', err.message);
    return { matches: crexCache?.matches || {}, mapping: crexCache?.mapping || {} };
  }
}

// Proxy endpoint for top matches
app.all(['/api/top-matches', '/api/v2/getTopMatches'], async (req, res) => {
  const countryCode = req.body?.cc || req.query?.cc || 'IN';

  try {
    // 1. Fetch from Goscorer API directly
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
      console.warn('Goscorer API fetch warning:', e.message);
    }

    // 2. Fetch full matches pool from Crex live score page
    const { matches: crexMatches, mapping } = await getCrexMatches();

    // 3. Merge: Goscorer API has latest live score updates, Crex has all active matches including 14VC, 14V3
    const mergedMatches: Record<string, any> = { ...crexMatches };
    for (const [id, m] of Object.entries(apiMatches)) {
      if (mergedMatches[id]) {
        mergedMatches[id] = { ...mergedMatches[id], ...m };
      } else {
        mergedMatches[id] = m;
      }
    }

    res.json({
      matches: mergedMatches,
      mapping,
      totalCount: Object.keys(mergedMatches).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mount Vite or serve static files
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
