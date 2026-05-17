# Net Positive Method — AI Content Pipeline

![Status](https://img.shields.io/badge/status-active-success)
![Phase 5.6](https://img.shields.io/badge/Phase%205.6-complete-22C55E)
![Phase 4](https://img.shields.io/badge/Phase%204-parked-lightgrey)
![Built With](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Claude](https://img.shields.io/badge/Anthropic-Claude%20Sonnet%204.5-D97706)
![Windsor](https://img.shields.io/badge/Windsor.ai-Analytics-8B3DFF)
![License](https://img.shields.io/badge/license-MIT-blue)

An end-to-end AI content pipeline for a personal-finance brand. It generates Pinterest pin ideas with Claude (informed by real performance data), runs them through a custom approval dashboard, and exports a ready-to-paste prompt for high-quality design creation via Claude.ai + Canva MCP.

Built solo as both a working operational tool and a portfolio piece covering API orchestration, analytics integration, prompt engineering, and full-stack development.

---

## What it does

```
[Windsor.ai pulls Instagram + Pinterest analytics]
        ↓ last 30 days of performance data cached
[Operator clicks "Generate"]
        ↓
[Backend + Windsor insights → Anthropic Claude API]
        ↓ generates 15 on-brand, seasonally-aware pin ideas
[Custom approval UI]
        ↓ operator approves, regenerates, edits, or skips
[Click "Export for Canva MCP"]
        ↓ formatted prompt copied to clipboard
[Paste into Claude.ai with Canva MCP active]
        ↓ AI generates high-quality Pinterest designs
[Download + post]
```

The approval gate keeps the operator in creative control. Analytics enrichment means each generation cycle learns from what already performed. Design creation is deliberately handled in Claude.ai (not this backend) — where Canva's MCP integration produces significantly better output than programmatic template autofill.

---

## Why this exists

Most personal-brand creators on Pinterest spend hours each week:

1. Brainstorming pin ideas
2. Writing titles and descriptions
3. Designing each pin in Canva
4. Manually scheduling posts

This system collapses steps 1 through 3 into a single approval-driven workflow. The operator stays in creative control via the approval gate, while the AI handles the production work — and each generation cycle benefits from data on what already worked.

One deliberate decision worth noting: I built and fully integrated Canva's Connect API (OAuth 2.0 with PKCE, brand template autofill, async job polling) but ultimately removed it from the active workflow. The technical integration worked — but the output quality didn't meet real-world brand requirements. Knowing when to cut a working feature because it doesn't serve the actual goal is as important as knowing how to build it. The simpler path — paste a well-structured prompt into Claude.ai with Canva MCP — produces better designs with less code.

---

## Architecture

| Layer | Technology | Role |
|-------|------------|------|
| Backend | Node.js + Express | REST API server, Windsor integration, prompt assembly |
| AI generation | Anthropic Claude API (`claude-sonnet-4-5`) | Generates pin ideas, regenerates on demand |
| Analytics | Windsor.ai REST API | Pulls Instagram + Pinterest performance data into prompt context |
| State | JSON file persistence | Ideas, approval status, analytics cache |
| Frontend | Vanilla HTML / JS / CSS | Custom approval and insights dashboard |
| Version control | Git + GitHub | Source-controlled with proper secrets management |

> **Design generation** is handled via **Claude.ai + Canva MCP** (separate from this backend). The pipeline exports a structured prompt that the operator pastes into Claude.ai, where Canva's MCP integration creates production-quality branded designs.

---

## Engineering highlights

- **Intentional simplification.** Built and fully validated Canva Connect API integration (OAuth 2.0 with PKCE, brand template autofill, async job polling), then removed it after determining the output quality didn't meet brand requirements. Replaced with a human-in-the-loop design step using Claude.ai + Canva MCP — cleaner, better output, less code.
- **Seasonal content awareness.** Prompt engineering that automatically incorporates the current month, season, and upcoming financial moments (tax season, back-to-school, holiday spending, year-end review) into idea generation. A dedicated "Seasonal" mix option generates 8 timely + 4 evergreen + 3 tip ideas in a single call.
- **Multi-source analytics aggregation.** Windsor.ai integration pulls Instagram and Pinterest performance data (reach, engagement, saves) into prompt enrichment. Pinterest is weighted as the primary signal; Instagram as secondary. Insights are cached with a 6-hour TTL and injected into the Claude prompt on every generation cycle.
- **Resilient API field probing.** Windsor connector uses a field-set waterfall: tries the richest field set first, automatically falls back to progressively smaller sets on 400 field errors — no manual intervention needed when a connector has limited field support.
- **Deduplication-aware analytics.** Windsor returns one row per daily snapshot per pin, not one row per pin. The insights endpoints dedupe by `pin_id` / `media_id`, sum metrics across dates, and compute accurate per-pin averages and total counts.
- **Full Insights dashboard.** Two-column performance view (Pinterest + Instagram side by side): top performer tables, day-of-week reach bars, content type breakdown, 7-day reach trend, and data freshness indicators.
- **Persistent state.** All ideas, approvals, and analytics cache survive server restarts via JSON storage.
- **Secrets management.** `.env` and all token/cache files are gitignored; safe for public repository.

---

## Demo flow

1. Operator opens `http://127.0.0.1:3000`
2. Clicks **Refresh insights** — backend pulls last 30 days from Windsor (Instagram + Pinterest)
3. Windsor panel shows live stats: avg engagement, avg reach, top performers
4. Selects platform, content mix (including Seasonal 🌿), tone, and any brand notes
5. Clicks **Generate** — Claude returns 10–15 pin ideas in ~5 seconds, informed by real performance data
6. Reviews each idea card; approves, regenerates, edits, or skips
7. Switches to **Queue** tab to review all approved ideas
8. Clicks **📋 Copy for Canva** — a fully-formatted design prompt is copied to clipboard and shown in a read-only preview
9. Pastes the prompt into Claude.ai (with Canva MCP active)
10. Claude generates each pin design one at a time, pausing for approval before the next
11. Downloads finished pins and posts to Pinterest

---

## Project structure

```
netpositive-pipeline/
├── server.js                        # Node.js backend — API routes, Windsor integration, prompt assembly
├── index.html                       # Custom approval + insights dashboard (vanilla JS)
├── package.json                     # Dependencies and scripts
├── .env                             # Secrets (gitignored)
├── ideas.json                       # Persistent idea store (gitignored)
├── .windsor-insights.json           # Instagram analytics cache (gitignored)
├── .windsor-pinterest-insights.json # Pinterest analytics cache (gitignored)
└── .gitignore                       # Strict secrets exclusion
```

---

## Roadmap

- [x] **Phase 1.** Backend, Claude API integration, custom approval UI
- [x] **Phase 2.** Disk persistence
- [x] **Phase 2.5.** Git + GitHub multi-machine workflow
- [x] **Phase 3.** Canva Connect API OAuth *(built, tested, removed — template output wasn't usable in production)*
- [x] **Phase 5.** Windsor.ai performance feedback loop — Pinterest + Instagram analytics injected into Claude prompt, full Insights dashboard tab
- [x] **Phase 5.5.** Pinterest row dedup by `pin_id`, accurate pin counts, day-of-week breakdown
- [x] **Phase 5.6.** Seasonal content mix, Canva MCP export prompt, removed all design generation code
- [ ] **Phase 4.** Pinterest auto-post *(parked — dev portal requires custom domain for privacy URL)*
- [ ] **Phase 6.** Dynamic prompt context improvements
- [ ] **Phase 7.** Portfolio polish — screenshots, architecture diagram
- [ ] **Phase 8.** Streamlined "ship it" UI

---

## Known limitations

- **Windsor free tier engagement metrics.** `media_engagement` and equivalent Pinterest engagement fields return null/zero on the free tier. The integration falls back to reach as the primary performance proxy. Upgrading Windsor or using the platform Graph APIs directly would unlock full engagement, saves, and CTR data.
- **Pinterest auto-post parked.** Phase 4 requires a privacy policy URL on a custom domain for Pinterest developer portal review. Subdomain-style URLs were rejected. Plan: acquire `netpositivemethod.com`, host a privacy policy there, and resubmit for API access.
- **Design creation is a manual step.** Exporting a prompt and pasting it into Claude.ai is intentional — it produces better quality designs than programmatic autofill — but it is not fully automated. A future phase could explore Canva MCP invocation from a backend agent.

---

## Local setup

Requires Node.js (v20+) and accounts with Anthropic and Windsor.ai (Instagram + Pinterest connected).

```bash
# Clone
git clone https://github.com/KoG3553/netpositive-pipeline.git
cd netpositive-pipeline

# Install
npm install

# Create .env (see template below)
notepad .env

# Run
node server.js
```

`.env` template:

```
ANTHROPIC_API_KEY=your-anthropic-api-key
PORT=3000

WINDSOR_API_KEY=your-windsor-api-key
WINDSOR_INSTAGRAM_ACCOUNT_ID=your-instagram-account-id
# WINDSOR_PINTEREST_ACCOUNT_ID=  # optional — omit to return all connected Pinterest accounts
```

Open `http://127.0.0.1:3000`, click **Refresh insights** to pull the first analytics fetch, then **Generate**.

---

## License

MIT. Feel free to learn from or adapt the patterns. Brand assets and content are not part of the license.
