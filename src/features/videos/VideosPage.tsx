import { RoutePlaceholder } from '../shared/RoutePlaceholder';

export default function VideosPage() {
  return (
    <RoutePlaceholder
      title="Videos"
      lead="Videos published by Shadow Archives, with the player loaded only on demand."
      note="Video discovery and playback are not implemented in this phase. No video bytes are requested by the shell, and the future player stays outside the startup bundle."
    />
  );
}
