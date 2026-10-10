import { useState } from 'react';
import { LinkList } from './components/LinkList';
import { LinkModal } from './components/LinkModal';
import './styles.css';

type ModalState = { mode: 'create' | 'edit' | 'view'; code?: string };
export default function App() {
  const [modal, setModal] = useState<ModalState>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  return <div className="app-shell">
    <nav className="topbar"><a href="/" className="brand"><span className="brand-icon">↗</span> littlelink<span className="brand-dot">.</span></a><span className="nav-note">Less length. More possibility.</span></nav>
    <main>
      <header className="hero"><div><span className="eyebrow">YOUR LINKS, SIMPLIFIED</span><h1>Small links.<br /><span>Big connections.</span></h1><p>A home for everything you want to share.<br />Create, find, and fine-tune your links in one place.</p></div>
        <div className="hero-side"><div className="orbit" aria-hidden="true"><span>↗</span><i>link / share / connect</i></div><button className="primary" onClick={() => { setNotice(''); setModal({ mode: 'create' }); }}><span aria-hidden="true">＋</span> Create a link</button></div>
      </header>
      <div className="collection-toolbar"><form className="search" onSubmit={event => { event.preventDefault(); setFilter(search.trim()); }}><span aria-hidden="true">⌕</span><input aria-label="Filter by exact short code" placeholder="Find a link by its short code" value={search} onChange={event => setSearch(event.target.value)} /><button type="submit">Search</button></form>
        {filter && <button className="clear-filter" onClick={() => { setSearch(''); setFilter(''); }}>Clear filter ×</button>}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <LinkList key={`${filter}:${revision}`} filter={filter} onView={code => setModal({ mode: 'view', code })} onEdit={code => setModal({ mode: 'edit', code })} />
    </main>
    <footer className="page-footer"><span>littlelink.</span><span>Made for the things worth sharing.</span></footer>
    {modal && <LinkModal key={`${modal.mode}:${modal.code ?? ''}`} code={modal.code} readOnly={modal.mode === 'view'} onClose={() => setModal(undefined)} onSaved={link => {
      setNotice(`${modal.mode === 'edit' ? 'Updated' : 'Saved'} ${link.shortCode}.`);
      setModal(undefined); setRevision(value => value + 1);
    }} />}
  </div>;
}
