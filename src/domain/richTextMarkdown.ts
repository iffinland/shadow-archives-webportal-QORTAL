/**
 * Canonical rich text → derived Markdown.
 *
 * Shadow Archives' canonical body is `tiptap-json-v1` (owner decision D4) and
 * stays that way. SubWire, however, stores and renders a *Markdown* string
 * (`content`, rendered by `marked` with GFM) plus base64 images, so publishing
 * one article that SubWire can display requires a derived representation. This
 * module derives it from the canonical document; the derived artifact is
 * rebuildable and never authoritative.
 *
 * Verified against `Qortal/Subwire` `master` @ a933a6c (2026-09-13):
 * `src/pages/ArticlePage.tsx` renders `displayArticleData.content` through
 * `marked.parse(content, { breaks: true, gfm: true })` and injects the result
 * with `dangerouslySetInnerHTML`. Two consequences drive the rules below:
 *
 * 1. Security. The downstream renderer has no sanitizer, so stored text must not
 *    be able to become HTML or an active link. Literal text is Markdown-escaped
 *    and link/image URLs are scheme-allowlisted. The only raw HTML emitted here
 *    is the fixed `<u>…</u>` wrap: GFM has no underline syntax and underline is
 *    part of the approved Shadow Archives editor model.
 * 2. Fidelity. `breaks: true` means a hard break renders from a plain newline, so
 *    hard breaks emit `\n` rather than a trailing double space.
 *
 * Unknown node types are traversed (their children are serialized) instead of
 * dropping a subtree, and unknown marks are ignored: one unrecognized node must
 * not silently delete an article's text.
 */

import { LIMITS } from './constants';
import type { RichTextDocument, RichTextNode } from './types';

/** URL schemes the derived artifact may turn into a link or image. */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'qortal:', 'mailto:'] as const;

const MARKDOWN_ESCAPE = /[\\`*_{}[\]()#+\-.!|~<>]/g;

/** Escapes Markdown punctuation so stored text is rendered literally. */
function escapeText(text: string): string {
  return text.replace(MARKDOWN_ESCAPE, '\\$&');
}

/**
 * Returns a URL only when it is safe for a downstream unsanitized renderer.
 * Relative/`data:` URLs are deliberately rejected: the artifact is consumed by
 * another app, where a relative path has no meaning.
 */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!(SAFE_URL_SCHEMES as readonly string[]).includes(url.protocol)) return null;
  return trimmed.replace(/[()<>\s"]/g, (match) => encodeURIComponent(match));
}

function attribute(node: RichTextNode, key: string): unknown {
  return node.attrs ? node.attrs[key] : undefined;
}

function inlineChildren(node: RichTextNode): string {
  return (node.content ?? []).map((child) => inline(child)).join('');
}

function applyMarks(text: string, node: RichTextNode): string {
  // Inline code is a literal span: its characters must NOT be Markdown-escaped,
  // or the consumer would render the backslashes. Every other mark operates on
  // escaped text so stored punctuation cannot become syntax.
  if ((node.marks ?? []).some((mark) => mark.type === 'code')) {
    return `\`${text.replace(/`/g, "'")}\``;
  }
  let result = escapeText(text);
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`;
        break;
      case 'italic':
        result = `*${result}*`;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'code':
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link': {
        const href = safeUrl(mark.attrs?.href);
        result = href ? `[${result}](${href})` : result;
        break;
      }
      default:
        break;
    }
  }
  return result;
}

/** Inline (text-level) serialization. */
function inline(node: RichTextNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node);
    case 'hardBreak':
      return '\n';
    case 'image': {
      const src = safeUrl(attribute(node, 'src'));
      if (!src) return '';
      const alt = attribute(node, 'alt');
      const label = typeof alt === 'string' ? escapeText(alt) : '';
      return `![${label}](${src})`;
    }
    default:
      return inlineChildren(node);
  }
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function codeBlockText(node: RichTextNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === 'text') return child.text ?? '';
      if (child.type === 'hardBreak') return '\n';
      return (child.content ?? []).map((grandChild) => grandChild.text ?? '').join('');
    })
    .join('');
}

/** Block-level serialization. Every block result already ends with a blank line. */
function block(node: RichTextNode, listDepth: number): string {
  switch (node.type) {
    case 'heading': {
      const level = attribute(node, 'level');
      const depth = typeof level === 'number' && level >= 1 && level <= 6 ? Math.floor(level) : 1;
      const text = inlineChildren(node).trim();
      return text.length > 0 ? `${'#'.repeat(depth)} ${text}\n\n` : '';
    }
    case 'paragraph': {
      const text = inlineChildren(node);
      return text.trim().length > 0 ? `${text}\n\n` : '';
    }
    case 'bulletList':
    case 'orderedList': {
      const start = attribute(node, 'start');
      let counter =
        node.type === 'orderedList' && typeof start === 'number' && start > 0
          ? Math.floor(start)
          : 1;
      const lines: string[] = [];
      for (const item of node.content ?? []) {
        const marker = node.type === 'orderedList' ? `${counter}. ` : '- ';
        counter += 1;
        const body = block(item, listDepth + 1).trimEnd();
        const [first = '', ...rest] = body.split('\n');
        const continuation = ' '.repeat(marker.length);
        const continued = rest.map((line) => (line.length > 0 ? `${continuation}${line}` : line));
        lines.push(`${marker}${first}${continued.length > 0 ? `\n${continued.join('\n')}` : ''}`);
      }
      return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
    }
    case 'listItem':
      return (node.content ?? []).map((child) => block(child, listDepth)).join('');
    case 'blockquote': {
      const body = (node.content ?? [])
        .map((child) => block(child, listDepth))
        .join('')
        .trim();
      return body.length > 0 ? `${indentLines(body, '> ')}\n\n` : '';
    }
    case 'codeBlock': {
      const language = attribute(node, 'language');
      const fence =
        typeof language === 'string' && /^[A-Za-z0-9+#-]{1,20}$/.test(language) ? language : '';
      const code = codeBlockText(node).replace(/```/g, "'''").trimEnd();
      return `\`\`\`${fence}\n${code}\n\`\`\`\n\n`;
    }
    case 'horizontalRule':
      return '---\n\n';
    case 'text':
      return `${inline(node)}\n\n`;
    default: {
      const children = node.content ?? [];
      if (children.length === 0) {
        const text = node.text;
        return typeof text === 'string' && text.length > 0 ? `${escapeText(text)}\n\n` : '';
      }
      const inlineOnly = children.every(
        (child) => child.type === 'text' || child.type === 'hardBreak',
      );
      return inlineOnly
        ? block({ type: 'paragraph', content: children }, listDepth)
        : children.map((child) => block(child, listDepth)).join('');
    }
  }
}

