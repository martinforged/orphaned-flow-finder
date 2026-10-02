import { PowerPlatformforAdminsService } from "../generated/services/PowerPlatformforAdminsService";
import type { Environment } from "../generated/models/PowerPlatformforAdminsModel";
import type { HttpRequest } from "../generated/models/HTTPwithMicrosoftEntraID_preauthorized_Model";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import { getClient } from "@microsoft/power-apps/data";
import {
  validateOwnerIds,
  type DirectoryUser,
  type OwnerValidation,
} from "./directoryUsers";

const ENVIRONMENT_PAGE_SIZE = 100;
const MAX_ENVIRONMENT_PAGES = 100;
const FLOW_PAGE_SIZE = 1_000;
const MAX_FLOW_PAGES = 1_000;
const POWER_PLATFORM_API_VERSION = "2026-06-01";
const INVENTORY_API_VERSION = "2024-10-01";
const ENVIRONMENT_RESOURCE_TYPE = "microsoft.powerplatform/environments";
const CLOUD_FLOW_RESOURCE_TYPE = "microsoft.powerautomate/cloudflows";
const INVENTORY_DATA_SOURCE = "webcontents";
const INVENTORY_ENDPOINT = `/resourcequery/resources/query?api-version=${INVENTORY_API_VERSION}`;
const DATAVERSE_METADATA_EXPAND = "properties/linkedEnvironmentMetadata";
const ENVIRONMENT_ID_PATTERN =
  /^(?:Default-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const httpClient = getClient(dataSourcesInfo);

export type DataverseStatus = "enabled" | "not-provisioned" | "unknown";

export interface TenantEnvironment {
  id: string;
  displayName: string;
  environmentType: string;
  location: string;
  isDefault: boolean;
  provisioningState: string;
  dataverseStatus: DataverseStatus;
}

export interface TenantFlow {
  id: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
  environmentType: string;
  isDefaultEnvironment: boolean;
  location: string;
  dataverseStatus: DataverseStatus;
  workflowEntityId?: string;
  isSolutionAware: boolean;
  ownerId?: string;
  owner: OwnerValidation;
  assignedCoOwner?: DirectoryUser;
  createdBy?: string;
  createdTime?: string;
  lastModifiedTime?: string;
}

export interface ScanIssue {
  severity: "warning" | "error";
  environmentId?: string;
  environmentName: string;
  message: string;
}

export type ScanPhase =
  | "loading-environments"
  | "loading-flows"
  | "validating-owners";

export interface ScanProgress {
  phase: ScanPhase;
  processedItems: number;
  totalItems: number;
  message: string;
}

export interface TenantFlowScanResult {
  environments: TenantEnvironment[];
  flows: TenantFlow[];
  issues: ScanIssue[];
  scannedAt: string;
}

export interface TenantEnvironmentDiscoveryResult {
  environments: TenantEnvironment[];
  issues: ScanIssue[];
}

export interface TenantFlowScanScope {
  environmentId?: string;
}

type ProgressHandler = (progress: ScanProgress) => void;

interface PowerPlatformInventoryResult {
  resources: InventoryResource[];
  reportedTotal: number;
  isPossiblyIncomplete: boolean;
}

type InventoryResource = Record<string, unknown>;

interface InventoryResponse {
  totalRecords: number;
  skipToken?: string;
  data: InventoryResource[];
}

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

  return "The connector returned an unknown error.";
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

function createOperationError(operation: string, error: unknown): Error {
  const status = getHttpStatus(error);
  const statusText = status ? ` (HTTP ${status})` : "";
  return new Error(`${operation} failed${statusText}: ${getErrorMessage(error)}`);
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned a response that isn't valid JSON.`);
  }
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseInventoryResponse(rawResponse: unknown): InventoryResponse {
  let payload = rawResponse;

  if (typeof payload === "string") {
    payload = parseJson(payload, "The Power Platform inventory API");
  }

  if (isRecord(payload) && "body" in payload) {
    payload = payload.body;
    if (typeof payload === "string") {
      payload = parseJson(payload, "The Power Platform inventory API");
    }
  }

  if (!isRecord(payload)) {
    throw new Error(
      "The Power Platform inventory API returned an unexpected response shape.",
    );
  }

  const rawData = payload.data;
  if (!Array.isArray(rawData) || rawData.some((item) => !isRecord(item))) {
    throw new Error(
      "The Power Platform inventory API response doesn't contain a valid data array.",
    );
  }

  return {
    totalRecords:
      readNumber(payload, "totalRecords") ??
      readNumber(payload, "count") ??
      rawData.length,
    skipToken: readString(payload, "skipToken"),
    data: rawData,
  };
}

function extractSkipToken(nextLink: string): string | undefined {
  try {
    const url = new URL(nextLink, "https://powerplatform.invalid");
    return (
      url.searchParams.get("$skiptoken") ??
      url.searchParams.get("skiptoken") ??
      url.searchParams.get("continuationToken") ??
      undefined
    );
  } catch {
    return undefined;
  }
}

function getAdminDataverseStatus(
  properties: Environment["properties"],
): DataverseStatus {
  const metadata = properties?.linkedEnvironmentMetadata;
  const hasDataverseMetadata = Boolean(
    metadata?.resourceId?.trim() ||
      metadata?.uniqueName?.trim() ||
      metadata?.instanceUrl?.trim() ||
      metadata?.instanceApiUrl?.trim(),
  );

  return hasDataverseMetadata ? "enabled" : "not-provisioned";
}

function normalizeAdminEnvironment(
  environment: Environment,
): TenantEnvironment | undefined {
  const id =
    environment.name ??
    environment.id?.split("/").filter(Boolean).at(-1);

  if (!id) {
    return undefined;
  }

  const properties = environment.properties;
  return {
    id,
    displayName: properties?.displayName?.trim() || id,
    environmentType:
      properties?.environmentType?.trim() ||
      properties?.environmentSku?.trim() ||
      "Unknown",
    location: environment.location?.trim() || "Unknown",
    isDefault: properties?.isDefault === true,
    provisioningState: properties?.provisioningState?.trim() || "Unknown",
    dataverseStatus: getAdminDataverseStatus(properties),
  };
}

async function listAdminEnvironments(): Promise<TenantEnvironmentDiscoveryResult> {
  const environments: TenantEnvironment[] = [];
  const issues: ScanIssue[] = [];
  const seenSkipTokens = new Set<string>();
  let skipToken: string | undefined;

  for (let page = 0; page < MAX_ENVIRONMENT_PAGES; page += 1) {
    const result = await PowerPlatformforAdminsService.Get_AdminEnvironment(
      POWER_PLATFORM_API_VERSION,
      skipToken,
      ENVIRONMENT_PAGE_SIZE,
      DATAVERSE_METADATA_EXPAND,
    );

    if (!result.success) {
      throw createOperationError(
        "Listing tenant environments",
        result.error,
      );
    }

    for (const environment of result.data?.value ?? []) {
      const normalized = normalizeAdminEnvironment(environment);
      if (!normalized) {
        issues.push({
          severity: "warning",
          environmentName: "Unknown environment",
          message:
            "An environment response without an ID was skipped because it cannot be correlated with flow inventory.",
        });
        continue;
      }

      const isDeleted =
        normalized.provisioningState.toLowerCase() === "deleted" ||
        normalized.provisioningState.toLowerCase() === "deleting" ||
        Boolean(environment.properties?.softDeletedTime);

      if (isDeleted) {
        issues.push({
          severity: "warning",
          environmentId: normalized.id,
          environmentName: normalized.displayName,
          message:
            "The environment is deleted or being deleted, so it was excluded from the active environment filter.",
        });
        continue;
      }

      environments.push(normalized);
    }

    const nextLink = result.data?.nextLink;
    const nextSkipToken =
      result.skipToken ??
      (nextLink ? extractSkipToken(nextLink) : undefined);

    if (!nextLink && !result.skipToken) {
      return { environments, issues };
    }

    if (!nextSkipToken) {
      throw new Error(
        "The environment connector returned another page but no readable continuation token.",
      );
    }

    if (seenSkipTokens.has(nextSkipToken)) {
      throw new Error(
        "The environment connector returned a repeated continuation token.",
      );
    }

    seenSkipTokens.add(nextSkipToken);
    skipToken = nextSkipToken;
  }

  throw new Error(
    `Environment discovery exceeded ${MAX_ENVIRONMENT_PAGES} pages and was stopped to avoid an endless request loop.`,
  );
}

async function listTenantFlowResources(
  onProgress: ProgressHandler,
  environmentId?: string,
): Promise<PowerPlatformInventoryResult> {
  return queryInventoryResources(
    CLOUD_FLOW_RESOURCE_TYPE,
    MAX_FLOW_PAGES,
    "Querying tenant cloud flow inventory",
    (loaded, total, page) => {
      onProgress({
        phase: "loading-flows",
        processedItems: loaded,
        totalItems: total,
        message: `Loading tenant cloud flow inventory page ${page}.`,
      });
    },
    environmentId,
  );
}

async function queryInventoryResources(
  resourceType: string,
  maximumPages: number,
  operationName: string,
  onPage?: (loaded: number, total: number, page: number) => void,
  environmentId?: string,
): Promise<PowerPlatformInventoryResult> {
  const resources: InventoryResource[] = [];
  const seenSkipTokens = new Set<string>();
  let skipToken: string | undefined;
  let reportedTotal = 0;

  for (let page = 0; page < maximumPages; page += 1) {
    const clauses: Record<string, unknown>[] = [
      {
        $type: "where",
        FieldName: "type",
        Operator: "==",
        Values: [`'${resourceType}'`],
      },
    ];
    if (environmentId) {
      clauses.push({
        $type: "where",
        FieldName: "properties.environmentId",
        Operator: "=~",
        Values: [`'${environmentId}'`],
      });
    }

    const query = {
      TableName: "PowerPlatformResources",
      Clauses: clauses,
      Options: skipToken
        ? { Top: FLOW_PAGE_SIZE, SkipToken: skipToken }
        : { Top: FLOW_PAGE_SIZE },
    };
    const request: HttpRequest = {
      method: "POST",
      url: INVENTORY_ENDPOINT,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(query),
    };
    const result = await httpClient.executeAsync<
      { request: HttpRequest },
      unknown
    >(
      {
        connectorOperation: {
          tableName: INVENTORY_DATA_SOURCE,
          operationName: "InvokeHttp",
          parameters: { request },
        },
      },
    );

    if (!result.success) {
      throw createOperationError(operationName, result.error);
    }

    const response = parseInventoryResponse(result.data);
    const pageResources = response.data;
    resources.push(...pageResources);
    reportedTotal = Math.max(
      reportedTotal,
      response.totalRecords,
    );

    onPage?.(resources.length, reportedTotal, page + 1);

    const nextSkipToken = response.skipToken ?? result.skipToken;
    if (!nextSkipToken) {
      return {
        resources,
        reportedTotal,
        isPossiblyIncomplete: reportedTotal > resources.length,
      };
    }

    if (seenSkipTokens.has(nextSkipToken)) {
      throw new Error(
        "The Power Platform inventory API returned a repeated continuation token.",
      );
    }

    seenSkipTokens.add(nextSkipToken);
    skipToken = nextSkipToken;
  }

  throw new Error(
    `${operationName} exceeded ${maximumPages} pages and was stopped to avoid an endless request loop.`,
  );
}

function getResourceProperties(
  resource: InventoryResource,
): Record<string, unknown> | undefined {
  const rawProperties = resource.properties;
  if (isRecord(rawProperties)) {
    return rawProperties;
  }

  if (typeof rawProperties === "string") {
    try {
      const parsed: unknown = JSON.parse(rawProperties);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeInventoryEnvironment(
  resource: InventoryResource,
  issues: ScanIssue[],
): TenantEnvironment | undefined {
  const properties = getResourceProperties(resource);
  const id = readString(resource, "name");

  if (!id) {
    issues.push({
      severity: "warning",
      environmentName: "Power Platform inventory",
      message:
        "An environment inventory record without an ID was skipped because it cannot be correlated with cloud flows.",
    });
    return undefined;
  }

  if (!properties) {
    issues.push({
      severity: "warning",
      environmentId: id,
      environmentName: id,
      message:
        "The environment inventory record returned an unreadable properties object.",
    });
  }

  const environmentType =
    readString(properties, "environmentType") ?? "Unknown";

  return {
    id,
    displayName: readString(properties, "displayName") ?? id,
    environmentType,
    location: readString(resource, "location") ?? "Unknown",
    isDefault: environmentType.toLowerCase() === "default",
    provisioningState: "Unknown",
    dataverseStatus: "unknown",
  };
}

async function listInventoryEnvironments(): Promise<TenantEnvironmentDiscoveryResult> {
  const issues: ScanIssue[] = [];
  const inventory = await queryInventoryResources(
    ENVIRONMENT_RESOURCE_TYPE,
    MAX_ENVIRONMENT_PAGES,
    "Querying tenant environment inventory",
  );
  const environments = inventory.resources.flatMap((resource) => {
    const environment = normalizeInventoryEnvironment(resource, issues);
    return environment ? [environment] : [];
  });

  if (inventory.isPossiblyIncomplete) {
    issues.push({
      severity: "warning",
      environmentName: "Power Platform inventory",
      message: `The inventory API reported ${inventory.reportedTotal.toLocaleString()} environments but returned ${environments.length.toLocaleString()}. Environment coverage might be incomplete.`,
    });
  }

  return { environments, issues };
}

function mergeEnvironment(
  current: TenantEnvironment | undefined,
  incoming: TenantEnvironment,
): TenantEnvironment {
  if (!current) {
    return incoming;
  }

  return {
    id: current.id,
    displayName:
      incoming.displayName !== incoming.id
        ? incoming.displayName
        : current.displayName,
    environmentType:
      incoming.environmentType !== "Unknown"
        ? incoming.environmentType
        : current.environmentType,
    location:
      incoming.location !== "Unknown" ? incoming.location : current.location,
    isDefault: current.isDefault || incoming.isDefault,
    provisioningState:
      incoming.provisioningState !== "Unknown"
        ? incoming.provisioningState
        : current.provisioningState,
    dataverseStatus:
      incoming.dataverseStatus !== "unknown"
        ? incoming.dataverseStatus
        : current.dataverseStatus,
  };
}

function sortEnvironments(
  environments: TenantEnvironment[],
): TenantEnvironment[] {
  return [...environments].sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

function normalizeScanEnvironmentId(
  environmentId: string | undefined,
): string | undefined {
  const normalized = environmentId?.trim();
  if (!normalized) {
    return undefined;
  }
  if (!ENVIRONMENT_ID_PATTERN.test(normalized)) {
    throw new Error(
      "The selected environment ID isn't in a supported Power Platform environment format.",
    );
  }
  return normalized;
}

export async function discoverTenantEnvironments(): Promise<TenantEnvironmentDiscoveryResult> {
  const [inventoryResult, adminResult] = await Promise.allSettled([
    listInventoryEnvironments(),
    listAdminEnvironments(),
  ]);

  if (
    inventoryResult.status === "rejected" &&
    adminResult.status === "rejected"
  ) {
    throw new Error(
      `Environment discovery failed from both sources. Power Platform inventory: ${getErrorMessage(inventoryResult.reason)} Power Platform for Admins: ${getErrorMessage(adminResult.reason)}`,
    );
  }

  const issues: ScanIssue[] = [];
  const environmentsById = new Map<string, TenantEnvironment>();

  if (inventoryResult.status === "fulfilled") {
    issues.push(...inventoryResult.value.issues);
    for (const environment of inventoryResult.value.environments) {
      const key = environment.id.toLowerCase();
      environmentsById.set(
        key,
        mergeEnvironment(environmentsById.get(key), environment),
      );
    }
  } else {
    issues.push({
      severity: "warning",
      environmentName: "Power Platform inventory",
      message: `Environment inventory couldn't be queried. The scan continued with the admin connector: ${getErrorMessage(inventoryResult.reason)}`,
    });
  }

  if (adminResult.status === "fulfilled") {
    issues.push(...adminResult.value.issues);
    for (const environment of adminResult.value.environments) {
      const key = environment.id.toLowerCase();
      environmentsById.set(
        key,
        mergeEnvironment(environmentsById.get(key), environment),
      );
    }
  } else {
    issues.push({
      severity: "warning",
      environmentName: "Power Platform for Admins",
      message: `The admin environment list couldn't be queried. The scan continued with Power Platform inventory, so Dataverse database status can remain Unknown: ${getErrorMessage(adminResult.reason)}`,
    });
  }

  return {
    environments: sortEnvironments(Array.from(environmentsById.values())),
    issues,
  };
}

function mapFlowResource(
  resource: InventoryResource,
  environmentsById: ReadonlyMap<string, TenantEnvironment>,
  issues: ScanIssue[],
  unknownEnvironmentIds: Set<string>,
): TenantFlow | undefined {
  const properties = getResourceProperties(resource);
  const id = readString(resource, "name");

  if (!id) {
    issues.push({
      severity: "warning",
      environmentName: "Tenant inventory",
      message:
        "A cloud flow inventory record without a flow ID was skipped.",
    });
    return undefined;
  }

  if (!properties) {
    issues.push({
      severity: "warning",
      environmentName: "Tenant inventory",
      message: `Flow ${id} returned an unreadable properties object and was skipped.`,
    });
    return undefined;
  }

  const environmentId =
    readString(resource, "environmentId") ??
    readString(properties, "environmentId") ??
    "";

  if (!environmentId) {
    issues.push({
      severity: "warning",
      environmentName: "Tenant inventory",
      message: `Flow ${id} didn't report an environment ID. It remains visible but can't receive a co-owner until the inventory record is complete.`,
    });
  }

  const environment = environmentId
    ? environmentsById.get(environmentId.toLowerCase())
    : undefined;

  if (environmentId && !environment) {
    unknownEnvironmentIds.add(environmentId);
  }

  const workflowEntityId = readString(properties, "workflowEntityId");

  return {
    id,
    displayName: readString(properties, "displayName") ?? id,
    environmentId,
    environmentName:
      environment?.displayName ||
      (environmentId
        ? `Environment ${environmentId}`
        : "Unknown environment"),
    environmentType: environment?.environmentType ?? "Unknown",
    isDefaultEnvironment: environment?.isDefault === true,
    location:
      readString(resource, "location") ?? environment?.location ?? "Unknown",
    dataverseStatus: environment?.dataverseStatus ?? "unknown",
    workflowEntityId,
    isSolutionAware:
      environment?.dataverseStatus === "enabled" &&
      Boolean(workflowEntityId),
    ownerId: readString(properties, "ownerId"),
    owner: {
      id: readString(properties, "ownerId"),
      status: readString(properties, "ownerId") ? "unknown" : "missing",
      displayName: readString(properties, "ownerId")
        ? "Pending directory validation"
        : "Owner ID not reported",
    },
    createdBy: readString(properties, "createdBy"),
    createdTime: readString(properties, "createdAt"),
    lastModifiedTime: readString(properties, "lastModifiedAt"),
  };
}

export async function scanTenantFlows(
  onProgress: ProgressHandler,
  scope: TenantFlowScanScope = {},
): Promise<TenantFlowScanResult> {
  const requestedEnvironmentId = normalizeScanEnvironmentId(
    scope.environmentId,
  );

  onProgress({
    phase: "loading-environments",
    processedItems: 0,
    totalItems: 0,
    message:
      "Discovering every Power Platform environment available to this administrator.",
  });

  const environmentInventory = await discoverTenantEnvironments();
  const requestedEnvironment = requestedEnvironmentId
    ? environmentInventory.environments.find(
        (environment) =>
          environment.id.toLowerCase() ===
          requestedEnvironmentId.toLowerCase(),
      )
    : undefined;
  if (requestedEnvironmentId && !requestedEnvironment) {
    throw new Error(
      "The selected environment is no longer available to this administrator. Refresh the environment list and try again.",
    );
  }

  const environments = requestedEnvironment
    ? [requestedEnvironment]
    : [...environmentInventory.environments];
  const environmentsById = new Map(
    environments.map((environment) => [
      environment.id.toLowerCase(),
      environment,
    ]),
  );
  const issues = environmentInventory.issues.filter(
    (issue) =>
      !requestedEnvironmentId ||
      !issue.environmentId ||
      issue.environmentId.toLowerCase() ===
        requestedEnvironmentId.toLowerCase(),
  );

  onProgress({
    phase: "loading-flows",
    processedItems: 0,
    totalItems: 0,
    message: requestedEnvironment
      ? `Querying cloud flow inventory for ${requestedEnvironment.displayName}.`
      : "Querying the tenant-wide Power Platform inventory for cloud flows.",
  });

  const flowInventory = await listTenantFlowResources(
    onProgress,
    requestedEnvironmentId,
  );
  const unknownEnvironmentIds = new Set<string>();
  const unvalidatedFlows = flowInventory.resources.flatMap((resource) => {
    const flow = mapFlowResource(
      resource,
      environmentsById,
      issues,
      unknownEnvironmentIds,
    );
    return flow ? [flow] : [];
  });

  for (const environmentId of unknownEnvironmentIds) {
    const matchingFlow = unvalidatedFlows.find(
      (flow) =>
        flow.environmentId.toLowerCase() === environmentId.toLowerCase(),
    );
    const environment: TenantEnvironment = {
      id: environmentId,
      displayName: `Environment ${environmentId}`,
      environmentType: "Unknown",
      location: matchingFlow?.location ?? "Unknown",
      isDefault: false,
      provisioningState: "Unknown",
      dataverseStatus: "unknown",
    };
    environments.push(environment);
    environmentsById.set(environmentId.toLowerCase(), environment);
  }
  environments.sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });

  if (flowInventory.isPossiblyIncomplete) {
    issues.push({
      severity: "warning",
      environmentName: "Tenant inventory",
      message: `The inventory API reported ${flowInventory.reportedTotal.toLocaleString()} flows but returned ${unvalidatedFlows.length.toLocaleString()}. Review inventory completeness before remediation.`,
    });
  }

  if (unknownEnvironmentIds.size > 0) {
    issues.push({
      severity: "warning",
      environmentName: "Tenant inventory",
      message: `${unknownEnvironmentIds.size.toLocaleString()} environment ID(s) referenced by flow inventory weren't returned by either environment-discovery source. They were added with ID-based labels so their flows remain selectable.`,
    });
  }

  const ownerIds = unvalidatedFlows.flatMap((flow) =>
    flow.ownerId ? [flow.ownerId] : [],
  );
  const uniqueOwnerCount = new Set(
    ownerIds.map((ownerId) => ownerId.toLowerCase()),
  ).size;

  onProgress({
    phase: "validating-owners",
    processedItems: 0,
    totalItems: uniqueOwnerCount,
    message: "Validating unique flow owners against Microsoft Entra ID.",
  });

  const ownerValidations = await validateOwnerIds(
    ownerIds,
    (completed, total) => {
      onProgress({
        phase: "validating-owners",
        processedItems: completed,
        totalItems: total,
        message: "Validating unique flow owners against Microsoft Entra ID.",
      });
    },
  );
  const flows = unvalidatedFlows.map((flow) => ({
    ...flow,
    owner: flow.ownerId
      ? (ownerValidations.get(flow.ownerId.toLowerCase()) ?? flow.owner)
      : flow.owner,
  }));
  const unknownOwners = Array.from(ownerValidations.values()).filter(
    (owner) => owner.status === "unknown",
  );

  if (unknownOwners.length > 0) {
    issues.push({
      severity: "warning",
      environmentName: "Microsoft Entra ID",
      message: `${unknownOwners.length.toLocaleString()} owner lookup(s) couldn't be classified. These flows remain in Unknown status; review the owner and flow details before assigning a co-owner. ${unknownOwners[0]?.error ?? ""}`.trim(),
    });
  }

  onProgress({
    phase: "validating-owners",
    processedItems: uniqueOwnerCount,
    totalItems: uniqueOwnerCount,
    message: "Tenant flow and owner validation completed.",
  });

  return {
    environments,
    flows,
    issues,
    scannedAt: new Date().toISOString(),
  };
}
