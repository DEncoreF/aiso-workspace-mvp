# AISO Workspace v4 MVP

A front-end prototype of the AISO back-office workspace: the product catalogue,
purchase orders, the after-sales Service Desk, and the organizations, roles and
accounts that decide who sees what.

Everything runs in the browser. There is no backend — state lives in
`localStorage` under `aiso-portal-v4-mvp` (schema `VERSION 8`; a version bump
discards old saves and falls back to the seed data).

## Run it

Serve this directory with any static HTTP server, then open `index.html`.

```
python3 -m http.server 4173
```

Sign in with `root@aiso.com` / `aiso1234`.

**To see what anyone else sees, use the View as switch at the bottom right.**
It lists every role of every organization; picking one applies that role's
permissions and its organization's data scope through the same code path a real
account uses. Demos never need a second login.

Other accounts can sign in (same password) and the flow is real — one role
enters directly, several open a role picker, and the sidebar account menu
switches roles without signing in again — but the demo path is the switch.

## The modules

| Module | What it holds |
|---|---|
| Software / Hardware Products | The catalogue: drafts, publishing, images, specs, per-product history |
| Compatibility | Which published hardware each published software product can pair with |
| Parameter Center | System-level vocabularies (product types, categories, industries) and display order |
| Orders | Purchase orders, their lines, serial numbers, BOM, licence keys, documents |
| Service Desk | After-sales tickets raised against one order line |
| Organizations | Organizations, the roles built inside them, their members, and all accounts |
| Activity Log | What was done in this session, stamped with the acting organization |
| Asset Registry | Serial numbers and warranty for AISO-built devices — **hidden**, see below |

## Who can do what

Three layers, described in full in [docs/ORG_MANAGEMENT_PLAN.md](docs/ORG_MANAGEMENT_PLAN.md):

1. **The organization type sets a ceiling.** `OPERATOR` (AISO) reaches
   everything; a `CUSTOMER` reaches its own orders, tickets, devices and
   members and nothing else. The ceiling is hard-coded, because roles are not.
2. **Roles are built in the UI**, inside one organization, from a module × CRUD
   matrix. Cells outside the ceiling are shown as a dash and stripped on save,
   so a role can never exceed its type.
3. **An account is bound to roles**, possibly in several organizations. Only one
   binding is in effect at a time — switching role is how the view changes, and
   permissions are never merged across roles.

`root@aiso.com` is a **Super Admin**: a system account that belongs to no
organization, holds no role, passes every check, and is never counted as a
member.

Customers come in two kinds. An **enterprise** customer runs its own members and
roles; an **individual** customer *is* the account, so organization management
is absent from its ceiling entirely — it has one Owner role, created with the
organization, and no Organizations page of its own.

Vendor organizations (`VENDOR`, split into `SOFTWARE` / `HARDWARE` / `SI`) exist
in the data and back the product catalogue's vendor matching, but are not
managed, cannot hold roles and cannot sign in this round. The plan's Deferred
section records what opening them up requires.

## Free text, then linked

Customer and supplier names on an order are free text — an order is never
blocked by a missing directory entry. A customer name that matches an
organization exactly links to it (`customer_org_id`), which is what customer
scoping reads. Unmatched names are shown as **Not linked** in the order detail,
with buttons to create that organization or link to an existing one, rather than
being left silently null. Supplier links wait for vendor organizations.

## Service Desk

Tickets hang off an **order line**, not the order header: the line carries the
scope, serials, warranty or licence period and SLA that the entitlement card
shows. Only confirmed orders can take a ticket. Each ticket snapshots what it
needs at creation, so later edits to the order never rewrite history.

AISO is the single service window — there is no vendor assignment. The public
status (`OPEN → IN_PROGRESS ⇄ AWAITING_CUSTOMER_INFO → RESOLVED → CLOSED`) is
what the customer sees; a separate desk-only **internal handling** state records
who AISO is waiting on (HW supplier, SW supplier, SI, or its own bench) and is
never exposed to the customer.

See [docs/SERVICE_DESK_PLAN.md](docs/SERVICE_DESK_PLAN.md) and
[docs/ORDER_MANAGEMENT_PLAN.md](docs/ORDER_MANAGEMENT_PLAN.md).

## Asset Registry (hidden)

The registry holds one record per AISO-built device: the serial number from the
manufacturing team, the warranty attached to it, and which customer claimed it.
Its nav entry is commented out in `js/seed-data.js` while the MVP4 order lands
first; the view and its code are untouched and the data model is current, so
restoring the entry brings it back.

What it does when enabled:

- **Scope: AISO-built devices only.** Partner hardware is warranted by its own
  vendor, so it never gets a device record; its serials sit on order lines.
- **Import** takes the manufacturing team's CSV
  (`serial_no,model,shipped_at,warranty_months`). Rows are checked one at a
  time and a run may partly succeed — one typo in five hundred lines should not
  cost the other 499. A serial already on file is updated, never duplicated.
- **Add** covers the single device that arrives outside a production run.
  Both routes share one validator, and Add refuses a serial already on file.
- **Two owners, one record.** Manufacturing owns `serial_no`, `product_id`,
  `shipped_at` and `warranty_months`; the workspace owns `warranty_start`, the
  claim and the order link. `warranty_source` is the test: while it reads
  `ship_date` nobody set the start deliberately, so an import may still move it.
  Only the *start* is protected — a corrected term still moves the end.
- **Export for Portal** writes a `warranty-data.js` for `hardware/v6/js/`. It is
  a format conversion, not a state export: only the manufacturing columns cross
  over, so the Portal copy can never disagree with this one.

**Known limit:** claim state cannot flow back. A customer registering on the
Portal marks the device claimed there, and this side reads a static file. With
no shared backend this has no fix; it is the first thing that will need one.

## Layout

```
index.html          markup, styles, view containers
js/seed-data.js     demo data, vocabularies, nav, permission ceilings
js/store.js         localStorage load/save, schema version, image compression
js/app.js           everything else
docs/               module plans (Chinese), mockups
```
