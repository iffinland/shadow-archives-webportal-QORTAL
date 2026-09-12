import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible, framework-free dialog for the owner publishing flows.
 *
 * It is intentionally NOT exported from `components/common`: this module ships
 * only inside the lazy owner boundary, so visitors never download it.
 *
 * Behaviour:
 * - `role="dialog"` with `aria-modal` and a labelled heading;
 * - focus moves into the dialog and is restored on close;
 * - Tab/Shift+Tab are trapped inside the dialog;
 * - background scroll is locked, and the overlay blocks background pointer
 *   interaction;
 * - Escape requests close only while `canClose` (a critical submission keeps the
 *   dialog open and explains why).
 */
export interface ModalProps {
  readonly title: string;
  readonly description?: string;
  readonly onRequestClose: () => void;
  /** False while a critical (in-flight write) state must not be dismissed. */
  readonly canClose?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly wide?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  title,
  description,
  onRequestClose,
  canClose = true,
  initialFocusRef,
  children,
  footer,
  wide = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Kept in refs so the mount effect never re-runs (which would steal focus back
  // to the first field on every state change during a submission).
  const canCloseRef = useRef(canClose);
  const closeRef = useRef(onRequestClose);

  useEffect(() => {
    canCloseRef.current = canClose;
    closeRef.current = onRequestClose;
  }, [canClose, onRequestClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null || element === dialog,
      );

    const target = initialFocusRef?.current ?? focusables()[0] ?? dialog;
    target.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (canCloseRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [initialFocusRef]);

  const titleId = 'sa-modal-title';
  const descriptionId = 'sa-modal-description';

  const content = (
    <div
      className="sa-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && canClose) onRequestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`sa-modal${wide ? ' sa-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="sa-modal__header">
          <h2 className="sa-modal__title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="sa-modal__description" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <div className="sa-modal__body">{children}</div>
        {footer ? <footer className="sa-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
