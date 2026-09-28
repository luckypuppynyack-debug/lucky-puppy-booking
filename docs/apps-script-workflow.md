# Apps Script Development Workflow

This doc explains where the Lucky Puppy booking/invoice automation code
actually lives, how it's connected to Google, and the process for making a
safe change to it. It exists because that code used to live only inside the
Apps Script web editor with no version history — this repo is now the
source of truth.

## Where everything lives

There are **two live Google Apps Script projects** and **two Google
Sheets**. Both script projects run the *same* code (or should, once a
change is fully rolled out) — one is bound to real client data, the other
to a disposable copy.

| | Prod (real) | Sandbox (test) |
|---|---|---|
| Repo folder | `apps-script/prod/` | `apps-script/test/` |
| Apps Script project | "Lucky Puppy" | "Lucky Puppy" (copy) |
| Script ID | `1gh-UHNlas6MIon12PxT_3YlnuEX003bJ_B8_-OzBVReEZTXPExwL6JRb` | `1a5mJI_1fxw7YBv6Ux_l9qY9tP8Q7TkzV_yFbU6O4EgDiG43nQjOocB9Y` |
| Editor URL | https://script.google.com/d/1gh-UHNlas6MIon12PxT_3YlnuEX003bJ_B8_-OzBVReEZTXPExwL6JRb/edit | https://script.google.com/d/1a5mJI_1fxw7YBv6Ux_l9qY9tP8Q7TkzV_yFbU6O4EgDiG43nQjOocB9Y/edit |
| Bound spreadsheet | "Lucky Puppy Intake Form (Responses)" | "Lucky Puppy Data (sandbox)" |
| Spreadsheet ID | `1MH3iz7xmQaLWBzViWIjFHY69ICgxLjhAG3iooR7l11k` | `130_vG_Hue6wM3aYLKqpsSPExX41XipgPXBWKnifecjw` |
| Web app `/exec` deployment ID | `AKfycbz6FF4rMUkOAoyg90HWmuvdH1Mzxf0vZghmkSznk5PhXVvfj4ijRp6Iq8e1C8TDOHk9pA` | `AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD` |
| Data | Real client bookings, real emails get sent | Fake/duplicated rows — safe to run functions against |

The sandbox spreadsheet was made by **File → Make a copy** on the real one,
which also copies the bound script (so both projects started identical).
The sandbox has its own separate web app deployment, pointed at itself —
never at prod.

**GitHub repo:** `luckypuppynyack-debug/lucky-puppy-booking`. The Apps
Script source is synced in and out via `clasp` (Google's Apps Script CLI),
so each folder has its own `.clasp.json` pointing at that project's script
ID.

## The two files inside each project

- `bookingsubmissions.js` — the web app's `doGet`/`doPost` entry points:
  new booking form submission, accept/decline links, and the
  send-invoice-to-client action.
- `invoicegenerator.js` — invoice generation and charge calculation, plus
  the daily/weekly triggers that run it.

## Why the deployment ID matters (read this before touching deploys)

Every "Approve booking" / "Send invoice" link emailed to a client or to the
admin is built from the **web app deployment's `/exec` URL**. That URL is
tied to a specific deployment, which is in turn pinned to a specific saved
*version* of the code.

- `clasp push` (or pasting code into the editor and saving) uploads new
  code and creates a new version, but **does not** change what the live
  deployment serves, and **does not** change what a time-driven trigger
  (the daily 8am invoice run, etc.) executes — triggers always run the
  latest saved version regardless of deployment.
- Updating the *existing* deployment to point at the new version (via
  `clasp deploy -i <deploymentId>` or, in the editor, **Deploy → Manage
  deployments → pencil icon → Version: New version → Deploy**) is what
  actually changes what the `/exec` URL serves — **and it keeps the same
  URL**, so every already-sent email link keeps working.
- Clicking **"New deployment"** instead of editing the existing one mints
  a *brand-new* URL/ID. This is exactly what caused the original bug this
  process was written to prevent: an old hardcoded URL pointed at a
  deployment that no longer matched the current code. **Never click "New
  deployment" on either project unless you're deliberately deploying an
  isolated pilot** — always edit the existing deployment in place.

## Process for making a change

1. **Edit the sandbox copy first** (`apps-script/test/*.js` in the repo).
2. **Push it to the sandbox script project**:
   ```
   cd apps-script/test
   clasp push
   ```
3. **If the change affects a URL a client/admin would click** (accept/decline,
   send invoice), update the sandbox's live deployment too, so the link in
   any test email actually reflects the new code:
   ```
   clasp deploy -i AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD --description "<what changed>"
   ```
   If the change is only in a function you run directly from the editor
   (e.g. a data-loading helper), a plain `clasp push` is enough — Apps
   Script's own "Run" button always executes the latest saved code.
4. **Test in the sandbox.** Use fake data or your own email address for
   whatever row you're exercising — never a real client's row/email even
   in the sandbox, since it's still capable of sending real emails and
   creating real calendar events (just on the sandbox's own calendar/sheet,
   not the business's real ones). Common ways to trigger a test:
   - Run a function directly from the Apps Script editor's function
     dropdown (e.g. `runInvoicesForToday`, or a one-off `testXyz()`
     function you add temporarily and delete once confirmed).
   - Hit the deployed web app URL directly with query params, e.g.
     `.../exec?action=accept&bookingId=...`, to simulate what a client
     clicking an email link would do.
5. **Once confirmed working, apply the same change to
   `apps-script/prod/*.js`** in the repo.
6. **Commit and push to git** (small, focused commits — one logical fix
   per commit, sandbox and prod changes can be separate commits):
   ```
   git add apps-script/...
   git commit -m "..."
   git push
   ```
   This repo doesn't currently use pull requests for this work — commits
   go straight to the working branch. If that changes, open a PR instead
   of pushing directly to main.
7. **Deploy to live prod.** Update the *existing* prod deployment in
   place, the same way as sandbox:
   ```
   cd apps-script/prod
   clasp push
   clasp deploy -i AKfycbz6FF4rMUkOAoyg90HWmuvdH1Mzxf0vZghmkSznk5PhXVvfj4ijRp6Iq8e1C8TDOHk9pA --description "<what changed>"
   ```
   **Note:** in a Claude Code cloud/remote session, an auto-mode safety
   classifier blocks `clasp push`/`clasp deploy` against the *prod* script
   as a "Production Deploy" action, and also blocks Claude from editing
   permission settings to grant itself that ability (a "Self-Modification"
   block). When that happens, the fallback is to apply the same code
   change by hand in the prod editor (copy-paste the function, save) and
   then **Deploy → Manage deployments → pencil icon → Version: New
   version → Deploy** — same "edit existing deployment" rule as above, just
   done through the UI instead of the CLI.
8. **Verify the live version actually updated.** Check the deployment's
   pinned version number matches the latest saved version (via the Apps
   Script API, or just re-testing the real flow).

## One-time setup (already done, documented for reference)

- Apps Script API must be toggled on for the Google account at
  https://script.google.com/home/usersettings — required before `clasp`
  can do anything.
- `clasp login` needs a one-time OAuth grant as `luckypuppynyack@gmail.com`.
- `npm install -g @google/clasp` to get the CLI.
