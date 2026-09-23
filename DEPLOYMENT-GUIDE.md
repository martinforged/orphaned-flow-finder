# Orphaned Flow Finder Deployment and Tenant Onboarding Guide

## Document purpose

This guide explains how to package, move, configure, validate, and operate
Orphaned Flow Finder in a different Microsoft Power Platform tenant and
environment.

The validated deployment path is **GCC to GCC**. A deployment to Commercial,
GCC High, DoD, China, or an air-gapped cloud must be treated as a separate
porting exercise because service URLs, connector availability, authentication,
and Code App hosting regions differ.

This document is intended for:

- Power Platform administrators
- Dynamics 365 administrators
- Power Platform solution/ALM owners
- Developers responsible for the Code App source

## 1. What the solution contains

The solution display name is **Oprhaned Flow Finder**. The Code App display
name is **Orphaned Flow Finder**.

The app:

1. Reads the tenant's Power Platform environments.
2. Queries Power Platform Inventory for tenant-wide cloud flow inventory.
3. Validates unique owner object IDs against Microsoft Entra ID.
4. Classifies owner records as Active, Disabled, Deleted, Missing, or Unknown.
5. Filters, sorts, pages, and exports the inventory.
6. Allows a confirmed deleted-owner flow to receive a valid recovery co-owner.

Tenant scanning and directory validation are read-only. The only write operation
adds a recovery co-owner after the operator reviews the affected flows and
selects an explicit confirmation check box.

## 2. Connector architecture

The app requires four connectors.

| Connector | Connector ID | Purpose | Connection behavior |
| --- | --- | --- | --- |
| Power Platform for Admins | `shared_powerplatformforadmins` | Lists environments, including Default | Per-user/nonshareable |
| HTTP with Microsoft Entra ID (preauthorized) | `shared_webcontents` | Calls the GCC Power Platform Inventory API | Shareable connection |
| Office 365 Users | `shared_office365users` | Validates owner IDs and searches recovery users | Per-user/nonshareable |
| Power Automate Management | `shared_flowmanagement` | Adds a confirmed recovery co-owner | Per-user/nonshareable |

### GCC Power Platform API connection

For the HTTP with Microsoft Entra ID (preauthorized) connection, configure both
fields with this exact GCC value:

| Field | GCC value |
| --- | --- |
| Base Resource URL | `https://api.gov.powerplatform.microsoft.us` |
| Microsoft Entra ID Resource URI | `https://api.gov.powerplatform.microsoft.us` |

Do not use this GCC endpoint in another cloud.

## 3. Publisher preparation before exporting

Complete this section once in the source/development environment before
distributing the solution.

### Why this step is mandatory

Connector connections are environment-specific and must not be transported as
source-environment connection IDs. The Code App must use connection references
that are solution components. The target import can then map each reference to
a target-tenant connection.

Do not distribute an export until the solution contains all four connection
references and the Code App has been republished against them.

### 3.1 Prerequisites in the source environment

Confirm:

- The source environment has Microsoft Dataverse.
- Code Apps are enabled.
- The Code App is in the **Oprhaned Flow Finder** solution.
- The app builds successfully.
- All four source connections are in Connected status.
- The operator has edit access to the solution and Code App.
- Node.js 22 or later is installed.
- The project dependencies have been restored with `npm install`.

### 3.2 Create four connection references

In the source maker portal:

1. Select the source environment.
2. Open **Solutions**.
3. Open **Oprhaned Flow Finder**.
4. Select **New** > **More** > **Connection reference**.
5. Create the following references.

| Recommended display name | Connector | Source current connection |
| --- | --- | --- |
| Orphaned Flow Finder - Power Platform Admins | Power Platform for Admins | A connected admin connection |
| Orphaned Flow Finder - Inventory API | HTTP with Microsoft Entra ID (preauthorized) | The connection configured with the GCC API URL |
| Orphaned Flow Finder - Directory Users | Office 365 Users | A connected directory connection |
| Orphaned Flow Finder - Flow Management | Power Automate Management | A connected admin connection |

The solution publisher creates the logical names. Record the exact logical name
of each reference.

### 3.3 Verify the connection references

