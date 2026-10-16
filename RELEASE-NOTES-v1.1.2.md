# Orphaned Flow Finder v1.1.2

This patch fixes the GCC co-owner and last-run lookup paths introduced in
v1.1.1 and restores fast tenant-wide scanning.

## Fixes

- Replace the non-admin owner call with **Power Automate for Admins - Get Flow
  Owner Role as Admin**.
- Resolve co-owner user object IDs through Office 365 Users so the inventory
  shows display names and user principal names instead of GUIDs.
- Replace the unsupported Power Platform for Admins V2 flow-run call, which
  returned `AADSTS7000301` in GCC, with the GCC Flow admin endpoint:
  `gov.api.flow.microsoft.us`.
- Authenticate last-run requests with the matching GCC Flow resource URI:
  `https://gov.service.flow.microsoft.us/`.
- Return the newest retained `properties.startTime`, or **No runs found** when
  the flow has no retained run history.
- Keep the base scan fast by moving per-flow co-owner and run-history calls to
  the explicit **Load page details** action.
- Limit extended details to the current page of up to 50 flows and stop
  repeating a connector call after an authorization failure.

## Connection changes

Version 1.1.2 contains six solution connection references:

1. Power Platform for Admins
2. Inventory API - HTTP with Microsoft Entra ID (preauthorized)
3. Flow Admin API - HTTP with Microsoft Entra ID (preauthorized)
4. Office 365 Users
5. Power Automate for Admins
6. Power Automate Management

The two HTTP connections require different GCC base/resource values. Review
the deployment guide before importing or updating.

## Installation

- Use `OrphanedFlowFinder_1_1_2_0_managed.zip` for production, UAT, and most
  tenant installations.
- Use `OrphanedFlowFinder_1_1_2_0_unmanaged.zip` only when the target
  organization will own future customizations.
- Create and map all six target-tenant connections during import.

The packaged app is configured for GCC. Other sovereign or commercial clouds
require endpoint and availability validation before deployment.
