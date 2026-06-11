# ProIdeaStore Platform

ProIdeaStore is the curated opportunity dossier layer in the Open Frontier store ecosystem.

It turns the best FreeIdeaStore activity into investment-ready or build-ready packets with research, validation, prototype scope, risk memos, pitch material, and contributor history.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for dossiers, diligence notes, interest signals, and graduation events.
- Hosted dossier pages at `/dossiers/:id/`.
- Seed data in `packages/worker/migrations/0001_dossiers.sql`.

## Local Preview

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

Live Worker:

https://proideastore.online

## Product Principle

Do not sell raw ideas. Sell diligence, readiness, access, and reputation.

## Relationship To FreeIdeaStore

FreeIdeaStore is the cheap, high-volume public layer. Raw ideas stay as D1/R2-backed one-page records there.

ProIdeaStore is the curated layer. A promoted idea becomes a dossier with buyer clarity, evidence, missing diligence, assets, notes, and interest signals. This is where full Zensical-style books, prototype packets, pitch decks, and serious investment/build research should live.

## API

- `GET /api/health`
- `GET /api/dossiers`
- `POST /api/dossiers`
- `GET /api/dossiers/:id`
- `GET /api/dossiers/:id/notes`
- `POST /api/dossiers/:id/notes`
- `POST /api/dossiers/:id/interest`
- `POST /api/dossiers/:id/graduations`
