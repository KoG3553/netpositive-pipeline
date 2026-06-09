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
[Operator opens dashboard]
        ↓
[Overview: local stats + Windsor insights if connected]
        ↓
[Generate tab: Claude generates 10–15 seasonally-aware ideas]
        ↓
[Queue tab: approve, skip, edit, regenerate ideas]
        ↓
[Export for Canva MCP: copies formatted system prompt to clipboard]
        ↓
[Paste into Claude.ai with Canva MCP → AI generates Pinterest designs]
        ↓
[Download + post to Pinterest]
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

A key engineering decision worth noting: I built and fully integrated Canva's Connect API — OAuth 2.0 with PKCE, brand template autofill, async job polling — then deliberately removed it after determining the output didn't meet real-world quality requirements. Knowing when to remove a working feature is as important as knowing how to build one.

---

## Architecture

| Layer | Technology | Role |
|-------|------------|------|
| Backend | Node.js + Express | REST API, OAuth flows |
| AI generation | Anthropic Claude API (`claude-sonnet-4-5`) | Idea generation |
| Analytics | Windsor.ai (optional) | Performance insights when connected |
| Auth | OAuth 2.0 with PKCE | Canva authentication (built, available as fallback) |
| Design generation | Claude.ai + Canva MCP | Pinterest pin design (human-in-loop step) |
| State | JSON persistence | Ideas + approval status |
| Frontend | Vanilla HTML/JS/CSS | Single-page dashboard |

> **Design generation** is handled via **Claude.ai + Canva MCP** (separate from this backend). The pipeline exports a structured prompt that the operator pastes into Claude.ai, where Canva's MCP integration creates production-quality branded designs.

---

## Engineering highlights

- **Knowing when to cut a feature.** Built and fully validated Canva Connect API integration (OAuth 2.0 with PKCE, brand template autofill, async job polling) — then intentionally removed it after determining template output quality didn't meet brand requirements. Demonstrates the ability to cut features that work technically but fail in practice.
- **Seasonal content intelligence.** Prompt engineering that automatically incorporates the current month, season, and upcoming financial moments (tax season, back-to-school, holiday spending, year-end review) into idea generation. A dedicated "Seasonal" mix generates 8 timely + 4 evergreen + 3 tip ideas in a single call.
- **Local analytics.** Approval rate, content-mix breakdown, and platform distribution — derived entirely from local state (`ideas.json`) with no external API dependency, so the Overview dashboard is always accurate even when Windsor is disconnected.
- **Hybrid AI workflow.** Backend handles data and orchestration; Claude.ai + Canva MCP handles design generation — the right tool for each job, rather than forcing one system to do both.
- **Resilient API field probing.** Windsor connector uses a field-set waterfall: tries the richest field set first, automatically falls back to progressively smaller sets on 400 field errors — no manual intervention needed when a connector has limited field support.
- **Deduplication-aware analytics.** Windsor returns one row per daily snapshot per pin, not one row per pin. The insights endpoints dedupe by `pin_id` / `media_id`, sum metrics across dates, and compute accurate per-pin averages and total counts.
- **Persistent state.** All ideas, approvals, and analytics cache survive server restarts via JSON storage.
- **Secrets management.** `.env` and all token/cache files are gitignored; safe for public repository.

---

## Demo flow

1. Operator opens `http://127.0.0.1:3000` — the **Overview** page shows local stats (total ideas, approval rate, ideas this session, content-mix and platform breakdowns) plus Windsor insights if connected
2. *(Optional)* Clicks **Refresh** on the Windsor panel — backend pulls last 30 days from Windsor (Instagram + Pinterest)
3. Opens the **Generate** tab, selects platform, content mix (including Seasonal 🌿), tone, and any brand notes
4. Clicks **Generate** — Claude returns 10–15 pin ideas in ~5 seconds, seasonally aware and (when enabled) informed by performance data
5. Reviews each idea card; approves, regenerates, edits, or skips
6. Switches to the **Queue** tab to review all approved ideas with status filters
7. Clicks **Export N approved ideas for Canva** — a fully-formatted design system-prompt is copied to clipboard and shown in a read-only preview
8. Pastes the prompt into Claude.ai (with Canva MCP active)
9. Claude generates each pin design one at a time, pausing for approval before the next
10. Downloads finished pins and posts to Pinterest

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

- [x] **Phase 1.** Backend + Claude API + approval UI
- [x] **Phase 2.** Disk persistence
- [x] **Phase 2.5.** Git + GitHub multi-machine workflow
- [x] **Phase 3.** Canva Connect API *(built, validated, intentionally removed)*
- [x] **Phase 5.** Windsor.ai analytics integration
- [x] **Phase 5.5.** Pinterest data dedup, insights dashboard
- [x] **Phase 5.6.** Seasonal content mix, Canva MCP export, UI overhaul
- [ ] **Phase 4.** Pinterest auto-post *(parked — needs custom domain)*
- [ ] **Phase 6.** Scheduled generation (cron job, weekly auto-run)
- [ ] **Phase 7.** Multi-platform export (Instagram Reels format)
- [ ] **Phase 8.** Performance-weighted idea scoring

---

## Known limitations

- **Windsor.ai requires an active subscription for sustained use.** Insights enrichment depends on Windsor's connectors; once the trial lapses the external data goes stale. The Overview dashboard's local stats (approval rate, content mix, platform distribution) are derived from `ideas.json` and remain accurate regardless. On the free tier, engagement fields also returned null/zero, so reach was used as the primary performance proxy.
- **Design generation is a manual step.** Exporting a prompt and pasting it into Claude.ai (with Canva MCP) is an intentional tradeoff — quality over full automation. It produces better designs than programmatic template autofill, but is not hands-off. A future phase could explore Canva MCP invocation from a backend agent.
- **Pinterest auto-post requires the `netpositivemethod.com` domain.** Phase 4 needs a privacy policy URL on a custom domain for Pinterest developer-portal validation; subdomain-style URLs were rejected. Plan: acquire the domain, host a privacy policy, and resubmit for API access.

---

## Local setup

Requires Node.js (v20+) and an Anthropic API key. A Windsor.ai account (Instagram + Pinterest connected) is **optional** — it enriches generation with performance data, but the app and its local Overview stats work fully without it.

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

# Optional — Windsor.ai analytics enrichment. Omit to run without external insights.
WINDSOR_API_KEY=your-windsor-api-key
WINDSOR_INSTAGRAM_ACCOUNT_ID=your-instagram-account-id
# WINDSOR_PINTEREST_ACCOUNT_ID=  # optional — omit to return all connected Pinterest accounts
```

Open `http://127.0.0.1:3000`, head to **Generate**, and create your first batch. If Windsor is configured, use **Refresh** on the Overview's Windsor panel to pull analytics.

---

## License

MIT. Feel free to learn from or adapt the patterns. Brand assets and content are not part of the license.
