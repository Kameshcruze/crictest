export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ';
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003980667930';

  const now = Date.now();
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  try {
    const apiRes = await fetch(`https://api.goscorer.com/api/v2/getTopMatches?_t=${now}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ cc: 'IN', _t: now }),
    });

    if (!apiRes.ok) {
      return res.status(502).json({ ok: false, error: 'Failed to fetch Crex matches' });
    }

    const matches = await apiRes.json();
    const liveMatches = Object.entries(matches).filter(([_, m]: [string, any]) => (m.j || m.k) && !m.finishTime);

    let telegramSent = false;
    let messageText = '';

    if (liveMatches.length > 0) {
      messageText = `🏏 <b>CREX LIVE CRICKET 24/7 DIGEST</b> · <i>${timeStr}</i>\n`;
      messageText += `🔥 <b>${liveMatches.length} Live Matches in Progress</b>\n`;
      messageText += `───────────────────\n\n`;

      liveMatches.forEach(([_, m]: [string, any], idx) => {
        const t1 = m.t1Sname || m.b || 'Team 1';
        const t2 = m.t2Sname || m.c || 'Team 2';
        const format = m.fo || 'Match';
        const score1 = m.j || 'Yet to bat';
        const score2 = m.k || 'Yet to bat';
        const status = m.res || m.soResult || m.a || 'Live';

        messageText += `<b>${idx + 1}. ${t1} vs ${t2}</b> (${format})\n`;
        messageText += `   • <b>${t1}</b>: ${score1}\n`;
        messageText += `   • <b>${t2}</b>: ${score2}\n`;
        messageText += `   • <i>${status}</i>\n\n`;
      });

      messageText += `───────────────────\n`;
      messageText += `⚡ <i>Auto-broadcast 24/7</i>`;

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: messageText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const tgData = await tgRes.json();
      telegramSent = tgData.ok === true;
    }

    return res.status(200).json({
      ok: true,
      status: 'cron_executed',
      timestamp: new Date().toISOString(),
      liveMatchesCount: liveMatches.length,
      telegramSent,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
