# Power Platform solution packages

## Recommended installer

Use:

`OrphanedFlowFinder_1_0_0_0_managed.zip`

This is the recommended package for production, UAT, and normal tenant
installations. Import it through **Power Apps > Solutions > Import solution**.

## Developer package

Use:

`OrphanedFlowFinder_1_0_0_0_unmanaged.zip`

Only use the unmanaged package when the target organization intentionally
takes ownership of customizations and future development.

## Included components

Each package contains:

- Orphaned Flow Finder Code App
- Power Platform for Admins connection reference
- HTTP with Microsoft Entra ID (preauthorized) connection reference
- Office 365 Users connection reference
- Power Automate Management connection reference

Connections aren't transported between tenants. Create the four target
connections and map the imported connection references as described in
[the deployment guide](../DEPLOYMENT-GUIDE.md).

## Integrity

Verify downloaded packages against [SHA256SUMS.txt](./SHA256SUMS.txt) before
importing them.
