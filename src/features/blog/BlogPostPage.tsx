import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useCapability } from '../../app/providers/CapabilityProvider';
import { Button } from '../../components/common';
import { RouteLoading } from '../../components/feedback';
import { EntityStatePanel, TaxonomyChips, formatDate, useEntityDetail } from '../content';
import { EntityEngagementControls } from '../engagement';
import { SafeRichText } from '../content/richText/SafeRichText';

const BlogEditModal = lazy(async () => ({
  default: (await import('./owner/BlogPublishModal')).BlogPublishModal,
}));

/**
 * Blog detail: the authoritative entity resource is fetched here, validated, and
 * rendered through the read-only allowlisting renderer + DOMPurify boundary.
 */
export default function BlogPostPage() {
  const { id } = useParams<{ id: string }>();
  const { isOwner } = useCapability();
  const [editing, setEditing] = useState(false);
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
            {isOwner ? (
              <div className="sa-route__actions">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit post
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="sa-route__lead">
            A single archived post, resolved from its stable reference.
          </p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading post" /> : null}
      {status === 'ready' && post ? <SafeRichText doc={post.data.body} /> : null}
      {status === 'ready' && post ? <EntityEngagementControls entity={post} /> : null}
      {status !== 'loading' && status !== 'ready' ? (
        <EntityStatePanel
          status={status}
          subject="Blog post"
          message={error?.message ?? undefined}
          onRetry={reload}
        />
      ) : null}
      {editing && post && isOwner ? (
        <Suspense fallback={null}>
          <BlogEditModal
            onClose={() => setEditing(false)}
            initialDraft={{
              id: post.id,
              title: post.data.title,
              excerpt: post.data.excerpt,
              body: post.data.body,
              categories: post.data.categories,
              tags: post.data.tags,
              language: post.data.language,
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
