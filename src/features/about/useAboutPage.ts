import { useCallback, useEffect, useRef, useState } from 'react';

import { useContent } from '../../app/providers/ContentProvider';
import {
  loadAboutPage,
  type AboutPageResult,
  type AboutPageStatus,
} from '../../services/aboutRepository';
import type { AboutPageDocument } from '../../domain/aboutPage';
import type { ContentError } from '../../services/errors';

export interface AboutPageState {
  readonly status: AboutPageStatus | 'loading';
  readonly document: AboutPageDocument | null;
  readonly error: ContentError | null;
  readonly reload: () => void;
}

interface AboutRecord {
  readonly key: string;
  readonly result: AboutPageResult;
}

/**
 * Read the singleton About document for the current publisher scope.
 *
 * Mirrors the entity-detail hook: the read is keyed by scope + nonce, a late
 * answer from a superseded scope is ignored, and no request is issued when the
 * runtime has no publisher scope.
 */
export function useAboutPage(): AboutPageState {
  const { scope, reader } = useContent();
  const [nonce, setNonce] = useState(0);
  const requestKey = `${scope.scoped ? scope.name : scope.reason}:${nonce}`;

  const [record, setRecord] = useState<AboutRecord | null>(null);
  const current = record && record.key === requestKey ? record.result : null;
  const loadIdRef = useRef(0);

  useEffect(() => {
    const id = loadIdRef.current + 1;
    loadIdRef.current = id;
    void loadAboutPage(scope, { reader }).then((result) => {
      if (id !== loadIdRef.current) return;
      setRecord({ key: requestKey, result });
    });
    return () => {
      loadIdRef.current += 1;
    };
  }, [scope, reader, requestKey]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  if (!current) {
    return { status: 'loading', document: null, error: null, reload };
  }
  return { status: current.status, document: current.document, error: current.error, reload };
}
