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

// Connected SSE clients for instantaneous real-time streaming
const sseClients: Set<express.Response> = new Set();

function broadcastToClients(data: any) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

let isGoscorerRunning = false;
let isCrexRunning = false;

// 1. Ultra-fast Goscorer API sync (runs every 1 second, ~10ms)
async function syncGoscorerApi(countryCode = 'IN') {
  if (isGoscorerRunning) return;
  isGoscorerRunning = true;
  const now = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`https://api.goscorer.com/api/v2/getTopMatches?_t=${now}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ cc: countryCode, _t: now }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      let hasChange = false;

      for (const [id, m] of Object.entries(data)) {
        const existing = matchStore.matches[id];
        if (
          !existing ||
          existing.j !== (m as any).j ||
          existing.k !== (m as any).k ||
          existing.res !== (m as any).res
        ) {
          hasChange = true;
        }
        matchStore.matches[id] = { ...(matchStore.matches[id] || {}), ...(m as any) };
      }

      matchStore.lastUpdated = Date.now();

      if (hasChange && sseClients.size > 0) {
        broadcastToClients({
          type: 'update',
          matches: matchStore.matches,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-blocking
  } finally {
    isGoscorerRunning = false;
  }
}

// 2. Crex Pool sync (runs every 15s) to collect extra matches and mapping without overwriting fresh scores
async function syncCrexPool() {
  if (isCrexRunning) return;
  isCrexRunning = true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const html = await fetch('https://crex.com/cricket-live-score', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    }).then((r) => r.text());
    clearTimeout(timeout);

    const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let hasChange = false;

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
              const existing = matchStore.matches[id];
              // Merge metadata while preserving existing live scores
              matchStore.matches[id] = {
                ...(m as any),
                ...(existing || {}),
              };
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

    if (hasChange && sseClients.size > 0) {
      broadcastToClients({
        type: 'update',
        matches: matchStore.matches,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Non-blocking
  } finally {
    isCrexRunning = false;
  }
}

// Initial eager sync
syncGoscorerApi().then(syncCrexPool);

// Continuous live polling loop
setInterval(syncGoscorerApi, 1000); // Check Goscorer API every 1000ms
setInterval(syncCrexPool, 20000);   // Sync background mapping/metadata every 20s

// SSE Live Stream: Instant zero-latency push to connected clients
app.get('/api/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send current state immediately on connect
  res.write(
    `data: ${JSON.stringify({
      type: 'init',
      matches: matchStore.matches,
      mapping: matchStore.mapping,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  sseClients.add(res);

  // Keep-alive heartbeat every 10s
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 10000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// High-speed endpoint: Responds immediately from memory in < 1ms
app.all(['/api/top-matches', '/api/v2/getTopMatches'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (Object.keys(matchStore.matches).length === 0) {
    await Promise.all([syncGoscorerApi(req.body?.cc || 'IN'), syncCrexPool()]);
  }

  res.json({
    matches: matchStore.matches,
    mapping: matchStore.mapping,
    totalCount: Object.keys(matchStore.matches).length,
    timestamp: new Date(matchStore.lastUpdated || Date.now()).toISOString(),
  });
});

// Telegram Bot Dispatch Proxy
app.post('/api/telegram/send', async (req, res) => {
  const { botToken, chatId, text } = req.body || {};
  if (!botToken || !chatId || !text) {
    return res.status(400).json({ ok: false, error: 'Missing botToken, chatId, or text' });
  }

  try {
    const cleanToken = String(botToken).trim().replace(/^bot/i, '');
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId).trim(),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await tgRes.json();
    return res.status(tgRes.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
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
    console.log(`Live Scorer server running on port ${PORT}`);
  });
}

startServer();
