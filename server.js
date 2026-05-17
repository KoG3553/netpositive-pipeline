// server.js — Net Positive Method Content Pipeline
// Phase 6: Seasonal content mix, Canva MCP export, design code removed

require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express   = require('express');
const cors      = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CLAUDE_MODEL = 'claude-sonnet-4-5';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE                       = path.join(__dirname, 'ideas.json');
const WINDSOR_INSIGHTS_FILE           = path.join(__dirname, '.windsor-insights.json');
const WINDSOR_PINTEREST_INSIGHTS_FILE = path.join(__dirname, '.windsor-pinterest-insights.json');

// Windsor config
const WINDSOR_API_KEY           = process.env.WINDSOR_API_KEY;
const WINDSOR_ACCOUNT_ID        = process.env.WINDSOR_INSTAGRAM_ACCOUNT_ID || '17841448812096533';
const WINDSOR_PINTEREST_ACCOUNT = process.env.WINDSOR_PINTEREST_ACCOUNT_ID || '';

// ---------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------
function loadIdeas() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const ideas = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Strip legacy Canva/pin design fields (Phase 5.6 cleanup)
      // eslint-disable-next-line no-unused-vars
      return ideas.map(({ canva_design_id, canva_design_url, canva_job_status,
                          canva_job_error, pin_generated, image_url, ...rest }) => rest);
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

// Windsor insights cache (disk-backed, 6h TTL)
function loadInsights() {
  try {
    if (fs.existsSync(WINDSOR_INSIGHTS_FILE))
      return JSON.parse(fs.readFileSync(WINDSOR_INSIGHTS_FILE, 'utf8'));
  } catch (err) {}
  return null;
}
function saveInsights(data) {
  fs.writeFileSync(WINDSOR_INSIGHTS_FILE, JSON.stringify(data, null, 2));
}
let cachedInsights = loadInsights();

function loadPinterestInsights() {
  try {
    if (fs.existsSync(WINDSOR_PINTEREST_INSIGHTS_FILE))
      return JSON.parse(fs.readFileSync(WINDSOR_PINTEREST_INSIGHTS_FILE, 'utf8'));
  } catch (err) {}
  return null;
}
function savePinterestInsights(data) {
  fs.writeFileSync(WINDSOR_PINTEREST_INSIGHTS_FILE, JSON.stringify(data, null, 2));
}
let cachedPinterestInsights = loadPinterestInsights();

// ---------------------------------------------------------------
// Windsor.ai — helpers
// ---------------------------------------------------------------
function extractHook(text) {
  if (!text || typeof text !== 'string') return null;
  const firstLine = text.split(/\n/)[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

function scoreEngagement(p, prefix = '') {
  const f   = k => Number(p[prefix + k] || p[k] || 0);
  const eng = f('engagement'); if (eng  > 0) return eng;
  const l   = f('like_count'); const c = f('comments_count');
  if (l > 0 || c > 0) return l + c;
  return f('saves') || f('pin_clicks') || 0;
}

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
      console.log(`[windsor/${connector}] ✓ ${rows.length} rows`);
      return { ok: true, rows, fieldsUsed: fields };
    }

    const txt = await r.text();
    if (r.status === 400 && (txt.includes('Unexpected field') || txt.includes('expected string'))) {
      console.log(`[windsor/${connector}] Field error, trying next fallback…`);
      continue;
    }
    console.error(`[windsor/${connector}] Hard error ${r.status}: ${txt.slice(0, 200)}`);
    return { ok: false, status: r.status, error: txt };
  }
  return { ok: false, error: 'All field sets exhausted' };
}

