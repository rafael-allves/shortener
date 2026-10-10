import { useEffect, useRef, useState } from 'react';
import { linksApi } from '../services/links';
import type { Link } from '../services/links';

export function LinkList({ filter, onView, onEdit }: { filter: string; onView(code: string): void; onEdit(code: string): void }) {
  const [items, setItems] = useState<Link[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(true);
  function loadNext() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPage(value => value + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    inFlight.current = true;
    setLoading(true); setError('');
    linksApi.list(page, filter, controller.signal).then(result => {
      setItems(previous => Array.from(new Map([...previous, ...result.data].map(link => [link.shortCode, link])).values()));
      setTotal(result.pagination.total);
      setHasMore(result.data.length > 0 && page < result.pagination.pages);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) { inFlight.current = false; setLoading(false); } });
    return () => controller.abort();
  }, [page, filter, retry]);
  useEffect(() => {
    if (loading || error || !hasMore || !sentinel.current) return;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !requested) {
        requested = true; loadNext();
      }
    }, { rootMargin: '240px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, error, hasMore, page]);
  return <section aria-label="Saved links" aria-busy={loading}>
    <div className="list-heading"><h2>Your collection <span>{total}</span></h2><p>Newest first</p></div>
    <div className="link-list">{items.map(link => <article className="link-card" key={link.shortCode}>
      <div className="link-symbol" aria-hidden="true">↗</div>
      <div className="link-info"><button className="code-button" onClick={() => onView(link.shortCode)}>{link.shortCode}</button>
        <a className="destination" href={link.originalUrl} target="_blank" rel="noopener noreferrer">{link.originalUrl}</a>
        <span className="date">Created {new Date(link.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
      <button className="secondary edit-button" onClick={() => onEdit(link.shortCode)} aria-label={`Edit ${link.shortCode}`}>Edit <span aria-hidden="true">↗</span></button>
    </article>)}</div>
    {!loading && !error && items.length === 0 && <div className="empty-state"><span aria-hidden="true">↗</span><h3>{filter ? 'No matching link' : 'Make your first connection'}</h3><p>{filter ? 'Try a different short code.' : 'Create a link to start your collection.'}</p></div>}
    <div className="list-status" ref={sentinel}>
      {loading && <p role="status"><span className="spinner" /> Loading {page === 1 ? 'links' : 'more links'}…</p>}
      {error && <div><p role="alert" className="error">{error}</p><button className="secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {!loading && !error && hasMore && <button className="secondary" onClick={loadNext}>Load more</button>}
      {!loading && !error && !hasMore && items.length > 0 && <p>You’re all caught up.</p>}
    </div>
  </section>;
}