From the Code App project directory, authenticate to the source GCC
environment and list the references:

```powershell
npx pa auth login `
  --cloud usgov `
  --environment-id <SOURCE-ENVIRONMENT-ID>

npx pa connection list-references `
  --solution-id <SOURCE-SOLUTION-ID>
```

The output must list four references. If it reports
`No connection references found`, stop and complete section 3.2.

### 3.4 Rebind each Code App data source

Remove the direct connection bindings:

```powershell
npx pa app remove data-source `
  --connector shared_powerplatformforadmins `
  --name powerplatformforadmins `
  --force

npx pa app remove data-source `
  --connector shared_webcontents `
  --name webcontents `
  --force

npx pa app remove data-source `
  --connector shared_office365users `
  --name office365users `
  --force

npx pa app remove data-source `
  --connector shared_flowmanagement `
  --name flowmanagement `
  --force
```

Add the data sources back using their solution connection references:

```powershell
npx pa app add data-source `
  --connector shared_powerplatformforadmins `
  --connection-ref <POWER-PLATFORM-ADMINS-LOGICAL-NAME> `
  --solution-id <SOURCE-SOLUTION-ID>

npx pa app add data-source `
  --connector shared_webcontents `
  --connection-ref <INVENTORY-API-LOGICAL-NAME> `
  --solution-id <SOURCE-SOLUTION-ID>

npx pa app add data-source `
  --connector shared_office365users `
  --connection-ref <DIRECTORY-USERS-LOGICAL-NAME> `
  --solution-id <SOURCE-SOLUTION-ID>

npx pa app add data-source `
  --connector shared_flowmanagement `
  --connection-ref <FLOW-MANAGEMENT-LOGICAL-NAME> `
  --solution-id <SOURCE-SOLUTION-ID>
```

Names are case-sensitive. Use the logical names returned by
`pa connection list-references`.

### 3.5 Build and republish

```powershell
npm run lint
npm run build
npx pa app push --solution-id <SOURCE-SOLUTION-ID>
```

Open the solution and verify that it contains:

- The Orphaned Flow Finder Code App
- Four connection references

Run one source-environment scan after republishing. Do not export until the
scan works with the reference-based bindings.

## 4. Export the source solution

### 4.1 Choose managed or unmanaged

Use:

- **Managed** for Test, UAT, or Production environments where recipients
  shouldn't directly modify the solution.
- **Unmanaged** only when the target team must continue development and accepts
  ownership of the customizations.

For most distributions, export a managed package and provide the source code
separately under the organization's approved source-control process.

### 4.2 Export steps

1. Open the **Oprhaned Flow Finder** solution.
2. Select **Publish all customizations**.
3. Update the solution version.
4. Run Solution Checker if required by organizational policy.
5. Select **Export**.
6. Choose **Managed** or **Unmanaged**.
7. Download the solution ZIP.
8. Do not unzip or modify the exported package.

Distribute:

- The exported solution ZIP
- This deployment guide
- Release notes/version
- Optional source package for approved developers

## 5. Target tenant prerequisites

The target environment must have:

- Microsoft Dataverse
- Code Apps enabled
- Power Platform Inventory available
- All four required connectors allowed by Data Loss Prevention policy
- An appropriate Power Apps license for every operator
- Premium connector entitlement for HTTP with Microsoft Entra ID
  (preauthorized)
- Network access to the target Power Platform, Power Apps, connector, and
  Microsoft Entra endpoints

### Required administrator role

Operators who scan and recover flows should hold one of:

- Power Platform Administrator
- Dynamics 365 Administrator, with access to the applicable environment
- Global Administrator, where organizational policy permits

Do not broadly share this governance app with regular environment users. A
regular user might be able to launch the app but won't have the tenant-wide
admin permissions required by its connectors.

Use a dedicated Microsoft Entra security group for authorized governance
operators whenever possible.

## 6. Create connections in the target environment

Create the target connections before importing the solution. Sign in with an
authorized target-tenant administrator.

### 6.1 Power Platform for Admins

1. Go to the target maker portal.
2. Select the target environment.
3. Open **Connections**.
4. Select **New connection**.
5. Create **Power Platform for Admins**.
6. Confirm the connection shows **Connected**.

### 6.2 HTTP with Microsoft Entra ID (preauthorized)

1. Create **HTTP with Microsoft Entra ID (preauthorized)**.
2. Select **Log in with Microsoft Entra ID**.
3. For GCC, set both connection fields to:
   `https://api.gov.powerplatform.microsoft.us`
