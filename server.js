// server.js — Net Positive Method Content Pipeline
// Phase 2: Disk persistence (ideas saved to ideas.json)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ---------------------------------------------------------------
// PHASE 2: Disk persistence
// Ideas are saved to ideas.json in the project folder.
// Every change (generate, approve, edit, delete) writes to disk.
// On server startup, we load whatever was saved last.
// ---------------------------------------------------------------

const DATA_FILE = path.join(__dirname, 'ideas.json');

function loadIdeas() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      console.log(`Loaded ${parsed.length} saved ideas from disk`);
      return parsed;
    }
  } catch (err) {
    console.error('Could not load ideas.json, starting fresh:', err.message);
  }
  return [];
}

function saveIdeas() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(ideasStore, null, 2));
  } catch (err) {
    console.error('Could not save to disk:', err.message);
  }
}

let ideasStore = loadIdeas();

// ---------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ideas: ideasStore.length });
});

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
      model: 'claude-sonnet-4-20250514',
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
    saveIdeas(); // persist to disk
    res.json({ success: true, ideas });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ideas', (req, res) => {
  res.json({ ideas: ideasStore });
});

app.patch('/api/ideas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idea = ideasStore.find(i => i.id === id);
  if (!idea) return res.status(404).json({ error: 'Not found' });

  Object.assign(idea, req.body);
  saveIdeas(); // persist to disk
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const newIdea = JSON.parse(clean);

    Object.assign(idea, newIdea, { status: 'pending' });
    saveIdeas(); // persist to disk
    res.json({ success: true, idea });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/ideas/:id', (req, res) => {
  const id = parseInt(req.params.id);
  ideasStore = ideasStore.filter(i => i.id !== id);
  saveIdeas(); // persist to disk
  res.json({ success: true });
});

app.delete('/api/ideas', (req, res) => {
  ideasStore = [];
  saveIdeas(); // persist to disk
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\nContent Pipeline running at http://localhost:${PORT}`);
  console.log(`Ideas persisted to: ${DATA_FILE}\n`);
});