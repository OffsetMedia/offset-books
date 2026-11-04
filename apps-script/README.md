# Offset Books: server setup

The app is your original Offset Books screen (from `Index.html`) running as an installable app, plus split bills, documents read by Claude, and Claude's weekly check with an in-app Inbox.

Invoices, quotes, emailing, payments, the bank, vendors, crew and settings all run on your existing `Code.gs` through `Api.gs`. The new features run on `AppWrite.gs`.

## Install or update (about 3 minutes)

1. Open the Offset Books DB sheet, then **Extensions → Apps Script**.
2. Open the **AppWrite** file, select everything, and paste in the whole new `AppWrite.gs`. Save.
3. `Api.gs` needs only its first line inside `doPost(e)`, which you already have: `var w = obwHandle(e); if (w) return w;`
4. **Deploy → Manage deployments**, click the pencil on the existing deployment, set **Version: New version**, then **Deploy**. This keeps the same `/exec` URL.
5. Google asks you to approve new permissions: Calendar (for matching bills to shoot days) and "run when you're not there" (the weekly check). Allow both.
6. Open the app, go to **Inbox**, and tap **Run check now** once. That runs the first check and switches on the Monday-morning weekly check.

## What the new parts write

- **Entries**: lines from split bills and approved bills. Two columns are added on first use: `bill_id` (links the lines of one bill) and `allocation` (`overhead`).
- **Approvals**: each document Claude reads waits here (`source` = `bill_upload`) until you approve or reject it.
- **Shoots** (new tab): the shoots inside each project, each with its own date, fee, invoice and budget by cost type. Renaming a shoot also renames it on that project's cost lines.
- **Inbox** (new tab): one row per check, with Claude's message and the list of issues.
- **AIUsage**: every Claude call, with its cost. Calls are counted against `claude_monthly_budget_usd`.
- **AuditLog**: every change, with old and new values.
- **Drive**: bills go to `FY 2026-27/Bills in/_To review`. Approved bills are renamed `YYYY-MM-DD_Supplier_DocNo_Amount` and moved to `Bills in/<Rentals|Crew|Studios|Props|Other>/<Supplier>`. Rejected bills go to `Bills in/_Rejected`.

## What the weekly check looks for

- Income lines pointing at a missing invoice, or at an invoice for another client
- Invoices with no income line, or counted twice
- Zero amounts
- Supplier costs with no project
- Possible duplicate costs
- Missing supplier invoices, grouped by payee
- Overdue invoices
- Projects over budget
- Withholding tax: one person paid LKR 80,000 or more in a month
- Settings that look wrong
- Unpaid costs older than 30 days
- Unsorted bank lines, and a statement that is out of date
- Items waiting for approval

You can dismiss an issue so future checks skip it.
