import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function ContactPage() {
  return (
    <RoutePlaceholder
      title="Contact"
      lead="Send a message to the archive owner through Qortal Q-Mail."
      note="Q-Mail delivery is not implemented in this phase, so no form is shown and no message can be sent. If delivery is unavailable when it is implemented, the draft is preserved and the message can be copied — the app will never silently fall back to a different messaging action."
    />
  );
}
