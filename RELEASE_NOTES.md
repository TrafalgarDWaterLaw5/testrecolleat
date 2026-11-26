# Build 4.45

- Dedicated Friends, Account Settings, Privacy & Safety and administrator-only Founder Dashboard views.
- Visible invitation code, friend action menus, password recovery and optional persistent sign-in.
- No database migration. Journal and photographs remain local. Test recovery email, token refresh, account actions and access controls on the deployed site before beta.

# Build 4.4 — dedicated Account & Friends

- Friends main navigation; Places and Dishes paired in More.
- Profile shortcut to dedicated account view.
- Separate accepted friends, following and requests. Following preferences are local to this device and only accepted friends can be followed; no feed or sharing yet.
- Existing Supabase configuration and schema retained. No migration or restaurant cloud storage.

# Build 3.5 — 25 November 2026

Permanent home metrics, one home add action, service contrast, centered Collection metrics, wider calendar month selector, privacy wording, and separate median price with minimum spread for Palate Code. Price spread threshold is a product heuristic, not a significance test. Database unchanged. Future accounts: personalise greeting using authenticated display name; not implemented yet.

---

# Build 3.4 — Original local journal

Based on 3.3, not the 4.x social draft. Fresh UI styling and external Maps search copied independently. Location cards replace bubbles on all screens; photo editing uses the same existing local location store. Add icon uses symmetric SVG, with no generated glyph. No schema changes, new account service, Google API calls or journal upload. Existing application identity and icon images retained. Upload all root files, including the new v3-4 CSS/JS files, to the original repository. Export a backup first.

## Verification

Chromium with 94 simulated restaurants: 320, 360, 393, 412, 844 and 1280 px, seven destinations, plus geometry (0 px horizontal and vertical offset), all six palettes in both modes on Home and Places, local search and location photo editing/navigation. Synthetic test photos; no real Android or IndexedDB persistence test. No new backend.

## Previous release
# Recolleat — Build 3.3

24 November 2026 · Base: supplied Build 3.2. Local IndexedDB database version 7; unchanged app installation identity.

## Changes
- Home: equally sized Add restaurant (Quick Log) and New restaurant (full editor) buttons, full-width Scan receipt, six centered unnumbered statistics, smaller International label, centered disclosure titles without arrows.
- Dish data: one derived catalogue of dated visit dishes and undated review dishes. Ranked views include valid ratings only; counts distinguish all recorded dishes from rated dishes. Passport and desktop table show both sources. The full review shows existing visit dishes separately. Duplicate-name warnings are advisory, never delete or automatically merge existing records.
- Receipt workflow: selected items become editable Quick Log dish rows with prices and optional ratings. Cancelling a scan returns the in-memory form, preserving existing dishes, note, photo and payment state. Save & review saves once then opens the saved restaurant. Basic Quick Log drafts retain text, ratings and receipt prices; draft photos are still not persistent across a browser restart.
- Independent meal value and personal payment inputs with Same as meal value shortcuts; treated meals save zero payment. Existing unknown amounts remain unknown.
- Memories: rotates up to three eligible dated visits each local day (at least 30 days old), prioritizes anniversaries, refreshes after a date change or resume. With very few eligible visits, the selection may repeat; no invented memories.
- Cuisines: compact clickable ranking by mean or median overall restaurant rank, mean default unless a prior preference exists. Overview, restaurants and dishes pages, 210 ms incoming slide, swipe and button/keyboard navigation, reduced-motion support. Provisional cuisines remain separate.
- Hall of Flavour: simplified header, scrollable rows with compact score and rank, expandable long text and direct source editing.
- Install icon: crisp mint speech-bubble and utensils symbol, opaque emerald background, separate mask-safe icon. Root-level install assets and diagnostics retained. Manifest icon URLs versioned.
- Extra safeguards: missing score is not automatically converted to 0 or 8, photo-only migration check includes dish photos, confirmation before removing a detailed visit, Quick Log double-submit guard.

## Verification and limitations
- Chromium rendering with simulated storage, using a synthetic 94-restaurant collection, 24 visits and 121 recorded dishes (119 rated); 320, 360, 393, 412, 844 landscape and 1280 desktop widths for Home. Hall at 320, 393 and 844. No document horizontal overflow or reported JavaScript exceptions in the tested paths.
- Tested daily rotation and same-day stability; cuisine passport button and synthetic touch-swipe; both dish sources and unrated labels; visit edit preserves unknown payment; receipt cancel and continuation retain existing form values; receipt quantity £9.01 splits to £4.51 and £4.50; Save & review creates exactly one restaurant and one visit with three dishes.
- JavaScript syntax, CSS top-level parsing, unique HTML IDs, manifest icon dimensions, asset references, and ZIP integrity checked.
- The browser environment blocked real HTTP navigation. These tests use the actual rendering and application code with an in-memory test adapter, not an independent IndexedDB persistence or real-device test. Android launcher icon refresh, actual touch feel, receipt OCR support, offline service-worker update, migration and full accessibility across themes are not newly verified. Native receipt image recognition remains dependent on device/browser support.
- A complete CSS architecture refactor and actual usage/retention testing remain future work. No accounts, cloud database or additional online dependencies were introduced.

## Deployment
Export a JSON backup before replacing files. Extract the ZIP, upload all contents (including .assetsignore) to the existing GitHub repository root, and commit to main. Keep the existing Cloudflare configuration. Check /recolleat-release.txt and accept the app's update prompt when offered. Existing installed icons can refresh later than the app itself; avoid clearing site data or uninstalling merely to refresh the launcher icon.

## Build 4.3 — accounts and private connections
- Optional verified email/password accounts, private invite-code-based requests and mutual acceptance, remove/block/unblock/report, account deletion, and role-gated founder account moderation.
- Local restaurant data and photos remain local, with no cloud journal or sharing. Existing database identifiers retained.
- Supabase SQL and setup guide supplied; backend must be provisioned and tested before accounts work. No live backend was provisioned as part of this ZIP.
- Personalized home greeting after sign-in. No persistent account session in browser storage.
- Future per-entry sharing, protected cloud photo delivery and shared content moderation intentionally deferred; no public content access is enabled.
- Local per-restaurant sharing preference drafts (overall rating, dish ratings, review and photographs) default to private; never transmitted. Actual publication is disabled.

## Connected branch 4.3
Renumbered account foundation to 4.3. Optional Google Maps restaurant matching in full editor, storing place IDs locally only. No automatic journal sync. Configure both providers independently; live integration untested.

## Build 4.46 — social authentication
- Google and Apple OAuth via Supabase, using PKCE with a short-lived per-tab verifier; existing email/password and optional persistent sign-in retained.
- No database changes. Provider setup required; no live OAuth test yet. No restaurant data is shared or uploaded.
- See backend/OAUTH_SETUP.md. Apple web authentication requires paid developer membership and periodic secret renewal. Verify provider branding, account linking and privacy notices before beta.

## Build 4.47
Replaces the previous paid-field Google browser search with optional ID-only server search. Disabled until configured; manual logging unaffected. Candidate verification opens Google Maps externally. No schema changes, no friends feed, no advertising or SMTP activation. See backend/GOOGLE_SETUP.md and backend/CHECKLIST.md. Existing authentication options retained. Live integration not tested.
