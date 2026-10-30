# Oasis: an AI agent for your Shopify store

Oasis is a standalone web app that connects to a Shopify store and lets you work with its data through an AI agent. Ask questions in plain language, get live charts, pin them to a dashboard, and let the agent make changes. Every change waits for your approval and can be undone.

## Features

**Ask and analyse**
- Chat with an agent that answers from live Admin GraphQL and ShopifyQL data: orders, products, customers, inventory, discounts, analytics.
- Generative UI: charts, KPI tiles and tables render inline. Pin any of them to a dashboard where tiles are draggable, resizable and snap to a 12-column grid, and analytics tiles re-query on every load.
- Proactive store brief: each morning (or on demand) it compares the week with the previous one, flags unusual days, returns spikes, stockout risks and products below the margin target, and writes a short summary.
- Profit and margins from unit costs; inventory forecast with days of stock left, reorder quantities and a purchase order CSV.
- Weekly PDF report, kept in the app, plus print-to-PDF for the dashboard and chats.
- Meta Ads: campaign performance and return on ad spend joined with Shopify revenue.

**Act, safely**
- Writes are proposed on an approval card that shows the live "before" values next to the proposed ones:
  - discounts (optionally limited to a customer segment)
  - prices, products, inventory, tags and unit costs
  - draft orders, cancellations and fulfillment
  - customer segments
  - products created from a web link
  - Liquid pages
- Bulk changes ("raise all snowboards 5% rounded to .99", "tag everyone who spent over 1000") as one reviewable change.
- Undo: each write stores its before-state; reverse it from the card, the Activity page, or by asking the agent.
- Guards: an unconverted foreign-currency price is refused automatically, Liquid sections are checked for Shopify schema and readability rules before publishing, and web fetching blocks private addresses.

**Content**
- Paste a product link (or upload a saved page when a site blocks scraping): the agent extracts the title, price, specs and photos and creates a listing with original copy.
- Generates Liquid sections (landing pages or a product-specific PDP), previews them with real products and the theme's own CSS, and publishes to an unpublished copy of the live theme.
- Reads supplier invoices, price lists and stock counts (PDF, CSV, image) and reconciles them with the catalog.

**Agent ergonomics**
- Store memory ("our margin target is 45%") applied to every answer.
- Run history: tool calls, timings, Shopify query cost and token usage per request.
- Voice input, model picker (Anthropic, OpenAI, Google, with automatic fallback).

## Stack

Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS 4, Vercel AI SDK 7, Drizzle ORM with Postgres, Recharts, react-grid-layout, @react-pdf/renderer, liquidjs, Vitest.

```
src/app            pages (chat, dashboard, documents, pages, reports, activity, settings) and API routes
src/lib/agent      model registry, system prompt, tools (read, write + undo, ui, docs, liquid, web, growth, ads, briefs, memory)
src/lib/shopify    OAuth, Admin GraphQL client, validated queries and mutations, read-only query guard
src/lib            analytics, insights, reports, scheduler, Meta client, documents, Liquid checks and preview
scripts            seeding (orders, history, costs, dashboard), GraphQL validation, agent smoke tests
shopify-app        Shopify app configuration (shopify.app.toml)
```

## Getting started

Requirements: Node 22+, pnpm, Docker, the Shopify CLI, a Shopify Partner or Dev Dashboard account with a development store, and at least one LLM API key.

```bash
pnpm install
docker compose up -d          # Postgres on localhost:5433
cp .env.example .env          # then fill it in (see below)
pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

1. **Create the Shopify app.** In `shopify-app/`, link your own app with `shopify app config link`. This replaces the `client_id`; keep the redirect URL `http://localhost:3000/api/auth/callback`. Then run `shopify app deploy`.
2. **Copy the app's credentials into `.env`** with `shopify app env pull --env-file ../.env`. Generate `ENCRYPTION_KEY` and `SESSION_SECRET` with `openssl rand -hex 32`, and add an LLM key.
3. **Enable protected customer data** for the app in the Partner/Dev Dashboard (API access → Protected customer data: data plus the name, email, phone and address fields). Development stores don't need a review. Without it, orders, customers and ShopifyQL are blocked.
4. **Connect the store.** Open http://localhost:3000 and connect your store.
5. **Optional demo data:**
   - `pnpm seed:history` backdates orders across 90 days
   - `pnpm seed:costs` adds unit costs so margins have data
   - `pnpm seed:dashboard` pins a starter set of analytics tiles

Optional settings in `.env`:
- `META_APP_ID` and `META_APP_SECRET`, for "Connect with Facebook" (otherwise paste an `ads_read` token in Settings).
- `CRON_SECRET`, for `GET /api/cron` when deployed.
- `OASIS_SCHEDULER=off`, to disable the in-app scheduler.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` / `pnpm lint` | Type and lint checks |
| `pnpm validate:graphql` | Validates every Admin GraphQL operation against Shopify's schema (needs the shopify-ai-toolkit Claude plugin) |
| `pnpm llm:check [provider:model]` | Tool-calling smoke test for the configured model |
| `pnpm agent:check "question"` | Sends a prompt through the running app's chat API and prints tool calls and the answer |
| `pnpm seed:history`, `seed:costs`, `seed:dashboard` | Demo data, as above |

## Notes and limitations

- **Single-merchant, local-first.** Uploads and reports are stored under `.data/`. The scheduler runs inside the server process, so use `/api/cron` when deploying.
- **Rights to scraped content.** Text and photos taken from third-party pages need the owner's permission before selling on a real store. The agent writes original copy and the approval card warns about this.
- **Theme files.** Writing them needs an exemption for public apps; it works for development stores. Generated pages go to an unpublished theme copy, never the live theme.
- **Dev store throttling.** Development stores limit API order creation to a few orders per minute; the history seeder paces itself.
