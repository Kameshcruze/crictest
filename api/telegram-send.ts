export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { botToken, chatId, text } = req.body || {};
  const finalToken = botToken || process.env.TELEGRAM_BOT_TOKEN || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ';
  const finalChatId = chatId || process.env.TELEGRAM_CHAT_ID || '-1003980667930';

  if (!text) {
    return res.status(400).json({ ok: false, error: 'Missing message text' });
  }

  try {
    const cleanToken = String(finalToken).trim().replace(/^bot/i, '');
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(finalChatId).trim(),
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
}
