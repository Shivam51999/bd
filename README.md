# BD Tracker — Mangalam Landmarks
Two separate deliverables sharing one Google Sheet as the single source of truth.

1. **BD Daily Entry** (`index.html` + `app.js`) — the working tool the BD team
   uses every day. Forms for daily activity, full pipeline management
   (add/edit/delete deals), target editing.
2. **BD CEO Dashboard** (`ceo-dashboard.html` + `ceo-dashboard.js`) — a
   read-only executive summary for SSS/RP. No forms, no edit/delete buttons.
   Auto-refreshes every 10 minutes.

Both read from/write to the same Google Sheet, but through **different API
actions** on the same Apps Script backend — the CEO dashboard only ever
calls `getCeoSummary`, which is backend-filtered to exclude sensitive fields.
It's not just hidden in the UI; the data never leaves the server in the
first place.

## What the CEO Dashboard shows vs. hides
**Shows:** activity counts (site visits, meetings, leads, proposals),
the deal funnel, AOP target progress (switchable by quarter), and the full
pipeline list — parcel name, location, area, source type, stage, expected
GDV, next action + date.

**Hides:** daily notes/blockers, broker and landowner contact names, lead
source breakup detail, and negotiation terms (landowner ask / current offer).

## Files
- `Code.gs` — Apps Script backend (shared by both frontends)
- `index.html` / `app.js` — BD Daily Entry tool
- `ceo-dashboard.html` / `ceo-dashboard.js` — CEO Dashboard (read-only)
- `vercel.json` — static deployment config

## Setup steps

### 1. Backend (Google Apps Script) — one-time
1. Create a new Google Sheet (e.g. "BD Tracker Database").
2. Extensions → Apps Script. Delete default code, paste in `Code.gs`.
3. Run `seedFY27Targets` once manually from the function dropdown to
   pre-fill quarterly targets (you'll be asked to authorize permissions).
4. Deploy → New Deployment → type: **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the **Web app URL** (`https://script.google.com/macros/s/XXXX/exec`)

> Every time you edit `Code.gs`, you must
> **Deploy → Manage Deployments → Edit (pencil) → New Version → Deploy**
> or changes won't go live — same gotcha as your other trackers.

### 2. BD Daily Entry tool (Vercel)
1. In `app.js`, replace `API_URL` with the Web App URL from step 1.
2. Push `index.html` + `app.js` + `vercel.json` to a GitHub repo
   (e.g. `bd-daily-entry`).
3. Import in Vercel → Deploy. You'll get e.g. `bd-entry.vercel.app`.
4. This is the tool the BD team bookmarks/uses daily.

### 3. CEO Dashboard (separate Vercel deployment)
1. In `ceo-dashboard.js`, paste the **same** Web App URL from step 1.
2. Push `ceo-dashboard.html` + `ceo-dashboard.js` + `vercel.json` to a
   **separate** GitHub repo (e.g. `bd-ceo-dashboard`) — keep it physically
   separate from the entry tool so there's no risk of shipping form/edit
   code into the CEO-facing build by accident.
3. Import in Vercel → Deploy. You'll get e.g. `bd-dashboard.vercel.app`.
4. Share this URL with SSS/RP, or tile it onto Mangalam HQ as a CEO-visible
   card. The entry tool's URL should NOT go on a CEO-visible tile.

## Data model (unchanged from entry tool)

**DailyLog**: date, site visits, broker meetings, landowner meetings, new
leads, calls/follow-ups, proposals presented, notes/blockers.

**Pipeline**: parcel name, location, area (acres), source, stage, expected
GDV, landowner ask vs current offer, next action + date.

Stages (mapped into 4 phases for the funnel):
- **Sourcing** → Lead
- **Site Visit** → Site Visit Done
- **Negotiation** → Feasibility, Negotiation, Term Sheet, Due Diligence
- **Closed** → Signed, Dropped

**Targets**: one row per quarter — target proposals, target acres, target
deals signed. Actuals are computed live from DailyLog and Pipeline, not
stored separately, so both frontends always show consistent numbers.

## Notes on target logic
- "Proposals presented" actuals sum Daily Log entries within each quarter.
- "Acres signed" / "deals signed" actuals sum Pipeline deals at stage =
  Signed, using `lastUpdated` (when it was marked Signed) as the
  quarter-assignment date.
- Quarters follow Indian FY (Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec,
  Q4 = Jan-Mar).

## Possible future additions (not built — flag if wanted)
- Broker/landowner contact database instead of free text per entry
- Document/photo upload per deal (would need Google Drive API)
- WhatsApp/email reminder for overdue "next actions"
- If BD team grows beyond 1 person: per-person filter + rollups (Pipeline
  already has an `owner` field; DailyLog would need the same added)
- Password/SSO gate on the CEO Dashboard URL if you don't want it open to
  anyone with the link (currently relies on the link itself being private)
