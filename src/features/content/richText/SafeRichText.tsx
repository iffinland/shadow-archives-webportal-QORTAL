import { useCallback, useMemo, useRef, useState } from 'react';

import type { RichTextDocument } from '../../../domain';
import { copyText, type CopyMethod } from './clipboard';
import { renderTipTapDocument } from './renderTipTap';
import { sanitizeRenderedHtml } from './sanitizeHtml';

interface SafeRichTextProps {
  readonly doc: RichTextDocument;
  readonly className?: string;
}

interface Feedback {
  readonly state: 'idle' | 'copied' | 'manual' | 'failed';
  readonly message: string;
  readonly method?: CopyMethod;
  readonly url?: string;
}

/**
 * Visitor-side read rendering for stored rich text.
 *
 * Two independent gates: the allowlisting renderer emits only known markup with
 * escaped text and policy-checked URLs, then DOMPurify sanitizes the result.
 * Web2 links never navigate away: their clicks are intercepted and copied, with
 * the platform's own `preventDefault` on `http(s)` anchors as a second layer.
 */
export function SafeRichText({ doc, className }: SafeRichTextProps) {
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle', message: '' });
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => sanitizeRenderedHtml(renderTipTapDocument(doc.doc).html), [doc]);

  const handleClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) return;

    // Never navigate the Q-App away from Shadow Archives.
    event.preventDefault();
    const result = await copyText(href);
    if (result.ok) {
      setFeedback({
        state: 'copied',
        method: result.method,
        message:
          'Link copied to the clipboard. Shadow Archives never opens external links directly.',
        url: href,
      });
      return;
    }
    setFeedback({
      state: 'manual',
      method: 'manual',
      url: href,
      message:
        'Clipboard access is unavailable here. Select the URL below and copy it manually to open it in your browser.',
    });
  }, []);

  return (
    <div className="sa-rich-text__wrapper">
      <div
        ref={containerRef}
        className={['sa-rich-text', className].filter(Boolean).join(' ')}
        onClick={(event) => {
          void handleClick(event);
        }}
        // Sanitized by DOMPurify above; the renderer emits only allowlisted markup.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {feedback.state !== 'idle' ? (
        <div
          className={`sa-rich-text__feedback sa-rich-text__feedback--${feedback.state}`}
          role="status"
          aria-live="polite"
        >
          <p className="sa-rich-text__feedback-text">{feedback.message}</p>
          {feedback.state === 'manual' && feedback.url ? (
            <input
              className="sa-rich-text__url"
              type="text"
              readOnly
              value={feedback.url}
              aria-label="Link URL"
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
