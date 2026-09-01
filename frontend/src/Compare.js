import React, { useState, useEffect, useRef } from 'react';
import { api, catColor, lifespanLabel } from './lib';
import { PairCard } from './PairCard';

// A search box that resolves to one person. Searching hits the alias table, so
// a reign name, a birth name, or a Vietnamese spelling all find the same row.
export const PersonPicker = ({ label, value, onPick, autoFocus }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api('/search-name', { q: query.trim() })
        .then(r => { if (!cancelled) { setResults(r); setOpen(true); } })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  return (
    <div className="picker" ref={boxRef}>
      <label className="picker-label">{label}</label>
      {value ? (
        <div className="picker-chosen">
          {value.thumbnailUrl
            ? <img src={value.thumbnailUrl} alt="" style={{ borderColor: catColor(value.category) }} />
            : <div className="picker-thumb-blank" style={{ borderColor: catColor(value.category) }} />}
          <div className="picker-chosen-text">
            <strong>{value.name}</strong>
            <span>{lifespanLabel(value)}</span>
          </div>
          <button className="picker-clear" onClick={() => { onPick(null); setQuery(''); }}>&#x2715;</button>
        </div>
      ) : (
        <input
          className="picker-input"
          placeholder="Type a name"
          value={query}
          autoFocus={autoFocus}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      )}
      {open && !value && results.length > 0 && (
        <ul className="picker-results">
          {results.map(r => (
            <li key={r.id}>
              <button onClick={() => { onPick(r); setOpen(false); setQuery(''); }}>
                {r.thumbnailUrl
                  ? <img src={r.thumbnailUrl} alt="" />
                  : <span className="picker-thumb-blank small" style={{ borderColor: catColor(r.category) }} />}
                <span className="picker-result-name">{r.name}</span>
                <span className="picker-result-meta">{lifespanLabel(r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Pick any two people and see whether their lives touched.
export const Compare = ({ initialA, initialB, onPairChange }) => {
  const [a, setA] = useState(initialA || null);
  const [b, setB] = useState(initialB || null);
  const [pair, setPair] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!a || !b) { setPair(null); return; }
    if (a.id === b.id) { setError('Pick two different people.'); setPair(null); return; }
    setError(null);
    api('/pair', { a: a.id, b: b.id })
      .then(p => { setPair(p); onPairChange?.(a.id, b.id); })
      .catch(() => setError('Could not compare those two.'));
  }, [a, b, onPairChange]);

  return (
    <div className="compare-view">
      <div className="compare-pickers">
        <PersonPicker label="Someone" value={a} onPick={setA} autoFocus />
        <span className="compare-and">and</span>
        <PersonPicker label="Someone else" value={b} onPick={setB} />
      </div>

      {error && <p className="compare-error">{error}</p>}

      {!a || !b ? (
        <p className="compare-hint">
          Pick two people to see whether they shared any years, how far apart they were,
          and how old each was when the other was born.
        </p>
      ) : pair ? (
        <PairCard pair={pair} />
      ) : (
        <p className="compare-hint">Working...</p>
      )}
    </div>
  );
};
