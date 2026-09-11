import type { RichTextMark, RichTextNode } from '../../../domain';
import { normalizeCssColor } from './colors';
import { classifyContentUrl, isAllowedImageSource } from './urlPolicy';

/**
 * Read-only allowlisting renderer for the canonical `tiptap-json-v1` document.
 *
 * Rules (documented so behaviour is reviewable):
 * - Text is always HTML-escaped; stored content is never injected as trusted HTML.
 * - Only the supported node/mark subset below is emitted.
 * - Unknown node types are dropped with their subtree; unknown marks are ignored.
 * - Unknown attributes are ignored; only an explicit per-node allowlist is read.
 * - A rejected link URL keeps its text but loses the anchor.
 * - DOMPurify runs over the result as defence in depth (`sanitizeHtml.ts`).
 */

export interface RenderResult {
  readonly html: string;
  readonly droppedNodes: number;
  readonly blockedLinks: number;
  readonly droppedImages: number;
}

const HEADING_LEVELS = new Set(['1', '2', '3', '4', '5', '6']);

function escapeText(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/`/g, '&#96;');
}

interface RenderState {
  droppedNodes: number;
  blockedLinks: number;
  droppedImages: number;
}

function readAttr(node: RichTextNode, key: string): unknown {
  return node.attrs ? node.attrs[key] : undefined;
}

function renderMarks(text: string, marks: readonly RichTextMark[], state: RenderState): string {
  let output = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        output = `<strong>${output}</strong>`;
        break;
      case 'italic':
        output = `<em>${output}</em>`;
        break;
      case 'underline':
        output = `<u>${output}</u>`;
        break;
      case 'strike':
        output = `<s>${output}</s>`;
        break;
      case 'code':
        output = `<code>${output}</code>`;
        break;
      case 'link': {
        const decision = classifyContentUrl(mark.attrs?.href);
        if (decision.kind === 'reject') {
          state.blockedLinks += 1;
          break;
        }
        const href = escapeAttribute(decision.url);
        const external = decision.kind === 'external-web';
        output = `<a href="${href}" rel="noopener noreferrer"${
          external ? ' class="sa-content-link"' : ''
        }>${output}</a>`;
        break;
      }
      case 'textStyle': {
        const color = normalizeCssColor(mark.attrs?.color);
        if (color) output = `<span style="color:${color}">${output}</span>`;
        break;
      }
      case 'highlight': {
        const color = normalizeCssColor(mark.attrs?.color);
        if (color) output = `<mark style="background-color:${color}">${output}</mark>`;
        break;
      }
      default:
        // Unknown mark: ignored, text preserved.
        break;
    }
  }
  return output;
}

function renderTextNode(node: RichTextNode, state: RenderState): string {
  if (typeof node.text !== 'string' || node.text.length === 0) return '';
  const text = escapeText(node.text);
  const marks = node.marks ?? [];
  return marks.length > 0 ? renderMarks(text, marks, state) : text;
}

function renderChildren(node: RichTextNode, state: RenderState): string {
  if (!node.content) return '';
  return node.content.map((child) => renderNode(child, state)).join('');
}

function renderImage(node: RichTextNode, state: RenderState): string {
  const src = readAttr(node, 'src');
  if (!isAllowedImageSource(src)) {
    state.droppedImages += 1;
    return '';
  }
  const altRaw = readAttr(node, 'alt');
  const alt = typeof altRaw === 'string' ? escapeAttribute(altRaw.slice(0, 512)) : '';
  const width = readPositiveInt(readAttr(node, 'width'));
  const height = readPositiveInt(readAttr(node, 'height'));
  const dimensions = `${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}`;
  return `<img src="${escapeAttribute(src)}" alt="${alt}"${dimensions} loading="lazy" decoding="async" />`;
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 100_000) {
    return null;
  }
  return value;
}

function renderNode(node: RichTextNode, state: RenderState): string {
  switch (node.type) {
    case 'doc':
      return renderChildren(node, state);
    case 'paragraph':
      return `<p>${renderChildren(node, state)}</p>`;
    case 'heading': {
      const level = readAttr(node, 'level');
      const asString =
        typeof level === 'number' ? String(level) : typeof level === 'string' ? level : '';
      if (!HEADING_LEVELS.has(asString)) {
        state.droppedNodes += 1;
        return `<p>${renderChildren(node, state)}</p>`;
      }
      return `<h${asString}>${renderChildren(node, state)}</h${asString}>`;
    }
    case 'bulletList':
      return `<ul>${renderChildren(node, state)}</ul>`;
    case 'orderedList': {
      const start = readPositiveInt(readAttr(node, 'start'));
      return `<ol${start && start > 1 ? ` start="${start}"` : ''}>${renderChildren(node, state)}</ol>`;
    }
    case 'listItem':
      return `<li>${renderChildren(node, state)}</li>`;
    case 'blockquote':
      return `<blockquote>${renderChildren(node, state)}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${renderChildren(node, state)}</code></pre>`;
    case 'horizontalRule':
      return '<hr />';
    case 'hardBreak':
      return '<br />';
    case 'image':
      return renderImage(node, state);
    case 'text':
      return renderTextNode(node, state);
    default:
      state.droppedNodes += 1;
      return '';
  }
}

export function renderTipTapDocument(doc: RichTextNode): RenderResult {
  const state: RenderState = { droppedNodes: 0, blockedLinks: 0, droppedImages: 0 };
  const html = renderNode(doc, state);
  return {
    html,
    droppedNodes: state.droppedNodes,
    blockedLinks: state.blockedLinks,
    droppedImages: state.droppedImages,
  };
}
