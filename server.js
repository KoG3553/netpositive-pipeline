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
const WINDSOR_INSIGHTS_FILE           = path.join(__dirname, '.windsor-insights.json');
const WINDSOR_PINTEREST_INSIGHTS_FILE = path.join(__dirname, '.windsor-pinterest-insights.json');

// Windsor config
const WINDSOR_API_KEY            = process.env.WINDSOR_API_KEY;
const WINDSOR_ACCOUNT_ID         = process.env.WINDSOR_INSTAGRAM_ACCOUNT_ID || '17841448812096533';
const WINDSOR_PINTEREST_ACCOUNT  = process.env.WINDSOR_PINTEREST_ACCOUNT_ID || '';

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

// Windsor insights cache (disk-backed, 6 h TTL)
function loadInsights() {
  try {
    if (fs.existsSync(WINDSOR_INSIGHTS_FILE)) {
      return JSON.parse(fs.readFileSync(WINDSOR_INSIGHTS_FILE, 'utf8'));
    }
  } catch (err) {}
  return null;
}

function saveInsights(data) {
  fs.writeFileSync(WINDSOR_INSIGHTS_FILE, JSON.stringify(data, null, 2));
}

let cachedInsights = loadInsights();

// Pinterest insights cache
function loadPinterestInsights() {
  try {
    if (fs.existsSync(WINDSOR_PINTEREST_INSIGHTS_FILE)) {
      return JSON.parse(fs.readFileSync(WINDSOR_PINTEREST_INSIGHTS_FILE, 'utf8'));
    }
  } catch (err) {}
  return null;
}
function savePinterestInsights(data) {
  fs.writeFileSync(WINDSOR_PINTEREST_INSIGHTS_FILE, JSON.stringify(data, null, 2));
}
let cachedPinterestInsights = loadPinterestInsights();

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
// Windsor.ai — helpers
// ---------------------------------------------------------------

