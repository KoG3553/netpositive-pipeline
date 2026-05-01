// server.js — Net Positive Method Content Pipeline
// Phase 3: Canva OAuth + Auto-polling autofill jobs

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use the latest Claude model
const CLAUDE_MODEL = 'claude-sonnet-4-5';

// Canva config
const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID;
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;
const CANVA_REDIRECT_URI = process.env.CANVA_REDIRECT_URI;
const CANVA_AUTH_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const CANVA_API_BASE = 'https://api.canva.com/rest/v1';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'ideas.json');
const TOKEN_FILE = path.join(__dirname, '.canva-tokens.json');
const PKCE_FILE = path.join(__dirname, '.canva-pkce.json');

// ---------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------
function loadIdeas() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Could not load ideas.json:', err.message);
  }
  return [];
}

function saveIdeas() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(ideasStore, null, 2));
  } catch (err) {
    console.error('Could not save ideas:', err.message);
  }
}

let ideasStore = loadIdeas();

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (err) {}
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

let canvaTokens = loadTokens();

// ---------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------
async function ensureValidToken() {
  if (!canvaTokens) throw new Error('Not connected to Canva. Click Connect Canva first.');

  const now = Date.now();
  if (canvaTokens.expires_at && now < canvaTokens.expires_at - 60000) {
    return canvaTokens.access_token;
  }

  const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: canvaTokens.refresh_token
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Token refresh failed: ' + err);
  }

  const data = await res.json();
  canvaTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || canvaTokens.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  };
  saveTokens(canvaTokens);
  return canvaTokens.access_token;
}

// ---------------------------------------------------------------
// Health
// ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ideas: ideasStore.length,
    canva_connected: !!canvaTokens
  });
});

// ---------------------------------------------------------------
// Canva OAuth
// ---------------------------------------------------------------
app.get('/oauth/canva/start', (req, res) => {
  if (!CANVA_CLIENT_ID || !CANVA_REDIRECT_URI) {
    return res.status(500).send('Canva credentials missing in .env');
  }

  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(PKCE_FILE, JSON.stringify({ verifier, state }, null, 2));

  const scopes = [
    'design:content:read',
    'design:content:write',
    'design:meta:read',
    'asset:read',
    'asset:write',
    'brandtemplate:content:read',
    'brandtemplate:meta:read'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CANVA_CLIENT_ID,
    redirect_uri: CANVA_REDIRECT_URI,
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });

  res.redirect(`${CANVA_AUTH_URL}?${params.toString()}`);
});

app.get('/oauth/canva/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<h2>Canva auth error</h2><pre>${error}</pre><a href="/">Back</a>`);
  if (!code) return res.send('<h2>No code returned</h2><a href="/">Back</a>');

  let pkce;
  try { pkce = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8')); }
  catch (e) { return res.send('<h2>PKCE state lost. Try connecting again.</h2><a href="/">Back</a>'); }

  if (state !== pkce.state) {
    return res.send('<h2>State mismatch — possible CSRF. Try again.</h2><a href="/">Back</a>');
  }

  try {
    const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(CANVA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CANVA_REDIRECT_URI,
        code_verifier: pkce.verifier
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return res.send(`<h2>Token exchange failed</h2><pre>${errText}</pre><a href="/">Back</a>`);
    }

    const data = await tokenRes.json();
    canvaTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    saveTokens(canvaTokens);
    fs.unlinkSync(PKCE_FILE);

    res.send(`
      <html><body style="font-family:sans-serif;background:#0B0F14;color:#22C55E;text-align:center;padding:4rem;">
        <h1>Canva connected.</h1>
        <p>You can close this window and return to the app.</p>
        <script>setTimeout(()=>window.location='/',2000)</script>
      </body></html>
    `);
  } catch (err) {
    res.send(`<h2>Error: ${err.message}</h2><a href="/">Back</a>`);
  }
});

