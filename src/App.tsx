import { useMemo, useRef, useState } from "react";
import "./App.css";
import { ReassignmentDialog } from "./components/ReassignmentDialog";
import type {
  DirectoryUser,
  OwnerStatus,
  OwnerValidation,
} from "./services/directoryUsers";
import {
  getFlowKey,
  MAX_REASSIGNMENT_BATCH,
  type FlowReassignmentResult,
} from "./services/flowOwnership";
import {
  scanTenantFlows,
  type ScanIssue,
  type ScanProgress,
  type TenantEnvironment,
  type TenantFlow,
} from "./services/tenantFlowInventory";

const PAGE_SIZE = 50;

type ScanStatus = "idle" | "scanning" | "complete" | "error";
type SortDirection = "ascending" | "descending";
type OwnerFilter = OwnerStatus | "all" | "reported" | "recovered";
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
  | "lastModifiedTime";

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
    value === "recovered" ||
    isOwnerStatus(value)
  );
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
    if (sort.field === "lastModifiedTime") {
      const leftTime = left.lastModifiedTime
        ? new Date(left.lastModifiedTime).getTime()
        : 0;
      const rightTime = right.lastModifiedTime
        ? new Date(right.lastModifiedTime).getTime()
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
  const [modifiedFilter, setModifiedFilter] =
    useState<ModifiedFilter>("all");
  const [defaultEnvironmentOnly, setDefaultEnvironmentOnly] = useState(false);
  const [selectedFlowKeys, setSelectedFlowKeys] = useState<Set<string>>(
    new Set(),
  );
  const [isReassignmentOpen, setIsReassignmentOpen] = useState(false);
  const [reassignmentFlows, setReassignmentFlows] = useState<TenantFlow[]>(
    [],
  );
  const [sort, setSort] = useState<SortState>({
    field: "lastModifiedTime",
    direction: "descending",
  });
  const [page, setPage] = useState(1);
  const inventoryPanelRef = useRef<HTMLElement>(null);

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
  const ownerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          flows.flatMap((flow) =>
            [
              ...(flow.owner.id
                ? [[flow.owner.id.toLowerCase(), flow.owner] as const]
                : []),
              ...(flow.recoveryOwner
                ? [
                    [
                      flow.recoveryOwner.id.toLowerCase(),
                      {
                        id: flow.recoveryOwner.id,
                        status: "active" as const,
                        displayName: flow.recoveryOwner.displayName,
                        userPrincipalName:
                          flow.recoveryOwner.userPrincipalName,
                        mail: flow.recoveryOwner.mail,
                      },
                    ] as const,
                  ]
                : []),
            ],
          ),
        ).values(),
      )
        .filter(
          (owner): owner is OwnerValidation & { id: string } =>
            Boolean(owner.id),
        )
        .sort((left, right) =>
          compareText(left.displayName, right.displayName),
        ),
    [flows],
  );
  const environmentFlowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flow of flows) {
      counts.set(
        flow.environmentId,
        (counts.get(flow.environmentId) ?? 0) + 1,
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
        flow.recoveryOwner?.displayName
          .toLowerCase()
          .includes(normalizedSearch) ||
        flow.recoveryOwner?.userPrincipalName
          ?.toLowerCase()
          .includes(normalizedSearch);
      const matchesEnvironment =
        environmentFilter === "all" ||
        flow.environmentId === environmentFilter;
      const matchesOwner =
        ownerFilter === "all" ||
        (ownerFilter === "reported" && Boolean(flow.owner.id)) ||
        (ownerFilter === "recovered" && Boolean(flow.recoveryOwner)) ||
        (ownerFilter === "orphaned" &&
          flow.owner.status === "orphaned" &&
          !flow.recoveryOwner) ||
        (ownerFilter !== "orphaned" &&
          ownerFilter !== "recovered" &&
          ownerFilter !== "reported" &&
          flow.owner.status === ownerFilter);
      const matchesOwnerId =
        ownerIdFilter === "all" ||
        flow.owner.id?.toLowerCase() === ownerIdFilter ||
        flow.recoveryOwner?.id.toLowerCase() === ownerIdFilter;
      const matchesEnvironmentType =
        environmentTypeFilter === "all" ||
        flow.environmentType === environmentTypeFilter;
      const matchesLocation =
        locationFilter === "all" || flow.location === locationFilter;
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
        matchesDefault &&
        matchesModified
      );
    });

    return sortFlows(matchingFlows, sort);
  }, [
    defaultEnvironmentOnly,
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
    (flow) => flow.owner.status === "orphaned" && !flow.recoveryOwner,
  ).length;
  const recoveredFlowCount = flows.filter((flow) =>
    Boolean(flow.recoveryOwner),
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
  const activeFilterCount = [
    Boolean(searchText.trim()),
    environmentFilter !== "all",
    ownerFilter !== "all",
    ownerIdFilter !== "all",
    environmentTypeFilter !== "all",
    locationFilter !== "all",
    modifiedFilter !== "all",
    defaultEnvironmentOnly,
  ].filter(Boolean).length;

  const progressPercent = (() => {
    if (scanStatus !== "scanning" || !progress) {
      return scanStatus === "complete" ? 100 : 0;
    }

    if (
      progress.phase === "loading-environments" ||
      progress.totalItems === 0
    ) {
      return 8;
    }

    const ratio = progress.processedItems / progress.totalItems;
    return progress.phase === "loading-flows"
      ? Math.min(75, 10 + Math.round(ratio * 65))
      : Math.min(98, 75 + Math.round(ratio * 23));
  })();

  async function startScan() {
    setScanStatus("scanning");
    setScanError(null);
    setIssues([]);
    setPage(1);
    setSelectedFlowKeys(new Set());
    setIsReassignmentOpen(false);
    setReassignmentFlows([]);

    try {
      const result = await scanTenantFlows(setProgress);
      setEnvironments(result.environments);
      setFlows(result.flows);
      setIssues(result.issues);
      setScannedAt(result.scannedAt);
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
      } else if (next.size < MAX_REASSIGNMENT_BATCH) {
        next.add(key);
      }
      return next;
    });
  }

  function handleReassignmentApplied(
    results: FlowReassignmentResult[],
    replacement: DirectoryUser,
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
              recoveryOwner: replacement,
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
      "Recovery status",
      "Recovery co-owner display name",
      "Recovery co-owner user principal name",
      "Recovery co-owner object ID",
      "Created by object ID",
      "Created",
      "Last modified",
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
      flow.recoveryOwner ? "Co-owner added" : "",
      flow.recoveryOwner?.displayName ?? "",
      flow.recoveryOwner?.userPrincipalName ?? "",
      flow.recoveryOwner?.id ?? "",
      flow.createdBy ?? "",
      flow.createdTime ?? "",
      flow.lastModifiedTime ?? "",
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
            <span>Confirmed co-owner recovery</span>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-panel">
          <div>
            <p className="section-kicker">TENANT INVENTORY</p>
            <h2>Find every cloud flow. Start with a trusted baseline.</h2>
            <p className="hero-copy">
              Scan every Power Platform environment available to a Power
              Platform or Dynamics 365 administrator, including the default
              environment. Owner IDs are validated against Microsoft Entra ID,
              and orphan recovery adds a valid co-owner only after an explicit
              preview and confirmation.
            </p>
          </div>
          <div className="hero-actions">
            <button
              className="primary-button"
              type="button"
              onClick={startScan}
              disabled={scanStatus === "scanning"}
            >
              {scanStatus === "scanning"
                ? "Scanning tenant..."
                : flows.length > 0
                  ? "Scan again"
                  : "Scan tenant"}
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
                ? `Last completed ${formatDate(scannedAt)}`
                : "No tenant scan has been completed."}
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
                      : "Microsoft Entra ID directory"}
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
                ? `of ${environments.length.toLocaleString()} active environments`
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
            <span className="metric-detail">Tenant-wide inventory</span>
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
              {recoveredFlowCount > 0
                ? `${recoveredFlowCount.toLocaleString()} recovered this session`
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
                placeholder="Flow, owner ID, or environment"
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
                    {` (${(environmentFlowCounts.get(environment.id) ?? 0).toLocaleString()})`}
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
                <option value="recovered">Recovery co-owner added</option>
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
                      : ownerFilter === "recovered"
                        ? "Recovery co-owner added"
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
                  {selectedFlowKeys.size} orphaned flow
                  {selectedFlowKeys.size === 1 ? "" : "s"} selected
                </strong>
                <span>
                  Up to {MAX_REASSIGNMENT_BATCH} flows per confirmed batch
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
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setReassignmentFlows(selectedFlows);
                    setIsReassignmentOpen(true);
                  }}
                >
                  Assign recovery co-owner
                </button>
              </div>
            </div>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="selection-column">
                    <span className="visually-hidden">Select orphaned flow</span>
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
                        aria-label={`Select ${flow.displayName} for co-owner recovery`}
                        checked={selectedFlowKeys.has(getFlowKey(flow))}
                        onChange={() => toggleFlowSelection(flow)}
                        disabled={
                          flow.owner.status !== "orphaned" ||
                          Boolean(flow.recoveryOwner) ||
                          (!selectedFlowKeys.has(getFlowKey(flow)) &&
                            selectedFlowKeys.size >= MAX_REASSIGNMENT_BATCH)
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
                      </div>
                    </td>
                    <td>
                      {flow.recoveryOwner ? (
                        <div className="owner-cell">
                          <div>
                            <strong>{flow.recoveryOwner.displayName}</strong>
                            <small>
                              {flow.recoveryOwner.userPrincipalName ??
                                flow.recoveryOwner.mail ??
                                flow.recoveryOwner.id}
                            </small>
                            <small>
                              Deleted primary owner: {flow.owner.id}
                            </small>
                          </div>
                          <span className="owner-status owner-recovered">
                            Recovery co-owner added
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

      {isReassignmentOpen && reassignmentFlows.length > 0 ? (
        <ReassignmentDialog
          flows={reassignmentFlows}
          onClose={() => {
            setIsReassignmentOpen(false);
            setReassignmentFlows([]);
          }}
          onApplied={handleReassignmentApplied}
        />
      ) : null}

      <footer>
        <span>Orphaned Flow Finder</span>
        <span>
          Phase 2: directory validation and confirmed co-owner recovery
        </span>
      </footer>
    </div>
  );
}

export default App;
