# Cinna Rewards

The GitHub Pages app in `index.html` uses a Cloudflare Worker to read and update the existing shared Google Sheet. The browser never receives a Google credential. The Worker's Durable Object serializes requests so two users cannot overwrite each other's point updates. The original Apps Script files in `apps-script/` are retained only as an archive.

## Deployment

1. In the Google account that owns the [Cinna Rewards sheet](https://docs.google.com/spreadsheets/d/1A4eVPZhMvrf17UvFhoYxQ1W3ae2Tzh41t8jYblnBoWg/edit), create a Google Cloud project, enable Google Sheets API, and create a service account with a JSON key. Share only this sheet with the service account email as Editor.
2. In the personal Cloudflare account, deploy `worker/` with Wrangler: `pnpm dlx wrangler deploy`. Set the full JSON key as the Worker secret `GOOGLE_SERVICE_ACCOUNT_JSON` using `pnpm dlx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`. Never commit the key.
3. Set `API_URL` in `index.html` to the deployed `https://cinna-rewards-api.puririrorinpa.workers.dev`. Check that the Worker reads the current points, coupons, wishlist, people, and history from the original sheet. Test one reversible edit before publishing.
4. Publish `index.html` through GitHub Pages from `main` and the repository root. Verify the published page reads and writes through the Worker, then retire the old Apps Script deployment if desired.

The Worker expects the five existing tabs and column headers from `apps-script/Code.gs`. It does not create or reset the database. `SHEET_ID` and `FRONTEND_ORIGIN` are configured in `worker/wrangler.toml`; the service account key belongs only in the Cloudflare secret. Run `node --test worker/src/index.test.js` for the core point and coupon rules.
https://porogirl1412.github.io/cinna-rewards/
