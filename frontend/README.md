# NPR Metal Crusher — Figma Make React prototype

Source: User-supplied Figma Make link, retrieved through connected Figma design context.

## Local startup

```powershell
npm install
npm run dev
```

Then open http://localhost:5173.

**Important:** This is a frontend-only DESIGN PROTOTYPE with hard-coded demo invoices and dummy prices, no authentication, database or secure save. The Save button is a UI demonstration; do not use it for real billing.

The original Figma Make runtime Vite config was replaced with standard Vite config. No font files are bundled; Sinhala web fonts load from Google Fonts at runtime, falling back to system fonts if unavailable.

Next development phase: move this prototype to frontend/ within the NPR-Metal-Crusher-System root; build backend/ with Node/Express and Supabase PostgreSQL; replace mock data and mock actions with server-authenticated APIs, DB transactions, immutable invoices and append-only payments; add tests and A5 printing.
