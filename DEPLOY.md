# ProIdeaStore Deploy

ProIdeaStore is hosted on Cloudflare Workers with Worker Assets and D1.

ProIdeaStore is intentionally the heavier curated layer. FreeIdeaStore should keep raw ideas cheap; promoted ideas become ProIdeaStore dossiers and can later receive full generated books, research packets, prototypes, and pitch assets.

## Live

https://proideastore.online

## Cloudflare Resources

- Worker: `proideastore`
- D1: `proideastore`
- D1 database ID: `503b0125-b2b5-48b0-be47-f0603bc4bfed`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm db:migrate:local
doppler run --project pas --config prd -- pnpm db:migrate:prod
doppler run --project pas --config prd -- pnpm --filter @pis/worker exec wrangler deploy
```

## Custom Domain

`proideastore.online` is the canonical public domain for the ProIdeaStore Worker.

Wrangler config:

```toml
[[routes]]
pattern = "proideastore.online"
zone_name = "proideastore.online"
custom_domain = true
```

The `workers.dev` URL may still exist as a fallback, but product links, sitemap, robots, and Playwright E2E tests use `https://proideastore.online`.

## Doppler

The Doppler workspace is currently at the 10-project limit, so there is no dedicated `pis` project yet. Deployment currently uses the existing Cloudflare credentials from the `pas` Doppler project.
