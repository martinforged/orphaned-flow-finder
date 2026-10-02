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

## Quick installation path

Use this path when installing the published package from the project
repository. Sections 3 and 4 are for maintainers who build a new release and
can be skipped by a target-tenant installer.

1. Download
   `solutions/OrphanedFlowFinder_1_1_0_0_managed.zip`.
2. Confirm the file hash against `solutions/SHA256SUMS.txt`.
3. Complete the target prerequisites in section 5.
4. Create the four target connections in section 6.
5. Import the managed ZIP and map the four connection references as described
   in section 7.
6. Complete first-run consent and the acceptance test in sections 8 and 9.
7. Share Run access only with approved administrators.

## 1. What the solution contains

The solution display name is **Oprhaned Flow Finder**. The Code App display
name is **Orphaned Flow Finder**.

The app:

1. Merges environments from Power Platform for Admins and Power Platform
   Inventory so Dataverse-backed and non-Dataverse environments are covered.
2. Loads active environments before scanning so the operator can scan all
   environments, only the Default environment, or one selected environment.
3. Applies a selected environment to the Power Platform Inventory query.
4. Validates unique owner object IDs against Microsoft Entra ID.
5. Classifies owner records as Active, Disabled, Deleted, Missing, or Unknown.
6. Identifies Dataverse database status and solution-aware flows when the
   platform returns that metadata.
7. Filters, sorts, pages, and exports the inventory.
8. Adds an active Microsoft Entra user as a co-owner to explicitly selected
   flows after preview and confirmation.
9. Opens a single selected non-solution flow in the GCC Power Automate maker
   portal so an existing owner or co-owner can use the supported **Send a
   copy** panel.

Tenant scanning and directory validation are read-only. The only write operation
adds a co-owner after the operator reviews the affected flows and
selects an explicit confirmation check box. The Send a copy handoff performs
no write in this app.

## 2. Connector architecture

The app requires four connectors.

| Connector | Connector ID | Purpose | Connection behavior |
| --- | --- | --- | --- |
| Power Platform for Admins | `shared_powerplatformforadmins` | Lists environments and expands Dataverse metadata | Per-user/nonshareable |
| HTTP with Microsoft Entra ID (preauthorized) | `shared_webcontents` | Queries GCC environment and cloud flow inventory | Shareable connection |
| Office 365 Users | `shared_office365users` | Validates owner IDs and searches active co-owners | Per-user/nonshareable |
| Power Automate Management | `shared_flowmanagement` | Adds a confirmed flow co-owner as admin | Per-user/nonshareable |

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

This section is for project maintainers. It has already been completed for the
published solution packages in `solutions/`.

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

The repository's official release artifacts are:

- `solutions/OrphanedFlowFinder_1_1_0_0_managed.zip`
- `solutions/OrphanedFlowFinder_1_1_0_0_unmanaged.zip`
- `solutions/SHA256SUMS.txt`

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
5. Upload `OrphanedFlowFinder_1_1_0_0_managed.zip` for the standard
   installation, or the unmanaged ZIP only when the target team will own
   future development.
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
4. Wait for the pre-scan environment list to load.
5. Choose one scan scope:
   - Leave **All environments** selected.
   - Check **Scan only the Default environment**.
   - Select one Power Platform environment from the list.
6. Select the applicable scan button.
7. Keep the player open until inventory and directory validation complete.

Power Platform Inventory can take up to 15 minutes to reflect recently created,
modified, or deleted resources.

## 9. Acceptance test

Complete this checklist before production use.

### Inventory

- The pre-scan selector lists the active environments available to the
  administrator.
- **Scan only the Default environment** overrides and disables the environment
  selector.
- An all-environments scan returns flows across the tenant.
- A selected-environment scan returns flows and owner validation only for that
  environment.
- The environment count is nonzero.
- The Default environment appears in the Environment filter.
- Known Dataverse environments show the **Dataverse** badge and non-Dataverse
  environments show **No Dataverse**.
- Flow-level metadata never changes the environment database badge.
- An environment returned by only one discovery source still appears.
- Cloud flows are returned.
- Owner IDs are deduplicated and validated.
- Active, Disabled, Deleted, Missing, and Unknown statuses behave as expected.

### Filters and export

- Summary metric cards filter or organize the inventory.
- Environment, owner status, owner, environment type, region, Dataverse,
  modified date, and Default-only filters work.
- Active filter chips can be removed.
- **Clear all** resets the inventory.
- CSV export contains only the filtered rows.

### Co-owner assignment safety

- Flows with active, disabled, deleted, missing, or unknown primary-owner
  status can be selected when the flow and environment IDs are available.
