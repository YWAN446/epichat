# Deploying and running the EpiChat web app

The app is the `web/` service of the repository. Sub-project 2 adds the `sim`
service beside it. Everything below is done once by the owner; the code never
creates projects or changes dashboard settings.

## 1. Supabase (EpiChat's own project)

1. Create a new project on the free plan. Region: US East.
2. SQL editor: paste and run `web/supabase/migrations/0001_init.sql`. It is
   safe to run twice. Later migrations are run in order by file name.
3. Sign-in is by an emailed code only. The app has no page for a sign-in link
   to land on, so the emails must carry the code and no link.
   - Authentication > Sign In / Providers > Email: set "Email OTP Length" to
     8. The app asks for exactly eight digits (`SIGN_IN_CODE_LENGTH` in
     `lib/signInCode.ts`); change both together.
   - Authentication > Emails: in both the "Confirm signup" and "Magic Link"
     templates, replace the body with:

         <h2>Sign in to EpiChat</h2>
         <p>Enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>

     A first-time participant gets the signup template and a returning one
     gets the magic-link template. Both must be changed.
4. Authentication > URL Configuration: set the Site URL to the app's live
   address. No redirect addresses are needed.
5. Authentication > SMTP settings: turn on custom SMTP with Resend (host
   `smtp.resend.com`, port `465`, username `resend`, password = a Resend API
   key with sending access, sender = an address on a domain verified in
   Resend). The built-in mailer sends only 2 emails an hour.
6. Authentication > Rate limits: raise "emails per hour" to 100. Resend's free
   plan allows 100 a day.
7. Project settings > API keys: copy the project URL, the publishable key, and
   the secret key into the environment (section 3).

## 2. Anthropic

Not needed until sub-project 3. When it is: create a workspace for EpiChat in
the Anthropic Console, create an API key in it, and set the workspace's monthly
spend limit a little above `MONTHLY_BUDGET_USD` as the backstop.

## 3. Environment

`web/.env.local` for local runs; the same variables go into Vercel for
Production and Preview. Copy `web/.env.example` and fill in the Supabase keys,
`CONTACT_EMAIL`, `RESEARCHER_EMAILS` (the addresses that may open `/admin`),
and `CRON_SECRET` (any long random string; Vercel sends it as a bearer token
with every cron request, and `/api/health` reports the enrollment count only
to that bearer). Every other setting has a default.

## 4. Vercel

Done on 2026-10-08: project `epichat` in the owner's personal account, live at
`https://epichat-ai.vercel.app` (`epichat-psi.vercel.app` is the
auto-assigned alias and also works). The single-service config was accepted on
the Hobby plan as written.

1. From the repository root, `npx vercel link --yes --project epichat`. The
   project root is the repository root; `vercel.json` there defines the `web`
   service. Leave the Root Directory setting empty. Linking also connected
   the GitHub repository, so every push to `main` is a production deploy and
   a push to any other branch is a preview.
2. Environment variables: either Settings > Environment Variables in the
   dashboard, or from the repository root,
   `printf '%s' "<value>" | npx vercel env add NAME production,preview --yes`
   (add `--sensitive` for keys). The variables are the set ones in section 3.
3. `npx vercel deploy` prints a preview address; `npx vercel deploy --prod`
   puts the current code live. A project's very first deployment goes to
   production regardless. Preview addresses sit behind Vercel Authentication:
   open them in a browser signed in to Vercel. The production address is
   public.
4. After the first live deploy, Settings > Cron Jobs: confirm `/api/health`
   runs daily. Then set the Supabase Site URL (section 1.4) to the live address.
   The daily cron response also reports the simulation service's health
   (section 7).
5. Keep the Hobby plan for the pilot. Do not turn on Password Protection; it
   adds a monthly charge.

## 5. Verification after a deploy

- Open the preview address: it redirects to `/sign-in`.
- Sign in with an allowed address; the code arrives from the Resend sender.
- The consent page appears; declining signs out with the declined message;
  agreeing with a participant type opens `/chat`.
- Table Editor: `profiles` has the row; `step_events` has `consent_given`,
  `session_start`; `sessions` has a row with the browser's user agent.
- `/api/health` answers 401 to a browser once `CRON_SECRET` is set, and
  `{"ok":true,"participants":N}` when called with
  `Authorization: Bearer <CRON_SECRET>` (as the Vercel cron does). Without
  `CRON_SECRET` it answers `{"ok":true}` to anyone and reports no count.
- `/admin` opens for an address in `RESEARCHER_EMAILS` and is a 404 for
  anyone else.

## 6. Routine work

- **Changing the consent text:** edit `web/content/consent.md`, bump its
  `version`, deploy. Every participant is asked again on their next visit.
- **Adding a researcher or a test address:** edit `RESEARCHER_EMAILS` or
  `UNLIMITED_EMAILS` in Vercel and redeploy.
- **Removing a participant's data on request** (SQL editor; replace the id):

      delete from conversations where user_id = '<user_id>';   -- cascades to messages, turns, events, feedback, scenarios
      delete from runs where user_id = '<user_id>';
      delete from sessions where user_id = '<user_id>';
      delete from step_events where user_id = '<user_id>';
      delete from usage_daily where user_id = '<user_id>';
      delete from profiles where user_id = '<user_id>';

  then delete the user under Authentication > Users.
