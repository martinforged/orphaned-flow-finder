import { useState, type FormEvent } from "react";
import type { DirectoryUser } from "../services/directoryUsers";
import {
  assignFlowCoOwners,
  MAX_COOWNER_ASSIGNMENT_BATCH,
  type FlowCoOwnerAssignmentResult,
} from "../services/flowOwnership";
import { searchDirectoryUsers } from "../services/directoryUsers";
import type { TenantFlow } from "../services/tenantFlowInventory";

type DialogStage = "search" | "review" | "running" | "complete";

interface CoOwnerAssignmentDialogProps {
  flows: TenantFlow[];
  onClose: () => void;
  onApplied: (
    results: FlowCoOwnerAssignmentResult[],
    coOwner: DirectoryUser,
  ) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The co-owner assignment failed with an unknown error.";
}

export function CoOwnerAssignmentDialog({
  flows,
  onClose,
  onApplied,
}: CoOwnerAssignmentDialogProps) {
  const [stage, setStage] = useState<DialogStage>("search");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<FlowCoOwnerAssignmentResult[]>([]);
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
      const assignmentResults = await assignFlowCoOwners(
        flows,
        selectedUser,
        (completedFlows) => setCompleted(completedFlows),
      );
      setResults(assignmentResults);
      onApplied(assignmentResults, selectedUser);
      setStage("complete");
    } catch (assignmentError) {
      setError(getErrorMessage(assignmentError));
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
        aria-labelledby="coowner-assignment-title"
      >
        <div className="dialog-header">
          <div>
            <p className="section-kicker">FLOW CO-OWNER ACCESS</p>
            <h2 id="coowner-assignment-title">
              {stage === "search"
                ? "Choose a new co-owner"
                : stage === "review"
                  ? "Review co-owner assignment"
                  : stage === "running"
                    ? "Adding co-owners"
                    : "Assignment results"}
            </h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            disabled={stage === "running"}
            aria-label="Close co-owner assignment dialog"
          >
            Close
          </button>
        </div>

        <div className="dialog-body">
          {stage === "search" ? (
            <>
              <div className="dialog-callout">
                <strong>{flows.length} flow(s) selected</strong>
                <span>
                  A maximum of {MAX_COOWNER_ASSIGNMENT_BATCH} flows can receive
                  a co-owner in one confirmed batch.
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
                  aria-label="Co-owner search results"
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
                  <small>New co-owner</small>
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
                    <code>{flow.owner.id ?? "Owner ID unavailable"}</code>
                  </article>
                ))}
              </div>

              <div className="write-warning">
                This adds the selected user as a co-owner with edit access to
                every listed flow. Existing owners remain, and their
                connections aren't transferred. A co-owner can edit, share,
                stop, or delete the flow.
              </div>

              <label className="confirmation-check">
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(event) => setIsConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the flows and selected user and approve granting
                  co-owner access.
                </span>
              </label>
            </>
          ) : null}

          {stage === "running" ? (
            <div className="operation-progress" aria-live="polite">
              <div className="operation-mark" aria-hidden="true">
                OF
              </div>
              <h3>Adding confirmed co-owners</h3>
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
                  The selected co-owner was added to every confirmed flow.
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
                Review co-owner assignment
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
                Confirm and grant co-owner access
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
