# AISO Portal v3 MVP

This project is an independent copy of `portal-v2-mvp` focused on centralized
software-to-hardware compatibility management.

## v3 changes

- Adds a dedicated **Compatibility Mapping** view as a standalone sidebar entry,
  parallel to Parameter Center (permission-gated via `compatibility.read`).
- Provides software search, status filtering, mapping summaries, and a searchable
  published-hardware selector.
- Removes compatibility selection from software create and edit forms.
- Keeps `compatible_hardware` on the software product so storefront previews,
  product details, and hardware takedown guards remain compatible with v2 data.
- Logs mapping changes to Activity Log and product history.
- Adds centralized `compatibility.read` and `compatibility.update` permission
  boundaries for future RBAC integration.
- Uses the separate localStorage key `aiso-portal-v3-mvp`, preventing v3 from
  reading or overwriting v2 prototype data.

## Synced with v2 (2026-07-20)

- Ported the Licensing feature from v2: per-software single-select licensing
  offer, shown as a storefront badge next to the product name, selectable in the
  software create form. Since 2026-07-22 the offers are static (`SW_LICENSE_TYPES`
  in app.js): First year free (green), N-day free trial (blue, day count entered
  per product), Free during POC (purple), or Not specified — the former
  Parameter Center → Licensing Options module was removed.
- Re-synced all other shared code with v2's latest working tree; the remaining
  differences between the two prototypes are v3's compatibility centralization,
  the permission scaffold, and the separate storage key.

## Official Website field (2026-07-27)

- Software products expose an optional **Official Website** field in the create
  and edit forms, stored on the existing `officialUrl` property that was
  previously carried in seed data but never surfaced.
- The value is normalised on save (`www.example.com` becomes
  `https://www.example.com`); a filled-in value must parse as an `http`/`https`
  URL or the form is blocked.
- Both live previews render it under the storefront action button, showing the
  domain without the scheme. A blank or still-invalid value
  keeps a grey placeholder row so the footer never shifts while typing, and the
  preview stays non-interactive like the rest of the storefront mock-up.
- The software detail page shows it as a clickable `Website` row in Product
  Info, or `—` when unset.
- The storefront action footer no longer carries the "Request a custom quote
  for this add-on" line.

## Current policy

- Only published hardware can be added to a mapping.
- Draft and published software can be configured.
- Archived software mappings are read-only.
- Changes to published software take effect immediately.
- Bundled software without a mapping is highlighted as needing configuration,
  but remains allowed until the final business rule is confirmed.

## Run locally

Serve this directory with any static HTTP server, then open `index.html`.

Demo credentials:

- Email: `root@aiso.com`
- Password: `aiso1234`
