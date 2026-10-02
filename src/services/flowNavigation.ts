import type { TenantFlow } from "./tenantFlowInventory";

const GCC_POWER_AUTOMATE_MAKER_URL =
  "https://make.gov.powerautomate.us";

export function getFlowDetailsUrl(flow: TenantFlow): string {
  const environmentId = flow.environmentId.trim();
  const flowId = flow.id.trim();

  if (!environmentId || !flowId) {
    throw new Error(
      "The environment ID and flow ID are required to open Power Automate.",
    );
  }

  return `${GCC_POWER_AUTOMATE_MAKER_URL}/environments/${encodeURIComponent(environmentId)}/flows/${encodeURIComponent(flowId)}/details`;
}
