/* ============================================================
   DeniaTempMail — Express proxy for Guerrilla Mail API
   Node ≥18 (native fetch). Deploy: Railway.
   ============================================================ */

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GM_API = 'https://api.guerrillamail.com/ajax.php';

/* ---------- Middleware ---------- */
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Guerrilla Mail request helper ----------
   Forwards session cookie (PHPSESSID) so Guerrilla keeps state.
   Returns parsed JSON + relevant Set-Cookie to propagate back.
--------------------------------------------------------- */
async function gmFetch(params, incomingCookie) {
  const qs = new URLSearchParams({ ip: '127.0.0.1', agent: 'DeniaTempMail', ...params });
  const url = `${GM_API}?${qs}`;

  const headers = { 'User-Agent': 'DeniaTempMail/1.0' };
  if (incomingCookie) headers['Cookie'] = incomingCookie;

  const res = await fetch(url, { headers });
  const data = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';

  return { data, setCookie };
}

/* ---------- Extract PHPSESSID from Set-Cookie header ---------- */
function extractPhpSess(setCookie) {
  if (!setCookie) return '';
  const m = setCookie.match(/PHPSESSID=([^;]+)/);
  return m ? `PHPSESSID=${m[1]}` : '';
}

/* ============================================================
   API ROUTES (7 endpoints — spec cố định)
   ============================================================ */

/* ---------- 1. Create inbox ---------- */
app.get('/api/create-inbox', async (req, res) => {
  try {
    const { data, setCookie } = await gmFetch({ f: 'get_email_address' });
    const phpSess = extractPhpSess(setCookie);
    if (phpSess) res.setHeader('Set-Cookie', `${phpSess}; Path=/; HttpOnly; SameSite=Lax`);

    res.json({
      email: data.email_addr,
      sid_token: data.sid_token,
      timestamp: data.email_timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 2. Check inbox ---------- */
app.get('/api/check-inbox', async (req, res) => {
  const { sid_token, seq = 0 } = req.query;
  if (!sid_token) return res.status(400).json({ error: 'sid_token required' });

  try {
    const { data } = await gmFetch(
      { f: 'check_email', sid_token, seq },
      req.headers.cookie
    );
    res.json({ list: data.list || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 3. Read message ---------- */
app.get('/api/read-message', async (req, res) => {
  const { sid_token, email_id } = req.query;
  if (!sid_token || !email_id) return res.status(400).json({ error: 'sid_token and email_id required' });

  try {
    const { data } = await gmFetch(
      { f: 'fetch_email', sid_token, email_id },
      req.headers.cookie
    );
    res.json({
      mail_id: data.mail_id,
      mail_from: data.mail_from,
      mail_subject: data.mail_subject,
      mail_body: data.mail_body,
      mail_timestamp: data.mail_timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 4. Set custom username ---------- */
app.get('/api/set-username', async (req, res) => {
  const { sid_token, username } = req.query;
  if (!sid_token || !username) return res.status(400).json({ error: 'sid_token and username required' });

  try {
    const { data } = await gmFetch(
      { f: 'set_email_user', sid_token, email_user: username },
      req.headers.cookie
    );
    res.json({ email: data.email_addr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 5. Extend session ---------- */
app.get('/api/extend', async (req, res) => {
  const { sid_token } = req.query;
  if (!sid_token) return res.status(400).json({ error: 'sid_token required' });

  try {
    const { data } = await gmFetch({ f: 'extend', sid_token }, req.headers.cookie);
    res.json({ ok: true, expires: data.email_timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 6. Forget address ---------- */
app.get('/api/forget', async (req, res) => {
  const { sid_token } = req.query;
  if (!sid_token) return res.status(400).json({ error: 'sid_token required' });

  try {
    await gmFetch({ f: 'forget_me', sid_token }, req.headers.cookie);
    res.setHeader('Set-Cookie', 'PHPSESSID=; Path=/; Max-Age=0');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 7. Delete message ---------- */
app.get('/api/delete', async (req, res) => {
  const { sid_token, email_id } = req.query;
  if (!sid_token || !email_id) return res.status(400).json({ error: 'sid_token and email_id required' });

  try {
    await gmFetch({ f: 'del_email', sid_token, email_ids: email_id }, req.headers.cookie);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- Health check ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'DeniaTempMail', timestamp: Date.now() });
});

/* ---------- SPA fallback ---------- */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- Boot ---------- */
app.listen(PORT, () => {
  console.log(`DeniaTempMail running on port ${PORT}`);
});
