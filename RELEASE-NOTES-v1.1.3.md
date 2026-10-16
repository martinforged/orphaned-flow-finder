# Orphaned Flow Finder v1.1.3

This release replaces numbered pagination with a responsive continuous-scroll
inventory and adds safe background enrichment for co-owner and last-run
details.

## Highlights

- Display every filtered flow through one continuous scrollbar.
- Virtualize the inventory so only visible and overscan rows are mounted,
  keeping large environments responsive.
- Load co-owner and run-history details automatically as rows enter view.
- Add **Load all details** to queue every remaining filtered flow.
- Show processed and queued counts while details load.
- Add **Cancel load all** without interrupting the fast base inventory.
- Process five flows per batch and wait 3.5 seconds between batches to remain
  below the documented per-connection request limit.
- Stop queued calls after connector authorization failures instead of
  repeating known failures.
- Preserve loaded details while sorting, filtering, and scrolling.
- Split the virtualizer into its own production bundle chunk so the primary app
  bundle remains below the warning threshold.

## Scale guidance

Loading every detail for approximately 1,000 flows can still require 10–12
minutes because both admin connectors are limited to approximately 100 calls
per minute. Administrators can browse immediately while visible details load,
or start and cancel the complete queue as needed.

## Installation

- Use `OrphanedFlowFinder_1_1_3_0_managed.zip` for production, UAT, and most
  tenant installations.
- Use `OrphanedFlowFinder_1_1_3_0_unmanaged.zip` only when the target
  organization will own future customizations.
- Create and map all six target-tenant connections during import.

The packaged app is configured for GCC. Other sovereign or commercial clouds
require endpoint and availability validation before deployment.
