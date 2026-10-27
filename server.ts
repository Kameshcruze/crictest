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

// In-memory warm match store
let matchStore: {
  matches: Record<string, any>;
  mapping: { teams?: any[]; venues?: any[]; series?: any[] };
  lastUpdated: number;
} = {
  matches: {},
  mapping: {},
  lastUpdated: 0,
};

// Fast background sync directly from Goscorer API (runs every 3 seconds)
async function syncGoscorerApi(countryCode = 'IN') {
  try {
    const res = await fetch('https://api.goscorer.com/api/v2/getTopMatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    });

    if (res.ok) {
      const data = await res.json();
      for (const [id, m] of Object.entries(data)) {
        // Fresh API match always overwrites existing match
        matchStore.matches[id] = { ...(matchStore.matches[id] || {}), ...(m as any) };
      }
      matchStore.lastUpdated = Date.now();
    }
  } catch {
    // Non-blocking background catch
  }
}

// Background sync for full Crex matches pool (runs every 3 seconds)
async function syncCrexPool() {
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
            for (const [id, m] of Object.entries(parsed.desktopTopMatchesRaw)) {
              // Fresh Crex match always overwrites existing match
              matchStore.matches[id] = { ...(matchStore.matches[id] || {}), ...(m as any) };
            }
          }

          const homeMap =
            parsed['https://oc.crickapi.com/mapping/getHomeMapDatahome'] ||
            parsed['https://oc.crickapi.com/mapping/getHomeMapDatahomeAtf'];
          if (homeMap) {
            matchStore.mapping = {
              teams: homeMap.t,
              venues: homeMap.v,
              series: homeMap.s,
            };
          }
          break;
        }
      }
    }
    matchStore.lastUpdated = Date.now();
  } catch {
    // Non-blocking background catch
  }
}

// Initial eager sync
syncCrexPool().then(() => syncGoscorerApi());

// Run live syncs every 3 seconds in parallel
setInterval(syncGoscorerApi, 3000);
setInterval(syncCrexPool, 3000);

// Endpoint: Serves immediately in < 2ms from memory
app.all(['/api/top-matches', '/api/v2/getTopMatches'], async (req, res) => {
  if (Object.keys(matchStore.matches).length === 0) {
    await Promise.all([syncCrexPool(), syncGoscorerApi(req.body?.cc || 'IN')]);
  }

  res.json({
    matches: matchStore.matches,
    mapping: matchStore.mapping,
    totalCount: Object.keys(matchStore.matches).length,
    timestamp: new Date(matchStore.lastUpdated || Date.now()).toISOString(),
  });
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
    console.log(`Live Scorer server running at http://localhost:${PORT}`);
  });
}

startServer();
