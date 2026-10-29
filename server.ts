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

// Backend Automated Telegram Broadcaster
const DEFAULT_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ';
const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003980667930';

async function sendTelegramBroadcast(htmlText: string) {
  if (!DEFAULT_TELEGRAM_BOT_TOKEN || !DEFAULT_TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${DEFAULT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: DEFAULT_TELEGRAM_CHAT_ID,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e: any) {
    console.error('Telegram broadcast error:', e.message);
    return false;
  }
}

// Track match state for automated notifications
const backendScoresSnapshot: Record<
  string,
  {
    score1: string;
    score2: string;
    wickets1: number;
    wickets2: number;
    res?: string;
  }
> = {};

const finishedNotifiedMatches = new Set<string>();
let lastDigestTimestamp = Date.now();

function parseScore(raw?: string) {
  if (!raw || typeof raw !== 'string') return { runs: 0, wickets: 0, overs: '0' };
  const match = raw.trim().match(/^(\d+)(?:\/(\d+))?(?:\((\d+(?:\.\d+)?))?/);
  if (!match) return { runs: 0, wickets: 0, overs: '0' };
  return {
    runs: parseInt(match[1], 10) || 0,
    wickets: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    overs: match[3] || '0',
  };
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
        const item = m as any;
        const existing = matchStore.matches[id];
        if (
          !existing ||
          existing.j !== item.j ||
          existing.k !== item.k ||
          existing.res !== item.res
        ) {
          hasChange = true;
        }
        matchStore.matches[id] = { ...(matchStore.matches[id] || {}), ...item };

        // Automated backend Telegram detection
        const prev = backendScoresSnapshot[id];
        const curScore1 = parseScore(item.j);
        const curScore2 = parseScore(item.k);
        const team1Name = item.t1Sname || item.b || 'Team 1';
        const team2Name = item.t2Sname || item.c || 'Team 2';
        const format = item.fo || 'Match';

        if (prev) {
          // Check for wicket in innings 1
          if (curScore1.wickets > prev.wickets1 && (item.j || '').includes('/')) {
            const wicketMsg =
              `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
              `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
              `💥 <b>${team1Name}</b> lose a wicket!\n` +
              `📊 Current Score: <b>${curScore1.runs}/${curScore1.wickets}</b> (${curScore1.overs} ov)\n` +
              `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
            sendTelegramBroadcast(wicketMsg);
          }
          // Check for wicket in innings 2
          if (curScore2.wickets > prev.wickets2 && (item.k || '').includes('/')) {
            const wicketMsg =
              `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
              `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
              `💥 <b>${team2Name}</b> lose a wicket!\n` +
              `📊 Current Score: <b>${curScore2.runs}/${curScore2.wickets}</b> (${curScore2.overs} ov)\n` +
              `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
            sendTelegramBroadcast(wicketMsg);
          }
        }

        // Check for match conclusion
        const resText = (item.res || item.soResult || '').toLowerCase();
        const isFinished = item.finishTime || resText.includes('won by') || resText.includes('won') || resText.includes('drawn');
        if (isFinished && !finishedNotifiedMatches.has(id)) {
          finishedNotifiedMatches.add(id);
          const resultMsg =
            `🏆 <b>MATCH CONCLUDED!</b> 🏆\n\n` +
            `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
            `🥇 <b>Result: ${item.res || item.soResult}</b>\n\n` +
            `📊 <b>Scores:</b>\n` +
            (item.j ? `• ${team1Name}: <b>${item.j}</b>\n` : '') +
            (item.k ? `• ${team2Name}: <b>${item.k}</b>\n` : '') +
            (item.sname || item.sfullname ? `\n🏆 ${item.sname || item.sfullname}` : '');
          sendTelegramBroadcast(resultMsg);
        }

        backendScoresSnapshot[id] = {
          score1: item.j || '',
          score2: item.k || '',
          wickets1: curScore1.wickets,
          wickets2: curScore2.wickets,
          res: item.res,
        };
      }

      // Periodic Scoreboard Digest: Every 3 minutes automatically
      if (now - lastDigestTimestamp >= 180000) {
        lastDigestTimestamp = now;
        const liveItems = Object.entries(matchStore.matches).filter(([_, m]) => (m.j || m.k) && !m.finishTime);
        if (liveItems.length > 0) {
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let digest = `🏏 <b>CREX LIVE CRICKET DIGEST</b> · <i>${timeStr}</i>\n`;
          digest += `🔥 <b>${liveItems.length} Live Matches in Progress</b>\n`;
          digest += `───────────────────\n\n`;
          liveItems.forEach(([_, m], idx) => {
            const t1 = m.t1Sname || m.b || 'T1';
            const t2 = m.t2Sname || m.c || 'T2';
            digest += `<b>${idx + 1}. ${t1} vs ${t2}</b> (${m.fo || 'Match'})\n`;
            digest += `   • <b>${t1}</b>: ${m.j || 'Yet to bat'}\n`;
            digest += `   • <b>${t2}</b>: ${m.k || 'Yet to bat'}\n`;
            if (m.res || m.soResult) digest += `   • <i>${m.res || m.soResult}</i>\n`;
            digest += `\n`;
          });
          digest += `───────────────────\n⚡ <i>Live automated broadcast</i>`;
          sendTelegramBroadcast(digest);
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

// 24/7 Webhook / Cron Endpoint (hit by cron-job.org, UptimeRobot, or Vercel Cron)
app.all(['/api/cron', '/api/telegram/cron'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await syncGoscorerApi('IN');

  const liveItems = Object.entries(matchStore.matches).filter(
    ([_, m]) => (m.j || m.k) && !m.finishTime
  );

  let sent = false;
  if (liveItems.length > 0) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let digest = `🏏 <b>CREX LIVE CRICKET 24/7 DIGEST</b> · <i>${timeStr}</i>\n`;
    digest += `🔥 <b>${liveItems.length} Live Matches in Progress</b>\n`;
    digest += `───────────────────\n\n`;

    liveItems.forEach(([_, m], idx) => {
      const t1 = m.t1Sname || m.b || 'T1';
      const t2 = m.t2Sname || m.c || 'T2';
      digest += `<b>${idx + 1}. ${t1} vs ${t2}</b> (${m.fo || 'Match'})\n`;
      digest += `   • <b>${t1}</b>: ${m.j || 'Yet to bat'}\n`;
      digest += `   • <b>${t2}</b>: ${m.k || 'Yet to bat'}\n`;
      if (m.res || m.soResult) digest += `   • <i>${m.res || m.soResult}</i>\n`;
      digest += `\n`;
    });

    digest += `───────────────────\n⚡ <i>24/7 Automated cron broadcast</i>`;
    sent = await sendTelegramBroadcast(digest);
  }

  res.json({
    ok: true,
    status: 'cron_executed',
    timestamp: new Date().toISOString(),
    liveMatchesCount: liveItems.length,
    telegramSent: sent,
  });
});

// Telegram Bot Dispatch Proxy
app.post('/api/telegram/send', async (req, res) => {
  const { botToken, chatId, text } = req.body || {};
  const token = botToken || DEFAULT_TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || DEFAULT_TELEGRAM_CHAT_ID;

  if (!text) {
    return res.status(400).json({ ok: false, error: 'Missing message text' });
  }

  try {
    const cleanToken = String(token).trim().replace(/^bot/i, '');
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(targetChatId).trim(),
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

// Trigger initial connection greeting on boot
setTimeout(() => {
  sendTelegramBroadcast(
    '🏏 <b>Crex Live Cricket Scorer Connected!</b>\n\n' +
    '✅ Backend automated live cricket feed is now active.\n' +
    '📢 Real-time wickets, match conclusions, and live scoreboards will be broadcasted here automatically.'
  );
}, 2000);

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
