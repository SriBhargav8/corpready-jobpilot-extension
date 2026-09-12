# CorpReady JobPilot — v0 codebase

Global AI career agent: matches roles from 50K+ company career pages, tailors
resume + cover letter + screening answers per role, fills the application in
one click. **The user always presses the final Submit.**

Spec: jobpilot-global-spec-v2.md · OSS references: jobpilot-oss-bundle.zip

## What is in this repo — and its test status

| Path | What | Status |
|---|---|---|
| supabase/migrations/001_schema.sql | Full Postgres schema + RLS + selector_maps | Written, not yet applied |
| supabase/functions/generate-kit/ | AI kit engine (injection-hardened, credit-metered, funnel events) | Written; prompt validated in prototype; deploy to test |
| workers/ats-pollers.js | Greenhouse/Lever/Ashby pollers + visa/remote/scam signal extraction | **8/8 fixture tests passing** |
| workers/field-engine.test.js | Field classifier tests | **16/16 passing** |
| extension/ | MV3: field engine, filler, background AI-fallback, popup | Syntax-checked; needs live-page QA |

## Bring-up (Bhargav, Day 1)

1. `supabase init && supabase db push` (applies 001_schema.sql; enable pgvector in dashboard if needed)
2. `supabase secrets set ANTHROPIC_API_KEY=...` then `supabase functions deploy generate-kit`
3. Seed boards: `insert into ats_boards (company, ats_type, slug) values (...)` — start with 50 target companies (GCCs, Big 4, YC list)
4. `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node workers/ats-pollers.js` → jobs table fills
5. Load `extension/` unpacked in Chrome (set SUPABASE_URL in background.js) → open a Greenhouse posting → popup → Fill
6. Offline checks anytime: `node workers/ats-pollers.js --fixtures` and `node workers/field-engine.test.js`

## Deliberately not in v0 (per spec)

- Workday + LinkedIn Easy Apply multi-step walkers (Week 3-4; port from OSS bundle)
- answer-fields edge function (AI fallback endpoint the background worker calls — clone generate-kit shape)
- Resume PDF renderer, slug-discovery worker, payments, web app (web: reuse the JobPilot artifact prototype as the paste-a-JD page)

## Third-party code

extension/field-engine.js label-signature approach adapted from JobNavigator
(MIT). Keep LICENSE-THIRD-PARTY when publishing.
