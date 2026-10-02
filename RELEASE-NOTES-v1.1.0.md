# Orphaned Flow Finder v1.1.0

This release expands tenant inventory coverage and adds guarded recovery
options while preserving explicit administrator confirmation before any flow
permission change.

## Highlights

- Choose the scan scope before scanning: all environments, only the Default
  environment, or one selected Power Platform environment.
- Apply selected-environment scope directly to the Power Platform inventory
  query so unrelated flows and owners aren't processed.
- Merge environment discovery from Power Platform for Admins and Power
  Platform Inventory.
- Show authoritative **Dataverse**, **No Dataverse**, or **Database unknown**
  badges from environment metadata instead of inferring database state from
  flow metadata.
- Validate flow owners through Microsoft Entra ID and distinguish active,
  disabled, deleted, missing, and unknown records.
- Assign an active Microsoft Entra user as co-owner to up to five confirmed
  flows per batch.
- Guide owners and co-owners through Power Automate's supported **Send a copy**
  workflow for non-solution flows.
- Export scoped results to CSV with environment database and co-owner details.

## Installation

- Use `OrphanedFlowFinder_1_1_0_0_managed.zip` for production, UAT, and most
  tenant installations.
- Use `OrphanedFlowFinder_1_1_0_0_unmanaged.zip` only when the target
  organization will own future customizations.
- Create and map all four target-tenant connections during import.
- Review the deployment guide before installing.

The packaged app is configured for GCC. Other sovereign or commercial clouds
require endpoint and availability validation before deployment.
