---
name: apps-script-change
description: Use this skill whenever the user asks to change, fix, add to, debug, or deploy the Lucky Puppy booking/invoice Apps Script automation — anything touching apps-script/prod, apps-script/test, bookingsubmissions.js, invoicegenerator.js, or referred to as "the apps script," "the booking script," "the invoice script," or "the sandbox." Also consult it before running any clasp push/deploy command in this repo, and before telling the user a change is "done" — deploying to prod is a separate step from writing the code and is easy to forget. Encodes the required sandbox-first workflow so changes never go straight to production and never silently break the live deployment URL that's baked into every emailed booking/invoice link.
---

# Apps Script change workflow

Full background on why this process exists — what broke before, the two
live projects, their spreadsheets and deployment IDs — is in
`docs/apps-script-workflow.md` at the repo root. Read it once if this is
your first time touching this code; the IDs below are copied from there so
you don't have to re-derive them.

## The rule that matters most

Every "Accept booking" / "Send invoice" link ever emailed points at a
**deployment's `/exec` URL**, which is pinned to a specific saved code
version. Editing code and saving it does **not** change what that URL
serves — only explicitly updating the *existing* deployment does. A
"New deployment" mints a different URL and orphans every link already
sent. **Never create a new deployment on either project — always edit the
existing one in place.** This one rule is why the sandbox/prod split and
every step below exist.

## IDs you'll need

| | Prod | Sandbox |
|---|---|---|
| Repo folder | `apps-script/prod/` | `apps-script/test/` |
| Script ID | `1gh-UHNlas6MIon12PxT_3YlnuEX003bJ_B8_-OzBVReEZTXPExwL6JRb` | `1a5mJI_1fxw7YBv6Ux_l9qY9tP8Q7TkzV_yFbU6O4EgDiG43nQjOocB9Y` |
| Deployment ID | `AKfycbz6FF4rMUkOAoyg90HWmuvdH1Mzxf0vZghmkSznk5PhXVvfj4ijRp6Iq8e1C8TDOHk9pA` | `AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD` |
| Editor URL | script.google.com/d/`1gh-UHNlas6MIon12PxT_3YlnuEX003bJ_B8_-OzBVReEZTXPExwL6JRb`/edit | script.google.com/d/`1a5mJI_1fxw7YBv6Ux_l9qY9tP8Q7TkzV_yFbU6O4EgDiG43nQjOocB9Y`/edit |

## The steps, in order

1. **Edit `apps-script/test/*.js` first.** Never write straight to `prod/`.

2. **Push to the sandbox project:**
   ```
   cd apps-script/test && clasp push
   ```
   If the change touches a URL someone would click (accept/decline,
   send-invoice), also update the sandbox's live deployment so a test
   click actually exercises the new code:
   ```
   clasp deploy -i AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD --description "<what changed>"
   ```
   A change only reachable by running a function directly from the
   editor doesn't need this — the editor's Run button always uses the
   latest push regardless of deployment.

3. **Test it in the sandbox**, either by running a function from the
   editor's function dropdown, or by hitting the deployed URL with query
   params (e.g. `.../exec?action=accept&bookingId=...`). Use fake data or
   your own email for whatever row you're exercising — the sandbox is a
   safe copy of the data, but it still sends real emails and creates real
   calendar events on its own calendar, so never point a test at a real
   client's row even here.

4. **Once it works, make the identical change in `apps-script/prod/*.js`.**

5. **Commit and push to git.** One focused commit per fix is fine;
   sandbox and prod changes can be separate commits. This repo pushes
   straight to the working branch — no PR step currently.

6. **Deploy to live prod:**
   ```
   cd apps-script/prod && clasp push
   clasp deploy -i AKfycbz6FF4rMUkOAoyg90HWmuvdH1Mzxf0vZghmkSznk5PhXVvfj4ijRp6Iq8e1C8TDOHk9pA --description "<what changed>"
   ```

   **If you're running in a Claude Code cloud/remote session**, expect
   this to be blocked: the auto-mode safety classifier treats
   `clasp push`/`clasp deploy` against the prod script ID as a
   "Production Deploy" action and refuses it outright, and it also
   refuses to let you edit permission settings to grant yourself that
   ability ("Self-Modification"). This isn't a bug to route around —
   it's working as intended, and the fallback is a normal part of this
   workflow, not a failure state:

   - Tell the user the deploy is ready and needs to be applied manually.
   - Give them the exact function(s) to paste into the prod editor
     (script.google.com/d/`1gh-UHNlas6MIon12PxT_3YlnuEX003bJ_B8_-OzBVReEZTXPExwL6JRb`/edit).
   - Have them save, then **Deploy → Manage deployments → pencil icon on
     the existing deployment → Version: New version → Deploy**. Stress
     that this is different from "New deployment" — editing the existing
     one is what keeps the URL stable.
   - If they'd rather not do this by hand every time, they can either run
     the two `clasp` commands themselves from their own machine, or add
     `"permissions": {"allow": ["Bash(clasp *)"]}` to `.claude/settings.json`
     or `.claude/settings.local.json` themselves (Claude can't add this
     rule on its own — same self-modification restriction).

7. **Verify the live version actually updated** before calling the task
   done:
   ```
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://script.googleapis.com/v1/projects/<scriptId>/deployments/<deploymentId>" \
     | jq '.deploymentConfig.versionNumber'
   ```
   Compare against the newest entry from
   `GET .../projects/<scriptId>/versions`. A token can be pulled from
   `~/.clasprc.json` (`.tokens.default.access_token`) if `clasp login` has
   already been done in this session. If they don't match, the deploy step
   didn't actually take — go back and redo it rather than reporting success.