4. Complete sign-in.
5. Confirm the connection shows **Connected**.

This is a Premium connector. If creation fails, confirm licensing, DLP policy,
the exact GCC endpoint, and administrator permissions.

### 6.3 Office 365 Users

1. Create **Office 365 Users**.
2. Sign in with the target-tenant administrator.
3. Confirm the connection shows **Connected**.

### 6.4 Power Automate Management

1. Create **Power Automate Management**.
2. Use Microsoft Entra ID Integrated authentication.
3. Sign in with the target-tenant administrator.
4. Confirm the connection shows **Connected**.

## 7. Import the solution

1. Sign in to the target maker portal.
2. Select the target environment.
3. Open **Solutions**.
4. Select **Import solution**.
5. Upload the exported ZIP.
6. Review the package details and dependencies.
7. Map each connection reference to the matching target connection.
8. Complete the import.
9. Wait for the import to report Success.
10. Open the imported solution and verify the Code App and four connection
    references are present.

If the import wizard doesn't request a connection mapping:

1. Open each connection reference in the imported solution.
2. Set **Current connection** to the correct target connection.
3. Save the reference.
4. Publish all customizations.

Never point a target reference to a source-tenant connection ID.

## 8. First-run configuration

1. Open Orphaned Flow Finder from the target solution.
2. When Power Apps displays **Allow this app to access your data**, verify all
   four connectors.
3. Select **Allow**.
4. Select **Scan tenant**.
5. Keep the player open until inventory and directory validation complete.

Power Platform Inventory can take up to 15 minutes to reflect recently created,
modified, or deleted resources.

## 9. Acceptance test

Complete this checklist before production use.

### Inventory

- The environment count is nonzero.
- The Default environment appears in the Environment filter.
- Cloud flows are returned.
- Owner IDs are deduplicated and validated.
- Active, Disabled, Deleted, Missing, and Unknown statuses behave as expected.

### Filters and export

- Summary metric cards filter or organize the inventory.
- Environment, owner status, owner, environment type, region, modified date,
  and Default-only filters work.
- Active filter chips can be removed.
- **Clear all** resets the inventory.
- CSV export contains only the filtered rows.

### Recovery safety

- Only flows with a directory-confirmed deleted owner can be selected.
- No more than five flows can be selected in one batch.
- Recovery-user search returns active target-tenant users.
- The preview lists every selected flow and recovery co-owner.
- **Confirm and add co-owner** remains disabled until the confirmation box is
  selected.

Use a dedicated test flow for the first recovery test.

Important behavior:

- Recovery adds the selected user as a co-owner with edit access.
- The immutable deleted primary-owner permission can remain listed.
- Connections owned by the deleted user might still need repair.
- Solution-aware flows can have primary ownership changed separately through
  the flow details experience.

## 10. Share the app

Share Run access only with the approved admin security group or named
administrators.

Each operator might be prompted to create or approve their own nonshareable
connections for:

- Power Platform for Admins
- Office 365 Users
- Power Automate Management

The HTTP with Microsoft Entra ID connection can be shared through its solution
connection reference, subject to organizational security policy.

Sharing the app doesn't grant Power Platform Administrator or Dynamics 365
Administrator permissions. The operator must already hold the required role.

## 11. Security and operating guidance

- Treat tenant flow names, owner IDs, and environment inventory as
  administrative data.
- Limit app access to authorized governance personnel.
- Review DLP policy before enabling the HTTP connector.
- Use a dedicated admin or service account for shared connections where policy
  permits.
- Review recovery results after each batch.
- Repair or replace departed-user connections separately.
- Do not interpret an Unknown directory result as proof that a user was
  deleted.
- Keep batch size at five unless the connector throttling and organizational
  change-control policy are deliberately reassessed.