function buildInsightText({ platform = 'Instagram', totalPosts, avgEngagement, avgReach, topPosts, avgSaves = 0 }) {
  const label = platform === 'Pinterest' ? 'pins' : 'posts';
  let text = `${platform} performance (last 30 days, ${totalPosts} ${label} analyzed):\n`;
  text += `• Avg engagement per ${label.slice(0, -1)}: ${avgEngagement}\n`;
  if (avgReach > 0) text += `• Avg reach per ${label.slice(0, -1)}: ${avgReach}\n`;
  if (avgSaves > 0) text += `• Avg saves per ${label.slice(0, -1)}: ${avgSaves}\n`;

  if      (avgEngagement > 100) text += `• Engagement is strong — double down on top formats.\n`;
  else if (avgEngagement > 20)  text += `• Engagement is moderate — experiment with stronger hooks.\n`;
  else                          text += `• Engagement is low — shift to more provocative openers and high-utility content.\n`;

  if (topPosts.length) {
    const top    = topPosts[0];
    const metric = top.saves > 0 ? `${top.saves} saves` : `${top.engagement} interactions`;
    text += `• Best performing ${label.slice(0, -1)}: ${metric}`;
    if (top.reach > 0) text += `, ${top.reach} reach`;
    text += `\n`;
    if (top.url)   text += `  ${top.url}\n`;
    if (top.title) text += `  Title: "${top.title}"\n`;
  }
  return text;
}

