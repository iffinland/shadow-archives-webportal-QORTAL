/**
 * Read-only live check of the Blog interoperability contracts.
 *
 * It proves, against real QDN data, that:
 *   - the SubWire article coordinate Shadow Archives derives is discoverable
 *     through the *exact* search request SubWire issues, and the served payload
 *     passes SubWire's own consumption gate;
 *   - the Quitter post coordinate is discoverable through Quitter's own search,
 *     and the served payload is the SubWire-style cross-post that references the
 *     SubWire article URL and attaches the cover image.
 *
 * It never writes, publishes or transacts anything.
 *
 * Usage: npx vite-node scripts/live-blog-interop-check.ts http://127.0.0.1:24991 [more nodes]
 */
import {
  SUBWIRE_ARTICLE_DISCOVERY_REQUEST,
  isSubwireRenderableArticle,
  subwireArticleIdentifierPrefix,
} from '../src/services/subwireArticleContract';
import {
  QUITTER_POST_DISCOVERY_REQUEST,
  isQuitterRenderablePost,
  quitterPostIdentifierPrefix,
} from '../src/services/quitterAnnouncementContract';

const PUBLISHER = 'Shadow Archives';
const nodes = process.argv.slice(2);

/** Turns a bridged search request into the read-only node REST query. */
function restQuery(request: Record<string, unknown>, name: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (key === 'action') continue;
    params.set(key, String(value));
  }
  params.set('name', name);
  return params.toString();
}

async function search(node: string, request: Record<string, unknown>, name: string) {
  const response = await fetch(`${node}/arbitrary/resources/search?${restQuery(request, name)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${node} search -> ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body : [];
}

/** Fetch a DOCUMENT payload, tolerating per-node index/chunk propagation lag. */
async function fetchPayload(identifier: string): Promise<{ node: string; text: string } | null> {
  for (const node of nodes) {
    try {
      const response = await fetch(
        `${node}/arbitrary/DOCUMENT/${encodeURIComponent(PUBLISHER)}/${encodeURIComponent(identifier)}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) continue;
      const text = await response.text();
      if (text.startsWith('{') && text.includes('"error"')) continue;
      return { node, text };
    } catch {
      // try the next node
    }
  }
  return null;
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function main() {
  const subwirePrefix = await subwireArticleIdentifierPrefix();
  const quitterPrefix = await quitterPostIdentifierPrefix();
  const report: Record<string, unknown> = {
    publisher: PUBLISHER,
    subwireIdentifierPrefix: subwirePrefix,
    quitterIdentifierPrefix: quitterPrefix,
    nodes: {},
    evidence: { subwire: [], quitter: [] },
  };

  const identifiers = new Set<string>();
  for (const node of nodes) {
    const status = (await (await fetch(`${node}/admin/status`)).json()) as { height?: number };
    const subwireHits = await search(node, SUBWIRE_ARTICLE_DISCOVERY_REQUEST, PUBLISHER);
    const quitterHits = await search(node, QUITTER_POST_DISCOVERY_REQUEST, PUBLISHER);
    const pick = (hits: unknown[], prefix: string) =>
      hits
        .filter((hit): hit is Record<string, unknown> => !!hit && typeof hit === 'object')
        .map((hit) => ({ identifier: String(hit.identifier ?? ''), size: hit.size ?? null }))
        .filter((hit) => hit.identifier.startsWith(prefix));

    const subwire = pick(subwireHits, subwirePrefix);
    const quitter = pick(quitterHits, quitterPrefix);
    for (const hit of [...subwire, ...quitter]) identifiers.add(hit.identifier);

    (report.nodes as Record<string, unknown>)[node] = {
      height: status.height ?? null,
      subwireResultCount: subwireHits.length,
      quitterResultCount: quitterHits.length,
      subwire,
      quitter,
    };
  }

  for (const identifier of identifiers) {
    const fetched = await fetchPayload(identifier);
    if (!fetched) {
      const bucket = identifier.startsWith(subwirePrefix) ? 'subwire' : 'quitter';
      (report.evidence as Record<string, unknown[]>)[bucket].push({
        identifier,
        served: false,
      });
      continue;
    }
    const payload = parse(fetched.text);
    if (identifier.startsWith(subwirePrefix)) {
      const cover = (payload?.coverImage ?? null) as { src?: unknown } | null;
      (report.evidence as Record<string, unknown[]>).subwire.push({
        identifier,
        servedBy: fetched.node,
        gatePasses: isSubwireRenderableArticle(payload),
        title: payload?.title ?? null,
        contentChars: typeof payload?.content === 'string' ? payload.content.length : null,
        coverBase64Chars: typeof cover?.src === 'string' ? cover.src.length : null,
        coverIsDataUrl: typeof cover?.src === 'string' && cover.src.startsWith('data:'),
        type: payload?.type ?? null,
        published: payload?.published ?? null,
      });
    } else {
      const text = typeof payload?.text === 'string' ? payload.text : '';
      const images = Array.isArray(payload?.images) ? payload.images : [];
      const referenced = text.match(/qortal:\/\/APP\/Subwire\/article\/\S+/g) ?? [];
      (report.evidence as Record<string, unknown[]>).quitter.push({
        identifier,
        servedBy: fetched.node,
        gatePasses: isQuitterRenderablePost(payload),
        textFirstLine: text.split('\n')[0] ?? null,
        referencesSubwireArticle: referenced.length > 0,
        referencedIdentifiers: referenced.map((url) =>
          decodeURIComponent(url.split('/').pop() ?? ''),
        ),
        imageCount: images.length,
        timestamp: payload?.timestamp ?? null,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

await main();
