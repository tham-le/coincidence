import React, { useState, useEffect } from 'react';
import { api, catColor, formatYear, lifespanLabel, ageInYear } from './lib';

// One year, the whole world, side by side.
//
// This is the founding example turned into a repeatable format: type 1789 and
// Paris and Thăng Long sit in neighbouring columns with nothing in between.
export const YearCard = ({ year, onYearChange, onPick }) => {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(String(year));
  const [loading, setLoading] = useState(false);

  useEffect(() => { setDraft(String(year)); }, [year]);

  useEffect(() => {
    setLoading(true);
    api('/year-card', { year, per_region: 6 })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year]);

  const submit = e => {
    e.preventDefault();
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n >= -4000 && n <= 2026) onYearChange(n);
  };

  return (
    <div className="year-card">
      <form className="year-card-head" onSubmit={submit}>
        <span className="year-card-lead">In the year</span>
        <input
          className="year-card-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          aria-label="Year"
        />
        <button className="year-card-go" type="submit">Go</button>
        <span className="year-card-hint">negative for BCE</span>
      </form>

      {loading && <p className="year-card-status">Looking...</p>}

      {data && !loading && (
        data.regions.length === 0
          ? <p className="year-card-status">Nothing recorded for {formatYear(year)} yet.</p>
          : (
            <div className="year-card-grid">
              {data.regions.map(g => (
                <section className="year-region" key={g.region}>
                  <h3>{g.region}</h3>
                  <ul className="year-people">
                    {g.people.map(p => (
                      <li key={p.id}>
                        <button className="year-person" onClick={() => onPick?.(p)}>
                          {p.thumbnailUrl
                            ? <img src={p.thumbnailUrl} alt="" />
                            : <span className="year-dot" style={{ background: catColor(p.category) }} />}
                          <span className="year-person-text">
                            <strong>{p.name}</strong>
                            <em>
                              {(() => {
                                const age = ageInYear(p, year);
                                return age === null ? lifespanLabel(p) : `age ${age}`;
                              })()}
                            </em>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {g.events.length > 0 && (
                    <ul className="year-events">
                      {g.events.map(e => (
                        <li key={e.id} style={{ '--cat-color': catColor(e.category) }}>{e.name}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )
      )}
    </div>
  );
};
