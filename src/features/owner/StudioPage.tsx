import type { ReactNode } from 'react';

import { useAuth } from '../../app/providers/AuthProvider';
import { useCapability } from '../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../app/providers/BridgeProvider';
import { Button } from '../../components/common/Button';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import type { CapabilityState } from '../../qortal/types';

/**
 * Owner / Studio capability shell.
 *
 * This route lives behind its own lazy boundary and is not linked from public
 * navigation, so it contributes nothing to the visitor startup graph. It is an
 * information and capability shell only: it verifies whether the account
 * currently connected in the Qortal host owns this application's publishing
 * name, and it contains NO publishing, editing, moderation or other write
 * control.
 *
 * The single `GET_USER_ACCOUNT` call is issued only from the explicit "Enter
 * owner mode" action below. Loading this page never requests permission.
 */

function shortenAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

interface DetailRow {
  readonly label: string;
  readonly value: string;
}

function CapabilityDetails({ rows }: { readonly rows: readonly DetailRow[] }) {
  return (
    <dl className="sa-route__details">
      {rows.map((row) => (
        <div className="sa-route__detail" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusPanel({
  status,
  children,
  tone,
}: {
  readonly status: string;
  readonly tone?: 'owner' | 'muted';
  readonly children: ReactNode;
}) {
  return (
    <section className="sa-studio" aria-label="Owner studio status">
      <p className={`sa-studio__status${tone ? ` sa-studio__status--${tone}` : ''}`}>{status}</p>
      {children}
    </section>
  );
}

export default function StudioPage() {
  const environment = useQortalEnvironment();
  const { capability } = useCapability();
  const { permission, account, ownedNames, authenticate, cancel, reset } = useAuth();

  const startOwnerMode = () => {
    void authenticate();
  };
  const retryOwnerMode = () => {
    void authenticate({ retry: true });
  };

  const publishingName = environment.publisherName;

  function renderCapability(capabilityState: CapabilityState) {
    switch (capabilityState) {
      case 'requesting-permission':
        return (
          <StatusPanel status="Waiting for the Qortal host">
            <p className="sa-studio__body">
              Approve or decline the account request in the Qortal host window. No account data is
              shared until you decide.
            </p>
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </StatusPanel>
        );

      case 'resolving-ownership':
        return (
          <StatusPanel status="Checking name ownership">
            <p className="sa-studio__body" role="status">
              Verifying the current owner of the publishing name against the connected account.
            </p>
          </StatusPanel>
        );

      case 'permission-denied':
        return (
          <ErrorState
            title="Account access was declined"
            description="No account was shared, so owner capability cannot be verified. Browsing stays available and nothing was changed."
            onRetry={retryOwnerMode}
            retryLabel="Try again"
          />
        );

      case 'error':
        return (
          <ErrorState
            title="Account access is unavailable"
            description="The Qortal host did not complete the account request. No account was shared and nothing was changed; you can try again."
            onRetry={retryOwnerMode}
            retryLabel="Try again"
          />
        );

      case 'visitor':
        return (
          <EmptyState
            title="No account was shared"
            description="Owner capability cannot be verified without an account. Browsing stays available; you can retry owner mode at any time."
          />
        );

      case 'authenticated-no-name':
        return (
          <StatusPanel status="No registered Qortal name">
            <p className="sa-studio__body">
              This account owns no registered Qortal name. Acting as a name (for example commenting
              or publishing) requires one in a later phase. Owner controls stay hidden.
            </p>
            {account ? (
              <CapabilityDetails
                rows={[{ label: 'Connected account', value: shortenAddress(account.address) }]}
              />
            ) : null}
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={retryOwnerMode}>
                Check again
              </Button>
            </div>
          </StatusPanel>
        );

      case 'authenticated-non-owner':
        return (
          <StatusPanel status="Signed in — not the owner">
            <p className="sa-studio__body">
              This account does not currently own the publishing name
              {publishingName ? ` “${publishingName}”` : ' for this application'}. Owner controls
              stay hidden. If the name is transferred to this account, re-check to pick that up.
            </p>
            {account ? (
              <CapabilityDetails
                rows={[{ label: 'Connected account', value: shortenAddress(account.address) }]}
              />
            ) : null}
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={retryOwnerMode}>
                Check again
              </Button>
            </div>
          </StatusPanel>
        );

      case 'owner':
        return (
          <StatusPanel status="Owner capability verified" tone="owner">
            <CapabilityDetails
              rows={[
                { label: 'Publishing name', value: publishingName ?? 'unresolved' },
                {
                  label: 'Connected account',
                  value: account ? shortenAddress(account.address) : 'unknown',
                },
                { label: 'Registered names owned', value: String(ownedNames.length) },
              ]}
            />
            <p className="sa-studio__body">
              Publishing, editing and moderation tools arrive in a later phase. This build contains
              no write actions, so there is nothing to publish yet.
            </p>
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={retryOwnerMode}>
                Re-check ownership
              </Button>
              <Button variant="ghost" onClick={reset}>
                Sign out of owner mode
              </Button>
            </div>
          </StatusPanel>
        );

      case 'unknown':
      default:
        return (
          <StatusPanel status="Could not verify ownership">
            <p className="sa-studio__body">
              The connected account was resolved, but the current owner of the publishing name could
              not be confirmed. Owner controls stay hidden until ownership can be proven.
            </p>
            <div className="sa-route__actions">
              <Button variant="secondary" onClick={retryOwnerMode}>
                Check again
              </Button>
            </div>
          </StatusPanel>
        );
    }
  }

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Owner studio</h1>
        <p className="sa-route__lead">
          Publishing, editing and moderation for the current owner of this application&rsquo;s
          Qortal publishing name.
        </p>
      </header>

      {!environment.bridgeAvailable ? (
        <EmptyState
          title="Not running in a Qortal host"
          description="This page is open in a plain browser, so there is no Qortal account bridge and no publishing identity to verify. Reader features work normally; open the published app in a Qortal host for owner mode."
        />
      ) : environment.isProxy ? (
        <StatusPanel status="Development — identity not authoritative" tone="muted">
          <p className="sa-studio__body">
            This app is being served through the Qortal node development proxy, which does not carry
            the deployed publishing identity. Owner capability cannot be verified here, and this
            build has no development owner bypass.
          </p>
        </StatusPanel>
      ) : permission === 'idle' ? (
        <StatusPanel status="Owner mode">
          <p className="sa-studio__body">
            Owner mode asks the Qortal host for the account currently connected to this app, then
            checks whether that account is the current owner of the publishing name
            {publishingName ? ` “${publishingName}”` : ''}. Account access is only requested when
            you choose it below; browsing the archive never triggers it.
          </p>
          <div className="sa-route__actions">
            <Button variant="primary" onClick={startOwnerMode}>
              Enter owner mode
            </Button>
          </div>
        </StatusPanel>
      ) : (
        renderCapability(capability)
      )}
    </div>
  );
}
