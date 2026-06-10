# ProIdeaStore Platform

ProIdeaStore is the curated opportunity dossier layer in the Open Frontier store ecosystem.

It turns the best FreeIdeaStore activity into investment-ready or build-ready packets with research, validation, prototype scope, risk memos, pitch material, and contributor history.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for dossiers, diligence notes, interest signals, and graduation events.
- Seed data in `packages/worker/migrations/0001_dossiers.sql`.

## Local Preview

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

Live Worker:

https://proideastore.serge-the-dev.workers.dev

## Product Principle

Do not sell raw ideas. Sell diligence, readiness, access, and reputation.

## API

- `GET /api/health`
- `GET /api/dossiers`
- `POST /api/dossiers`
- `GET /api/dossiers/:id/notes`
- `POST /api/dossiers/:id/notes`
- `POST /api/dossiers/:id/interest`
- `POST /api/dossiers/:id/graduations`

