
# Plan: Notifications fix, Investments, Coin approvals, Moderation dashboard

This is a large, multi-system change. Splitting into four self-contained workstreams. Each ships independently so you can review before I move on.

---

## 1. Universal push + in-app notifications

**Problem.** FCM tokens are saved, but most events (new messages, new posts from followed creators, likes, comments, follows, coin tips, marketplace status) only insert a row into the `notifications` table — they never trigger a push, so nothing reaches phones / the OS notification center.

**Fix.**
- Add a Postgres trigger `on_notification_insert` on `public.notifications` that calls a new edge function `dispatch-push` via `pg_net`.
- New edge function `supabase/functions/dispatch-push/index.ts` — looks up the user's `push_tokens` and sends an FCM v1 push with `title`, `body`, `data.url`, `data.type`. Reuses the FCM logic from `notify-order-status`.
- Update `public/firebase-messaging-sw.js` to render a system notification for every background message, with deep-link click handler reading `data.url`.
- Add a small in-app toaster bridge (`src/components/PushDeepLinkBridge.tsx` already exists — extend it) so foreground messages also pop a toast and route on click.
- New triggers to *insert* notification rows for events that currently skip them:
  - Direct messages (`messages` insert → notify recipient, type `message`).
  - New post from a followed creator (notify each follower, type `new_post`).
  - Re-confirm existing triggers for `like`, `comment`, `follow`, `coin_tip` still fire.

SQL goes in `supabase-patches/2026-06-30-notifications-fanout.sql`. One manual apply in the SQL editor.

---

## 2. JagX / JRILICENSE Investment marketplace

**New surface inside `/marketplace`** — top tab "Invest" alongside the existing listings.

**Projects & caps (seeded, editable by admin):**
- JagX Connect — 10% of company available
- JagX AI Agent — 5%
- JagX AI — 1%
- Extensible: admin can add more projects later.

**Pricing model.**
- Each project has `total_shares`, `available_shares`, and `price_per_share_jagx` (JagX coin price).
- "Best price" = admin sets a base price; the UI also shows a suggested fair price using `marketcap / total_shares` so the admin can update with one click. No external market data fetch.
- Buyer inputs JagX amount → UI auto-calculates shares = `amount / price_per_share_jagx` and equity % = `shares / total_shares * 100`. Validated against `available_shares`.

**Buyer flow.**
1. Open project → enter JagX amount → review auto-calculated shares & equity %.
2. Submit personal credentials (legal name, government ID number, email, phone, address, country) + draw signature on canvas. Stored in `investment_applications`.
3. JagX is escrowed (debited from wallet to a `pending_investments` ledger row — refundable if rejected).
4. Status: `pending_admin_review`.

**Admin flow.**
1. New admin page `/admin/investments`.
2. Sees pending applications with full buyer credentials + signature image.
3. Approve → triggers:
   - Move JagX from escrow to project treasury.
   - Decrement `available_shares`.
   - Generate a signed PDF certificate (JRILICENSE branded, buyer name, shares, %, date, admin signature, unique cert ID) using `pdf-lib` inside an edge function. Stored in Supabase Storage bucket `investment-certs`.
   - Insert `investor` row linking user ↔ project ↔ shares.
   - Add `investor` badge / role on the buyer's profile (the "promote account" you asked for) via `user_roles` (new role `investor`).
   - Insert a `notifications` row with `related_url` pointing to the cert PDF → fires push via §1.
4. Reject → refund escrow, notify buyer with reason.

**Tables (new patch `2026-06-30-investments.sql`):**
- `investment_projects` (id, name, slug, equity_total_pct, equity_available_pct, total_shares, available_shares, price_per_share_jagx, status, cover_url).
- `investment_applications` (id, user_id, project_id, amount_jagx, shares, equity_pct, full_name, gov_id, email, phone, address, country, signature_data_url, status, admin_note, certificate_url, reviewed_by, reviewed_at, created_at).
- `investment_ledger` (id, user_id, project_id, amount_jagx, direction enum debit/credit, application_id, created_at).
- All with `GRANT`s, RLS (owner read own; admin read all; admin update), and `service_role` full access.
- New enum value `'investor'` added to `app_role`.

**Edge functions:**
- `supabase/functions/issue-investment-certificate/index.ts` — generates PDF, uploads to storage, returns signed URL. Invoked from admin approve action.

**Pages:**
- `src/pages/InvestPage.tsx` — project list.
- `src/pages/InvestProjectPage.tsx` — detail + apply form (amount, auto-calc preview, credentials, signature canvas).
- `src/pages/MyInvestmentsPage.tsx` — buyer's applications, status, download certificate.
- `src/pages/AdminInvestmentsPage.tsx` — review queue + approve/reject with PDF preview.
- Marketplace top tab → links to `/invest`.

---

## 3. Real-time coin purchase approvals

Right now JagX top-ups likely auto-credit. You want admin to approve.

- Add `coin_purchase_requests` table (id, user_id, amount, payment_method, payment_reference, status pending/approved/rejected, admin_id, created_at, processed_at).
- `/coins` page: "Buy JagX" now creates a `pending` request instead of crediting immediately.
- New admin page `/admin/coin-purchases` — pending list with realtime subscription; one-click Approve credits the wallet, inserts a notification (→ pushes via §1), and broadcasts to a per-user channel so the user's `/coins` page updates instantly. Reject path notifies + refunds reference.
- User-facing "My purchases" section on `/coins` shows live status pills (Pending → Approved → Credited / Rejected) via realtime channel.

Patch: `supabase-patches/2026-06-30-coin-approvals.sql`.

---

## 4. Admin moderation dashboard for reports

Builds on the existing `reports` table from `2026-06-29-reports-and-comment-pagination.sql`.

- New page `src/pages/AdminReportsPage.tsx` at `/admin/reports`:
  - Tabs: Open / Reviewed / Actioned / Dismissed.
  - Each row: reporter, target preview (post text / image / comment text — fetched live), reason, details, created_at.
  - Actions: **Approve report → Remove content** (soft-delete the post or comment, notify author), **Dismiss** (no action, status → dismissed), **Mark reviewed**.
- Audit log table `moderation_audit_log` (id, report_id, admin_id, action, previous_status, new_status, notes, created_at) with RLS admin-only read. Every action writes one row.
- Add an "Audit log" tab showing the last 200 entries with admin avatar, action, target link.
- Add admin entry-points to `AdminPage.tsx` linking to: Reports, Investments, Coin Purchases.

Patch: `supabase-patches/2026-06-30-moderation.sql` (audit log table + soft-delete columns `removed_at`, `removed_by` on `posts` and `comments`, plus a `has_role('admin')` policy allowing admin updates).

---

## Manual steps after I ship

1. Apply 4 SQL patches in order in the Supabase SQL editor.
2. Confirm `FIREBASE_SERVICE_ACCOUNT_JSON` secret is already set (used by §1 and existing order push).
3. Seed the three investment projects from the admin page (one-click "Seed defaults" button included).

---

## Order I'll build in

I'll ship **§1 (push fanout) first** as a standalone turn since it's the smallest and unblocks everything else's notifications. Then §4 (moderation, smallest UI), then §3 (coin approvals), then §2 (investments — biggest). Confirm and I'll start with §1.
