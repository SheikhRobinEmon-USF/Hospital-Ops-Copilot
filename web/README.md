# Hospital Ops Copilot: web app

The primary interface for Hospital Ops Copilot: a Next.js 16 dashboard with a streaming, evidence-grounded AI
copilot. It talks to the FastAPI service in the repository root; every figure on screen comes from that API.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, React Compiler, Cache Components) with React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 with design tokens (OKLCH), dark-mode-first with a full light theme |
| Components | Radix UI primitives (accessible dialogs, popovers, sliders, tooltips), lucide icons |
| Motion | Motion (`LazyMotion`, async features): spring counters, shared-layout transitions, staggered reveals |
| Data | TanStack Query with previous-data placeholders; typed API client |
| Charts | Hand-written SVG for small multiples (percentile strips, sparklines); Recharts (lazy) for trends |
| Command palette | cmdk (`⌘K`): search 6,000+ hospitals, jump to views, ask the copilot |
| Component workshop | Storybook 10 (`npm run storybook`) |

## UX

- **AI-native, not bolted on.** The copilot docks beside every view (`⌘J`). Insight cards, KPI rows, opportunity
  rows, the what-if model, and the command palette all hand questions to it with one click.
- **Transparent agent.** Answers stream token by token, with a live timeline of the tools the agent calls, a
  "figures verified" badge from the server-side grounding check, sources (CMS report ID, fiscal period, fields),
  and suggested follow-ups. Voice dictation uses the Web Speech API where the browser supports it.
- **Proactive insights.** The overview leads with the biggest sized opportunity, risks, and strengths computed from
  the benchmark, before the user asks anything.
- **Shareable state.** Hospital, year, peer group, and view sync to the URL.
- **Accessible.** Keyboard reachable throughout, labeled controls, visible focus rings, `prefers-reduced-motion`
  respected, skip link. Lighthouse accessibility 100.

## Performance

- The page is a static, prerendered shell (27 KB of HTML).
- A small inline script starts the first view's API requests before the JavaScript bundle loads, so the hospital name
  and KPIs paint as soon as React hydrates.
- Every view is its own chunk; Recharts loads only with the Trends view; the copilot and command palette load when
  first needed (or when the browser is idle).
- The animation engine loads asynchronously (`LazyMotion`).
- The API gzips responses and caches computed benchmarks in memory (a cache hit is about 2 ms).
- Fonts are self-hosted (Geist), with no layout shift from late-loading fonts.

## Run

The API must be running (`hoc api` from the repository root, port 8000).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. For a production build:

```bash
npm run build && npm start
```

Set `NEXT_PUBLIC_API_URL` if the API is not at `http://localhost:8000`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run storybook` | Component workshop on port 6006 |
