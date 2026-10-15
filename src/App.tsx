import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import { CoOwnerAssignmentDialog } from "./components/CoOwnerAssignmentDialog";
import { SendCopyDialog } from "./components/SendCopyDialog";
import type {
  DirectoryUser,
  OwnerStatus,
} from "./services/directoryUsers";
import {
  getFlowKey,
  MAX_COOWNER_ASSIGNMENT_BATCH,
  type FlowCoOwnerAssignmentResult,
} from "./services/flowOwnership";
import {
  discoverTenantEnvironments,
  scanTenantFlows,
  type DataverseStatus,
  type FlowCoOwner,
  type ScanIssue,
  type ScanProgress,
  type TenantEnvironment,
  type TenantEnvironmentDiscoveryResult,
  type TenantFlow,
} from "./services/tenantFlowInventory";

const PAGE_SIZE = 50;

type ScanStatus = "idle" | "scanning" | "complete" | "error";
type EnvironmentOptionsStatus = "loading" | "ready" | "error";
type SortDirection = "ascending" | "descending";
type OwnerFilter = OwnerStatus | "all" | "reported" | "assigned";
type DataverseFilter = DataverseStatus | "all";
type MetricFilter =
  | "environments"
  | "flows"
  | "owners"
  | "orphaned"
  | "disabled";
type ModifiedFilter = "all" | "7" | "30" | "90" | "365" | "older365" | "missing";
type SortField =
  | "displayName"
  | "environmentName"
  | "ownerId"
  | "lastModifiedTime"
  | "lastRunTime";

interface OwnerOption {
  id?: string;
  displayName: string;
  userPrincipalName?: string;
  mail?: string;
}

interface SortState {
  field: SortField;
  direction: SortDirection;
}

const MODIFIED_FILTER_LABELS: Record<ModifiedFilter, string> = {
  all: "Any modified date",
  "7": "Modified in 7 days",
  "30": "Modified in 30 days",
  "90": "Modified in 90 days",
  "365": "Modified in 1 year",
  older365: "Not modified in 1+ year",
  missing: "Modified date unavailable",
};
const MODIFIED_FILTER_OPTIONS: ModifiedFilter[] = [
  "all",
  "7",
  "30",
  "90",
  "365",
  "older365",
  "missing",
];
const DATAVERSE_FILTER_LABELS: Record<DataverseFilter, string> = {
  all: "Any database status",
  enabled: "Dataverse database",
  "not-provisioned": "No Dataverse database",
  unknown: "Database status unknown",
};

function ownerStatusLabel(status: OwnerStatus): string {
  const labels: Record<OwnerStatus, string> = {
    active: "Active",
    disabled: "Disabled",
    orphaned: "Deleted user",
    unknown: "Unknown",
    missing: "Owner ID missing",
  };
  return labels[status];
}

function dataverseStatusLabel(status: DataverseStatus): string {
  const labels: Record<DataverseStatus, string> = {
    enabled: "Dataverse",
    "not-provisioned": "No Dataverse",
    unknown: "Database unknown",
  };
  return labels[status];
}

function isOwnerStatus(value: string): value is OwnerStatus {
  return (
    value === "active" ||
    value === "disabled" ||
    value === "orphaned" ||
    value === "unknown" ||
    value === "missing"
  );
}

function isOwnerFilter(value: string): value is OwnerFilter {
  return (
    value === "all" ||
    value === "reported" ||
    value === "assigned" ||
    isOwnerStatus(value)
  );
}

function isDataverseFilter(value: string): value is DataverseFilter {
  return value in DATAVERSE_FILTER_LABELS;
}

function matchesModifiedFilter(
  value: string | undefined,
  filter: ModifiedFilter,
  referenceTime: number,
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "missing") {
    return !value;
  }
  if (!value || referenceTime <= 0) {
    return false;
  }

  const modifiedTime = new Date(value).getTime();
  if (Number.isNaN(modifiedTime)) {
    return false;
  }

  const ageInDays = (referenceTime - modifiedTime) / (24 * 60 * 60 * 1_000);
  if (filter === "older365") {
    return ageInDays > 365;
  }

  return ageInDays <= Number(filter);
}

function isModifiedFilter(value: string): value is ModifiedFilter {
  return value in MODIFIED_FILTER_LABELS;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "The tenant scan failed with an unknown error.";
}

function formatDate(value?: string): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function flowCoOwnerIdentity(coOwner: FlowCoOwner): string {
  return (
    coOwner.userPrincipalName ??
    coOwner.mail ??
    coOwner.id ??
    coOwner.principalType ??
    "Identity unavailable"
  );
}

function flowCoOwnerCsvValue(coOwner: FlowCoOwner): string {
  const identity = flowCoOwnerIdentity(coOwner);
  return identity === coOwner.displayName
    ? coOwner.displayName
    : `${coOwner.displayName} <${identity}>`;
}

function additionalCoOwnersCsvValue(flow: TenantFlow): string {
  const coOwners = flow.additionalCoOwners
    .map(flowCoOwnerCsvValue)
    .join("; ");

  if (flow.coOwnerLookupStatus === "failed") {
    return coOwners
      ? `${coOwners}; Lookup failed - list may be incomplete`
      : "Lookup failed";
  }
  if (flow.coOwnerLookupStatus === "unavailable") {
    return coOwners || "Not available";
  }
  return coOwners || "None";
}

function lastRunDisplayValue(flow: TenantFlow): string {
  if (flow.lastRunStatus === "found") {
    return formatDate(flow.lastRunTime);
  }

  const labels = {
    "never-run": "No runs found",
    unavailable: "Not available",
    failed: "Lookup failed",
  } as const;
  return labels[flow.lastRunStatus];
}

function lastRunCsvValue(flow: TenantFlow): string {
  return flow.lastRunStatus === "found"
    ? (flow.lastRunTime ?? "")
    : lastRunDisplayValue(flow);
}

function csvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function sortFlows(
  flows: TenantFlow[],
  sort: SortState,
): TenantFlow[] {
  const direction = sort.direction === "ascending" ? 1 : -1;

  return [...flows].sort((left, right) => {
    if (
      sort.field === "lastModifiedTime" ||
      sort.field === "lastRunTime"
    ) {
      const leftValue = left[sort.field];
      const rightValue = right[sort.field];
      const leftTime = leftValue
        ? new Date(leftValue).getTime()
        : 0;
      const rightTime = rightValue
        ? new Date(rightValue).getTime()
        : 0;
      return (leftTime - rightTime) * direction;
    }

    return (
      compareText(left[sort.field] ?? "", right[sort.field] ?? "") *
      direction
    );
  });
}

