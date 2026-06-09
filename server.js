// LegalForms — Express server
// Serves index.html and proxies to Claude + OpenAI APIs.
//
// Required env vars:
//   OPENAI_API_KEY    — for /api/transcribe (Whisper)
//   ANTHROPIC_API_KEY — for /api/generate (Crown Court narrative)
//
// Usage:
//   npm install
//   OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... node server.js

const express = require('express');
const multer = require('multer');
const path = require('path');

// Native fetch and FormData are built into Node 18+ — no extra packages needed
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/login ──────────────────────────────────────────
// Validates an access code against the ACCESS_CODES env var.
// ACCESS_CODES=firm1code,firm2code,firm3code
app.post('/api/login', (req, res) => {
  const { code } = req.body || {};
  const codes = (process.env.ACCESS_CODES || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (!code || !codes.includes(code)) {
    return res.json({ ok: false });
  }
  res.json({ ok: true });
});

// ── POST /api/verify ─────────────────────────────────────────
// Checks if a previously stored access code is still valid
// (allows revocation by removing a code from ACCESS_CODES).
app.post('/api/verify', (req, res) => {
  const { code } = req.body || {};
  const codes = (process.env.ACCESS_CODES || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  res.json({ ok: !!(code && codes.includes(code)) });
});

// ── POST /api/transcribe ──────────────────────────────────────
// Receives multipart audio, sends to OpenAI Whisper, returns { text }
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY not set on server' });

  try {
    const mime = req.file.mimetype || 'audio/webm';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', new File([req.file.buffer], `recording.${ext}`, { type: mime }));
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Whisper error:', data);
      return res.status(502).json({ error: data.error?.message || 'Whisper API error' });
    }

    res.json({ text: data.text });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/generate ────────────────────────────────────────
// Proxies Crown Court narrative generation to Anthropic Claude
app.post('/api/generate', async (req, res) => {
  const { system, messages } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'No messages provided' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: system || '',
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Claude error:', data);
      return res.status(502).json({ error: data.error?.message || 'Claude API error' });
    }

    res.json(data);
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LegalForms server running at http://localhost:${PORT}`);
  console.log(`  OPENAI_API_KEY:    ${process.env.OPENAI_API_KEY    ? '✓ set' : '✗ missing'}`);
  console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ missing'}`);
  const codes = (process.env.ACCESS_CODES || '').split(',').filter(Boolean);
  console.log(`  ACCESS_CODES:      ${codes.length ? `✓ ${codes.length} code(s)` : '✗ missing — all logins will fail'}`);
});
