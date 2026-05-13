# Checkpoint — 2026-04-24

## Where we left off
Debugging `Bad Request - Request Too Long` (HTTP 400) when setting authentication for the **LOCAL** environment in the dashboard.

## Diagnosis
Error came from Kestrel on `https://localhost:44350` (the LOCAL ShareDo site), not from the dashboard. Playwright's persistent browser profile at `cache/ux-user-data/local/` had accumulated stale `sharedo.*` session cookies across logins until the total cookie header exceeded Kestrel's request-header size limit. Confirmed by server logs showing all 3 UX page checks returning `400 in ~5000ms` before the fix.

## What we did
- Deleted `cache/ux-user-data/local/` to clear the bloated profile. (`prod/` left untouched.)
- Dashboard server (`npm start`) is still running in the background from today's session — may or may not still be alive tomorrow.

## Next step
1. Make sure dashboard is running (`npm start` if not).
2. Go to Options page → Authentication section → click **Launch Browser** for LOCAL.
3. Log in fresh in the Playwright window. Cookie should be captured and `hasCookie` will flip true.
4. Verify: UX page checks for LOCAL should start returning 200 instead of 400.

## Related code
- `server/auth.js:134` — `acquireCookieForEnv` (programmatic OIDC 6-step flow, not used here)
- `server.js:463` — `POST /api/auth/launch-browser` (Playwright-based manual login, this is what the UI triggers)
- `server.js:484` — persistent context launch pointing at `cache/ux-user-data/{env}/`

## Uncommitted changes (unrelated to today's debug)
- M `public/shared/shared.js`
- M `server.js`
- M `server/auth.js`
- ?? `CLAUDE.md`, `data/`, `public/activity/`

Decide separately whether these belong in a commit — today's work didn't touch them.