app.post('/api/canva/disconnect', (req, res) => {
  canvaTokens = null;
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// Canva: list brand templates
// ---------------------------------------------------------------
app.get('/api/canva/brand-templates', async (req, res) => {
  try {
    const token = await ensureValidToken();
    const r = await fetch(`${CANVA_API_BASE}/brand-templates`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inspect a brand template's expected fields
app.get('/api/canva/brand-templates/:id/dataset', async (req, res) => {
  try {
    const token = await ensureValidToken();
    const r = await fetch(`${CANVA_API_BASE}/brand-templates/${req.params.id}/dataset`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Canva: AUTOFILL — submit + auto-poll until done
// ---------------------------------------------------------------
async function pollJob(token, jobId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(`${CANVA_API_BASE}/autofills/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    console.log(`[poll ${i+1}/${maxAttempts}] job ${jobId} status:`, data.job?.status);
    if (data.job?.status === 'success' || data.job?.status === 'failed') {
      return data;
    }
  }
  return { job: { status: 'timeout' } };
}

app.post('/api/canva/autofill', async (req, res) => {
  const { brand_template_id, idea_id } = req.body;
  const idea = ideasStore.find(i => i.id === idea_id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });

  console.log(`\n[autofill] Submitting for idea ${idea_id}: "${idea.topic}"`);
  console.log(`[autofill] Template: ${brand_template_id}`);
  console.log(`[autofill] Data:`, { hook: idea.hook, title: idea.title, description: idea.description });

  try {
    const token = await ensureValidToken();

    const submitRes = await fetch(`${CANVA_API_BASE}/autofills`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        brand_template_id,
        data: {
          hook: { type: 'text', text: idea.hook || '' },
          title: { type: 'text', text: idea.title || '' },
          description: { type: 'text', text: idea.description || '' }
        }
      })
    });

    const submitData = await submitRes.json();
    console.log(`[autofill] Submit response:`, JSON.stringify(submitData, null, 2));

    if (!submitRes.ok) {
      return res.status(submitRes.status).json({ error: submitData });
    }

    const jobId = submitData.job?.id;
    if (!jobId) {
      return res.json({ success: false, error: 'No job ID returned', data: submitData });
    }

    // Poll until done
    const finalResult = await pollJob(token, jobId);
    console.log(`[autofill] Final status:`, finalResult.job?.status);

    if (finalResult.job?.status === 'success' && finalResult.job?.result?.design) {
      idea.canva_design_id = finalResult.job.result.design.id;
      idea.canva_design_url = finalResult.job.result.design.url;
      idea.canva_job_status = 'success';
      saveIdeas();
    } else {
      idea.canva_job_status = finalResult.job?.status || 'unknown';
      if (finalResult.job?.error) {
        idea.canva_job_error = finalResult.job.error;
      }
      saveIdeas();
    }

    res.json({ success: true, data: finalResult });
  } catch (err) {
    console.error('[autofill] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Existing routes (Phase 1 + 2)
// ---------------------------------------------------------------
app.post('/api/generate', async (req, res) => {
  const { platform = 'pinterest', count = 10, mix = 'balanced', tone = 'direct', brandNotes = '' } = req.body;

  const mixMap = {
    balanced: '4 cash flow/tracker pins, 3 personal finance tips, 3 side hustle/creator pins',
    tracker: '7 tracker/product pins, 3 finance tips',
    tips: `${count} personal finance tip pins`,
    sidehustle: `${count} side hustle and creator economy pins`
  };

  const toneMap = {
    direct: 'direct and minimal — short sentences, no fluff',
    educational: 'educational and clear — teach one thing per pin',
    motivational: 'motivational — focus on progress and possibility'
  };

  const platformLabel = platform === 'pinterest' ? 'Pinterest pins' : platform === 'reel' ? 'Instagram Reels' : 'Pinterest pins and Instagram Reels';

  const prompt = `You are a content strategist for Net Positive Method — a faceless personal finance brand that sells a cash flow tracker on Gumroad and Etsy.

Core philosophy: most people have a visibility problem, not a money problem. The only number that matters is whether cash flow ends the month positive or negative.

Generate exactly ${count} ${platformLabel}.

Content mix: ${mixMap[mix] || mixMap.balanced}
Tone: ${toneMap[tone] || toneMap.direct}
${brandNotes ? `Brand notes: ${brandNotes}` : ''}

Return ONLY a valid JSON array. No markdown. No preamble. No explanation.

Each object must have exactly these fields:
- topic: short phrase (3-6 words)
- hook: on-screen text, under 8 words, lowercase, punchy
- title: Pinterest pin title, under 60 chars
- description: Pinterest description, 2-3 sentences, no hashtags, ends with a soft CTA to the tracker
- visual_brief: one sentence describing the design (text placement, color, mood)
- platform: "Pinterest" or "Reel" or "Both"
- content_type: "tracker" or "finance_tip" or "side_hustle"`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    let ideas = JSON.parse(clean);

    ideas = ideas.map((idea, i) => ({
      ...idea,
      id: Date.now() + i,
      status: 'pending',
      createdAt: new Date().toISOString()
    }));

    ideasStore = [...ideas, ...ideasStore];
    saveIdeas();
    res.json({ success: true, ideas });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ideas', (req, res) => res.json({ ideas: ideasStore }));

app.patch('/api/ideas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idea = ideasStore.find(i => i.id === id);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  Object.assign(idea, req.body);
  saveIdeas();
  res.json({ success: true, idea });
});

app.post('/api/ideas/:id/regenerate', async (req, res) => {
  const id = parseInt(req.params.id);
  const idea = ideasStore.find(i => i.id === id);
  if (!idea) return res.status(404).json({ error: 'Not found' });

  const prompt = `Rewrite this Pinterest pin idea to be stronger — same topic and platform, but better hook, title, and description.

Original:
${JSON.stringify(idea, null, 2)}

Return ONLY a valid JSON object with the same fields: topic, hook, title, description, visual_brief, platform, content_type. No markdown, no preamble.`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const newIdea = JSON.parse(clean);

    Object.assign(idea, newIdea, { status: 'pending' });
    saveIdeas();
    res.json({ success: true, idea });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/ideas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  ideasStore = ideasStore.filter(i => i.id !== id);
  saveIdeas();
  res.json({ success: true });
});

app.delete('/api/ideas', (req, res) => {
  ideasStore = [];
  saveIdeas();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\nContent Pipeline running at http://localhost:${PORT}`);
  console.log(`Also accessible at http://127.0.0.1:${PORT}`);
  console.log(`Ideas: ${DATA_FILE}`);
  console.log(`Canva connected: ${!!canvaTokens}`);
  console.log(`Claude model: ${CLAUDE_MODEL}\n`);
});