import { useParams } from 'react-router-dom';

import { RouteLoading } from '../../components/feedback';
import { EntityStatePanel, TaxonomyChips, formatDate, useEntityDetail } from '../content';
import { SafeRichText } from '../content/richText/SafeRichText';

/**
 * Blog detail: the authoritative entity resource is fetched here, validated, and
 * rendered through the read-only allowlisting renderer + DOMPurify boundary.
 */
export default function BlogPostPage() {
  const { id } = useParams<{ id: string }>();
  const { status, entity, error, reload } = useEntityDetail('blog-post', id ?? '');
  const post = entity && entity.kind === 'blog-post' ? entity : null;

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{post ? post.data.title : 'Blog post'}</h1>
        {post ? (
          <>
            <p className="sa-detail__meta">
              {formatDate(post.updatedAt) ?? 'Undated'}
              {post.data.excerpt ? ` — ${post.data.excerpt}` : ''}
            </p>
            <TaxonomyChips categories={post.data.categories} tags={post.data.tags} />
          </>
        ) : (
          <p className="sa-route__lead">
            A single archived post, resolved from its stable reference.
          </p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading post" /> : null}
      {status === 'ready' && post ? <SafeRichText doc={post.data.body} /> : null}
      {status !== 'loading' && status !== 'ready' ? (
        <EntityStatePanel
          status={status}
          subject="Blog post"
          message={error?.message ?? undefined}
          onRetry={reload}
        />
      ) : null}
    </div>
  );
}
