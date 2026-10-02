import { getFlowDetailsUrl } from "../services/flowNavigation";
import type { TenantFlow } from "../services/tenantFlowInventory";

interface SendCopyDialogProps {
  flow: TenantFlow;
  onClose: () => void;
}

export function SendCopyDialog({
  flow,
  onClose,
}: SendCopyDialogProps) {
  const flowDetailsUrl = getFlowDetailsUrl(flow);

  return (
    <div className="dialog-backdrop">
      <section
        className="reassignment-dialog send-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-copy-title"
      >
        <div className="dialog-header">
          <div>
            <p className="section-kicker">INDEPENDENT FLOW TEMPLATE</p>
            <h2 id="send-copy-title">Send a copy in Power Automate</h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            aria-label="Close Send a copy guidance"
          >
            Close
          </button>
        </div>

        <div className="dialog-body">
          <div className="copy-flow-card">
            <div>
              <small>Selected flow</small>
              <strong>{flow.displayName}</strong>
              <span>{flow.environmentName}</span>
            </div>
            <code>{flow.id}</code>
          </div>

          <div className="dialog-callout">
            <strong>This handoff doesn't change flow permissions.</strong>
            <span>
              The app opens the supported Power Automate flow details page.
              Complete the Send a copy action there.
            </span>
          </div>

          <ol className="copy-steps">
            <li>
              Open the selected flow in Power Automate using the button below.
            </li>
            <li>
              On the flow details command bar, select{" "}
              <strong>Send a copy</strong>.
            </li>
            <li>
              Review the template name and description, choose the recipients,
              and send the copy within your organization.
            </li>
          </ol>

          <div className="write-warning">
            <strong>Owner access is required.</strong> Tenant inventory or
            environment-admin access alone might not expose the Send a copy
            command. If it isn't available, an existing owner or co-owner must
            complete this step, or grant the operator co-owner access first.
          </div>

          <div className="copy-behavior">
            The recipient creates a separate flow using their own connections.
            Later changes to the original flow don't synchronize to the copy,
            and access to a sent copy can't be revoked from the original flow.
            Review the definition for personal information, secrets, and
            hard-coded environment values before sending it.
          </div>
        </div>

        <div className="dialog-footer">
          <button
            className="secondary-button"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <a
            className="primary-button button-link"
            href={flowDetailsUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open flow in Power Automate
          </a>
        </div>
      </section>
    </div>
  );
}
