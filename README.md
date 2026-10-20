# Cinna Rewards

GitHub Pages entry point for the existing Cinna Rewards app.

The page embeds the deployed Google Apps Script app. Google Sheets remains the shared database, and existing points, coupons, wishlist, and history behavior is unchanged. The direct-app link is available if browser restrictions prevent embedding.

## Files

- `index.html`: GitHub Pages entry point.
- `apps-script/Code.gs` and `apps-script/Index.html`: original supplied Apps Script sources, preserved without changes.

## Deployment

Enable GitHub Pages from the `main` branch and `/ (root)` folder. Apps Script sources are stored here for version control; GitHub does not execute `.gs` files. To update application behavior, update the existing Apps Script project and publish a new version of its existing deployment, retaining its URL and database configuration.

No spreadsheet data or credentials are stored in this repository. This repository uses the existing Apps Script deployment and its existing access settings.
