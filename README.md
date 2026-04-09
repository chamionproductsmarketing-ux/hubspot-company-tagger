# HubSpot Company Tagger

Webhook middleware for **Champion Products** that automatically populates the `categories_purchased` and `vendors_purchased` multi-checkbox properties on HubSpot Company records, based on `product_group_id` and `supplier_id` values from deal line items synced by the P21 ERP.

## How It Works

```
P21 ERP syncs order → Deal created/updated in HubSpot with line items
                        ↓
HubSpot fires webhook (deal.propertyChange on dealstage)
                        ↓
This middleware receives the webhook
                        ↓
Reads line items → extracts product_group_id + supplier_id
                        ↓
Maps product_group_id → "Categories Purchased" checkbox option (label)
Maps supplier_id       → "Vendors Purchased" checkbox option (supplier_id = internal value)
                        ↓
Merges new values into Company record (deduped, append-only)
```

## Deployment (Vercel)

- **GitHub:** `git@github.com:chamionproductsmarketing-ux/hubspot-company-tagger.git`
- **Vercel:** `https://vercel.com/chamionproductsmarketing-2911s-projects/hubspot-company-tagger`
- **Live URL:** `https://hubspot-company-tagger.vercel.app`

### First-time setup
1. Add env vars from `.env.example` to Vercel → Settings → Environment Variables
2. Push code to `main` — Vercel builds automatically
3. Hit `https://hubspot-company-tagger.vercel.app/api/hubspot/status` to verify connectivity
4. Configure HubSpot webhook (see below)
5. Optionally run `https://hubspot-company-tagger.vercel.app/api/hubspot/backfill?key=YOUR_KEY` to tag existing deals

## HubSpot Webhook Setup

1. Go to your HubSpot App → **Webhooks**
2. Set the **Target URL** to `https://hubspot-company-tagger.vercel.app/api/hubspot/webhook`
3. Create a subscription:
   - **Object:** Deal
   - **Event type:** Property change
   - **Property:** `dealstage`
4. Activate the subscription
5. Copy the **Client secret** from the webhook settings into the `HUBSPOT_WEBHOOK_SECRET` env var

## API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/hubspot/status` | GET | Health check — verifies token and both properties exist |
| `/api/hubspot/webhook` | POST | HubSpot webhook receiver |
| `/api/hubspot/backfill` | GET | Scans all deals and tags companies (auth with `?key=`) |

## Mappings

- **145 product group mappings** in `lib/mappings.js` — maps P21 `product_group_id` → `categories_purchased` option label
- **519 supplier IDs** in `lib/mappings.js` — validated against the `vendors_purchased` options where internal value = supplier_id

To add new mappings, edit `lib/mappings.js` and redeploy.

## Environment Variables

| Key | Required | Description |
|-----|----------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | Private app or OAuth access token |
| `HUBSPOT_WEBHOOK_SECRET` | No | Enables signature verification |
| `DEAL_STAGE_TRIGGER` | No | Limit to specific stage (e.g. `closedwon`) |
| `BACKFILL_KEY` | No | Auth key for the backfill endpoint |
