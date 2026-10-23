const Busboy = require('busboy');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return res.status(503).json({ error: 'Owner notification is not configured yet. Please contact support.' });

  const fields = {};
  let fileBuffer = null, fileName = 'payment-screenshot.jpg', mimeType = 'image/jpeg', fileError = null;
  try {
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 8 } });
    const chunks = [];
    const parsed = new Promise((resolve, reject) => {
      bb.on('field', (name, value) => { fields[name] = value; });
      bb.on('file', (name, stream, info) => {
        if (name !== 'screenshot') { stream.resume(); return; }
        fileName = (info.filename || fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
        mimeType = info.mimeType || mimeType;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) fileError = 'Only JPG, PNG, or WebP screenshots are accepted.';
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('limit', () => { fileError = 'Screenshot must be 8 MB or smaller.'; });
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });
      bb.on('error', reject);
      bb.on('finish', resolve);
      req.pipe(bb);
    });
    await parsed;
    if (fileError) return res.status(400).json({ error: fileError });
    if (!fileBuffer || !fileBuffer.length) return res.status(400).json({ error: 'Please attach a payment screenshot.' });
    const phone = String(fields.whatsapp || '').trim();
    if (!/^\+?[0-9 ()-]{10,18}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid WhatsApp number with country code.' });
    const plan = String(fields.plan || 'Premium membership').slice(0, 100);
    const amount = String(fields.amount || '').slice(0, 20);
    const caption = `New payment proof submission\nPlan: ${plan}\nAmount shown: ₹${amount}\nWhatsApp: ${phone}\nStatus: UNVERIFIED — check payment in your merchant app before sending invite.`;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('photo', new Blob([fileBuffer], { type: mimeType }), fileName);
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    const result = await tg.json();
    if (!tg.ok || !result.ok) return res.status(502).json({ error: 'Could not notify owner on Telegram. Please retry later.' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid upload request. Please retry.' });
  }
};
module.exports.config = { api: { bodyParser: false } };
