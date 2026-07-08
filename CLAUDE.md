<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This project runs Next.js 16, which has breaking changes vs. what's in your training data — APIs, conventions, and file structure may all differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code that touches routing, middleware, server actions, or config. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working in this repo

See `README.md` first for feature/architecture overview. This file is for things a Claude session needs to know *before* editing, learned the hard way while building this app.

## Non-negotiable constraints

1. **Never modify `profiles` or its RLS policies.** This app shares the Supabase project (`fslagsuorkcckvvtrmyi`) with `lab-management-portal`. Every new table is prefixed `shift_` and FKs to `profiles(id)`. If you need a new profiles-adjacent field, it belongs in a `shift_*` table, not on `profiles`.
2. **`profiles` RLS only allows self-read (or Admin).** Never query `profiles` from a browser-side Supabase client for anyone but the current user. Colleague names/roles/depts must go through an API route using the service-role client (`lib/supabase/admin.ts`). `/api/staff` is the existing pattern — reuse it.
3. **Auth cookie name must stay `shift-auth` in exactly three places**: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `proxy.ts`. If you add a fourth Supabase client factory, it needs the same `cookieOptions: { name: 'shift-auth' }` or sessions silently break when this app and the portal run on the same `localhost` origin.
4. **`NEXT_PUBLIC_*` env vars in client code must be accessed with a static expression** — `process.env.NEXT_PUBLIC_X`, never `process.env[someVariable]`. Next.js's bundler only inlines the literal, statically-written form; a dynamic/computed access always evaluates to `undefined` in the browser with **no error, no warning** — the failure mode is a feature that silently does nothing (this exact bug caused the login button to hang forever with no error message; see `lib/supabase/client.ts`'s comment for the full story). Server-only files (`server-only` import) don't have this restriction since `process.env` there is the real Node object.
5. **Data mutations go through `/api/*` route handlers**, not client-side Supabase calls. Pattern: `requireActor()`/`requireScheduler()`/`requireAdmin()` (from `lib/server/auth.ts`) to authenticate + authorize, then the service-role client to read/write. RLS on `shift_*` tables exists as defense-in-depth, not as the primary gate.
6. **Never use `window.confirm()` for destructive-action confirmation.** Browsers can silently suppress repeated native dialogs ("prevent this page from creating additional dialogs"), which makes `confirm()` return `false` instantly — the click then does *nothing*, with no request sent and no error shown, which looks exactly like a backend bug. Use the in-app confirm `Modal` pattern in `components/schedule/schedule-view.tsx` (`confirmBox` state + a dedicated confirm `Modal`) instead.
7. **Any client-side `fetch()` to `/api/*` must not be cacheable.** `lib/client-api.ts`'s `api()` helper sets `cache: 'no-store'` and appends a `_t` cache-busting param to every GET — always route API calls through this helper rather than raw `fetch`, or a browser that cached a pre-mutation GET can keep serving stale data indefinitely (this caused "click generate, nothing happens, click again, works" — the server was correct the whole time, the browser cache wasn't).
8. **Aggregate in Postgres, not in JS, for anything that scans historical rows.** `lib/server/data.ts` `buildCarryIn()` used to fetch every historical `shift_assignments` row across all months and sum in JS — correct but grows linearly forever. It now calls the `shift_lifetime_totals()` SQL function (a `GROUP BY` inside Postgres) so the query cost stays flat regardless of how many months of history accumulate. Follow this pattern for any new "sum/count across all history" feature — don't fetch-then-reduce in Node.
9. **No migration CLI/direct DB connection is available in this environment.** `supabase/migrations/*.sql` files are written but must be run manually by the user in the Supabase SQL Editor — there is no `supabase db push` or direct Postgres connection string configured. After writing a migration, explicitly tell the user which file to run and why. Migrations must be idempotent (`create table if not exists`, `drop policy if exists` before `create policy`, `on conflict do nothing` for seeds) since a user may re-run a file after you've since edited it further.
10. **Vercel function region is `syd1`**, matching the Supabase project's `ap-southeast-2` (Sydney) region. Don't let it drift back to the `iad1` default — every DB round trip pays cross-continent latency otherwise (this was the original cause of "the app feels slow," before the code-level query-batching fixes on top of it).

## Deploy workflow

```bash
npx vercel deploy --prod --yes
# Vercel does NOT auto-move a custom alias to new prod deployments — re-point it explicitly:
LATEST=$(npx vercel ls | grep "Ready" | head -1 | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app')
npx vercel alias set "$LATEST" shift-scheduling-system-mtcbh.vercel.app
```

Both steps are required every deploy — the CLI's own aliased output URL from `deploy` is *not* the stable custom alias.

## Testing conventions

- `lib/scheduler/*` is pure TypeScript with zero Supabase dependency — this is intentional so the scheduling algorithm can be fully unit-tested (`lib/scheduler/*.test.ts`) without any DB. Keep it that way; if a new scheduling rule needs data, pass it in via `SchedulerInput`/`CarryIn`, don't reach into Supabase from inside `lib/scheduler/`.
- When adding a scheduling-fairness change, write a test that would have **failed** before the fix, not just one that passes after — several bugs in this codebase (pairing cliques, lifetime carry-in) were only caught by constructing an adversarial fixture and checking the actual distribution, not just "no errors thrown."
- Files ending in `.tmp.mjs`/`.tmp.ts` are throwaway debug scripts used during development against the real production DB (read-only checks, or checks reverted after) — never commit these; clean them up (`rm`) before finishing a task. If you need to inspect real prod data, prefer scratch files in the session's scratchpad directory over the repo root.

## Where things are

- `lib/scheduler/` — pure scheduling engine (constraints, fairness, rotation, pairing, engine, validate). No `server-only` imports here.
- `lib/server/` — everything that touches Supabase server-side: `auth.ts` (actor/permission resolution), `data.ts` (reference data + carry-in), `schedule-service.ts` (glue between API routes and the scheduler engine), `swaps.ts`/`sales.ts` (apply logic), `notify.ts`, `pagination.ts`.
- `lib/supabase/` — the three client factories (`client.ts` browser, `server.ts` SSR, `admin.ts` service-role) + `env.ts`.
- `app/api/` — one route per resource; `respond()` (`lib/server/route.ts`) wraps every handler for consistent error shaping + `Cache-Control: no-store`.
- `components/schedule/roster-grid.tsx` — the paper-roster-style grid (shift-type columns grouped with a thick separator + colored header border matching the legend). `components/schedule/schedule-view.tsx` hosts both the read-only `/schedule` and manager `/schedule/manage` views via a `manage` prop.
- `supabase/migrations/` — applied in filename order, manually, by the user (see constraint #9 above).

## Permission model quick reference

`getActor()` in `lib/server/auth.ts` computes `Actor.isAdmin` as `role === 'Admin' OR (user_id present in shift_schedulers)` — a designated scheduler is folded into `isAdmin` at the single point of computation, so every existing `isAdmin`-gated check automatically extends to them. `isManager` (role === 'Manager') is intentionally *not* part of `isScheduler` — Manager can view the dashboard and manage leave but cannot touch scheduling or settings. Don't reintroduce `isManager` into scheduling/settings guards without an explicit ask; it was deliberately removed.
