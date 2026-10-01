import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import type { RichTextDocument, RichTextNode } from '../../../domain/types';

/**
 * Owner article editor (owner decision D3: TipTap), lazy-loaded.
 *
 * The canonical stored representation is `tiptap-json-v1` (owner decision D4), so
 * this component only ever emits `editor.getJSON()` inside that envelope; the
 * normalized `bodyText` and the derived interoperability Markdown are produced by
 * `domain/richTextMarkdown.ts` from the same document, never from editor HTML.
 *
 * Scope: prose only. A body-image model would require separate QDN media
 * resources, so no image node is registered — a pasted image is dropped by the
 * schema instead of being silently embedded as a data URL (which would break the
 * entity payload cap and the derived artifact).
 */

/** Link schemes the editor accepts; mirrors the renderer/derivation allowlist. */
const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'qortal', 'mailto'];

export interface BlogEditorProps {
  /** Optional starting document (draft restore). */
  readonly initialDoc?: RichTextNode | null;
  readonly onChange: (doc: RichTextDocument) => void;
  readonly disabled?: boolean;
}

interface ToolbarButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}

function ToolbarButton({ label, active, disabled, onSelect, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`sa-editor__button${active ? ' sa-editor__button--active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/** The href of the link at the current selection, or an empty string. */
function linkHrefOf(editor: Editor): string {
  const attributes = editor.getAttributes('link') as { href?: unknown };
  return typeof attributes.href === 'string' ? attributes.href : '';
}

function LinkControls({
  editor,
  disabled,
}: {
  readonly editor: Editor;
  readonly disabled?: boolean;
}) {
  const [href, setHref] = useState(() => linkHrefOf(editor));
  const active = editor.isActive('link');

  // The field mirrors the link under the cursor. It is synced from the editor's
  // own selection/transaction events (an external system) rather than by
  // deriving state during an effect, so moving in and out of a link updates it.
  useEffect(() => {
    const sync = () => setHref(linkHrefOf(editor));
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);

  const apply = () => {
    const value = href.trim();
    if (value.length === 0) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (!ALLOWED_LINK_PROTOCOLS.includes(parsed.protocol.replace(':', ''))) return;
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: value, rel: 'noopener noreferrer nofollow', target: '_blank' })
      .run();
  };

  return (
    <span className="sa-editor__link">
      <input
        className="sa-input sa-input--compact"
        type="url"
        inputMode="url"
        placeholder="https://… or qortal://…"
        aria-label="Link address"
        value={href}
        disabled={disabled}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
      <button
        type="button"
        className="sa-button sa-button--secondary sa-button--sm"
        onClick={apply}
        disabled={disabled}
      >
        {active ? 'Update link' : 'Add link'}
      </button>
    </span>
  );
}

export function BlogEditor({ initialDoc, onChange, disabled }: BlogEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ALLOWED_LINK_PROTOCOLS,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
    ],
    content: (initialDoc as object | null | undefined) ?? undefined,
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current({
        format: 'tiptap-json-v1',
        doc: instance.getJSON() as RichTextNode,
      });
    },
    editorProps: {
      attributes: {
        class: 'sa-editor__surface',
        'aria-label': 'Article body',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  const chain = () => editor.chain().focus();

  return (
    <div className="sa-editor" aria-busy={disabled ? 'true' : undefined}>
      <div className="sa-editor__toolbar" role="toolbar" aria-label="Text formatting">
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          disabled={disabled}
          onSelect={() => chain().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          disabled={disabled}
          onSelect={() => chain().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive('underline')}
          disabled={disabled}
          onSelect={() => chain().toggleUnderline().run()}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive('strike')}
          disabled={disabled}
          onSelect={() => chain().toggleStrike().run()}
        >
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </ToolbarButton>
        <ToolbarButton
          label="Inline code"
          active={editor.isActive('code')}
          disabled={disabled}
          onSelect={() => chain().toggleCode().run()}
        >
          {'<>'}
        </ToolbarButton>
        <ToolbarButton
          label="Heading level 2"
          active={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          onSelect={() => chain().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          label="Heading level 3"
          active={editor.isActive('heading', { level: 3 })}
          disabled={disabled}
          onSelect={() => chain().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          disabled={disabled}
          onSelect={() => chain().toggleBulletList().run()}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          disabled={disabled}
          onSelect={() => chain().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive('blockquote')}
          disabled={disabled}
          onSelect={() => chain().toggleBlockquote().run()}
        >
          ❝
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive('codeBlock')}
          disabled={disabled}
          onSelect={() => chain().toggleCodeBlock().run()}
        >
          {'{ }'}
        </ToolbarButton>
        <ToolbarButton
          label="Horizontal rule"
          active={false}
          disabled={disabled}
          onSelect={() => chain().setHorizontalRule().run()}
        >
          —
        </ToolbarButton>
        <ToolbarButton
          label="Undo"
          active={false}
          disabled={disabled || !editor.can().undo()}
          onSelect={() => chain().undo().run()}
        >
          ↺
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          active={false}
          disabled={disabled || !editor.can().redo()}
          onSelect={() => chain().redo().run()}
        >
          ↻
        </ToolbarButton>
        <LinkControls editor={editor} disabled={disabled} />
      </div>
      <EditorContent editor={editor} />
      <p className="sa-field__hint">
        Formatting is stored as the canonical <code>tiptap-json-v1</code> document. A derived
        Markdown version is published for SubWire compatibility, so headings, lists, quotes, links
        and inline formatting carry over. Body images are not published in this version — use the
        cover image.
      </p>
    </div>
  );
}