## 12. Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Imported app has no usable connections | Solution was exported without connection references | Complete section 3 in the source, republish, and export again |
| `No connection references found` | References weren't created as solution components | Create all four references in the source solution |
| App opens but scan returns 401/403 | Wrong connection, expired connection, or missing admin role | Repair the connection and verify the operator's role |
| HTTP connector returns authorization errors | Wrong resource URI/base URL, DLP block, or missing Premium entitlement | For GCC, set both fields to `https://api.gov.powerplatform.microsoft.us`; review DLP and licensing |
| `AADSTS7000301` from Power Platform for Admins V2 | Cross-cloud certificate issue in the V2 connector path | This app must use the preauthorized HTTP connector; don't bind it to Power Platform for Admins V2 |
| Directory owners show Unknown | Office 365 Users lookup failed or was throttled | Repair the Office 365 Users connection and scan again |
| Inventory is empty or stale | Role doesn't include tenant inventory access, wrong API endpoint, or inventory propagation delay | Verify role/endpoint and wait at least 15 minutes |
| `RemovalOfPermissionNotAllowed` | An older app build attempted to remove the immutable primary owner | Upgrade the solution; the current build adds a co-owner only |
| Recovery succeeds but deleted owner remains listed | Expected platform behavior for the immutable primary owner | Verify the recovery co-owner was added; change solution-aware primary ownership separately if required |
| App reports an old version | Power Apps player/CDN propagation | Close and reopen the app, or select the player Refresh banner |
| Nonadmin users can launch but can't scan | Sharing grants app access, not admin roles | Remove broad sharing and use an approved admin group |

## 13. Updating an existing target deployment

For managed deployments:

1. Increment the source solution version.
2. Publish the updated Code App to the source solution.
3. Export a new managed solution.
4. Import it into the target as an **Update** unless the release specifically
   requires Upgrade behavior.
5. Keep the existing target connection mappings.
6. Run the acceptance test again.

For unmanaged deployments, coordinate changes carefully. Unmanaged
customizations can create active layers and make future upgrades harder.

Never delete target connections during a routine solution update. Connection
records are environment resources and can be used by other apps or flows.

## 14. Rollback considerations

- Keep the previous managed solution package according to change-control
  policy.
- Export a target backup before a major update when required.
- Uninstalling the solution removes solution components but doesn't undo
  co-owner permissions already added to flows.
- To reverse a recovery co-owner, use the supported Power Automate sharing or
  admin-permissions experience and verify the flow retains at least one valid
  owner.

## 15. Deployment checklist

### Source publisher

- [ ] Four solution connection references exist
- [ ] Code App data sources use the references
- [ ] Lint and build pass
- [ ] Code App is republished into the source solution
- [ ] Source scan succeeds
- [ ] Solution version is incremented
- [ ] Managed/unmanaged package choice is documented
- [ ] Solution ZIP is exported

### Target administrator

- [ ] Target environment has Dataverse and Code Apps enabled
- [ ] Operator has the required administrator role
- [ ] Licensing and DLP prerequisites are satisfied
- [ ] Four target connections are Connected
- [ ] Solution import succeeds
- [ ] Four references map to target connections
- [ ] App first-run consent is completed
- [ ] Inventory scan succeeds
- [ ] Filters and CSV export are validated
- [ ] Recovery preview is validated with a test flow
- [ ] Run access is limited to approved administrators

## Related project documentation

For feature and development details, see [README.md](./README.md).

## Microsoft reference documentation

- [Application Lifecycle Management for Code Apps](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/alm)
- [Connect a Code App to data and use connection references](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/connect-to-data)
- [Solutions overview](https://learn.microsoft.com/power-apps/maker/data-platform/solutions-overview)
- [Import solutions](https://learn.microsoft.com/power-apps/maker/data-platform/import-update-export-solutions)
- [Power Platform Inventory](https://learn.microsoft.com/power-platform/admin/power-platform-inventory)
- [Manage orphaned flows when the owner leaves](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-management/manage-orphan-flow-when-owner-leaves-org)
- [Power Apps US Government service URLs](https://learn.microsoft.com/power-platform/admin/powerapps-us-government#power-apps-us-government-service-urls)