// ---------------------------------------------------------------
// Windsor.ai — /api/windsor/insights (Instagram)
// ---------------------------------------------------------------
app.get('/api/windsor/insights', async (req, res) => {
  const force = req.query.force === 'true';

  if (!force && cachedInsights?.fetched_at) {
    const ageMs = Date.now() - new Date(cachedInsights.fetched_at).getTime();
    if (ageMs < 6 * 60 * 60 * 1000) return res.json({ success: true, cached: true, insights: cachedInsights });
  }

  if (!WINDSOR_API_KEY) return res.status(400).json({ error: 'WINDSOR_API_KEY not set in .env' });

  try {
    const igFieldSets = [
      'date,media_id,media_type,media_permalink,media_caption,media_url,media_impressions,media_reach,media_engagement,media_like_count,media_comments_count',
      'date,media_id,media_type,media_permalink,media_url,media_impressions,media_reach,media_engagement,media_like_count,media_comments_count',
      'date,media_id,media_type,media_url,media_impressions,media_reach,media_engagement,media_like_count,media_comments_count',
      'date,media_id,media_type,media_url,media_impressions,media_reach,media_like_count,media_comments_count',
      'date,media_id,media_like_count',
    ];

    const result = await fetchWindsorData('instagram', igFieldSets, { accounts: WINDSOR_ACCOUNT_ID });
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });

    const rows = result.rows;
    if (rows.length > 0) {
      console.log('[windsor/instagram] First raw row:', JSON.stringify(rows[0]));
    }

    const posts = rows.filter(p => p.date && p.media_id);
    if (!posts.length) {
      const empty = { fetched_at: new Date().toISOString(), total_posts: 0, aggregate: {}, top_posts: [], insight_text: null, platform: 'instagram', warning: 'No rows with date+media_id' };
      cachedInsights = empty; saveInsights(empty);
      return res.json({ success: true, cached: false, insights: empty });
    }

    const enriched = posts.map(p => ({
      date:        p.date,
      media_id:    p.media_id,
      media_type:  p.media_type || 'IMAGE',
      title:       extractHook(p.media_caption) || null,
      url:         p.media_permalink || p.media_url || null,
      impressions: Number(p.media_impressions)    || 0,
      reach:       Number(p.media_reach)          || 0,
      likes:       Number(p.media_like_count)     || 0,
      comments:    Number(p.media_comments_count) || 0,
      engagement:  scoreEngagement(p, 'media_'),
    }));

    const igMap = new Map();
    for (const p of enriched) {
      if (igMap.has(p.media_id)) {
        const e = igMap.get(p.media_id);
        e.impressions += p.impressions; e.reach      += p.reach;
        e.likes       += p.likes;       e.comments   += p.comments;
        e.engagement  += p.engagement;
      } else { igMap.set(p.media_id, { ...p }); }
    }
    const uniquePosts   = [...igMap.values()];
    const topPosts      = [...uniquePosts].sort((a, b) => b.engagement - a.engagement).slice(0, 5);
    const totalPosts    = uniquePosts.length;
    const avgEngagement = totalPosts ? Math.round(uniquePosts.reduce((s, p) => s + p.engagement, 0) / totalPosts) : 0;
    const avgReach      = totalPosts ? Math.round(uniquePosts.reduce((s, p) => s + p.reach,      0) / totalPosts) : 0;
    const dateRange     = { from: enriched.at(-1)?.date, to: enriched[0]?.date };

    const igDayAgg = new Map();
    for (const p of enriched) {
      const d = igDayAgg.get(p.date) || { date: p.date, reach: 0, engagement: 0 };
      d.reach += p.reach; d.engagement += p.engagement;
      igDayAgg.set(p.date, d);
    }
    const dailyData = [...igDayAgg.values()].sort((a, b) => a.date.localeCompare(b.date));

    const igDowAgg = new Map();
    for (const p of enriched) {
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(p.date + 'T12:00:00Z').getDay()];
      const d = igDowAgg.get(dow) || { day: dow, total_reach: 0, total_engagement: 0, count: 0 };
      d.total_reach += p.reach; d.total_engagement += p.engagement; d.count += 1;
      igDowAgg.set(dow, d);
    }
    const igDayBreakdown = [...igDowAgg.values()]
      .map(d => ({
        day:            d.day,
        avg_reach:      d.count ? Math.round(d.total_reach      / d.count) : 0,
        avg_engagement: d.count ? Math.round(d.total_engagement / d.count) : 0,
        count:          d.count
      }))
      .sort((a, b) => b.avg_reach - a.avg_reach);

    const insightText = buildInsightText({ platform: 'Instagram', totalPosts, avgEngagement, avgReach, topPosts });
    const insights = {
      fetched_at: new Date().toISOString(), platform: 'instagram',
      total_posts: totalPosts, date_range: dateRange, fields_used: result.fieldsUsed,
      aggregate: { avg_engagement: avgEngagement, avg_reach: avgReach },
      top_posts: topPosts, daily_data: dailyData, day_breakdown: igDayBreakdown, insight_text: insightText
    };
    cachedInsights = insights; saveInsights(insights);
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
    if (ageMs < 6 * 60 * 60 * 1000) return res.json({ success: true, cached: true, insights: cachedPinterestInsights });
  }

  if (!WINDSOR_API_KEY) return res.status(400).json({ error: 'WINDSOR_API_KEY not set in .env' });

  try {
    const pinFieldSets = [
      'date,pin_id,pin_title,impressions,saves,pin_clicks,outbound_click,engagement',
      'date,pin_id,pin_title,impressions,saves,pin_clicks',
      'date,pin_id,pin_title,impressions,saves',
      'date,pin_id,impressions,saves',
      'date,pin_id,impressions',
    ];

    const extra  = WINDSOR_PINTEREST_ACCOUNT ? { accounts: WINDSOR_PINTEREST_ACCOUNT } : {};
    const result = await fetchWindsorData('pinterest_organic', pinFieldSets, extra);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });

    const rows = result.rows;
    if (rows.length > 0) console.log('[windsor/pinterest] First raw row:', JSON.stringify(rows[0]));

    const pins = rows.filter(p => p.date && p.pin_id);
    if (!pins.length) {
      const empty = { fetched_at: new Date().toISOString(), total_posts: 0, aggregate: {}, top_posts: [], insight_text: null, platform: 'pinterest', warning: 'No rows with date+pin_id. Check Pinterest is connected in Windsor.' };
      cachedPinterestInsights = empty; savePinterestInsights(empty);
      return res.json({ success: true, cached: false, insights: empty });
    }

    const enriched = pins.map(p => ({
      date:        p.date,
      pin_id:      p.pin_id,
      title:       p.pin_title || null,
      url:         p.pin_url || (p.pin_id ? `https://www.pinterest.com/pin/${p.pin_id}/` : null),
      impressions: Number(p.impressions)    || 0,
      saves:       Number(p.saves)          || 0,
      clicks:      Number(p.pin_clicks)     || 0,
      outbound:    Number(p.outbound_click) || 0,
      engagement:  Number(p.engagement) || Number(p.saves) || Number(p.pin_clicks) || 0,
    }));

    const pinMap = new Map();
    for (const p of enriched) {
      if (pinMap.has(p.pin_id)) {
        const e = pinMap.get(p.pin_id);
        e.impressions += p.impressions; e.saves    += p.saves;
        e.clicks      += p.clicks;      e.outbound += p.outbound;
        e.engagement  += p.engagement;
      } else { pinMap.set(p.pin_id, { ...p }); }
    }
    const uniquePins    = [...pinMap.values()];
    const topPosts      = [...uniquePins].sort((a, b) => (b.saves || b.engagement) - (a.saves || a.engagement)).slice(0, 5);
    const totalPosts    = uniquePins.length;
    const avgEngagement = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.engagement,  0) / totalPosts) : 0;
    const avgSaves      = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.saves,        0) / totalPosts) : 0;
    const avgReach      = totalPosts ? Math.round(uniquePins.reduce((s, p) => s + p.impressions,  0) / totalPosts) : 0;
    const dateRange     = { from: enriched.at(-1)?.date, to: enriched[0]?.date };

    const pinDayAgg = new Map();
    for (const p of enriched) {
      const d = pinDayAgg.get(p.date) || { date: p.date, impressions: 0, saves: 0, engagement: 0 };
      d.impressions += p.impressions; d.saves += p.saves; d.engagement += p.engagement;
      pinDayAgg.set(p.date, d);
    }
    const dailyData = [...pinDayAgg.values()].sort((a, b) => a.date.localeCompare(b.date));

    const pinDowAgg = new Map();
    for (const p of enriched) {
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(p.date + 'T12:00:00Z').getDay()];
      const d = pinDowAgg.get(dow) || { day: dow, total_impressions: 0, total_saves: 0, count: 0 };
      d.total_impressions += p.impressions; d.total_saves += p.saves; d.count += 1;
      pinDowAgg.set(dow, d);
    }
    const pinDayBreakdown = [...pinDowAgg.values()]
      .map(d => ({
        day:       d.day,
        avg_reach: d.count ? Math.round(d.total_impressions / d.count) : 0,
        avg_saves: d.count ? Math.round(d.total_saves        / d.count) : 0,
        count:     d.count
      }))
      .sort((a, b) => b.avg_reach - a.avg_reach);

    const insightText = buildInsightText({ platform: 'Pinterest', totalPosts, avgEngagement, avgReach, avgSaves, topPosts });
    const insights = {
      fetched_at: new Date().toISOString(), platform: 'pinterest',
      total_posts: totalPosts, date_range: dateRange, fields_used: result.fieldsUsed,
      aggregate: { avg_engagement: avgEngagement, avg_saves: avgSaves, avg_reach: avgReach },
      top_posts: topPosts, daily_data: dailyData, day_breakdown: pinDayBreakdown, insight_text: insightText
    };
    cachedPinterestInsights = insights; savePinterestInsights(insights);
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
    ? Math.round((Date.now() - new Date(cachedInsights.fetched_at).getTime()) / 3600000) : null;
  const pinAgeH = cachedPinterestInsights?.fetched_at
    ? Math.round((Date.now() - new Date(cachedPinterestInsights.fetched_at).getTime()) / 3600000) : null;

  res.json({
    status:          'ok',
    ideas:           ideasStore.length,
    windsor_key_set: !!WINDSOR_API_KEY,
    instagram: { cached: !!cachedInsights?.insight_text,          age_h: insightsAgeH, posts: cachedInsights?.total_posts          ?? 0 },
    pinterest: { cached: !!cachedPinterestInsights?.insight_text, age_h: pinAgeH,      posts: cachedPinterestInsights?.total_posts ?? 0 }
  });
});

