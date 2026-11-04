# Switching on editing (one-time, about 3 minutes)

The app's editing screens call five new server actions: `obwMeta`, `obwSaveEntry`, `obwDeleteEntry`, `obwSaveBill` and `obwSaveProject`. They live in `AppWrite.gs`, which is self-contained: it checks the Google sign-in itself, only lets the admin write, and logs every change to the AuditLog tab. Everything else is still handled by the existing `Api.gs`.

1. Open the Offset Books DB sheet, then **Extensions → Apps Script**.
2. Click **+** next to Files, choose **Script**, and name it `AppWrite`. Paste in the whole of `AppWrite.gs` and save.
3. Open `Api.gs` and find `function doPost(e) {`. Paste this as the first line inside it:
   ```js
   var w = obwHandle(e); if (w) return w;
   ```
   (If the brackets say something other than `e`, for example `doPost(req)`, use that name instead: `obwHandle(req)`.)
4. Save, then go to **Deploy → Manage deployments**, click the pencil on the existing deployment, set **Version: New version**, and click **Deploy**. Editing the existing deployment keeps the same `/exec` URL, so `config.js` doesn't change. Creating a *new* deployment would give a new URL.
5. Reopen the app and tap Refresh. The yellow "Editing is not switched on yet" banner should be gone.

## What it writes to the DB

- **Entries**: new and edited lines. Edits change only the cells that changed. The first save adds two columns at the far right: `bill_id` (links the lines of a split bill) and `allocation` (`overhead` when you confirm a supplier cost has no project).
- **Projects**: new projects and edits (fee, budgets, status, dates, notes).
- **AuditLog**: one row per changed field, with the old and new value. A deleted or split line keeps its full old row in AuditLog, so it can be restored by hand.
