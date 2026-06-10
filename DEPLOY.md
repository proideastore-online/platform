# ProIdeaStore Deploy

ProIdeaStore is hosted on Cloudflare Workers with Worker Assets and D1.

## Live

https://proideastore.serge-the-dev.workers.dev

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

`proideastore.online` is not currently a Cloudflare zone in the account used for deployment, so the Worker is live on `workers.dev`.

When the zone exists:

1. Add route blocks back to `packages/worker/wrangler.toml`.
2. Update canonical links and sitemap to `https://proideastore.online/`.
3. Deploy with Wrangler.

## Doppler

The Doppler workspace is currently at the 10-project limit, so there is no dedicated `pis` project yet. Deployment currently uses the existing Cloudflare credentials from the `pas` Doppler project.