/**
 * Derive the GFM Markdown artifact for one canonical document.
 *
 * The result is normalized: CRLF removed, three or more newlines collapsed to
 * one blank line, trimmed, and bounded by the entity rich-text character budget.
 */
export function richTextToMarkdown(document: RichTextDocument): string {
  const markdown = block(document.doc, 0)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return markdown.length > LIMITS.richTextTextChars
    ? markdown.slice(0, LIMITS.richTextTextChars)
    : markdown;
}

/**
 * Normalized plain-text extract (the canonical `bodyText` field and the source
 * of the announcement excerpt). Block boundaries become newlines; list items get
 * a plain marker; rich-text marks are dropped. Whitespace runs collapse and
 * blank lines collapse to a single newline.
 */
export function richTextToPlainText(document: RichTextDocument): string {
  const text = plainBlock(document.doc, false)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > LIMITS.bodyText ? text.slice(0, LIMITS.bodyText) : text;
}

function plainBlock(node: RichTextNode, inList: boolean): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
    case 'horizontalRule':
      return `${children.map((child) => plainBlock(child, false)).join('')}\n\n`;
    case 'blockquote':
      return `${children.map((child) => plainBlock(child, false)).join('')}\n`;
    case 'listItem':
      return `${children.map((child) => plainBlock(child, true)).join('')}`;
    case 'bulletList':
    case 'orderedList': {
      const start = attribute(node, 'start');
      let counter =
        node.type === 'orderedList' && typeof start === 'number' && start > 0
          ? Math.floor(start)
          : 1;
      return children
        .map((item) => {
          const marker = node.type === 'orderedList' ? `${counter}. ` : '- ';
          counter += 1;
          return `${marker}${plainBlock(item, true).replace(/\n+$/, '')}\n`;
        })
        .join('');
    }
    default:
      if (children.length === 0) return typeof node.text === 'string' ? node.text : '';
      return children.map((child) => plainBlock(child, inList)).join('');
  }
}
