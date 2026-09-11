import { LIMITS } from './constants';
import type { RichTextDocument, RichTextMark, RichTextNode } from './types';
import { fail, isRecord, ok, type ValidationResult } from './validation';

const NODE_TYPE_MAX = 48;
const ATTR_COUNT_MAX = 24;
const ATTR_STRING_MAX = 2048;

interface Budget {
  nodes: number;
  chars: number;
}

function readPrimitiveAttrs(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > ATTR_COUNT_MAX) return undefined;
  const attrs: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    if (key.length === 0 || key.length > 64) continue;
    if (raw === null || typeof raw === 'boolean' || typeof raw === 'number') {
      attrs[key] = raw;
    } else if (typeof raw === 'string') {
      if (raw.length <= ATTR_STRING_MAX) attrs[key] = raw;
    }
    // Nested objects/arrays are dropped: attributes are rendered from an
    // explicit allowlist per node/mark type and never spread into the DOM.
  }
  return attrs;
}

function validateMark(value: unknown): RichTextMark | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (typeof type !== 'string' || type.length === 0 || type.length > NODE_TYPE_MAX) return null;
  const attrs = readPrimitiveAttrs(value.attrs);
  return attrs ? { type, attrs } : { type };
}

function validateNode(
  value: unknown,
  depth: number,
  budget: Budget,
): ValidationResult<RichTextNode> {
  if (depth > LIMITS.richTextDepth) {
    return fail('too-large', 'Rich text document is nested too deeply');
  }
  if (!isRecord(value)) {
    return fail('invalid-type', 'Rich text node must be an object');
  }
  budget.nodes += 1;
  if (budget.nodes > LIMITS.richTextNodes) {
    return fail('too-large', 'Rich text document contains too many nodes');
  }

  const type = value.type;
  if (typeof type !== 'string' || type.length === 0 || type.length > NODE_TYPE_MAX) {
    return fail('invalid-type', 'Rich text node type is missing or invalid');
  }

  const node: {
    type: string;
    attrs?: Record<string, unknown>;
    marks?: RichTextMark[];
    content?: RichTextNode[];
    text?: string;
  } = {
    type,
  };

  const attrs = readPrimitiveAttrs(value.attrs);
  if (attrs) node.attrs = attrs;

  if (value.text !== undefined && value.text !== null) {
    if (typeof value.text !== 'string') {
      return fail('invalid-type', 'Rich text node text must be a string');
    }
    budget.chars += value.text.length;
    if (budget.chars > LIMITS.richTextTextChars) {
      return fail('too-large', 'Rich text document contains too much text');
    }
    node.text = value.text;
  }

  if (value.marks !== undefined && value.marks !== null) {
    if (!Array.isArray(value.marks) || value.marks.length > ATTR_COUNT_MAX) {
      return fail('invalid-type', 'Rich text marks must be a bounded array');
    }
    const marks: RichTextMark[] = [];
    for (const rawMark of value.marks) {
      const mark = validateMark(rawMark);
      if (!mark) return fail('invalid-type', 'Rich text mark is invalid');
      marks.push(mark);
    }
    node.marks = marks;
  }

  if (value.content !== undefined && value.content !== null) {
    if (!Array.isArray(value.content) || value.content.length > LIMITS.richTextNodes) {
      return fail('invalid-type', 'Rich text content must be a bounded array');
    }
    const children: RichTextNode[] = [];
    for (const rawChild of value.content) {
      const child = validateNode(rawChild, depth + 1, budget);
      if (!child.ok) return child;
      children.push(child.value);
    }
    node.content = children;
  }

  return ok(node);
}

/**
 * Validate the canonical stored rich text (`tiptap-json-v1`).
 *
 * The validator guarantees a bounded, structurally sound ProseMirror document.
 * It does NOT enforce a node/mark allowlist: the read-only renderer ignores or
 * drops unknown node types and marks, so one unknown node cannot blank an
 * entire article. The renderer is the security boundary; this is the integrity
 * boundary.
 */
export function validateRichTextDocument(value: unknown): ValidationResult<RichTextDocument> {
  if (!isRecord(value)) {
    return fail('invalid-type', 'Rich text body must be an object');
  }
  if (value.format !== 'tiptap-json-v1') {
    return fail('unsupported-format', 'Unsupported rich text format');
  }
  const budget: Budget = { nodes: 0, chars: 0 };
  const doc = validateNode(value.doc, 0, budget);
  if (!doc.ok) return doc;
  if (doc.value.type !== 'doc') {
    return fail('invalid-value', 'Rich text document root must be a doc node');
  }
  return ok({ format: 'tiptap-json-v1', doc: doc.value });
}
