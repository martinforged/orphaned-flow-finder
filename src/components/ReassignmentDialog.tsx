import { useState, type FormEvent } from "react";
import type { DirectoryUser } from "../services/directoryUsers";
import {
  MAX_REASSIGNMENT_BATCH,
  reassignFlowOwners,
  type FlowReassignmentResult,
} from "../services/flowOwnership";
import { searchDirectoryUsers } from "../services/directoryUsers";
import type { TenantFlow } from "../services/tenantFlowInventory";

type DialogStage = "search" | "review" | "running" | "complete";

interface ReassignmentDialogProps {
  flows: TenantFlow[];
  onClose: () => void;
  onApplied: (
    results: FlowReassignmentResult[],
    replacement: DirectoryUser,
  ) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The co-owner recovery operation failed with an unknown error.";
}

export function ReassignmentDialog({
  flows,
  onClose,
  onApplied,
}: ReassignmentDialogProps) {
  const [stage, setStage] = useState<DialogStage>("search");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<FlowReassignmentResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSearching(true);
    setError(null);
    setSelectedUser(null);

    try {
      setSearchResults(await searchDirectoryUsers(searchTerm));
    } catch (searchError) {
      setSearchResults([]);
      setError(getErrorMessage(searchError));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleConfirm() {
    if (!selectedUser || !isConfirmed) {
      return;
    }

    setStage("running");
    setError(null);
    setCompleted(0);

    try {
      const reassignmentResults = await reassignFlowOwners(
        flows,
        selectedUser,
        (completedFlows) => setCompleted(completedFlows),
      );
      setResults(reassignmentResults);
      onApplied(reassignmentResults, selectedUser);
      setStage("complete");
    } catch (reassignmentError) {
      setError(getErrorMessage(reassignmentError));
      setStage("review");
    }
  }

  const successfulResults = results.filter((result) => result.success);
  const failedResults = results.filter((result) => !result.success);

  return (
    <div className="dialog-backdrop">
      <section
        className="reassignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reassignment-title"
      >
        <div className="dialog-header">
          <div>
            <p className="section-kicker">ORPHANED FLOW RECOVERY</p>
            <h2 id="reassignment-title">
              {stage === "search"
                ? "Choose a recovery co-owner"
                : stage === "review"
                  ? "Review co-owner recovery"
                  : stage === "running"
                    ? "Adding recovery co-owners"
                    : "Recovery results"}
            </h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            disabled={stage === "running"}
            aria-label="Close co-owner recovery dialog"
          >
            Close
          </button>
        </div>

        <div className="dialog-body">
          {stage === "search" ? (
            <>
              <div className="dialog-callout">
                <strong>{flows.length} orphaned flow(s) selected</strong>
                <span>
                  A maximum of {MAX_REASSIGNMENT_BATCH} flows can receive a
                  recovery co-owner in one confirmed batch.
                </span>
              </div>

              <form className="user-search" onSubmit={handleSearch}>
                <label>
                  <span>Search Microsoft Entra ID</span>
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Name or email address"
                    autoFocus
                  />
                </label>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={isSearching}
                >
                  {isSearching ? "Searching..." : "Search users"}
                </button>
              </form>

              {searchResults.length > 0 ? (
                <div
                  className="user-results"
                  role="radiogroup"
                  aria-label="Recovery co-owner results"
                >
                  {searchResults.map((user) => {
                    const isSelected = selectedUser?.id === user.id;
                    return (
                      <button
                        className={`user-result${isSelected ? " selected" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        key={user.id}
                        onClick={() => setSelectedUser(user)}
                      >
                        <span className="user-avatar" aria-hidden="true">
                          {user.displayName
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part.charAt(0).toUpperCase())
                            .join("") || "U"}
                        </span>
                        <span>
                          <strong>{user.displayName}</strong>
                          <small>
                            {user.userPrincipalName ?? user.mail ?? user.id}
                          </small>
                        </span>
                        <span className="radio-mark" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ) : !isSearching && searchTerm.trim().length >= 2 && !error ? (
                <p className="dialog-empty">
                  No active users matched that search.
                </p>
              ) : null}
            </>
          ) : null}

          {stage === "review" && selectedUser ? (
            <>
              <div className="replacement-card">
                <span className="user-avatar" aria-hidden="true">
                  {selectedUser.displayName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part.charAt(0).toUpperCase())
                    .join("") || "U"}
                </span>
                <span>
                  <small>Recovery co-owner</small>
                  <strong>{selectedUser.displayName}</strong>
                  <span>
                    {selectedUser.userPrincipalName ??
                      selectedUser.mail ??
                      selectedUser.id}
                  </span>
                </span>
              </div>

              <div className="preview-list">
                {flows.map((flow) => (
                  <article key={`${flow.environmentId}:${flow.id}`}>
                    <div>
                      <strong>{flow.displayName}</strong>
                      <span>{flow.environmentName}</span>
                    </div>
                    <code>{flow.owner.id}</code>
                  </article>
                ))}
              </div>

              <div className="write-warning">
                This adds the selected user as a co-owner with edit access. The
                Power Automate admin permissions API doesn't allow removing
                the immutable primary-owner permission, so the deleted primary
                owner can remain listed. Connections owned by the deleted user
                may still require separate repair.
              </div>

              <label className="confirmation-check">
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(event) => setIsConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the flows and recovery co-owner and approve adding
                  this co-owner.
                </span>
              </label>
            </>
          ) : null}

          {stage === "running" ? (
            <div className="operation-progress" aria-live="polite">
              <div className="operation-mark" aria-hidden="true">
                OF
              </div>
              <h3>Adding confirmed recovery co-owners</h3>
              <p>
                {completed} of {flows.length} flow(s) processed. Keep this
                window open until the operation completes.
              </p>
              <progress value={completed} max={flows.length}>
                {completed} of {flows.length}
              </progress>
            </div>
          ) : null}

          {stage === "complete" ? (
            <div className="operation-results">
              <div className="result-summary">
                <div className="result-success">
                  <strong>{successfulResults.length}</strong>
                  <span>Co-owner added</span>
                </div>
                <div className="result-failure">
                  <strong>{failedResults.length}</strong>
                  <span>Failed</span>
                </div>
              </div>
              {failedResults.length > 0 ? (
                <div className="failure-list">
                  {failedResults.map((result) => (
                    <article key={result.flowKey}>
                      <strong>{result.flowName}</strong>
                      <span>{result.environmentName}</span>
                      <p>{result.error}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="dialog-empty">
                  A recovery co-owner was added to every confirmed flow.
                </p>
              )}
            </div>
          ) : null}

          {error ? (
            <div className="dialog-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="dialog-footer">
          {stage === "search" ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => setStage("review")}
                disabled={!selectedUser}
              >
                Review co-owner recovery
              </button>
            </>
          ) : null}
          {stage === "review" ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setStage("search");
                  setIsConfirmed(false);
                }}
              >
                Back
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={handleConfirm}
                disabled={!isConfirmed}
              >
                Confirm and add co-owner
              </button>
            </>
          ) : null}
          {stage === "complete" ? (
            <button
              className="primary-button"
              type="button"
              onClick={onClose}
            >
              Done
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
