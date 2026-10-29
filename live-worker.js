/**
 * 24/7 Live Cricket Telegram Bot Daemon
 * 
 * Runs continuously in the background (no browser or website needed).
 * Polls the live Crex / Goscorer feed every 3 seconds for instant real-time updates.
 * 
 * To run locally or on any server / VPS / Render / Railway:
 *   node live-worker.js
 */

import http from 'http';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003980667930';
const POLL_INTERVAL_MS = 3000; // Check every 3 seconds (True Live)
const DIGEST_INTERVAL_MS = 5 * 60 * 1000; // Send full summary every 5 minutes
const PORT = process.env.PORT || 3000;

// Lightweight HTTP server so Render / Cloud Web Services pass health checks
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'active',
      daemon: 'Crex Live Cricket Telegram Bot',
      pollInterval: `${POLL_INTERVAL_MS / 1000}s`,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  );
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP Health Check Server listening on port ${PORT}`);
});

console.log('🚀 Starting 24/7 Live Cricket Telegram Bot Daemon...');
console.log(`📱 Bot Token: ${BOT_TOKEN.slice(0, 10)}...`);
console.log(`💬 Chat ID: ${CHAT_ID}`);
console.log(`⚡ Poll Rate: Every ${POLL_INTERVAL_MS / 1000} seconds\n`);

async function sendTelegram(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.error('Telegram dispatch error:', err.message);
    return false;
  }
}

function parseScore(raw) {
  if (!raw || typeof raw !== 'string') return { runs: 0, wickets: 0, overs: '0' };
  const match = raw.trim().match(/^(\d+)(?:\/(\d+))?(?:\((\d+(?:\.\d+)?))?/);
  if (!match) return { runs: 0, wickets: 0, overs: '0' };
  return {
    runs: parseInt(match[1], 10) || 0,
    wickets: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    overs: match[3] || '0',
  };
}

const matchSnapshots = {};
const finishedMatches = new Set();
let lastDigestTime = 0;

async function checkLiveScores() {
  const now = Date.now();
  try {
    const res = await fetch(`https://api.goscorer.com/api/v2/getTopMatches?_t=${now}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({ cc: 'IN', _t: now }),
    });

    if (!res.ok) return;
    const matches = await res.json();

    for (const [id, m] of Object.entries(matches)) {
      const item = m;
      const prev = matchSnapshots[id];
      const curScore1 = parseScore(item.j);
      const curScore2 = parseScore(item.k);
      const team1 = item.t1Sname || item.b || 'Team 1';
      const team2 = item.t2Sname || item.c || 'Team 2';
      const format = item.fo || 'Match';

      if (prev) {
        // 1. Instant Wicket Detection
        if (curScore1.wickets > prev.wickets1 && (item.j || '').includes('/')) {
          console.log(`[WICKET] ${team1} vs ${team2}`);
          const msg =
            `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
            `🏏 <b>${team1} vs ${team2}</b> (${format})\n` +
            `💥 <b>${team1}</b> lose a wicket!\n` +
            `📊 Current Score: <b>${curScore1.runs}/${curScore1.wickets}</b> (${curScore1.overs} ov)\n` +
            `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
          await sendTelegram(msg);
        }

        if (curScore2.wickets > prev.wickets2 && (item.k || '').includes('/')) {
          console.log(`[WICKET] ${team1} vs ${team2}`);
          const msg =
            `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
            `🏏 <b>${team1} vs ${team2}</b> (${format})\n` +
            `💥 <b>${team2}</b> lose a wicket!\n` +
            `📊 Current Score: <b>${curScore2.runs}/${curScore2.wickets}</b> (${curScore2.overs} ov)\n` +
            `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
          await sendTelegram(msg);
        }
      }

      // 2. Instant Match Conclusion Detection
      const resText = (item.res || item.soResult || '').toLowerCase();
      const isFinished = item.finishTime || resText.includes('won by') || resText.includes('won') || resText.includes('drawn');
      if (isFinished && !finishedMatches.has(id) && prev) {
        finishedMatches.add(id);
        console.log(`[FINISHED] ${team1} vs ${team2}`);
        const msg =
          `🏆 <b>MATCH CONCLUDED!</b> 🏆\n\n` +
          `🏏 <b>${team1} vs ${team2}</b> (${format})\n` +
          `🥇 <b>Result: ${item.res || item.soResult}</b>\n\n` +
          `📊 <b>Final Scores:</b>\n` +
          (item.j ? `• ${team1}: <b>${item.j}</b>\n` : '') +
          (item.k ? `• ${team2}: <b>${item.k}</b>\n` : '') +
          (item.sname || item.sfullname ? `\n🏆 ${item.sname || item.sfullname}` : '');
        await sendTelegram(msg);
      }

      // Save snapshot
      matchSnapshots[id] = {
        score1: item.j || '',
        score2: item.k || '',
        wickets1: curScore1.wickets,
        wickets2: curScore2.wickets,
        res: item.res,
      };
    }

    // 3. Periodic Digest every 5 minutes
    if (now - lastDigestTime >= DIGEST_INTERVAL_MS) {
      lastDigestTime = now;
      const liveItems = Object.entries(matches).filter(([_, m]) => (m.j || m.k) && !m.finishTime);
      if (liveItems.length > 0) {
        console.log(`[DIGEST] Broadcasting ${liveItems.length} matches...`);
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
        digest += `───────────────────\n⚡ <i>Live automated daemon</i>`;
        await sendTelegram(digest);
      }
    }
  } catch (err) {
    // Non-blocking
  }
}

// Startup test message
sendTelegram('🤖 <b>Crex Live Cricket Daemon Connected!</b>\n⚡ Monitoring live matches, wickets, and scores 24/7 in real time.').then(() => {
  // Run loop
  checkLiveScores();
  setInterval(checkLiveScores, POLL_INTERVAL_MS);
});
