import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { routes } from '../../app/config/navigation';
import { useAuth } from '../../app/providers/AuthProvider';
import { useCapability } from '../../app/providers/CapabilityProvider';
import { useQortalEnvironment } from '../../app/providers/BridgeProvider';
import { buildInfo } from '../../build/buildInfo';
import { Button } from '../../components/common/Button';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import type { CapabilityState, QdnEnvironment } from '../../qortal/types';

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

/** Render an injected `_qdn*` value without inventing a missing one. */
function describeInjected(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'not injected';
  if (value === '') return 'empty string';
  return value;
}

/**
 * Read-only host-context diagnostics.
 *
 * Shows only the non-secret `_qdn*` values Qortal Core injects into the rendered
 * frame, so the owner can confirm the real host context (`service`, `name`,
 * `identifier`, `context`, `base`, `baseWithPath`) without browser devtools.
 * It reads nothing from the host: no account request, no QDN read, no write,
 * and no secret or account data is displayed.
 */
function HostContextDiagnostics({ environment }: { readonly environment: QdnEnvironment }) {
  // Core injects `_qdnIdentifier=""` for the default (identifier-less) resource.
  // Inside a Qortal frame that is a fact about the served resource, not a missing
  // value, so it is reported as such instead of as "not injected".
  const identifier = environment.identifier
    ? environment.identifier
    : environment.isHosted
      ? 'default (no identifier injected)'
      : describeInjected(environment.identifier);

  const rows: DetailRow[] = [
    { label: 'Bridge available', value: environment.bridgeAvailable ? 'yes' : 'no' },
    { label: 'Runtime state', value: environment.runtimeState },
    { label: '_qdnService', value: describeInjected(environment.service) },
    { label: '_qdnName', value: describeInjected(environment.name) },
    { label: '_qdnIdentifier', value: identifier },
    { label: '_qdnContext', value: describeInjected(environment.context) },
    { label: '_qdnBase', value: describeInjected(environment.base) },
    { label: '_qdnBaseWithPath', value: describeInjected(environment.baseWithPath) },
  ];

  return (
    <details className="sa-studio">
      <summary className="sa-studio__status">Host context diagnostics</summary>
      <p className="sa-studio__body">
        Non-secret values injected by the Qortal host for this frame. They identify which resource,
        identifier and route path the app is rendered from. This block issues no host request and
        displays no account data.
      </p>
      <CapabilityDetails rows={rows} />
    </details>
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
  const { runtimeState } = environment;

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
              Owner mode is active for this session. Gallery publishing is available: the Gallery
              page now shows owner controls (Add image, Create album) and Studio appears in the main
              navigation only while this capability is verified.
            </p>
            <p className="sa-studio__body">
              Blog and video publishing, editing, moderation and comments are roadmap items and are
              not interactive in this build.
            </p>
            <div className="sa-route__actions">
              <Link className="sa-button sa-button--primary sa-button--md" to={routes.gallery}>
                Manage Gallery
              </Link>
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

      {runtimeState === 'plain-browser' ? (
        <EmptyState
          title="Plain browser — no Qortal context"
          description="This page is open outside Qortal: no publishing identity was injected and no account bridge is present. Nothing here is a published runtime. Reader features that need published QDN content require the published app; open the published Shadow Archives app inside a Qortal host for owner mode."
        />
      ) : runtimeState === 'qortal-dev-proxy' ? (
        <StatusPanel status="Development — identity not authoritative" tone="muted">
          <p className="sa-studio__body">
            This app is being served through the Qortal node development proxy, which does not carry
            the deployed publishing identity. Owner capability cannot be verified here, and this
            build has no development owner bypass.
          </p>
        </StatusPanel>
      ) : runtimeState === 'qortal-render-readonly' ? (
        <StatusPanel status="Published in a Qortal render context — read-only" tone="muted">
          <p className="sa-studio__body">
            This app is running in a real Qortal render context and the injected identity below is
            the published resource it was served from. Read-only browsing (Home, Blog, Videos,
            Gallery, taxonomy, search and content detail) works from that identity.
          </p>
          <CapabilityDetails
            rows={[
              { label: 'Publishing identity', value: publishingName ?? 'not injected' },
              { label: 'QDN service', value: environment.service ?? 'not injected' },
              { label: 'Runtime context', value: environment.context ?? 'not injected' },
              { label: 'Account bridge', value: 'unavailable in this frame' },
              { label: 'Owner capability', value: 'unavailable — requires the host bridge' },
            ]}
          />
          <p className="sa-studio__body">
            Owner mode is unavailable here because the Qortal account bridge (
            <code>qortalRequest</code>) is not reachable in this frame, so no account can be
            resolved, no permission can be granted and nothing can be published. Owner controls stay
            hidden and no account request is made.
          </p>
        </StatusPanel>
      ) : runtimeState === 'qortal-bridge-unidentified' ? (
        <StatusPanel status="Qortal account bridge present — no published identity" tone="muted">
          <p className="sa-studio__body">
            A Qortal account bridge is reachable, but this document was not served with an injected
            publishing identity, so there is no publisher to verify ownership against. Owner
            capability stays unavailable and no account request is made.
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

      <HostContextDiagnostics environment={environment} />

      <p className="sa-route__provenance">
        Served build v{buildInfo.version} · <code>{buildInfo.commitShort}</code>
      </p>
    </div>
  );
}
