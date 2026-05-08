# Net Positive Method, AI Content Pipeline

![Status](https://img.shields.io/badge/status-active-success)
![Phase 5](https://img.shields.io/badge/Phase%205-complete-22C55E)
![Phase 4](https://img.shields.io/badge/Phase%204-parked-lightgrey)
![Built With](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Claude](https://img.shields.io/badge/Anthropic-Claude%20Sonnet%204.5-D97706)
![Canva](https://img.shields.io/badge/Canva-Connect%20API-00C4CC?logo=canva&logoColor=white)
![Windsor](https://img.shields.io/badge/Windsor.ai-Analytics-8B3DFF)
![License](https://img.shields.io/badge/license-MIT-blue)

An end-to-end, AI-powered content automation system. It generates Pinterest pin ideas with Claude, lets the operator approve them through a custom dashboard, automatically creates branded designs in Canva, and feeds real Instagram and Pinterest performance data back into the AI prompt so it gets smarter over time.

Built solo as both a working tool for a personal-finance brand and a portfolio piece showcasing API orchestration, OAuth 2.0, analytics integration, and full-stack development.

---

## What it does

```
[Windsor.ai pulls Instagram + Pinterest analytics]
        ↓ last 30 days of performance data cached
[Operator clicks "Generate"]
        ↓
[Backend, Anthropic Claude API]
        ↓ generates 10 on-brand pin ideas, informed by real performance data
[Custom approval UI]
        ↓ operator approves, regenerates, edits, or skips
[Backend, Canva Connect API]
        ↓ submits autofill job to Brand Template
[Async polling until job completes]
        ↓
[Branded Canva design ready in operator's account]
```

A single click turns an approved idea into a finished pin design. The AI prompt is enriched with real analytics so each generation cycle learns from what actually performed.

---

## Why this exists

Most personal-brand creators on Pinterest spend hours each week:

1. Brainstorming pin ideas
2. Writing titles and descriptions
3. Designing each pin in Canva
4. Manually scheduling posts

This system collapses steps 1 through 3 into a single approval-driven workflow. The operator stays in creative control via the approval gate, while the AI and APIs handle the production work — and each generation cycle benefits from data on what already worked.

---

## Architecture

| Layer | Technology | Role |
|-------|------------|------|
| Backend | Node.js + Express | REST API server, OAuth flows, job polling |
| AI generation | Anthropic Claude API (`claude-sonnet-4-5`) | Generates pin ideas, regenerates on demand |
| Design generation | Canva Connect API | Brand Template autofill via OAuth 2.0 |
| Analytics | Windsor.ai REST API | Pulls Instagram + Pinterest performance data into prompt context |
| State | JSON file persistence | Ideas, approval status, analytics cache |
| Auth | OAuth 2.0 with PKCE | Per Canva's security requirements |
| Frontend | Vanilla HTML / JS / CSS | Custom approval dashboard |
| Version control | Git + GitHub | Source-controlled with proper secrets management |

---

## Engineering highlights

- **OAuth 2.0 with PKCE.** Full implementation of authorization code flow with PKCE challenge and verifier for Canva integration.
- **Token refresh.** Automatic refresh of expired access tokens before API calls.
- **Async job polling.** Submits autofill jobs and polls until completion or timeout, since Canva renders designs asynchronously.
- **Multi-source analytics aggregation.** Windsor.ai integration pulls Instagram and Pinterest performance data (reach, engagement, saves) into prompt enrichment. Pinterest is weighted as the primary signal; Instagram as secondary. Insights are cached with a 6-hour TTL and injected into the Claude prompt on every generation cycle.
- **Resilient API field probing.** Windsor connector uses a field-set waterfall: tries the richest field set first, automatically falls back to progressively smaller sets on 400 field errors — no manual intervention needed when a connector has limited fields.
- **Persistent state.** All ideas, approvals, design references, and analytics cache survive server restarts via JSON storage.
- **Secrets management.** `.env` and token/cache files are gitignored; safe for public repository.
- **Cross-service orchestration.** Single backend coordinates 4 different APIs (Anthropic, Canva, Windsor Instagram, Windsor Pinterest) with different auth models and response shapes.

---

## Demo flow

1. Operator opens `http://127.0.0.1:3000`
2. Connects Canva account once via OAuth (one click)
3. Sets a Brand Template ID — the visual master template
4. Clicks **Refresh insights** — backend pulls last 30 days from Windsor (Instagram + Pinterest)
5. Windsor panel shows live stats: avg engagement, avg reach, top performers
6. Selects platform, content mix, tone, and any brand notes
7. Clicks **Generate** — Claude returns 10 pin ideas in ~5 seconds, informed by real performance data
8. Reviews each idea card; approves, regenerates, edits, or skips
9. Clicks **Create Design** on an approved idea
10. Backend submits autofill job to Canva and polls for completion
11. Designed pin appears in operator's Canva account, ready to publish

---

## Project structure

```
netpositive-pipeline/
├── server.js                        # Node.js backend, all API routes, OAuth, polling, Windsor integration
├── index.html                       # Custom approval dashboard (vanilla JS)
├── package.json                     # Dependencies and scripts
├── .env                             # Secrets (gitignored)
├── .canva-tokens.json               # Canva OAuth tokens (gitignored)
├── ideas.json                       # Persistent idea store (gitignored)
├── .windsor-insights.json           # Instagram analytics cache (gitignored)
├── .windsor-pinterest-insights.json # Pinterest analytics cache (gitignored)
└── .gitignore                       # Strict secrets exclusion
```

---

## Roadmap

- [x] **Phase 1.** Backend, Claude integration, custom approval UI
- [x] **Phase 2.** Disk persistence
- [x] **Phase 2.5.** Git and GitHub multi-machine workflow
- [x] **Phase 3.** Canva OAuth and autofill via Brand Templates
- [x] **Phase 5.** Windsor.ai performance feedback loop — Pinterest + Instagram analytics injected into Claude prompt. Expanded analytics UI with top-performer cards, date ranges, and per-platform breakdown.
- [ ] **Phase 4.** Pinterest auto-post *(parked — Pinterest dev portal rejects subdomain privacy URLs; plan is to acquire netpositivemethod.com domain and resubmit)*
- [ ] **Phase 5.5.** Dedupe Pinterest rows by `pin_id`; smarter top-performer extraction weighted by saves rate
- [ ] **Phase 6.** Dynamic prompt context (seasonal, trend-aware generation)
- [ ] **Phase 7.** Polished portfolio doc with screenshots and architecture diagram
- [ ] **Phase 8.** Streamlined "ship it" UI — single-button workflow per idea

---

## Known issues / future improvements

**Pinterest row over-reporting.** Windsor returns one row per daily metric snapshot per pin, so a pin active for 30 days appears as 30 rows. Current code counts rows rather than unique pins. Fix: dedupe by `pin_id` before aggregating, which will give accurate `total_posts` and more reliable per-pin averages.

**Engagement metrics on Windsor free tier.** `media_engagement` and equivalent Pinterest engagement fields return 0 on the free tier. The integration falls back to reach as the primary performance proxy. Upgrading Windsor tier (or pulling directly from the Instagram/Pinterest Graph APIs) would unlock full engagement, saves, and click-through data.

**Pinterest auto-post parked.** Phase 4 (Pinterest API auto-posting) requires a privacy policy URL on a custom domain for the Pinterest developer portal review. Subdomain-style URLs (e.g. GitHub Pages) were rejected. Plan is to acquire `netpositivemethod.com`, host the privacy policy there, and resubmit for API access.

---

## Local setup

Requires Node.js (v20+) and accounts with Anthropic, Canva (developer access), and Windsor.ai (Instagram + Pinterest connected).

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

CANVA_CLIENT_ID=your-canva-client-id
CANVA_CLIENT_SECRET=your-canva-client-secret
CANVA_REDIRECT_URI=http://127.0.0.1:3000/oauth/canva/callback

WINDSOR_API_KEY=your-windsor-api-key
WINDSOR_INSTAGRAM_ACCOUNT_ID=17841448812096533
# WINDSOR_PINTEREST_ACCOUNT_ID=  # optional — omit to return all connected Pinterest accounts
```

Open `http://127.0.0.1:3000`, connect Canva, then click **Refresh insights** to pull the first analytics fetch.

---

## Why I built it

I wanted to ship a working AI integration end-to-end. Not just prompt-engineer in a chat window, but architect a real system that orchestrates multiple external APIs through a custom backend — and then closes the feedback loop so the AI gets smarter with each cycle. The result is something I actually use to operate Net Positive Method, while doubling as evidence of full-stack thinking and iterative product development.

---

## License

MIT. Feel free to learn from or adapt the patterns. Brand assets and content are not part of the license.
