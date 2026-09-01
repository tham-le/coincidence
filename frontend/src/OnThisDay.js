import React, { useState, useEffect } from 'react';
import { api, catColor, formatYear, lifespanLabel } from './lib';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const todayMD = () => {
  const d = new Date();
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const Person = ({ p, onPick, showDeath }) => (
  <button className="otd-person" onClick={() => onPick?.(p)}>
    {p.thumbnailUrl
      ? <img src={p.thumbnailUrl} alt="" />
      : <span className="otd-dot" style={{ background: catColor(p.category) }} />}
    <span className="otd-person-text">
      <strong>{p.name}</strong>
      <em>
        {showDeath ? formatYear(p.end_year) : formatYear(p.start_year)}
        {p.region ? ` · ${p.region}` : ''}
      </em>
    </span>
  </button>
);

// One calendar date, across all of history.
//
// Only dates flagged reliable get here. Before about 1500 an "exact" birthday
// is usually a tradition, and a page that states Plato's birthday as fact would
// deserve to be laughed at.
export const OnThisDay = ({ onPick }) => {
  const [md, setMd] = useState(todayMD);
  const [data, setData] = useState(null);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api('/same-day', { md })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [md]);

  useEffect(() => {
    api('/shared-birthday').then(r => setShared(r || [])).catch(() => setShared([]));
  }, []);

  const [mm, dd] = md.split('-');

  const setPart = (month, day) => {
    const maxDay = new Date(2024, Number(month), 0).getDate();
    const safeDay = Math.min(Number(day), maxDay);
    setMd(`${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`);
  };

  return (
    <div className="otd-view">
      <div className="otd-head">
        <span className="otd-lead">On</span>
        <select value={Number(dd)} onChange={e => setPart(mm, e.target.value)} className="otd-select">
          {Array.from({ length: new Date(2024, Number(mm), 0).getDate() }, (_, i) => i + 1)
            .map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={Number(mm)} onChange={e => setPart(e.target.value, dd)} className="otd-select wide">
          {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <button className="otd-today" onClick={() => setMd(todayMD())}>Today</button>
      </div>

      {loading && <p className="shell-status">Looking...</p>}

      {data && !loading && (
        <>
          {(data.collisions || []).length > 0 && (
            <div className="otd-collisions">
              {(data.collisions || []).map(c => (
                <div className="otd-collision" key={c.born.id + c.died.id}>
                  <p className="otd-collision-line">{c.sentence}</p>
                  <span className="otd-collision-date">{c.date}</span>
                </div>
              ))}
            </div>
          )}

          <div className="otd-columns">
            <section>
              <h3>Born on {data.label}</h3>
              {(data.born || []).length === 0
                ? <p className="otd-empty">Nothing recorded with a date we trust.</p>
                : data.born.map(p => <Person key={p.id} p={p} onPick={onPick} />)}
            </section>
            <section>
              <h3>Died on {data.label}</h3>
              {(data.died || []).length === 0
                ? <p className="otd-empty">Nothing recorded with a date we trust.</p>
                : data.died.map(p => <Person key={p.id} p={p} onPick={onPick} showDeath />)}
            </section>
          </div>

          {shared.length > 0 && (
            <section className="otd-shared">
              <h3>Same birthday, centuries apart</h3>
              <ul>
                {shared.slice(0, 10).map(s => (
                  <li key={s.a.id + s.b.id}>
                    <span className="otd-shared-day">{s.label}</span>
                    <strong>{s.a.name}</strong> <em>{formatYear(s.a.year)}</em>
                    <span className="otd-amp">and</span>
                    <strong>{s.b.name}</strong> <em>{formatYear(s.b.year)}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="otd-caveat">
            Only dates recorded from 1500 onward are used here. Earlier ones often carry an exact
            day in the source data that no historian accepts, so they are shown as approximate
            elsewhere on the site and left out of this page.
          </p>
        </>
      )}
    </div>
  );
};

// "They never met", the other half of a coincidence. Shown under the daily
// card, since someone reading about two lives that touched is the right person
// to show two that almost did.
export const NearMisses = ({ onOpenPair }) => {
  const [misses, setMisses] = useState([]);

  useEffect(() => {
    api('/near-miss', { within: 6 }).then(r => setMisses(r || [])).catch(() => setMisses([]));
  }, []);

  if (misses.length === 0) return null;

  return (
    <section className="nearmiss">
      <h3>They never met</h3>
      <p className="nearmiss-sub">One life ended just before the other began.</p>
      <ul>
        {misses.slice(0, 8).map(m => (
          <li key={m.a.id + m.b.id}>
            <button onClick={() => onOpenPair?.(m.a.id, m.b.id)}>
              <span className="nearmiss-line">{m.headline}</span>
              <span className="nearmiss-meta">
                {m.distance_km.toLocaleString()} km apart
                {m.a.region && m.b.region && m.a.region !== m.b.region
                  ? ` · ${m.a.region} and ${m.b.region}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
