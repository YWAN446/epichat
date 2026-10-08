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
