# Orphaned Flow Finder v1.1.1

This release expands the scanned flow inventory with existing co-owner and run
history details while preserving explicit administrator confirmation before
any flow permission change.

## Highlights

- Add an **Additional co-owners** column populated from current `Owner` and
  `CanEdit` permissions, excluding the primary owner reported by inventory.
- Add a sortable **Last flow run** column based on the latest valid run start
  time returned by the GCC Power Platform flow-runs API.
- Distinguish **No runs found**, **Not available**, and **Lookup failed** so
  missing or failed run data isn't presented as a valid date.
- Include scanned co-owners in free-text search and the specific-owner filter.
- Include additional co-owners and last flow run values in CSV exports.
- Keep newly assigned co-owners visible in the scanned co-owner list without
  requiring another scan.
- Enrich flows in bounded batches of five and aggregate lookup failures under
  **Scan notes and exceptions** instead of silently returning incomplete data.
- Update deployment and operating guidance for the new read-only enrichment
  calls.

## Run-history availability

The Power Platform flow-runs API requires a confirmed Dataverse database and a
flow `workflowEntityId`. Rows that don't meet those requirements display
**Not available**. This doesn't prevent co-owner review or remediation.

## Installation

- Use `OrphanedFlowFinder_1_1_1_0_managed.zip` for production, UAT, and most
  tenant installations.
- Use `OrphanedFlowFinder_1_1_1_0_unmanaged.zip` only when the target
  organization will own future customizations.
- Create and map all four target-tenant connections during import.
- Review the deployment guide before installing.

The packaged app is configured for GCC. Other sovereign or commercial clouds
require endpoint and availability validation before deployment.