- No more than five flows can be selected in one batch.
- Co-owner search returns active target-tenant users.
- The preview lists every selected flow and proposed co-owner.
- **Confirm and grant co-owner access** remains disabled until the confirmation
  box is selected.

Use a dedicated test flow for the first co-owner assignment test.

Important behavior:

- Assignment adds the selected user as a co-owner with edit access.
- Existing owners remain; the immutable deleted primary-owner permission can
  remain listed.
- Existing connections aren't transferred and might still need repair.
- Solution-aware flows can have primary ownership changed separately through
  the flow details experience.

### Send a copy guidance

- Selecting exactly one non-solution flow enables **Send a copy**.
- Selecting zero or multiple flows disables **Send a copy**.
- Selecting a solution-aware flow disables **Send a copy**; use **Save As** or
  solution export/import for that flow.
- The confirmation dialog identifies the selected flow and explains that the
  recipient receives an independent copy without the original connections.
- The operator reviews the flow for personal information, secrets, and
  hard-coded environment values before sending it.
- **Open flow in Power Automate** opens the GCC maker URL for the correct
  environment and flow ID.
- An existing owner or co-owner can select **Send a copy** on the flow details
  command bar, choose recipients, and send the template.
- If the command isn't present, inventory or environment-admin access alone
  wasn't sufficient; use an existing owner/co-owner or explicitly grant the
  operator co-owner access first.

Power Automate doesn't expose its portal Send a copy operation through the
supported Power Automate Management connector. The app deliberately uses the
documented portal workflow instead of an undocumented API or an
administrator-owned clone.

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
- Review co-owner assignment results after each batch.
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
| Dataverse environment is missing | One environment-discovery source failed or inventory hasn't propagated | Review **Scan notes and exceptions**, verify both admin connections, wait 15 minutes, and scan again; flow-referenced environments are added with an ID-based fallback |
| A non-Dataverse environment shows Dataverse | An older build inferred environment state from flow-level `workflowEntityId` | Upgrade to the current build and scan again; only expanded linked-environment metadata now determines the badge |
| Database status shows Unknown | Expanded admin environment metadata wasn't available | Repair the Power Platform for Admins connection and scan again |
| Send a copy is disabled | Zero or multiple flows are selected, or the selected flow is solution-aware | Select exactly one non-solution flow; use Save As or solution export/import for a solution-aware flow |
| Flow opens but Send a copy isn't shown | The signed-in operator isn't an owner or co-owner of the flow | Have an existing owner/co-owner send the copy, or grant the operator co-owner access first |
| Recipient can't use the copied flow | The independent copy needs recipient-owned connections or contains environment-specific values | Have the recipient create/select their connections and review hard-coded IDs, URLs, email addresses, and other environment-specific configuration |
| `RemovalOfPermissionNotAllowed` | An older app build attempted to remove the immutable primary owner | Upgrade the solution; the current build adds a co-owner only |
| Co-owner assignment succeeds but deleted owner remains listed | Expected platform behavior for the immutable primary owner | Verify the co-owner was added; change solution-aware primary ownership separately if required |
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
- To remove an assigned co-owner, use the supported Power Automate sharing or
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
- [ ] Co-owner assignment preview is validated with a test flow
- [ ] Send a copy opens the selected test flow in the GCC maker portal
- [ ] Run access is limited to approved administrators

## Related project documentation

For feature and development details, see [README.md](./README.md).

## Microsoft reference documentation

- [Application Lifecycle Management for Code Apps](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/alm)
- [Connect a Code App to data and use connection references](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/connect-to-data)
- [Solutions overview](https://learn.microsoft.com/power-apps/maker/data-platform/solutions-overview)
- [Import solutions](https://learn.microsoft.com/power-apps/maker/data-platform/import-update-export-solutions)
- [Power Platform Inventory](https://learn.microsoft.com/power-platform/admin/power-platform-inventory)
- [Power Platform inventory schema](https://learn.microsoft.com/power-platform/admin/inventory-schema)
- [Power Platform inventory API](https://learn.microsoft.com/power-platform/admin/inventory-api)
- [Share a cloud flow](https://learn.microsoft.com/power-automate/create-team-flows)
- [Duplicate a solution-aware cloud flow using Save As](https://learn.microsoft.com/power-automate/edit-solution-aware-flow#duplicate-a-solution-aware-cloud-flow-using-save-as)
- [Power Automate US Government service URLs](https://learn.microsoft.com/power-automate/us-govt#power-automate-us-government-service-urls)
- [Manage orphaned flows when the owner leaves](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-management/manage-orphan-flow-when-owner-leaves-org)
- [Power Apps US Government service URLs](https://learn.microsoft.com/power-platform/admin/powerapps-us-government#power-apps-us-government-service-urls)
