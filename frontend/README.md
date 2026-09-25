# frontend/

Static site deployed to **GitHub Pages**. No build step — these files are served exactly as
they are (docs/DECISIONS.md D-003).

```text
index.html            Entry page; sets viewport and Content-Security-Policy
.nojekyll             Tells GitHub Pages to serve files as-is
css/app.css           Styles: mobile-first, sidebar from 900px, light/dark
js/main.js            Boot: validate config, build layout, render current route
js/routes.js          The seven sections (single source for nav + routing)
js/router.js          Hash routing (#/backtest) — pure, unit-tested
js/config.js          Validates public config; rejects secrets
js/app-config.js      PUBLIC config: Supabase URL + publishable key only
js/health.js          Live database status (header pill)
js/icons.js           In-repo line icons (no icon font / CDN)
js/dom.js             Element + SVG icon helpers (textContent only, never innerHTML)
js/views/layout.js    Gradient header, status pill, section nav, footer disclaimer
js/views/pages.js     Page hero, planned card, Dashboard module grid, not-found, config banner
```

Each section has its own colour and icon (`tone`, `icon` in routes.js). Green and red are
reserved for bullish / bearish results and are never section colours.

Sections (PROJECT.md §16): Dashboard, Data, Admin, ORB Research, Backtest, Relationships,
Settings. Each currently says "Not built yet" and names the task that builds it.

Rules:

* Only the public Supabase URL and anon/publishable key may appear here.
* Never provider API keys or the Supabase service-role/secret key.
* Never browser storage as the historical database.
* No third-party scripts or CDNs (blocked by the CSP and by tests).

Run locally with `npm run dev` from the repository root.