// Extract the hook (first line of caption/title) from a raw string
function extractHook(text) {
  if (!text || typeof text !== 'string') return null;
  const firstLine = text.split(/\n/)[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

// Composite engagement score — use the best available metric
function scoreEngagement(p, prefix = '') {
  const f  = k => Number(p[prefix + k] || p[k] || 0);
  const eng = f('engagement');  if (eng  > 0) return eng;
  const l   = f('like_count'); const c = f('comments_count');
  if (l > 0 || c > 0) return l + c;
  return f('saves') || f('pin_clicks') || 0;
}

// Generic Windsor fetcher with automatic field-set fallback.
// Tries each field set in order; moves to the next on a 400 field-error.
async function fetchWindsorData(connector, fieldSets, extraParams = {}) {
  if (!WINDSOR_API_KEY) return { ok: false, error: 'WINDSOR_API_KEY not set' };

  for (const fields of fieldSets) {
    const params = new URLSearchParams({
      api_key:     WINDSOR_API_KEY,
      fields,
      date_preset: 'last_30dT',
      ...extraParams
    });
    const url = `https://connectors.windsor.ai/${connector}?${params}`;
    console.log(`[windsor/${connector}] Trying ${fields.split(',').length} fields`);

    let r;
    try { r = await fetch(url); } catch (e) {
      return { ok: false, error: `Network error: ${e.message}` };
    }

    if (r.ok) {
      const raw  = await r.json();
      const rows = Array.isArray(raw) ? raw : (raw.data || []);
      console.log(`[windsor/${connector}] ✓ ${rows.length} rows — fields: ${fields}`);
      return { ok: true, rows, fieldsUsed: fields };
    }

    const txt = await r.text();
    if (r.status === 400 && (txt.includes('Unexpected field') || txt.includes('expected string'))) {
      console.log(`[windsor/${connector}] Field error, trying next fallback set…`);
      console.log(`[windsor/${connector}]   ${txt.slice(0, 200)}`);
      continue;
    }
    // Hard error (auth, server, etc.) — don't retry
    console.error(`[windsor/${connector}] Hard error ${r.status}: ${txt.slice(0, 200)}`);
    return { ok: false, status: r.status, error: txt };
  }
  return { ok: false, error: 'All field sets exhausted' };
}

function buildInsightText({ platform = 'Instagram', totalPosts, avgEngagement, avgReach, topPosts, avgSaves = 0 }) {
  const label = platform === 'Pinterest' ? 'pins' : 'posts';
  let text = `${platform} performance (last 30 days, ${totalPosts} ${label} analyzed):\n`;
  text += `• Avg engagement per ${label.slice(0,-1)}: ${avgEngagement}\n`;
  if (avgReach > 0)  text += `• Avg reach per ${label.slice(0,-1)}: ${avgReach}\n`;
  if (avgSaves > 0)  text += `• Avg saves per ${label.slice(0,-1)}: ${avgSaves}\n`;

  if (avgEngagement > 100) {
    text += `• Engagement is strong — content is clearly resonating. Double down on top formats.\n`;
  } else if (avgEngagement > 20) {
    text += `• Engagement is moderate — experiment with stronger hooks and more utility-driven content.\n`;
  } else {
    text += `• Engagement is low — shift to more provocative openers and high-utility content (tools, trackers, one clear takeaway per pin).\n`;
  }

  if (topPosts.length) {
    const top = topPosts[0];
    const metric = top.saves > 0 ? `${top.saves} saves` : `${top.engagement} interactions`;
    text += `• Best performing ${label.slice(0,-1)}: ${metric}`;
    if (top.reach > 0) text += `, ${top.reach} reach`;
    text += `\n`;
    if (top.url) text += `  ${top.url}\n`;
    if (top.title) text += `  Title: "${top.title}"\n`;
  }

  return text;
}

// ---------------------------------------------------------------
// Windsor.ai — /api/windsor/insights
// ---------------------------------------------------------------
app.get('/api/windsor/insights', async (req, res) => {
  const force = req.query.force === 'true';

  // Serve from cache if fresh (< 6 h) and not forced
  if (!force && cachedInsights?.fetched_at) {
    const ageMs = Date.now() - new Date(cachedInsights.fetched_at).getTime();
    if (ageMs < 6 * 60 * 60 * 1000) {
      return res.json({ success: true, cached: true, insights: cachedInsights });
    }
  }

  if (!WINDSOR_API_KEY) {
    return res.status(400).json({ error: 'WINDSOR_API_KEY not set in .env' });
  }

  try {
    // Field sets in priority order — falls back if a field is unsupported on this account
    const igFieldSets = [
      'date,media_id,media_type,media_url,media_impressions,media_reach,media_engagement,media_like_count,media_comments_count',
      'date,media_id,media_type,media_url,media_impressions,media_reach,media_like_count,media_comments_count',
      'date,media_id,media_type,media_url,media_like_count,media_comments_count',
      'date,media_id,media_like_count',
    ];

    const result = await fetchWindsorData('instagram', igFieldSets, { accounts: WINDSOR_ACCOUNT_ID });
    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    const rows = result.rows;

    // DEBUG: show first raw row so we can confirm which fields are populated
    if (rows.length > 0) {
      const s = rows[0];
      console.log('[windsor/instagram] First raw row:', JSON.stringify(s));
      console.log('[windsor/instagram] Field presence:', Object.fromEntries(
        Object.entries(s).map(([k, v]) => [k, (v !== null && v !== undefined && v !== '') ? '✓' : '—'])
      ));
    }

    const posts = rows.filter(p => p.date && p.media_id);
    console.log(`[windsor/instagram] ${posts.length} / ${rows.length} rows have date+media_id`);

    if (!posts.length) {
      const empty = { fetched_at: new Date().toISOString(), total_posts: 0, aggregate: {}, top_posts: [], insight_text: null, platform: 'instagram', warning: 'No rows with date+media_id' };
      cachedInsights = empty; saveInsights(empty);
      return res.json({ success: true, cached: false, insights: empty });
    }

    const enriched = posts.map(p => ({
      date:        p.date,
      media_id:    p.media_id,
      media_type:  p.media_type || 'IMAGE',
      url:         p.media_url  || null,
      impressions: Number(p.media_impressions)      || 0,
      reach:       Number(p.media_reach)            || 0,
      likes:       Number(p.media_like_count)       || 0,
      comments:    Number(p.media_comments_count)   || 0,
      engagement:  scoreEngagement(p, 'media_'),
    }));

    // Dedupe by media_id: Windsor returns one row per daily snapshot per post.
    // Sum metrics across all date rows so each unique post has 30-day totals.
    const igMap = new Map();
    for (const p of enriched) {
      if (igMap.has(p.media_id)) {
        const e = igMap.get(p.media_id);
        e.impressions += p.impressions;
        e.reach       += p.reach;
        e.likes       += p.likes;
        e.comments    += p.comments;
        e.engagement  += p.engagement;
      } else {
        igMap.set(p.media_id, { ...p });
      }
    }
    const uniquePosts = [...igMap.values()];

    const topPosts      = [...uniquePosts].sort((a, b) => b.engagement - a.engagement).slice(0, 5);
    const totalPosts    = uniquePosts.length;
    const avgEngagement = totalPosts ? Math.round(uniquePosts.reduce((s, p) => s + p.engagement, 0) / totalPosts) : 0;
    const avgReach      = totalPosts ? Math.round(uniquePosts.reduce((s, p) => s + p.reach,      0) / totalPosts) : 0;
    const dateRange     = { from: enriched.at(-1)?.date, to: enriched[0]?.date };

    const insightText = buildInsightText({ platform: 'Instagram', totalPosts, avgEngagement, avgReach, topPosts });

    const insights = {
      fetched_at:  new Date().toISOString(),
      platform:    'instagram',
      total_posts: totalPosts,
      date_range:  dateRange,
      fields_used: result.fieldsUsed,
      aggregate:   { avg_engagement: avgEngagement, avg_reach: avgReach },
      top_posts:   topPosts,
      insight_text: insightText
    };

    cachedInsights = insights;
    saveInsights(insights);
    res.json({ success: true, cached: false, insights });
  } catch (err) {
    console.error('[windsor/instagram] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Windsor.ai — /api/windsor/pinterest-insights
// ---------------------------------------------------------------
app.get('/api/windsor/pinterest-insights', async (req, res) => {
  const force = req.query.force === 'true';

  if (!force && cachedPinterestInsights?.fetched_at) {
    const ageMs = Date.now() - new Date(cachedPinterestInsights.fetched_at).getTime();
    if (ageMs < 6 * 60 * 60 * 1000) {
      return res.json({ success: true, cached: true, insights: cachedPinterestInsights });
    }
  }

  if (!WINDSOR_API_KEY) {
    return res.status(400).json({ error: 'WINDSOR_API_KEY not set in .env' });
  }

  try {
    // Field sets in priority order — falls back automatically on field errors
    const pinFieldSets = [
      'date,pin_id,pin_title,impressions,saves,pin_clicks,outbound_click,engagement',
      'date,pin_id,pin_title,impressions,saves,pin_clicks',
      'date,pin_id,pin_title,impressions,saves',
      'date,pin_id,impressions,saves',
      'date,pin_id,impressions',
    ];

    const extra = WINDSOR_PINTEREST_ACCOUNT ? { accounts: WINDSOR_PINTEREST_ACCOUNT } : {};
    const result = await fetchWindsorData('pinterest_organic', pinFieldSets, extra);

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    const rows = result.rows;

    if (rows.length > 0) {
      console.log('[windsor/pinterest] First raw row:', JSON.stringify(rows[0]));
      console.log('[windsor/pinterest] Field presence:', Object.fromEntries(
        Object.entries(rows[0]).map(([k, v]) => [k, (v !== null && v !== undefined && v !== '') ? '✓' : '—'])
      ));
    }

    const pins = rows.filter(p => p.date && p.pin_id);
    console.log(`[windsor/pinterest] ${pins.length} / ${rows.length} rows have date+pin_id`);

    if (!pins.length) {
      const empty = { fetched_at: new Date().toISOString(), total_posts: 0, aggregate: {}, top_posts: [], insight_text: null, platform: 'pinterest', warning: 'No rows with date+pin_id. Check Pinterest is connected in Windsor.' };
      cachedPinterestInsights = empty; savePinterestInsights(empty);
      return res.json({ success: true, cached: false, insights: empty });
    }

    const enriched = pins.map(p => ({
      date:        p.date,
      pin_id:      p.pin_id,
      title:       p.pin_title || null,
      url:         p.pin_url   || null,
      impressions: Number(p.impressions)     || 0,
      saves:       Number(p.saves)           || 0,
      clicks:      Number(p.pin_clicks)      || 0,
      outbound:    Number(p.outbound_click)  || 0,
      engagement:  Number(p.engagement) || Number(p.saves) || Number(p.pin_clicks) || 0,
    }));

    // Dedupe by pin_id: Windsor returns one row per daily snapshot per pin.
    // Sum metrics across all date rows so each unique pin has 30-day totals.
    const pinMap = new Map();
    for (const p of enriched) {
      if (pinMap.has(p.pin_id)) {
        const e = pinMap.get(p.pin_id);
        e.impressions += p.impressions;
        e.saves       += p.saves;
        e.clicks      += p.clicks;
        e.outbound    += p.outbound;
        e.engagement  += p.engagement;
      } else {
        pinMap.set(p.pin_id, { ...p });
      }
    }
    const uniquePins = [...pinMap.values()];

    // Pinterest primary sort: saves (most intent-driven metric); fallback to engagement
    const topPosts      = [...uniquePins].sort((a, b) => (b.saves || b.engagement) - (a.saves || a.engagement)).slice(0, 5);
    const totalPosts    = uniquePins.length;
    const avgEngagement = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.engagement, 0) / totalPosts) : 0;
    const avgSaves      = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.saves,      0) / totalPosts) : 0;
    const avgReach      = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.impressions,0) / totalPosts) : 0;
    const dateRange     = { from: enriched.at(-1)?.date, to: enriched[0]?.date };

    const insightText = buildInsightText({ platform: 'Pinterest', totalPosts, avgEngagement, avgReach, avgSaves, topPosts });

    const insights = {
      fetched_at:  new Date().toISOString(),
      platform:    'pinterest',
      total_posts: totalPosts,
      date_range:  dateRange,
      fields_used: result.fieldsUsed,
      aggregate:   { avg_engagement: avgEngagement, avg_saves: avgSaves, avg_reach: avgReach },
      top_posts:   topPosts,
      insight_text: insightText
    };

    cachedPinterestInsights = insights;
    savePinterestInsights(insights);
    res.json({ success: true, cached: false, insights });
  } catch (err) {
    console.error('[windsor/pinterest] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Health
// ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const insightsAgeH = cachedInsights?.fetched_at
    ? Math.round((Date.now() - new Date(cachedInsights.fetched_at).getTime()) / 3600000)
    : null;

  const pinAgeH = cachedPinterestInsights?.fetched_at
    ? Math.round((Date.now() - new Date(cachedPinterestInsights.fetched_at).getTime()) / 3600000)
    : null;

  res.json({
    status: 'ok',
    ideas: ideasStore.length,
    canva_connected: !!canvaTokens,
    windsor_key_set: !!WINDSOR_API_KEY,
    instagram: {
      cached:   !!cachedInsights?.insight_text,
      age_h:    insightsAgeH,
      posts:    cachedInsights?.total_posts ?? 0
    },
    pinterest: {
      cached:   !!cachedPinterestInsights?.insight_text,
      age_h:    pinAgeH,
      posts:    cachedPinterestInsights?.total_posts ?? 0
    }
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
  const { platform = 'pinterest', count = 10, mix = 'balanced', tone = 'direct', brandNotes = '', useInsights = true } = req.body;

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

  // Build combined insight block from Pinterest (primary) + Instagram (secondary)
  let insightBlock = '';
  const freshH = t => t ? (Date.now() - new Date(t).getTime()) / 3600000 : 999;

  if (useInsights) {
    const pinFresh = cachedPinterestInsights?.insight_text && freshH(cachedPinterestInsights.fetched_at) < 24;
    const igFresh  = cachedInsights?.insight_text           && freshH(cachedInsights.fetched_at)          < 24;
    const sources  = [];

    if (pinFresh || igFresh) {
      insightBlock = '\nPERFORMANCE DATA — use this to weight your content choices:\n\n';

      if (pinFresh) {
        insightBlock += `PRIMARY SOURCE — PINTEREST (last 30 days):\n${cachedPinterestInsights.insight_text}\n\n`;
        sources.push('Pinterest');
      }
      if (igFresh) {
        insightBlock += `SECONDARY SOURCE — INSTAGRAM (last 30 days):\n${cachedInsights.insight_text}\n\n`;
        sources.push('Instagram');
      }
      if (pinFresh) {
        insightBlock += `IMPORTANT: The user's primary output platform is Pinterest. Pinterest patterns carry more weight than Instagram patterns for pin idea generation.\n`;
      }

      console.log(`[generate] Insights injected from: ${sources.join(', ')}`);
    }
  } else {
    console.log('[generate] Insights disabled by user toggle');
  }

  const prompt = `You are a content strategist for Net Positive Method — a faceless personal finance brand that sells a cash flow tracker on Gumroad and Etsy.

Core philosophy: most people have a visibility problem, not a money problem. The only number that matters is whether cash flow ends the month positive or negative.
${insightBlock}
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