# Orphaned Flow Finder

Orphaned Flow Finder is a Power Apps Code App for tenant-wide Power Automate
governance. Deploy it in a Dataverse solution named **Oprhaned Flow Finder**,
or use an organization-approved replacement solution name.

For tenant-to-tenant packaging, import, connection mapping, first-run, and
operations guidance, see [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md).

## Downloadable solution packages

Ready-to-import Power Platform solution packages are available in
[solutions/](./solutions/):

- [Managed solution](./solutions/OrphanedFlowFinder_1_1_1_0_managed.zip) -
  recommended for production, UAT, and most tenant installations.
- [Unmanaged solution](./solutions/OrphanedFlowFinder_1_1_1_0_unmanaged.zip) -
  intended only for organizations taking ownership of future development.

The packages contain the Code App and four solution connection references.
Target-tenant connections must be created and mapped during or after import.
See the deployment guide before installing.

## Current release: v1.1.1

Version 1.1.1 adds scanned co-owner inventory and the latest available flow run
date while retaining tenant scoping, authoritative Dataverse classification,
Microsoft Entra ID validation, and guarded flow recovery:

- Merges the Power Platform for Admins environment list with
  `microsoft.powerplatform/environments` inventory records so Dataverse-backed
  and non-Dataverse environments are both covered.
- Includes the tenant's default environment and adds an ID-based fallback entry
  when a flow references an environment missing from both discovery sources.
- Loads active environments before the flow scan so an administrator can scan
  all environments, check **Default environment only**, or select one tenant
  environment.
- Applies a selected environment directly to the **Power Platform inventory**
  query so only that environment's cloud flows and owners are processed.
- Deduplicates owner IDs and classifies them as Active, Disabled, Deleted, Missing, or Unknown through **Office 365 Users**.
- Displays environment, Dataverse database status, solution-aware status, flow
  ID, owner identity/status, additional co-owners, creator object ID, creation
  time, last modified time, and the latest available flow run time.
- Filters by free-text search, environment, owner status, specific owner,
  environment type, region, Dataverse database status, modified-date window,
  and Default environment.
- Makes every summary metric clickable: environment and cloud-flow cards reset/organize the inventory, while owner, orphaned, and disabled cards apply their matching quick filters.
- Shows active filter chips, per-environment flow counts, one-click filter reset, sorting, pagination, and CSV export.
- Reports malformed records and paging inconsistencies instead of silently omitting failures.
- Allows an administrator to select scanned flows and assign an active Microsoft
  Entra user as a co-owner, regardless of whether the environment has
  Dataverse.
- Requires user search, a preview, and explicit confirmation before granting
  co-owner access.
- Limits each confirmed assignment batch to five flows and reports every
  per-flow outcome.
- Provides a guided **Send a copy** action for one selected non-solution flow.
  The action opens that flow in the GCC Power Automate maker portal, where an
  existing owner or co-owner completes the supported Send a copy panel.

Tenant scanning, permission inventory, run-history lookup, and directory
validation are read-only. The only write path is the explicitly confirmed
action that adds a valid co-owner. The guided Send a copy action changes no
permissions or flow data in this app.

## Required permissions and connections

Use a Power Platform administrator or Dynamics 365 administrator account. The app uses these standard connectors:

1. **Power Platform for Admins** - lists tenant environments, expands Dataverse metadata, and identifies databases when available.
2. **HTTP with Microsoft Entra ID (preauthorized)** - queries tenant-wide environment and cloud flow inventory plus supported flow run history from the GCC Power Platform API. Configure both the Base Resource URL and Microsoft Entra ID Resource URI as `https://api.gov.powerplatform.microsoft.us`.
3. **Office 365 Users** - validates owner object IDs and searches active co-owner candidates.
4. **Power Automate Management** - reads current flow owner permissions during a scan and uses **Modify Flow Owners as Admin** only after preview and confirmation.

All connector calls use delegated permissions. **Power Platform for Admins** is
a per-user connection, while the preauthorized HTTP connection can be shared.
Power Apps can prompt each administrator to confirm the app's connection access
before the first scan.

### GCC implementation note

The app calls the inventory API through the preauthorized HTTP connector because the **Power Platform for Admins V2** connector returned `AADSTS7000301` for its on-behalf-of token in GCC (the connector certificate was issued from a different cloud instance). The Code App has no runtime dependency on that V2 connector.

## Local development

```powershell
npm install
npx pa auth login --cloud usgov --environment-id <TARGET-ENVIRONMENT-ID>
npx pa app run
```

Open the **Local Play** URL in the same browser profile used for the GCC tenant.

## Validation

```powershell
npm run lint
npm run build
```

## Publish

Build before publishing, then target the existing solution by ID:

```powershell
npm run build
npx pa app push --solution-id <TARGET-SOLUTION-ID>
```

## Inventory behavior

- Admin and inventory environment results are merged by environment ID.
- Dataverse status comes only from the expanded
  `properties.linkedEnvironmentMetadata` returned by Power Platform for
  Admins. Flow-level `workflowEntityId` never promotes an environment to
  Dataverse.
- When expanded metadata confirms a database, the UI reports **Dataverse**.
  When the admin environment record has no linked database metadata, it reports
  **No Dataverse**. If the admin source isn't available, it reports
  **Database unknown** rather than guessing.
- Environment and flow inventory paging are followed with continuation tokens and guarded against repeated or unbounded tokens.
- Cloud flows are queried from the `PowerPlatformResources` inventory table by resource type, avoiding hundreds of per-environment management calls.
- After the base inventory loads, owner permissions and supported run history
  are enriched in bounded batches of five flows to limit connector pressure.
- The additional co-owner list includes `Owner` and `CanEdit` permissions other
  than the primary owner reported by inventory. A failed permission lookup is
  shown as **Lookup failed** and never as an empty co-owner list.
- Last flow run uses the latest valid run start time returned by the Power
  Platform flow-runs API. The API requires a confirmed Dataverse database and a
  flow `workflowEntityId`; other rows show **Not available**, and a supported
  lookup that fails shows **Lookup failed**.
- Power Platform inventory can take up to 15 minutes to reflect newly created, changed, or deleted resources.
- Deleted or deleting environments are reported and skipped because they don't contain active flow inventory.
- A failed directory lookup remains **Unknown** and is never treated as proof that a user was deleted.
- Disabled users remain a separate status; only a directory 404/resource-not-found response is classified as orphaned.
- Successful assignment adds the selected active user as a co-owner without
  removing existing owners or transferring their connections.
- **Send a copy** requires exactly one selected non-solution flow. It opens
  `https://make.gov.powerautomate.us` at the selected flow's details page
  because the supported Power Automate Management connector doesn't expose the
  portal's Send a copy operation.
- For solution-aware flows, use **Save As** or solution export/import instead;
  the app disables Send a copy only when the environment is confirmed as
  Dataverse-backed and the flow reports a `workflowEntityId`.
- An existing owner or co-owner must complete Send a copy in Power Automate.
  Tenant inventory or environment-admin access alone might not expose that
  command.
- The recipient creates an independent flow using their own connections.
  Changes don't synchronize from the original, and the sent copy can't be
  revoked from the original flow. Review the definition for personal
  information, secrets, and hard-coded environment values before sending.
- The Power Automate admin permissions API doesn't allow revoking an immutable
  primary-owner permission, so a deleted primary owner can remain listed.
- Solution-aware flows can have their primary owner changed separately through
  the flow details experience. Both solution-aware and non-solution flows can
  receive a co-owner through this app.