- **Monthly:** check Supabase database size and Vercel usage against the free
  allowances (500 MB; 4 active-CPU hours, 360 GB-hours, 1M invocations).

## 7. Simulation service (`sim/`)

The second Vercel service. Private: no rewrite reaches it; the web app calls
it through the binding (`SIM_INTERNAL_URL`) with `SIM_SHARED_SECRET`.

**Environment.** Add `SIM_SHARED_SECRET` (any long random string) to the
Vercel project for Production and Preview; the same project variables reach
both services. `ANTHROPIC_API_KEY` is already set and is used only when a
run fails and the parameters are repaired. Locally, export both in the
shell that runs the service and put `SIM_INTERNAL_URL=http://localhost:8000`
plus the secret in `web/.env.local`.

**Bundle size.** The sim's Python bundle is about 590 MB (scipy, llvmlite,
pandas, matplotlib, and sciris's dependencies), above Vercel's 500 MB
default for Python functions. The project therefore sets
`VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (Production and Preview), which turns on
Vercel's large-functions beta (up to 5 GB). Without it the sim build fails
with "Total bundle size exceeds the maximum function size". Set it first on
any new project that hosts this service.

**Local run.** Two processes, from the repository root:

    SIM_SHARED_SECRET=<secret> sim/.venv/Scripts/python.exe -m uvicorn main:app --app-dir sim --port 8000
    npm --prefix web run dev

`sim/.venv` is a Python 3.12 virtualenv: `py -3.12 -m venv sim/.venv` then
`sim/.venv/Scripts/python.exe -m pip install -r sim/requirements.txt pytest`.
`npx vercel dev` from the root runs both with the binding injected.

**Tests.** `sim/.venv/Scripts/python.exe -m pytest sim/tests -q` (about 20 s;
three real Starsim runs). CI runs them on Python 3.12 as the `sim` job.

**Settings** (all optional except the secret): `SIM_TIMEOUT_SECONDS` 120,
`SIM_MAX_REPAIRS` 2, `SIM_REPAIR_MODEL` claude-opus-5-5,
`SIM_MAX_AGENT_YEARS` 500000, `SIM_SERIES_MAX_POINTS` 2000.

**First two-service deploy, verification.** Done on 2026-10-08: the
build-time copy of the package was bundled and ran, so the fallback in step 1
was not needed; the only surprise was the bundle size (see above).

1. `npx vercel deploy` from the root. Both services build. If the sim build
   fails because `../epichat` is not visible, change the sim service in
   `vercel.json` to `"root": "."` with `"entrypoint": "sim/main:app"`, drop
   the `buildCommand`, and add `web/**` and the Streamlit folders to its
   `excludeFiles`; record the switch here.
2. Public probe: `curl -s -o /dev/null -w "%{http_code}\n" https://epichat-ai.vercel.app/health`
   and the same for `/simulate` print `404` (the web app answers, never the
   sim).
3. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://epichat-ai.vercel.app/api/health`
   returns `"sim":{"ok":true,"starsim_version":"3.3.2",...}`.
4. Timing through the binding, bearer only:
   `.../api/health?run=10000` twice (the first is the cold start), then
   `.../api/health?run=100000` once. Each answer carries `sim_run.duration_ms`
   and `sim_run.cold_start`.
5. Record the numbers below from step 4; the Usage page's Active CPU
   reading is the owner's to note alongside them.

| Measured on Vercel, 2026-10-08 (iad1, Hobby, 2 GB) | Value |
|---|---|
| Cold health check through the binding (no run) | 4.9 s wall |
| Cold start, 10k agents, 1 year | 12.3 s (`duration_ms` 12257) |
| Warm, 10k agents, 1 year | 6.8 s (`duration_ms` 6755) |
| Warm, 100k agents, 1 year | 18.2 s (`duration_ms` 18224) |

The warm 10k run is about 4.5× the local CPU time (the child process
re-imports Starsim, about 3 s on Vercel, plus a slower vCPU); 100k agents is
about 1.7× local. Both are within the per-attempt timeout with room to spare,
and 100k agents for 5 years (60 s locally) should still fit.

Local baseline (Python 3.12, one core, 2026-10-08): import 2 s; 10k agents
1.5 s CPU; 100k agents 11 s; 100k agents for 5 years 60 s; peak memory 332 MB.

**Hobby watch rule.** The project runs on Vercel Hobby, which includes 4
Active CPU hours a month and pauses the whole project for the rest of the
30-day window when exceeded. During the study check Usage > Active CPU
weekly. If it passes 2 hours before mid-month, or a participant reports the
app paused, upgrade the team to Pro ($20 a month; usage at this scale is a
dollar or two and covered by the plan's credit). Nothing in the code changes.

**Moving the service elsewhere.** `sim/Dockerfile` builds the same service as
a container (`docker build -f sim/Dockerfile -t epichat-sim .`). Run it on
Render, Cloud Run, or a VM, set `SIM_INTERNAL_URL` to its address and
`SIM_SHARED_SECRET` to the same secret on both sides, and remove the `sim`
service and the binding from `vercel.json`. The web app does not change.
