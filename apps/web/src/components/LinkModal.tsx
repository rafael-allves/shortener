import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from './Modal';
import { linksApi } from '../services/links';
import type { Link } from '../services/links';

export function LinkModal({ code, readOnly = false, onClose, onSaved }: {
  code?: string; readOnly?: boolean; onClose(): void; onSaved(link: Link): void;
}) {
  const [url, setUrl] = useState('');
  const [shortCode, setShortCode] = useState(code ?? '');
  const [link, setLink] = useState<Link>();
  const [loading, setLoading] = useState(Boolean(code));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const requestIdentity = useRef({ body: '', key: '' });
  const pending = useRef(false);
  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    linksApi.get(code, controller.signal).then(data => {
      setUrl(data.originalUrl); setLink(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [code, retry]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      const body = JSON.stringify([url, shortCode]);
      if (requestIdentity.current.body !== body) requestIdentity.current = { body, key: crypto.randomUUID() };
      const result = code ? await linksApi.update(code, url) : await linksApi.create(url, shortCode, requestIdentity.current.key);
      onSaved(result);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this link.'); }
    finally { pending.current = false; setSaving(false); }
  }
  return <Modal title={readOnly ? 'Link details' : code ? 'Edit destination' : 'Create a link'} onClose={onClose} busy={saving}>
    {loading ? <p role="status" className="modal-body">Loading link…</p> : code && !link ? <div className="modal-body"><p role="alert" className="error">{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> :
      <form onSubmit={submit} className="link-form">
        <p className="muted">{readOnly ? 'Your link and its current destination.' : code ? 'Keep your code. Change where it leads.' : 'A smaller link for your next big idea.'}</p>
        <label htmlFor="destination">Destination URL</label>
        <input id="destination" autoFocus type="url" placeholder="https://example.com/something-great" required maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} readOnly={readOnly} disabled={saving} />
        <label htmlFor="short-code">{code ? 'Short code' : 'Custom short code'} {!code && <span className="muted">(optional)</span>}</label>
        <input id="short-code" placeholder="MyNextIdea" value={shortCode} onChange={event => setShortCode(event.target.value)} readOnly={Boolean(code) || readOnly} disabled={saving} maxLength={64} pattern="[a-zA-Z0-9]{1,64}" />
        {!code && <small className="muted">Letters and numbers only. Leave empty to generate a code.</small>}
        {readOnly && link && <p className="muted">Created {new Date(link.createdAt).toLocaleString()}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={saving}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : code ? 'Save changes' : 'Create link'}</button>}
        </footer>
      </form>}
  </Modal>;
}
