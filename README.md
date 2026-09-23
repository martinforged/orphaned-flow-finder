# Orphaned Flow Finder

Orphaned Flow Finder is a Power Apps Code App for tenant-wide Power Automate
governance. Deploy it in a Dataverse solution named **Oprhaned Flow Finder**,
or use an organization-approved replacement solution name.

For tenant-to-tenant packaging, import, connection mapping, first-run, and
operations guidance, see [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md).

## Current milestone

Phase 2 adds Microsoft Entra ID validation and guarded orphan-flow recovery:

- Enumerates every active Power Platform environment visible to the signed-in administrator.
- Includes the tenant's default environment.
- Queries the tenant-wide **Power Platform inventory** for every cloud flow with Azure Resource Graph paging.
- Deduplicates owner IDs and classifies them as Active, Disabled, Deleted, Missing, or Unknown through **Office 365 Users**.
- Displays environment, flow ID, owner identity/status, creator object ID, creation time, and last modified time.
- Filters by free-text search, environment, owner status, specific owner, environment type, region, modified-date window, and Default environment.
- Makes every summary metric clickable: environment and cloud-flow cards reset/organize the inventory, while owner, orphaned, and disabled cards apply their matching quick filters.
- Shows active filter chips, per-environment flow counts, one-click filter reset, sorting, pagination, and CSV export.
- Reports malformed records and paging inconsistencies instead of silently omitting failures.
- Allows only flows with a directory-confirmed deleted owner to be selected for co-owner recovery.
- Requires recovery-user search, a preview, and explicit confirmation before adding a co-owner.
- Limits each confirmed recovery batch to five flows and reports every per-flow outcome.

Tenant scanning and directory validation are read-only. The only write path is the explicitly confirmed action that adds a valid recovery co-owner.

## Required permissions and connections

Use a Power Platform administrator or Dynamics 365 administrator account. The app uses these standard connectors:

1. **Power Platform for Admins** - lists tenant environments, including the Default environment.
2. **HTTP with Microsoft Entra ID (preauthorized)** - queries tenant-wide cloud flow inventory and owner identifiers from the GCC Power Platform API. Configure both the Base Resource URL and Microsoft Entra ID Resource URI as `https://api.gov.powerplatform.microsoft.us`.
3. **Office 365 Users** - validates owner object IDs and searches active replacement users.
4. **Power Automate Management** - uses **Modify Flow Owners as Admin** only after preview and confirmation.

Both connections use delegated permissions. **Power Platform for Admins** is a per-user connection, while the preauthorized HTTP connection can be shared. Power Apps can prompt each administrator to confirm the app's connection access before the first scan.

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

- Environment and flow inventory paging are followed with continuation tokens and guarded against repeated or unbounded tokens.
- Cloud flows are queried from the `PowerPlatformResources` inventory table by resource type, avoiding hundreds of per-environment management calls.
- Power Platform inventory can take up to 15 minutes to reflect newly created, changed, or deleted resources.
- Deleted or deleting environments are reported and skipped because they don't contain active flow inventory.
- A failed directory lookup remains **Unknown** and is never treated as proof that a user was deleted.
- Disabled users remain a separate status; only a directory 404/resource-not-found response is classified as orphaned.
- Successful recovery adds the selected active user as a co-owner. The Power Automate admin permissions API doesn't allow revoking the immutable primary-owner permission, so a deleted primary owner can remain listed.
- Solution-aware flows can have their primary owner changed separately through the flow details experience. Non-solution orphaned flows are recovered by assigning a valid co-owner, as documented by Microsoft.
