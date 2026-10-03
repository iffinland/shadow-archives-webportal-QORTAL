/**
 * Built-in About-page content.
 *
 * This is the same prose the page shipped with before owner editing, expressed
 * in the canonical rich-text model so a visitor whose archive has no
 * owner-published About resource sees the identical content through the exact
 * same sanitized renderer as owner-authored text. It is also the seed the owner
 * editor starts from.
 */

import { siteConfig } from '../../app/config/siteConfig';
import type { RichTextDocument, RichTextNode } from '../../domain/types';

function text(value: string, marks?: RichTextNode['marks']): RichTextNode {
  return marks && marks.length > 0
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value };
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content };
}

function heading(level: 2 | 3, value: string): RichTextNode {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

export function defaultAboutDocument(): RichTextDocument {
  return {
    format: 'tiptap-json-v1',
    doc: {
      type: 'doc',
      content: [
        heading(2, 'Where the content lives'),
        paragraph(
          text('Content is published to QDN under the '),
          text(siteConfig.qdnService, [{ type: 'code' }]),
          text(
            ' service. The application holds no server, database or account of its own: it reads what the connected Qortal host makes available and asks the host to sign anything that is written.',
          ),
        ),
        heading(2, 'Who can publish'),
        paragraph(
          text(
            'Publishing authority belongs to the current owner of the app\u2019s publishing name, and is resolved at runtime. Owner controls are never derived from a name or address hardcoded into this application, and payload fields claiming authorship are not trusted.',
          ),
        ),
        heading(2, 'Phase status'),
        paragraph(
          text(
            `This build is the ${siteConfig.phaseLabel.toLowerCase()}: the responsive application shell plus read-only QDN content discovery, runtime validation and rendering. Every payload is validated before it is trusted, and the archive states distinguish an empty archive from an unavailable, partial or stale index.`,
          ),
        ),
        paragraph(
          text(
            'Publishing, editing, likes, comments, tips, sharing and owner studio functionality are deliberately not implemented in this phase. Browsing the archive never asks for a Qortal account or triggers an authentication prompt.',
          ),
        ),
        heading(2, 'Privacy and dependencies'),
        paragraph(
          text(
            'The shell loads only assets bundled with the app. There are no third-party fonts, image CDNs, analytics or external runtime APIs, in line with the QDN content security policy.',
          ),
        ),
      ],
    },
  };
}
