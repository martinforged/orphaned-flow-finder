# Power Platform solution packages

## Recommended installer

Use:

`OrphanedFlowFinder_1_1_1_0_managed.zip`

This is the recommended package for production, UAT, and normal tenant
installations. Import it through **Power Apps > Solutions > Import solution**.

## Developer package

Use:

`OrphanedFlowFinder_1_1_1_0_unmanaged.zip`

Only use the unmanaged package when the target organization intentionally
takes ownership of customizations and future development.

## Included components

Each package contains:

- Orphaned Flow Finder Code App
- Power Platform for Admins connection reference
- HTTP with Microsoft Entra ID (preauthorized) connection reference
- Office 365 Users connection reference
- Power Automate Management connection reference

The current packages use solution version **1.1.1.0** and include the pre-scan
environment scope selector, authoritative Dataverse/No Dataverse badges,
scanned additional co-owners, latest available flow run dates, co-owner
assignment, and guided Send a copy workflow.

The `1.0.0.0` and `1.1.0.0` ZIPs are retained for historical comparison. New
installations and updates should use `1.1.1.0`.

Connections aren't transported between tenants. Create the four target
connections and map the imported connection references as described in
[the deployment guide](../DEPLOYMENT-GUIDE.md).

## Integrity

Verify downloaded packages against [SHA256SUMS.txt](./SHA256SUMS.txt) before
importing them. The checksum file covers both current and retained historical
packages.
