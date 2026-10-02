import { PowerAutomateManagementService } from "../generated/services/PowerAutomateManagementService";
import type { ModifyFlowPermissionPayload } from "../generated/models/PowerAutomateManagementModel";
import type { DirectoryUser } from "./directoryUsers";
import type { TenantFlow } from "./tenantFlowInventory";

export const MAX_COOWNER_ASSIGNMENT_BATCH = 5;

const THROTTLE_RETRY_DELAY_MS = 60_000;

export interface FlowCoOwnerAssignmentResult {
  flowKey: string;
  flowName: string;
  environmentName: string;
  success: boolean;
  error?: string;
}

type ProgressHandler = (completed: number, total: number) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    isRecord(error) &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "The flow management connector returned an unknown error.";
}

function getHttpStatus(error: unknown): number | undefined {
  if (
    isRecord(error) &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

function isThrottled(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    getHttpStatus(error) === 429 ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("throttl")
  );
}

async function waitForThrottleWindow(): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, THROTTLE_RETRY_DELAY_MS);
  });
}

export function getFlowKey(flow: TenantFlow): string {
  return `${flow.environmentId.toLowerCase()}:${flow.id.toLowerCase()}`;
}

function createOwnerPayload(
  replacementOwnerId: string,
): ModifyFlowPermissionPayload {
  return {
    put: [
      {
        properties: {
          principal: {
            id: replacementOwnerId,
            type: "User",
          },
        },
      },
    ],
  };
}

async function assignSingleFlowCoOwner(
  flow: TenantFlow,
  coOwner: DirectoryUser,
): Promise<FlowCoOwnerAssignmentResult> {
  const flowKey = getFlowKey(flow);

  if (flow.assignedCoOwner) {
    return {
      flowKey,
      flowName: flow.displayName,
      environmentName: flow.environmentName,
      success: false,
      error: "A co-owner was already assigned to this flow in this session.",
    };
  }

  const payload = createOwnerPayload(coOwner.id);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result =
        await PowerAutomateManagementService.AdminModifyFlowOwners(
          flow.environmentId,
          flow.id,
          payload,
        );

      if (result.success) {
        return {
          flowKey,
          flowName: flow.displayName,
          environmentName: flow.environmentName,
          success: true,
        };
      }

      if (attempt === 0 && isThrottled(result.error)) {
        await waitForThrottleWindow();
        continue;
      }

      return {
        flowKey,
        flowName: flow.displayName,
        environmentName: flow.environmentName,
        success: false,
        error: getErrorMessage(result.error),
      };
    } catch (error) {
      return {
        flowKey,
        flowName: flow.displayName,
        environmentName: flow.environmentName,
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  return {
    flowKey,
    flowName: flow.displayName,
    environmentName: flow.environmentName,
    success: false,
    error: "Adding the co-owner did not complete after retrying.",
  };
}

export async function assignFlowCoOwners(
  flows: TenantFlow[],
  coOwner: DirectoryUser,
  onProgress: ProgressHandler,
): Promise<FlowCoOwnerAssignmentResult[]> {
  if (flows.length === 0) {
    throw new Error("Select at least one flow.");
  }

  if (flows.length > MAX_COOWNER_ASSIGNMENT_BATCH) {
    throw new Error(
      `Select no more than ${MAX_COOWNER_ASSIGNMENT_BATCH} flows per confirmed batch.`,
    );
  }

  if (flows.some((flow) => Boolean(flow.assignedCoOwner))) {
    throw new Error(
      "One or more selected flows already received a co-owner in this session. Clear the selection and retry.",
    );
  }

  if (flows.some((flow) => !flow.environmentId || !flow.id)) {
    throw new Error(
      "One or more selected flows are missing the environment or flow ID required for co-owner assignment.",
    );
  }

  const results: FlowCoOwnerAssignmentResult[] = [];
  for (const flow of flows) {
    results.push(await assignSingleFlowCoOwner(flow, coOwner));
    onProgress(results.length, flows.length);
  }

  return results;
}
