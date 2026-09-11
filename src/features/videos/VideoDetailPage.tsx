import { useParams } from 'react-router-dom';

import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <RoutePlaceholder
      title="Video"
      lead="A single archived video with its metadata and engagement."
      note="Playback, metadata resolution and the on-demand player chunk are not implemented in this phase. Q-Tube publication interoperability remains FUTURE / NOT VERIFIED and is deliberately not started."
      details={[{ label: 'Requested reference', value: id ?? '(none)' }]}
    />
  );
}
