# AISO Portal v4 MVP

An independent copy of `portal-v3-mvp` that adds the **Asset Registry** — the
record of every AISO-built device, its serial number and its warranty.

It uses the localStorage key `aiso-portal-v4-mvp`, so it never reads or
overwrites v3 prototype data.

## Why the registry exists

The Portal lets a customer register a device and look up its warranty using
nothing but a serial number. Those pages need real serials to check against, and
this is where serials live.

Serial numbers are **produced by the manufacturing team**, not here. This module
imports their list, keeps the warranty attached to each device, and hands the
Portal a copy of what it needs.

## Scope: AISO-built devices only

AISO warrants what it builds. Partner hardware — the GIGABYTE workstations, the
Phison drives — is warranted by its own vendor, so it never gets a device record
here; its serials sit on order lines instead. Importing a partner model is
rejected with that reason stated, rather than looking like a typo.

Own-brand products carry `is_own_brand: true`. The seed adds one, **AISO1 AI
Agent Workstation**, whose model and serials match the Portal's
`hardware/v6/js/warranty-data.js` so the two sides line up out of the box.

## Two owners, one record

Each device is written by two parties, and an import has to respect the split:

| Columns | Owner | On re-import |
|---|---|---|
| `serial_no` `product_id` `shipped_at` `warranty_months` | manufacturing | refreshed |
| `warranty_start` | workspace, once adjusted | left alone |
| `warranty_end` | derived | always recomputed from start + term |
| `service_org_id` `claimed_at` `order_line_id` `status` `replaced_by_asset_id` | workspace | untouched |

`warranty_source` is the test: while it reads `ship_date` nobody has set the
start deliberately, so a shipment may still move it. Anything else means someone
did, and the import leaves it be.

Note that only the **start** is protected. An adjustment says "coverage began on
this date", not "freeze the end date" — so a corrected term still moves the end,
otherwise a record could claim 24 months while showing an end date 36 months out.

## Import

Paste the manufacturing team's CSV:

```
serial_no,model,shipped_at,warranty_months
AISO1-2026-1001,AISO1,2026-03-14,36
```

`model` is the string on the label, not an internal id. Rows are checked one at a
time and a run may partly succeed — one typo in five hundred lines should not
cost the other 499. A serial already on file is updated, never duplicated.

## Adding devices

A production run arrives through **Import**. **Add** covers the single device
that arrives outside one — a replacement unit, an engineering sample, a serial
sent through after the fact.

Both routes share one validator, so a serial typed by hand clears exactly the
checks a pasted one does. Add refuses a serial already on file rather than
quietly turning into an update, since that is not what the button says it does.

## Export for the Portal

**Export for Portal** downloads a `warranty-data.js` to drop into
`hardware/v6/js/`. It is a format conversion, not a state export: only the
manufacturing columns cross over, so the Portal copy can never disagree with this
one about anything it holds. Claims and order links stay here.

## Known limit

Claim state cannot flow back. A customer registering on the Portal marks the
device claimed there, but this side reads a static file and will not see it —
and a release here will not reach the Portal either. With no shared backend this
has no fix; it is the first thing that will need one.

## Run locally

Serve this directory with any static HTTP server, then open `index.html`.

Demo credentials:

- Email: `root@aiso.com`
- Password: `aiso1234`
