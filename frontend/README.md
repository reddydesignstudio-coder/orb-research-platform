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
js/app-config.js      PUBLIC config: Supabase URL + anon key only (empty until TASK 003+)
js/dom.js             Tiny element helper (textContent only, never innerHTML)
js/views/layout.js    Header, section nav, footer disclaimer
js/views/pages.js     Planned-page, not-found and config-banner views
```

Sections (PROJECT.md §16): Dashboard, Data, Admin, ORB Research, Backtest, Relationships,
Settings. Each currently says "Not built yet" and names the task that builds it.

Rules:

* Only the public Supabase URL and anon/publishable key may appear here.
* Never provider API keys or the Supabase service-role/secret key.
* Never browser storage as the historical database.
* No third-party scripts or CDNs (blocked by the CSP and by tests).

Run locally with `npm run dev` from the repository root.
