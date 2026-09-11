/**
 * Tiny bounded-concurrency helper.
 *
 * Phase 2A issues multiple partition/entity reads; an unbounded `Promise.all`
 * over an arbitrary result set is forbidden, and pulling in a dependency for a
 * few lines of pooling is not justified.
 */
export type BoundedResult<R> =
  { readonly ok: true; readonly value: R } | { readonly ok: false; readonly error: unknown };

export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<BoundedResult<R>[]> {
  const results: BoundedResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function drain(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index] as T, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => drain());
  await Promise.all(workers);
  return results;
}
