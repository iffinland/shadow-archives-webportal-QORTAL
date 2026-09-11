import { useCapability } from '../../app/providers/CapabilityProvider';
import { RoutePlaceholder } from '../shared/RoutePlaceholder';

/**
 * Owner studio placeholder. It lives behind its own lazy boundary and is not
 * linked from any visitor navigation, so it contributes nothing to startup.
 *
 * Phase 1B intentionally provides NO working owner controls and never opens a
 * permission dialog: the panel below reports the capability state that was
 * actually derived (which is `unknown` outside a real Qortal host).
 */
export default function StudioPage() {
  const { capability } = useCapability();

  return (
    <RoutePlaceholder
      title="Owner studio"
      lead="Publishing, editing and moderation for the owner of the Shadow Archives name."
      note="Owner authentication and publishing tooling belong to later phases. This route never requests permission on load. When it is implemented, controls appear only for an account that currently owns the app's publishing name, verified at runtime against name ownership."
      details={[
        { label: 'Detected capability', value: capability },
        { label: 'Permission requests issued by this page', value: 'none' },
      ]}
    />
  );
}