function App() {
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [environmentOptionsStatus, setEnvironmentOptionsStatus] =
    useState<EnvironmentOptionsStatus>("loading");
  const [availableEnvironments, setAvailableEnvironments] = useState<
    TenantEnvironment[]
  >([]);
  const [environmentOptionsError, setEnvironmentOptionsError] = useState<
    string | null
  >(null);
  const [environmentOptionsIssueCount, setEnvironmentOptionsIssueCount] =
    useState(0);
  const [scanDefaultEnvironmentOnly, setScanDefaultEnvironmentOnly] =
    useState(false);
  const [scanEnvironmentId, setScanEnvironmentId] = useState("all");
  const [completedScanScope, setCompletedScanScope] = useState<string | null>(
    null,
  );
  const [environments, setEnvironments] = useState<TenantEnvironment[]>([]);
  const [flows, setFlows] = useState<TenantFlow[]>([]);
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [ownerIdFilter, setOwnerIdFilter] = useState("all");
  const [environmentTypeFilter, setEnvironmentTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [dataverseFilter, setDataverseFilter] =
    useState<DataverseFilter>("all");
  const [modifiedFilter, setModifiedFilter] =
    useState<ModifiedFilter>("all");
  const [defaultEnvironmentOnly, setDefaultEnvironmentOnly] = useState(false);
  const [selectedFlowKeys, setSelectedFlowKeys] = useState<Set<string>>(
    new Set(),
  );
  const [isCoOwnerAssignmentOpen, setIsCoOwnerAssignmentOpen] =
    useState(false);
  const [coOwnerAssignmentFlows, setCoOwnerAssignmentFlows] = useState<
    TenantFlow[]
  >([]);
  const [sendCopyFlow, setSendCopyFlow] = useState<TenantFlow | null>(null);
  const [sort, setSort] = useState<SortState>({
    field: "lastModifiedTime",
    direction: "descending",
  });
  const [page, setPage] = useState(1);
  const inventoryPanelRef = useRef<HTMLElement>(null);

  const defaultScanEnvironment = useMemo(
    () =>
      availableEnvironments.find((environment) => environment.isDefault),
    [availableEnvironments],
  );
  const selectedScanEnvironment = useMemo(
    () =>
      scanEnvironmentId === "all"
        ? undefined
        : availableEnvironments.find(
            (environment) =>
              environment.id.toLowerCase() ===
              scanEnvironmentId.toLowerCase(),
          ),
    [availableEnvironments, scanEnvironmentId],
  );
  const pendingScanEnvironment = scanDefaultEnvironmentOnly
    ? defaultScanEnvironment
    : selectedScanEnvironment;
  const pendingScanScopeLabel = scanDefaultEnvironmentOnly
    ? defaultScanEnvironment
      ? `Default environment: ${defaultScanEnvironment.displayName}`
      : "Default environment"
    : selectedScanEnvironment?.displayName ?? "All environments";
  const scanScopeReady =
    environmentOptionsStatus === "ready" &&
    (!scanDefaultEnvironmentOnly || Boolean(defaultScanEnvironment)) &&
    (scanEnvironmentId === "all" || Boolean(selectedScanEnvironment));

  const applyEnvironmentOptions = useCallback(
    (result: TenantEnvironmentDiscoveryResult) => {
      if (result.environments.length === 0) {
        throw new Error(
          "No active Power Platform environments are available to this administrator.",
        );
      }

      setAvailableEnvironments(result.environments);
      setEnvironmentOptionsIssueCount(result.issues.length);
      setEnvironmentOptionsError(null);
      setScanEnvironmentId((current) =>
        current === "all" ||
        result.environments.some(
          (environment) =>
            environment.id.toLowerCase() === current.toLowerCase(),
        )
          ? current
          : "all",
      );
      setEnvironmentOptionsStatus("ready");
    },
    [],
  );

  const applyEnvironmentOptionsError = useCallback((error: unknown) => {
    setAvailableEnvironments([]);
    setEnvironmentOptionsIssueCount(0);
    setEnvironmentOptionsError(errorMessage(error));
    setEnvironmentOptionsStatus("error");
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void discoverTenantEnvironments()
      .then((result) => {
        if (isCurrent) {
          applyEnvironmentOptions(result);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          applyEnvironmentOptionsError(error);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [applyEnvironmentOptions, applyEnvironmentOptionsError]);

  const refreshEnvironmentOptions = useCallback(async () => {
    setEnvironmentOptionsStatus("loading");
    setEnvironmentOptionsError(null);

    try {
      applyEnvironmentOptions(await discoverTenantEnvironments());
    } catch (error) {
      applyEnvironmentOptionsError(error);
    }
  }, [applyEnvironmentOptions, applyEnvironmentOptionsError]);

  const environmentTypes = useMemo(
    () =>
      Array.from(
        new Set(environments.map((environment) => environment.environmentType)),
      ).sort(compareText),
    [environments],
  );
  const locations = useMemo(
    () =>
      Array.from(
        new Set(environments.map((environment) => environment.location)),
      ).sort(compareText),
    [environments],
  );
  const ownerOptions = useMemo(() => {
    const optionsById = new Map<string, OwnerOption & { id: string }>();

    for (const flow of flows) {
      if (flow.owner.id) {
        optionsById.set(flow.owner.id.toLowerCase(), {
          id: flow.owner.id,
          displayName: flow.owner.displayName,
          userPrincipalName: flow.owner.userPrincipalName,
          mail: flow.owner.mail,
        });
      }
      for (const coOwner of flow.additionalCoOwners) {
        if (coOwner.id) {
          optionsById.set(coOwner.id.toLowerCase(), {
            id: coOwner.id,
            displayName: coOwner.displayName,
            userPrincipalName: coOwner.userPrincipalName,
            mail: coOwner.mail,
          });
        }
      }
      if (flow.assignedCoOwner) {
        optionsById.set(flow.assignedCoOwner.id.toLowerCase(), {
          id: flow.assignedCoOwner.id,
          displayName: flow.assignedCoOwner.displayName,
          userPrincipalName: flow.assignedCoOwner.userPrincipalName,
          mail: flow.assignedCoOwner.mail,
        });
      }
    }

    return Array.from(optionsById.values()).sort((left, right) =>
      compareText(left.displayName, right.displayName),
    );
  }, [flows]);
  const environmentFlowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flow of flows) {
      const environmentId = flow.environmentId.toLowerCase();
      counts.set(
        environmentId,
        (counts.get(environmentId) ?? 0) + 1,
      );
    }
    return counts;
  }, [flows]);
  const scanReferenceTime = scannedAt
    ? new Date(scannedAt).getTime()
    : 0;

  const filteredFlows = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const matchingFlows = flows.filter((flow) => {
      const matchesSearch =
        !normalizedSearch ||
        flow.displayName.toLowerCase().includes(normalizedSearch) ||
        flow.id.toLowerCase().includes(normalizedSearch) ||
        flow.environmentName.toLowerCase().includes(normalizedSearch) ||
        flow.ownerId?.toLowerCase().includes(normalizedSearch) ||
        flow.owner.displayName.toLowerCase().includes(normalizedSearch) ||
        flow.owner.userPrincipalName
          ?.toLowerCase()
          .includes(normalizedSearch) ||
        flow.additionalCoOwners.some(
          (coOwner) =>
            coOwner.id?.toLowerCase().includes(normalizedSearch) ||
            coOwner.displayName.toLowerCase().includes(normalizedSearch) ||
            coOwner.userPrincipalName
              ?.toLowerCase()
              .includes(normalizedSearch) ||
            coOwner.mail?.toLowerCase().includes(normalizedSearch),
        ) ||
        flow.assignedCoOwner?.displayName
          .toLowerCase()
          .includes(normalizedSearch) ||
        flow.assignedCoOwner?.userPrincipalName
          ?.toLowerCase()
          .includes(normalizedSearch);
      const matchesEnvironment =
        environmentFilter === "all" ||
        flow.environmentId.toLowerCase() ===
          environmentFilter.toLowerCase();
      const matchesOwner =
        ownerFilter === "all" ||
        (ownerFilter === "reported" && Boolean(flow.owner.id)) ||
        (ownerFilter === "assigned" && Boolean(flow.assignedCoOwner)) ||
        (ownerFilter === "orphaned" &&
          flow.owner.status === "orphaned" &&
          !flow.assignedCoOwner) ||
        (ownerFilter !== "orphaned" &&
          ownerFilter !== "assigned" &&
          ownerFilter !== "reported" &&
          flow.owner.status === ownerFilter);
      const matchesOwnerId =
        ownerIdFilter === "all" ||
        flow.owner.id?.toLowerCase() === ownerIdFilter ||
        flow.additionalCoOwners.some(
          (coOwner) => coOwner.id?.toLowerCase() === ownerIdFilter,
        ) ||
        flow.assignedCoOwner?.id.toLowerCase() === ownerIdFilter;
      const matchesEnvironmentType =
        environmentTypeFilter === "all" ||
        flow.environmentType === environmentTypeFilter;
      const matchesLocation =
        locationFilter === "all" || flow.location === locationFilter;
      const matchesDataverse =
        dataverseFilter === "all" ||
        flow.dataverseStatus === dataverseFilter;
      const matchesDefault =
        !defaultEnvironmentOnly || flow.isDefaultEnvironment;
      const matchesModified = matchesModifiedFilter(
        flow.lastModifiedTime,
        modifiedFilter,
        scanReferenceTime,
      );

      return (
        matchesSearch &&
        matchesEnvironment &&
        matchesOwner &&
        matchesOwnerId &&
        matchesEnvironmentType &&
        matchesLocation &&
        matchesDataverse &&
        matchesDefault &&
        matchesModified
      );
    });

    return sortFlows(matchingFlows, sort);
  }, [
    defaultEnvironmentOnly,
    dataverseFilter,
    environmentFilter,
    environmentTypeFilter,
    flows,
    locationFilter,
    modifiedFilter,
    ownerFilter,
    ownerIdFilter,
    scanReferenceTime,
    searchText,
    sort,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredFlows.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const visibleFlows = filteredFlows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const firstVisibleFlow =
    filteredFlows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastVisibleFlow = Math.min(
    currentPage * PAGE_SIZE,
    filteredFlows.length,
  );

  const distinctOwners = new Set(
    flows.flatMap((flow) => (flow.ownerId ? [flow.ownerId] : [])),
  ).size;
  const orphanedFlowCount = flows.filter(
    (flow) => flow.owner.status === "orphaned" && !flow.assignedCoOwner,
  ).length;
  const recoveredOrphanedFlowCount = flows.filter(
    (flow) => flow.owner.status === "orphaned" && flow.assignedCoOwner,
  ).length;
  const disabledOwnerFlowCount = flows.filter(
    (flow) => flow.owner.status === "disabled",
  ).length;
  const unresolvedOwnerFlowCount = flows.filter(
    (flow) =>
      flow.owner.status === "unknown" || flow.owner.status === "missing",
  ).length;
  const selectedFlows = flows.filter((flow) =>
    selectedFlowKeys.has(getFlowKey(flow)),
  );
  const selectionIncludesAssignedCoOwner = selectedFlows.some((flow) =>
    Boolean(flow.assignedCoOwner),
  );
  const selectedCopyFlow =
    selectedFlows.length === 1 ? selectedFlows[0] : undefined;
  const canSendCopy =
    Boolean(selectedCopyFlow) && !selectedCopyFlow?.isSolutionAware;
  const failedEnvironmentIds = new Set(
    issues
      .filter(
        (issue) => issue.severity === "error" && issue.environmentId,
      )
      .map((issue) => issue.environmentId),
  );
  const successfulEnvironmentCount = Math.max(
    0,
    environments.length - failedEnvironmentIds.size,
  );
  const dataverseEnvironmentCount = environments.filter(
    (environment) => environment.dataverseStatus === "enabled",
  ).length;
  const activeFilterCount = [
    Boolean(searchText.trim()),
    environmentFilter !== "all",
    ownerFilter !== "all",
    ownerIdFilter !== "all",
    environmentTypeFilter !== "all",
    locationFilter !== "all",
    dataverseFilter !== "all",
    modifiedFilter !== "all",
    defaultEnvironmentOnly,
  ].filter(Boolean).length;

  const progressPercent = (() => {
    if (scanStatus !== "scanning" || !progress) {
      return scanStatus === "complete" ? 100 : 0;
    }

    if (progress.phase === "loading-environments") {
      return 5;
    }

    const ratio =
      progress.totalItems > 0
        ? progress.processedItems / progress.totalItems
        : 0;
    if (progress.phase === "loading-flows") {
      return Math.min(55, 8 + Math.round(ratio * 47));
    }
    if (progress.phase === "validating-owners") {
      return Math.min(73, 55 + Math.round(ratio * 18));
    }
    return Math.min(98, 73 + Math.round(ratio * 25));
  })();

  async function startScan() {
    if (!scanScopeReady) {
      setScanError(
        "The scan scope isn't ready. Refresh the environment list and select a valid scope.",
      );
      return;
    }

    setScanStatus("scanning");
    setScanError(null);
    setIssues([]);
    clearAllFilters();
    setPage(1);
    setSelectedFlowKeys(new Set());
    setIsCoOwnerAssignmentOpen(false);
    setCoOwnerAssignmentFlows([]);
    setSendCopyFlow(null);

    try {
      const result = await scanTenantFlows(setProgress, {
        environmentId: pendingScanEnvironment?.id,
      });
      setEnvironments(result.environments);
      setFlows(result.flows);
      setIssues(result.issues);
      setScannedAt(result.scannedAt);
      setCompletedScanScope(pendingScanScopeLabel);
      setScanStatus("complete");
    } catch (error) {
      setScanError(errorMessage(error));
      setScanStatus("error");
    }
  }

  function clearAllFilters() {
    setSearchText("");
    setEnvironmentFilter("all");
    setOwnerFilter("all");
    setOwnerIdFilter("all");
    setEnvironmentTypeFilter("all");
    setLocationFilter("all");
    setDataverseFilter("all");
    setModifiedFilter("all");
    setDefaultEnvironmentOnly(false);
    setPage(1);
  }

  function applyMetricFilter(metric: MetricFilter) {
    clearAllFilters();

    if (metric === "environments") {
      setSort({ field: "environmentName", direction: "ascending" });
    } else if (metric === "flows") {
      setSort({ field: "lastModifiedTime", direction: "descending" });
    } else if (metric === "owners") {
      setOwnerFilter("reported");
      setSort({ field: "ownerId", direction: "ascending" });
    } else {
      setOwnerFilter(metric);
      setSort({ field: "lastModifiedTime", direction: "descending" });
    }

    globalThis.requestAnimationFrame(() => {
      inventoryPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function toggleFlowSelection(flow: TenantFlow) {
    const key = getFlowKey(flow);
    setSelectedFlowKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_COOWNER_ASSIGNMENT_BATCH) {
        next.add(key);
      }
      return next;
    });
  }

  function handleCoOwnerAssignmentApplied(
    results: FlowCoOwnerAssignmentResult[],
    coOwner: DirectoryUser,
  ) {
    const successfulKeys = new Set(
      results
        .filter((result) => result.success)
        .map((result) => result.flowKey),
    );

    setFlows((current) =>
      current.map((flow) =>
        successfulKeys.has(getFlowKey(flow))
          ? {
              ...flow,
              assignedCoOwner: coOwner,
              additionalCoOwners: flow.additionalCoOwners.some(
                (existingCoOwner) =>
                  existingCoOwner.id?.toLowerCase() ===
                  coOwner.id.toLowerCase(),
              )
                ? flow.additionalCoOwners
                : [
                    ...flow.additionalCoOwners,
                    {
                      id: coOwner.id,
                      displayName: coOwner.displayName,
                      userPrincipalName: coOwner.userPrincipalName,
                      mail: coOwner.mail,
                      principalType: "User" as const,
                      roleName: "CanEdit" as const,
                    },
                  ].sort((left, right) =>
                    compareText(left.displayName, right.displayName),
                  ),
            }
          : flow,
      ),
    );
    setSelectedFlowKeys((current) => {
      const next = new Set(current);
      for (const key of successfulKeys) {
        next.delete(key);
      }
      return next;
    });
  }

  function updateSort(field: SortField) {
    setSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "ascending"
          ? "descending"
          : "ascending",
    }));
  }

  function sortLabel(field: SortField): string {
    if (sort.field !== field) {
      return "";
    }
    return sort.direction === "ascending" ? "ASC" : "DESC";
  }

  function ariaSort(field: SortField): SortDirection | "none" {
    return sort.field === field ? sort.direction : "none";
  }

  function exportCsv() {
    const header = [
      "Flow name",
      "Flow ID",
      "Environment",
      "Environment ID",
      "Environment type",
      "Region",
      "Default environment",
      "Owner status",
      "Owner display name",
      "Owner user principal name",
      "Owner object ID",
      "Additional co-owners",
      "Co-owner assignment status",
      "Assigned co-owner display name",
      "Assigned co-owner user principal name",
      "Assigned co-owner object ID",
      "Dataverse database status",
      "Solution-aware flow",
      "Created by object ID",
      "Created",
      "Last modified",
      "Last flow run",
    ];
    const rows = filteredFlows.map((flow) => [
      flow.displayName,
      flow.id,
      flow.environmentName,
      flow.environmentId,
      flow.environmentType,
      flow.location,
      flow.isDefaultEnvironment ? "Yes" : "No",
      flow.owner.status,
      flow.owner.displayName,
      flow.owner.userPrincipalName ?? "",
      flow.ownerId ?? "",
      additionalCoOwnersCsvValue(flow),
      flow.assignedCoOwner ? "Co-owner added" : "",
      flow.assignedCoOwner?.displayName ?? "",
      flow.assignedCoOwner?.userPrincipalName ?? "",
      flow.assignedCoOwner?.id ?? "",
      flow.dataverseStatus,
      flow.isSolutionAware ? "Yes" : "No",
      flow.createdBy ?? "",
      flow.createdTime ?? "",
      flow.lastModifiedTime ?? "",
      lastRunCsvValue(flow),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvValue).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orphaned-flow-finder-inventory-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-content">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              OF
            </div>
            <div>
              <div className="eyebrow">POWER PLATFORM GOVERNANCE</div>
              <h1>Orphaned Flow Finder</h1>
            </div>
          </div>
          <div className="header-status">
            <span className="status-dot" aria-hidden="true" />
            <span>Admin inventory</span>
            <span className="header-divider" aria-hidden="true" />
            <span>Confirmed co-owner assignment</span>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-panel">
          <div>
            <p className="section-kicker">TENANT INVENTORY</p>
            <h2>Find every cloud flow. Start with a trusted baseline.</h2>
            <p className="hero-copy">
              Choose all environments, only the Default environment, or one
              Power Platform environment before scanning. Dataverse status
              comes from the environment record, owner IDs are validated
              against Microsoft Entra ID, and the completed inventory includes
              additional co-owners and the latest available flow run date.
              Co-owner access is granted only after an explicit preview and
              confirmation.
            </p>
          </div>
          <div className="hero-actions">
            <div className="scan-scope-panel">
              <div className="scan-scope-heading">
                <strong>Scan scope</strong>
                <span>{pendingScanScopeLabel}</span>
              </div>

              <label className="scan-default-option">
                <input
                  type="checkbox"
                  checked={scanDefaultEnvironmentOnly}
                  disabled={
                    environmentOptionsStatus !== "ready" ||
                    !defaultScanEnvironment ||
                    scanStatus === "scanning"
                  }
                  onChange={(event) =>
                    setScanDefaultEnvironmentOnly(event.target.checked)
                  }
                />
                <span>Scan only the Default environment</span>
              </label>

              <label className="scan-environment-option">
                <span>Power Platform environment</span>
                <select
                  value={scanEnvironmentId}
                  disabled={
                    environmentOptionsStatus !== "ready" ||
                    scanDefaultEnvironmentOnly ||
                    scanStatus === "scanning"
                  }
                  onChange={(event) =>
                    setScanEnvironmentId(event.target.value)
                  }
                >
                  <option value="all">
                    {environmentOptionsStatus === "loading"
                      ? "Loading environments..."
                      : "All environments"}
                  </option>
                  {availableEnvironments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.displayName}
                      {environment.isDefault ? " (Default)" : ""}
                      {` - ${environment.environmentType} - ${dataverseStatusLabel(environment.dataverseStatus)}`}
                    </option>
                  ))}
                </select>
              </label>

              {environmentOptionsStatus === "loading" ? (
                <p className="scan-scope-status" aria-live="polite">
                  Loading tenant environments before scanning...
                </p>
              ) : null}
              {environmentOptionsStatus === "ready" ? (
                <p className="scan-scope-status">
                  {availableEnvironments.length.toLocaleString()} active
                  environment
                  {availableEnvironments.length === 1 ? "" : "s"} available
                  {environmentOptionsIssueCount > 0
                    ? `; ${environmentOptionsIssueCount.toLocaleString()} discovery note${environmentOptionsIssueCount === 1 ? "" : "s"} will be rechecked during the scan`
                    : ""}
                  .
                </p>
              ) : null}
              {environmentOptionsStatus === "error" ? (
                <div className="scan-scope-error" role="alert">
                  <span>{environmentOptionsError}</span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void refreshEnvironmentOptions()}
                  >
                    Retry environment list
                  </button>
                </div>
              ) : null}
              {scanDefaultEnvironmentOnly &&
              environmentOptionsStatus === "ready" &&
              !defaultScanEnvironment ? (
                <p className="scan-scope-error" role="alert">
                  The tenant environment list didn't identify a Default
                  environment. Choose an environment from the list instead.
                </p>
              ) : null}
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={startScan}
              disabled={scanStatus === "scanning" || !scanScopeReady}
            >
              {scanStatus === "scanning"
                ? "Scanning..."
                : flows.length > 0
                  ? "Scan selected scope again"
                  : pendingScanEnvironment
                    ? "Scan selected environment"
                    : "Scan all environments"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={exportCsv}
              disabled={filteredFlows.length === 0}
            >
              Export CSV
            </button>
            <p className="last-scan">
              {scannedAt
                ? `Last completed ${formatDate(scannedAt)} · ${completedScanScope ?? "All environments"}`
                : "Choose a scope before starting the first scan."}
            </p>
          </div>
        </section>

        {scanStatus === "scanning" && progress ? (
          <section className="progress-panel" aria-live="polite">
            <div className="progress-heading">
              <div>
                <strong>{progress.message}</strong>
                <span>
                  {progress.phase === "loading-environments"
                    ? "Preparing tenant inventory"
                    : progress.phase === "loading-flows"
                      ? "Power Platform inventory API"
                      : progress.phase === "validating-owners"
                        ? "Microsoft Entra ID directory"
                        : "Flow permissions and run history"}
                </span>
              </div>
              <span>{progressPercent}%</span>
            </div>
            <progress value={progressPercent} max="100">
              {progressPercent}%
            </progress>
            {progress.totalItems > 0 ? (
              <div className="progress-meta">
                {progress.processedItems.toLocaleString()} of{" "}
                {progress.totalItems.toLocaleString()}{" "}
                {progress.phase === "validating-owners"
                  ? "unique owners validated"
                  : progress.phase === "enriching-flows"
                    ? "cloud flows enriched"
                    : "cloud flows loaded"}
              </div>
            ) : null}
          </section>
        ) : null}

        {scanError ? (
          <section className="error-panel" role="alert">
            <strong>The tenant scan could not start.</strong>
            <p>{scanError}</p>
            <p>
              Review the connector response above, then confirm that both
              admin connections are authenticated with a Power Platform or
              Dynamics 365 administrator account.
            </p>
          </section>
        ) : null}

        <section className="metric-grid" aria-label="Inventory summary">
          <button
            className="metric-card"
            type="button"
            aria-pressed={
              flows.length > 0 &&
              activeFilterCount === 0 &&
              sort.field === "environmentName" &&
              sort.direction === "ascending"
            }
            onClick={() => applyMetricFilter("environments")}
            title="Show all flows organized by environment"
          >
            <span className="metric-label">Environments covered</span>
            <strong>
              {scanStatus === "idle"
                ? "--"
                : successfulEnvironmentCount.toLocaleString()}
            </strong>
            <span className="metric-detail">
              {environments.length > 0
                ? `${environments.length.toLocaleString()} scanned; ${dataverseEnvironmentCount.toLocaleString()} with Dataverse`
                : "Default environment included"}
            </span>
            <span className="metric-action">View by environment</span>
          </button>
          <button
            className="metric-card"
            type="button"
            aria-pressed={
              flows.length > 0 &&
              activeFilterCount === 0 &&
              sort.field === "lastModifiedTime" &&
              sort.direction === "descending"
            }
            onClick={() => applyMetricFilter("flows")}
            title="Show all tenant cloud flows"
          >
            <span className="metric-label">Cloud flows</span>
            <strong>
              {scanStatus === "idle" ? "--" : flows.length.toLocaleString()}
            </strong>
            <span className="metric-detail">
              {completedScanScope ?? "No scope scanned"}
            </span>
            <span className="metric-action">Show all flows</span>
          </button>
          <button
            className="metric-card"
            type="button"
            aria-pressed={ownerFilter === "reported"}
            onClick={() => applyMetricFilter("owners")}
            title="Show flows with a reported owner ID"
          >
            <span className="metric-label">Unique owner IDs</span>
            <strong>
              {scanStatus === "idle" ? "--" : distinctOwners.toLocaleString()}
            </strong>
            <span className="metric-detail">Ready for directory validation</span>
            <span className="metric-action">Filter owner-backed flows</span>
          </button>
          <button
            className="metric-card metric-card-danger"
            type="button"
            aria-pressed={ownerFilter === "orphaned"}
            onClick={() => applyMetricFilter("orphaned")}
            title="Show only flows owned by deleted users"
          >
            <span className="metric-label">Orphaned flows</span>
            <strong>
              {scanStatus === "idle"
                ? "--"
                : orphanedFlowCount.toLocaleString()}
            </strong>
            <span className="metric-detail">
              {recoveredOrphanedFlowCount > 0
                ? `${recoveredOrphanedFlowCount.toLocaleString()} recovered this session`
                : "Owner no longer exists"}
            </span>
            <span className="metric-action">Filter orphaned flows</span>
          </button>
          <button
            className="metric-card metric-card-accent"
            type="button"
            aria-pressed={ownerFilter === "disabled"}
            onClick={() => applyMetricFilter("disabled")}
            title="Show only flows owned by disabled users"
          >
            <span className="metric-label">Disabled-owner flows</span>
            <strong>
              {scanStatus === "idle"
                ? "--"
                : disabledOwnerFlowCount.toLocaleString()}
            </strong>
            <span className="metric-detail">
              {unresolvedOwnerFlowCount > 0
                ? `${unresolvedOwnerFlowCount.toLocaleString()} unresolved`
                : "Directory record still exists"}
            </span>
            <span className="metric-action">Filter disabled-owner flows</span>
          </button>
        </section>

        <section className="inventory-panel" ref={inventoryPanelRef}>
          <div className="inventory-heading">
            <div>
              <p className="section-kicker">FLOW INVENTORY</p>
              <h2>Tenant cloud flows</h2>
              <p className="inventory-scope">
                Scan scope: {completedScanScope ?? "Not scanned"}
              </p>
            </div>
            <div className="result-count">
              {filteredFlows.length.toLocaleString()} of{" "}
              {flows.length.toLocaleString()} flows
            </div>
          </div>

          <div className="filter-bar">
            <label className="search-field">
              <span>Search flows</span>
              <input
                type="search"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setPage(1);
                }}
                placeholder="Flow, owner, co-owner, or environment"
              />
            </label>
            <label>
              <span>Environment</span>
              <select
                value={environmentFilter}
                onChange={(event) => {
                  setEnvironmentFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All environments</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.displayName}
                    {environment.isDefault ? " (Default)" : ""}
                    {environment.dataverseStatus === "enabled"
                      ? " - Dataverse"
                      : environment.dataverseStatus === "not-provisioned"
                        ? " - No Dataverse"
                        : ""}
                    {` (${(environmentFlowCounts.get(environment.id.toLowerCase()) ?? 0).toLocaleString()})`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Owner data</span>
              <select
                value={ownerFilter}
                onChange={(event) => {
                  if (isOwnerFilter(event.target.value)) {
                    setOwnerFilter(event.target.value);
                    setPage(1);
                  }
                }}
              >
                <option value="all">All owner records</option>
                <option value="reported">Owner ID reported</option>
                <option value="assigned">Co-owner added this session</option>
                <option value="orphaned">Deleted users</option>
                <option value="active">Active users</option>
                <option value="disabled">Disabled users</option>
                <option value="unknown">Lookup unknown</option>
                <option value="missing">Owner ID missing</option>
              </select>
            </label>
            <label>
              <span>Specific owner</span>
              <select
                value={ownerIdFilter}
                onChange={(event) => {
                  setOwnerIdFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All owners</option>
                {ownerOptions.map((owner) => (
                  <option
                    key={owner.id}
                    value={owner.id.toLowerCase()}
                  >
                    {owner.displayName}
                    {` - ${owner.userPrincipalName ?? owner.id}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Environment type</span>
              <select
                value={environmentTypeFilter}
                onChange={(event) => {
                  setEnvironmentTypeFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All environment types</option>
                {environmentTypes.map((environmentType) => (
                  <option key={environmentType} value={environmentType}>
                    {environmentType}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Region</span>
              <select
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All regions</option>
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Dataverse</span>
              <select
                value={dataverseFilter}
                onChange={(event) => {
                  if (isDataverseFilter(event.target.value)) {
                    setDataverseFilter(event.target.value);
                    setPage(1);
                  }
                }}
              >
                {(
                  Object.keys(
                    DATAVERSE_FILTER_LABELS,
                  ) as DataverseFilter[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {DATAVERSE_FILTER_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Last modified</span>
              <select
                value={modifiedFilter}
                onChange={(event) => {
                  if (isModifiedFilter(event.target.value)) {
                    setModifiedFilter(event.target.value);
                    setPage(1);
                  }
                }}
              >
                {MODIFIED_FILTER_OPTIONS.map(
                  (value) => (
                    <option key={value} value={value}>
                      {MODIFIED_FILTER_LABELS[value]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="checkbox-filter">
              <input
                type="checkbox"
                checked={defaultEnvironmentOnly}
                onChange={(event) => {
                  setDefaultEnvironmentOnly(event.target.checked);
                  setPage(1);
                }}
              />
              <span>Default environment only</span>
            </label>
          </div>

          {activeFilterCount > 0 ? (
            <div className="filter-summary">
              <strong>
                {activeFilterCount} active filter
                {activeFilterCount === 1 ? "" : "s"}
              </strong>
              <div>
                {searchText.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchText("");
                      setPage(1);
                    }}
                  >
                    Search: {searchText.trim()} <span>x</span>
                  </button>
                ) : null}
                {environmentFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEnvironmentFilter("all");
                      setPage(1);
                    }}
                  >
                    Environment:{" "}
                    {environments.find(
                      (environment) =>
                        environment.id === environmentFilter,
                    )?.displayName ?? environmentFilter}{" "}
                    <span>x</span>
                  </button>
                ) : null}
                {ownerFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOwnerFilter("all");
                      setPage(1);
                    }}
                  >
                    Owner status:{" "}
                    {ownerFilter === "reported"
                      ? "Owner ID reported"
                      : ownerFilter === "assigned"
                        ? "Co-owner added this session"
                        : ownerStatusLabel(ownerFilter)}{" "}
                    <span>x</span>
                  </button>
                ) : null}
                {ownerIdFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOwnerIdFilter("all");
                      setPage(1);
                    }}
                  >
                    Owner:{" "}
                    {ownerOptions.find(
                      (owner) =>
                        owner.id.toLowerCase() === ownerIdFilter,
                    )?.displayName ?? ownerIdFilter}{" "}
                    <span>x</span>
                  </button>
                ) : null}
                {environmentTypeFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEnvironmentTypeFilter("all");
                      setPage(1);
                    }}
                  >
                    Type: {environmentTypeFilter} <span>x</span>
                  </button>
                ) : null}
                {locationFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLocationFilter("all");
                      setPage(1);
                    }}
                  >
                    Region: {locationFilter} <span>x</span>
                  </button>
                ) : null}
                {dataverseFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDataverseFilter("all");
                      setPage(1);
                    }}
                  >
                    {DATAVERSE_FILTER_LABELS[dataverseFilter]} <span>x</span>
                  </button>
                ) : null}
                {modifiedFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setModifiedFilter("all");
                      setPage(1);
                    }}
                  >
                    {MODIFIED_FILTER_LABELS[modifiedFilter]} <span>x</span>
                  </button>
                ) : null}
                {defaultEnvironmentOnly ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultEnvironmentOnly(false);
                      setPage(1);
                    }}
                  >
                    Default environment <span>x</span>
                  </button>
                ) : null}
                <button
                  className="clear-filters"
                  type="button"
                  onClick={clearAllFilters}
                >
                  Clear all
                </button>
              </div>
            </div>
          ) : null}

          {selectedFlowKeys.size > 0 ? (
            <div className="selection-bar">
              <div>
                <strong>
                  {selectedFlowKeys.size} flow
                  {selectedFlowKeys.size === 1 ? "" : "s"} selected
                </strong>
                <span id="selection-guidance">
                  {selectedCopyFlow?.isSolutionAware
                    ? "Solution-aware flow selected: use Save As or solution export/import instead of Send a copy"
                    : "Select one non-solution flow to send a copy, or up to " +
                      `${MAX_COOWNER_ASSIGNMENT_BATCH} flows to assign co-owners`}
                </span>
              </div>
              <div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSelectedFlowKeys(new Set())}
                >
                  Clear selection
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canSendCopy}
                  aria-describedby="selection-guidance"
                  title={
                    selectedFlows.length !== 1
                      ? "Select exactly one flow to send a copy"
                      : selectedCopyFlow?.isSolutionAware
                        ? "Solution-aware flows use Save As or solution export instead of Send a copy"
                        : "Open the supported Send a copy workflow"
                  }
                  onClick={() => setSendCopyFlow(selectedCopyFlow ?? null)}
                >
                  Send a copy
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={selectionIncludesAssignedCoOwner}
                  aria-describedby="selection-guidance"
                  title={
                    selectionIncludesAssignedCoOwner
                      ? "One or more selected flows already received a co-owner in this session"
                      : "Assign an active Microsoft Entra user as co-owner"
                  }
                  onClick={() => {
                    setCoOwnerAssignmentFlows(selectedFlows);
                    setIsCoOwnerAssignmentOpen(true);
                  }}
                >
                  Assign new co-owner
                </button>
              </div>
            </div>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="selection-column">
                    <span className="visually-hidden">
                      Select flow for co-owner assignment
                    </span>
                  </th>
                  <th aria-sort={ariaSort("displayName")}>
                    <button
                      type="button"
                      onClick={() => updateSort("displayName")}
                    >
                      Flow
                      <span>{sortLabel("displayName")}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSort("environmentName")}>
                    <button
                      type="button"
                      onClick={() => updateSort("environmentName")}
                    >
                      Environment
                      <span>{sortLabel("environmentName")}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSort("ownerId")}>
                    <button
                      type="button"
                      onClick={() => updateSort("ownerId")}
                    >
                      Owner object ID
                      <span>{sortLabel("ownerId")}</span>
                    </button>
                  </th>
                  <th aria-sort={ariaSort("lastModifiedTime")}>
                    <button
                      type="button"
                      onClick={() => updateSort("lastModifiedTime")}
                    >
                      Last modified
                      <span>{sortLabel("lastModifiedTime")}</span>
                    </button>
                  </th>
                  <th>Additional co-owners</th>
                  <th aria-sort={ariaSort("lastRunTime")}>
                    <button
                      type="button"
                      onClick={() => updateSort("lastRunTime")}
                    >
                      Last flow run
                      <span>{sortLabel("lastRunTime")}</span>
                    </button>
                  </th>
                  <th>Flow ID</th>
                </tr>
              </thead>
              <tbody>
                {visibleFlows.map((flow) => (
                  <tr
                    className={
                      selectedFlowKeys.has(getFlowKey(flow))
                        ? "selected-row"
                        : undefined
                    }
                    key={`${flow.environmentId}:${flow.id}`}
                  >
                    <td className="selection-column">
                      <input
                        type="checkbox"
                        aria-label={`Select ${flow.displayName} for co-owner assignment`}
                        checked={selectedFlowKeys.has(getFlowKey(flow))}
                        onChange={() => toggleFlowSelection(flow)}
                        disabled={
                          !flow.environmentId ||
                          (!selectedFlowKeys.has(getFlowKey(flow)) &&
                            selectedFlowKeys.size >=
                              MAX_COOWNER_ASSIGNMENT_BATCH)
                        }
                      />
                    </td>
                    <td>
                      <div className="flow-name">{flow.displayName}</div>
                      <div className="flow-created">
                        Created {formatDate(flow.createdTime)}
                      </div>
                    </td>
                    <td>
                      <div className="environment-cell">
                        <span>{flow.environmentName}</span>
                        {flow.isDefaultEnvironment ? (
                          <span className="default-badge">Default</span>
                        ) : null}
                        <span
                          className={`database-badge database-${flow.dataverseStatus}`}
                        >
                          {dataverseStatusLabel(flow.dataverseStatus)}
                        </span>
                      </div>
                    </td>
                    <td>
                      {flow.assignedCoOwner ? (
                        <div className="owner-cell">
                          <div>
                            <strong>{flow.assignedCoOwner.displayName}</strong>
                            <small>
                              {flow.assignedCoOwner.userPrincipalName ??
                                flow.assignedCoOwner.mail ??
                                flow.assignedCoOwner.id}
                            </small>
                            <small>
                              Primary owner:{" "}
                              {flow.owner.userPrincipalName ??
                                flow.owner.id ??
                                "Not reported"}
                            </small>
                          </div>
                          <span className="owner-status owner-recovered">
                            Co-owner added
                          </span>
                        </div>
                      ) : (
                        <div className="owner-cell">
                          <div>
                            <strong>{flow.owner.displayName}</strong>
                            <small>
                              {flow.owner.userPrincipalName ??
                                flow.owner.id ??
                                "No directory identifier"}
                            </small>
                          </div>
                          <span
                            className={`owner-status owner-${flow.owner.status}`}
                          >
                            {ownerStatusLabel(flow.owner.status)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{formatDate(flow.lastModifiedTime)}</td>
                    <td>
                      {flow.additionalCoOwners.length > 0 ? (
                        <div className="co-owner-list">
                          {flow.additionalCoOwners.map((coOwner, index) => (
                            <div
                              key={
                                coOwner.id ??
                                `${flowCoOwnerIdentity(coOwner)}:${index}`
                              }
                              title={`${coOwner.displayName} - ${flowCoOwnerIdentity(coOwner)}`}
                            >
                              <strong>{coOwner.displayName}</strong>
                              <small>{flowCoOwnerIdentity(coOwner)}</small>
                            </div>
                          ))}
                          {flow.coOwnerLookupStatus === "failed" ? (
                            <span className="lookup-status lookup-failed">
                              List may be incomplete
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span
                          className={`lookup-status lookup-${flow.coOwnerLookupStatus}`}
                        >
                          {flow.coOwnerLookupStatus === "complete"
                            ? "None"
                            : flow.coOwnerLookupStatus === "failed"
                              ? "Lookup failed"
                              : "Not available"}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`lookup-status lookup-${flow.lastRunStatus}`}
                        title={
                          flow.lastRunStatus === "unavailable"
                            ? "Run history is unavailable when the environment has no confirmed Dataverse database or the flow has no workflow entity ID."
                            : undefined
                        }
                      >
                        {lastRunDisplayValue(flow)}
                      </span>
                    </td>
                    <td>
                      <code>{flow.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {visibleFlows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-mark" aria-hidden="true">
                  OF
                </div>
                <h3>
                  {scanStatus === "idle"
                    ? "Start with a tenant scan"
                    : scanStatus === "scanning"
                      ? "Inventory is being collected"
                      : scanStatus === "error"
                        ? "The scan did not complete"
                        : "No flows match these filters"}
                </h3>
                <p>
                  {scanStatus === "idle"
                    ? "The scan reads active environments and cloud flow identifiers without changing tenant resources."
                    : scanStatus === "scanning"
                      ? "Results appear when the environment scan completes."
                      : scanStatus === "error"
                        ? "Review the connector error above, correct it, and run the tenant scan again."
                        : "Clear or change the filters to view other cloud flows."}
                </p>
              </div>
            ) : null}
          </div>

          {filteredFlows.length > 0 ? (
            <div className="pagination">
              <span>
                Showing {firstVisibleFlow.toLocaleString()}-
                {lastVisibleFlow.toLocaleString()} of{" "}
                {filteredFlows.length.toLocaleString()}
              </span>
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setPage((current) => Math.max(1, current - 1))
                  }
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage.toLocaleString()} of{" "}
                  {totalPages.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((current) =>
                      Math.min(totalPages, current + 1),
                    )
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {issues.length > 0 ? (
          <details className="issues-panel">
            <summary>
              Scan notes and exceptions
              <span>{issues.length.toLocaleString()}</span>
            </summary>
            <div className="issue-list">
              {issues.map((issue, index) => (
                <article
                  className={`issue issue-${issue.severity}`}
                  key={`${issue.environmentId ?? "tenant"}-${index}`}
                >
                  <div>
                    <strong>{issue.environmentName}</strong>
                    <span>{issue.severity}</span>
                  </div>
                  <p>{issue.message}</p>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </main>

      {isCoOwnerAssignmentOpen && coOwnerAssignmentFlows.length > 0 ? (
        <CoOwnerAssignmentDialog
          flows={coOwnerAssignmentFlows}
          onClose={() => {
            setIsCoOwnerAssignmentOpen(false);
            setCoOwnerAssignmentFlows([]);
          }}
          onApplied={handleCoOwnerAssignmentApplied}
        />
      ) : null}

      {sendCopyFlow ? (
        <SendCopyDialog
          flow={sendCopyFlow}
          onClose={() => setSendCopyFlow(null)}
        />
      ) : null}

      <footer>
        <span>Orphaned Flow Finder</span>
        <span>
          Phase 2: tenant-wide validation and confirmed co-owner assignment
        </span>
      </footer>
    </div>
  );
}

export default App;