// ---------------------------------------------------------------
// Generate ideas
// ---------------------------------------------------------------
app.post('/api/generate', async (req, res) => {
  const { platform = 'pinterest', mix = 'balanced', tone = 'direct', brandNotes = '', useInsights = true } = req.body;
  let count = parseInt(req.body.count) || 10;

  // Seasonal mix is always 15 ideas (8 seasonal + 4 evergreen + 3 tips)
  if (mix === 'seasonal') count = 15;

  const now       = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' }); // e.g. "May 2026"

  const mixMap = {
    balanced:   '4 cash flow/tracker pins, 3 personal finance tips, 3 side hustle/creator pins',
    tracker:    '7 tracker/product pins, 3 finance tips',
    tips:       `${count} personal finance tip pins`,
    sidehustle: `${count} side hustle and creator economy pins`,
    seasonal:   `It is currently ${monthYear}. Generate ideas that are seasonally relevant — reference the current season, upcoming holidays, or seasonal financial moments (tax season, back-to-school, holiday spending, year-end money review, etc.). Mix: 8 seasonal/timely ideas (use content_type "seasonal"), 4 evergreen tracker/cash flow ideas (use content_type "tracker"), 3 personal finance tips (use content_type "finance_tip").`,
  };

  const toneMap = {
    direct:       'direct and minimal — short sentences, no fluff',
    educational:  'educational and clear — teach one thing per pin',
    motivational: 'motivational — focus on progress and possibility'
  };

  const platformLabel = platform === 'pinterest' ? 'Pinterest pins'
    : platform === 'reel' ? 'Instagram Reels'
    : 'Pinterest pins and Instagram Reels';

  let insightBlock = '';
  const freshH = t => t ? (Date.now() - new Date(t).getTime()) / 3600000 : 999;

  if (useInsights) {
    const pinFresh = cachedPinterestInsights?.insight_text && freshH(cachedPinterestInsights.fetched_at) < 24;
    const igFresh  = cachedInsights?.insight_text           && freshH(cachedInsights.fetched_at)          < 24;

    if (pinFresh || igFresh) {
      const sources = [];
      insightBlock = '\nPERFORMANCE DATA — use this to weight your content choices:\n\n';
      if (pinFresh) { insightBlock += `PRIMARY SOURCE — PINTEREST (last 30 days):\n${cachedPinterestInsights.insight_text}\n\n`; sources.push('Pinterest'); }
      if (igFresh)  { insightBlock += `SECONDARY SOURCE — INSTAGRAM (last 30 days):\n${cachedInsights.insight_text}\n\n`;       sources.push('Instagram'); }
      if (pinFresh)   insightBlock += `IMPORTANT: Pinterest patterns carry more weight for pin idea generation.\n`;
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
- content_type: "tracker" or "finance_tip" or "side_hustle" or "seasonal"`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }]
    });

    const raw   = response.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    let ideas   = JSON.parse(clean);

    ideas = ideas.map((idea, i) => ({
      ...idea,
      id:        Date.now() + i,
      status:    'pending',
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

// ---------------------------------------------------------------
// Ideas CRUD
// ---------------------------------------------------------------
app.get('/api/ideas', (req, res) => res.json({ ideas: ideasStore }));

app.patch('/api/ideas/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  const idea = ideasStore.find(i => i.id === id);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  Object.assign(idea, req.body);
  saveIdeas();
  res.json({ success: true, idea });
});

app.post('/api/ideas/:id/regenerate', async (req, res) => {
  const id   = parseInt(req.params.id);
  const idea = ideasStore.find(i => i.id === id);
  if (!idea) return res.status(404).json({ error: 'Not found' });

  const prompt = `Rewrite this Pinterest pin idea to be stronger — same topic and platform, but better hook, title, and description.

Original:
${JSON.stringify(idea, null, 2)}

Return ONLY a valid JSON object with the same fields: topic, hook, title, description, visual_brief, platform, content_type. No markdown, no preamble.`;

  try {
    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }]
    });
    const raw     = response.content.map(b => b.text || '').join('');
    const clean   = raw.replace(/```json|```/g, '').trim();
    const newIdea = JSON.parse(clean);
    Object.assign(idea, newIdea, { status: 'pending' });
    saveIdeas();
    res.json({ success: true, idea });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/ideas/:id', (req, res) => {
  const id   = parseInt(req.params.id);
  ideasStore = ideasStore.filter(i => i.id !== id);
  saveIdeas();
  res.json({ success: true });
});

app.delete('/api/ideas', (req, res) => {
  ideasStore = [];
  saveIdeas();
  res.json({ success: true });
});

// ---------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\nContent Pipeline running at http://localhost:${PORT}`);
  console.log(`Also accessible at http://127.0.0.1:${PORT}`);
  console.log(`Anthropic key loaded: ${process.env.ANTHROPIC_API_KEY ? 'YES ✓' : 'NO ✗  ← check .env'}`);
  console.log(`Windsor key loaded:   ${process.env.WINDSOR_API_KEY   ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Ideas file: ${DATA_FILE}`);
  console.log(`Claude model: ${CLAUDE_MODEL}\n`);
});
