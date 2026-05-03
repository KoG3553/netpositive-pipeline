# Net Positive Method, AI Content Pipeline

![Status](https://img.shields.io/badge/status-active-success)
![Phase 3](https://img.shields.io/badge/Phase%203-complete-22C55E)
![Phase 4](https://img.shields.io/badge/Phase%204-in%20progress-orange)
![Built With](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Claude](https://img.shields.io/badge/Anthropic-Claude%20Sonnet%204.5-D97706)
![Canva](https://img.shields.io/badge/Canva-Connect%20API-00C4CC?logo=canva&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

An end-to-end, AI-powered content automation system. It generates Pinterest pin ideas with Claude, lets the operator approve them through a custom dashboard, and automatically creates branded designs in Canva via the Canva Connect API.

Built solo as both a working tool for a personal-finance brand and a portfolio piece showcasing API orchestration, OAuth 2.0, and full-stack development.

---

## What it does

```
[Operator clicks "Generate"]
        ↓
[Backend, Anthropic Claude API]
        ↓ generates 10 on-brand pin ideas
[Custom approval UI]
        ↓ operator approves, regenerates, edits, or skips
[Backend, Canva Connect API]
        ↓ submits autofill job to Brand Template
[Async polling until job completes]
        ↓
[Branded Canva design ready in operator's account]
```

A single click turns an approved idea into a finished pin design. The next phase adds Pinterest auto-posting to close the full loop.

---

## Why this exists

Most personal-brand creators on Pinterest spend hours each week:

1. Brainstorming pin ideas
2. Writing titles and descriptions
3. Designing each pin in Canva
4. Manually scheduling posts

This system collapses steps 1 through 3 into a single approval-driven workflow. The operator stays in creative control via the approval gate, while the AI and APIs handle the production work.

---

## Architecture

| Layer | Technology | Role |
|-------|------------|------|
| Backend | Node.js + Express | REST API server, OAuth flows, job polling |
| AI generation | Anthropic Claude API (`claude-sonnet-4-5`) | Generates pin ideas, regenerates on demand |
| Design generation | Canva Connect API | Brand Template autofill via OAuth 2.0 |
| State | JSON file persistence | Ideas + approval status |
| Auth | OAuth 2.0 with PKCE | Per Canva's security requirements |
| Frontend | Vanilla HTML / JS / CSS | Custom approval dashboard |
| Version control | Git + GitHub | Source-controlled with proper secrets management |

---

## Engineering highlights

- **OAuth 2.0 with PKCE.** Full implementation of authorization code flow with PKCE challenge and verifier for Canva integration.
- **Token refresh.** Automatic refresh of expired access tokens before API calls.
- **Async job polling.** Submits autofill jobs and polls until completion or timeout, since Canva renders designs asynchronously.
- **Persistent state.** All ideas, approvals, and design references survive server restarts via JSON storage.
- **Secrets management.** `.env` and token files are gitignored; safe for public repository.
- **Cross-service orchestration.** Single backend coordinates 3 different APIs with different auth models.

---

## Demo flow

1. Operator opens `http://127.0.0.1:3000`
2. Connects Canva account once via OAuth (one click)
3. Sets a Brand Template ID, the visual master template
4. Selects platform, content mix, tone, and any brand notes
5. Clicks **Generate**, Claude returns 10 pin ideas in about 5 seconds
6. Reviews each idea card; approves, regenerates, edits, or skips
7. Clicks **Create Design** on an approved idea
8. Backend submits autofill job to Canva and polls for completion
9. Designed pin appears in operator's Canva account, ready to publish

---

## Project structure

```
netpositive-pipeline/
├── server.js           # Node.js backend, API routes, OAuth flows, polling
├── index.html          # Custom approval dashboard (vanilla JS)
├── package.json        # Dependencies and scripts
├── .env                # Secrets (gitignored)
├── .canva-tokens.json  # OAuth tokens (gitignored)
├── ideas.json          # Persistent idea store (gitignored)
└── .gitignore          # Strict secrets exclusion
```

---

## Roadmap

- [x] **Phase 1.** Backend, Claude integration, custom approval UI
- [x] **Phase 2.** Disk persistence
- [x] **Phase 2.5.** Git and GitHub multi-machine workflow
- [x] **Phase 3.** Canva OAuth and autofill via Brand Templates
- [ ] **Phase 4.** Pinterest API integration for auto-posting
- [ ] **Phase 5.** Performance feedback loop via Windsor.ai (post analytics into smarter prompts)
- [ ] **Phase 6.** Dynamic prompt context (seasonal, trend-aware)

---

## Local setup

Requires Node.js (v20+) and accounts with Anthropic and Canva (with developer access enabled).

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
```

Open `http://127.0.0.1:3000` and click **Connect Canva** to complete one-time OAuth.

---

## Why I built it

I wanted to ship a working AI integration end-to-end. Not just prompt-engineer in a chat window, but architect a real system that orchestrates multiple external APIs through a custom backend. The result is something I actually use to operate Net Positive Method, while doubling as evidence of full-stack thinking.

---

## License

MIT. Feel free to learn from or adapt the patterns. Brand assets and content are not part of the license.