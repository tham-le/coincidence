import React, { useState, useEffect } from 'react';
import { api, formatYear } from './lib';

// Does the whole world revolt at once?
//
// Each bar is one period. A period is marked as a wave when it holds well
// above the average number of events for its kind and those events are spread
// across at least three regions, so one busy country cannot invent one.
export const Waves = ({ onYearPick }) => {
  const [kind, setKind] = useState('Revolutions');
  const [kinds, setKinds] = useState([]);
  const [data, setData] = useState(null);
  const [range, setRange] = useState({ from: 1500, to: 2000, bucket: 20 });

  useEffect(() => { api('/wave-kinds').then(setKinds).catch(() => setKinds([])); }, []);

  useEffect(() => {
    api('/waves', { kind, ...range }).then(setData).catch(() => setData(null));
  }, [kind, range]);

  const max = data?.buckets?.reduce((m, b) => Math.max(m, b.count), 1) || 1;

  // Climate markers land on whichever bucket contains them. A period like the
  // Little Ice Age marks every bucket it covers instead.
  const climateFor = (b) => {
    const marks = data?.climate || [];
    return {
      points: marks.filter(m => m.kind !== 'period' && m.year >= b.start && m.year <= b.end),
      inPeriod: marks.some(m => m.kind === 'period' && m.year <= b.end && (m.end || m.year) >= b.start),
    };
  };

  return (
    <div className="waves-view">
      <div className="waves-head">
        <div className="waves-kinds">
          {kinds.map(k => (
            <button
              key={k.name}
              className={`waves-kind${kind === k.name ? ' active' : ''}`}
              onClick={() => setKind(k.name)}
            >
              {k.name} <span className="waves-kind-count">{k.count}</span>
            </button>
          ))}
        </div>
        <div className="waves-range">
          {[[-500, 2000, 100], [1000, 2000, 50], [1500, 2000, 20], [1700, 2000, 10]].map(([f, t, b]) => (
            <button
              key={`${f}-${b}`}
              className={`waves-range-btn${range.from === f && range.bucket === b ? ' active' : ''}`}
              onClick={() => setRange({ from: f, to: t, bucket: b })}
            >
              {formatYear(f)} on, {b}y
            </button>
          ))}
        </div>
      </div>

      {data?.buckets?.length > 0 && (
        <>
          <p className="waves-legend">
            Average {data.mean} per {data.bucket_size} years. A period is called a wave when it is
            more than one standard deviation ({data.stddev}) above that and spans three or more regions.
          </p>
          <div className="waves-chart">
            {data.buckets.map(b => {
              const climate = climateFor(b);
              return (
                <div
                  className={`wave-row${b.is_wave ? ' is-wave' : ''}${climate.inPeriod ? ' in-cold-period' : ''}`}
                  key={b.start}
                >
                  <button className="wave-year" onClick={() => onYearPick?.(b.start + Math.floor(data.bucket_size / 2))}>
                    {formatYear(b.start)}
                  </button>
                  <div className="wave-bar-track">
                    <div className="wave-bar" style={{ width: `${(b.count / max) * 100}%` }} />
                    <span className="wave-count">{b.count}</span>
                    <span className="wave-regions">{b.regions} region{b.regions === 1 ? '' : 's'}</span>
                    {climate.points.map(m => (
                      <span className="wave-climate" key={m.label} title={m.note || m.label}>
                        {m.label} {m.year}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {data.buckets.filter(b => b.is_wave).map(b => (
            <div className="wave-detail" key={`d${b.start}`}>
              <h4>{formatYear(b.start)} to {formatYear(b.end)}</h4>
              <p>{b.examples?.map(e => e.name).join(' · ')}</p>
            </div>
          ))}

          {(data.climate || []).length > 0 && (
            <div className="waves-climate-key">
              <h4>Cold years and revolt</h4>
              <p>
                Marked years are large sulfur-rich eruptions, the kind that cool summers and
                ruin harvests. Shaded rows fall inside the Little Ice Age. Laki in 1783 wrecked
                European harvests before 1789, and 1816, the year after Tambora, had no summer
                and brought bread riots.
              </p>
              <p className="waves-climate-warning">
                This is a juxtaposition, not a finding. Ten eruptions is far too few to measure
                anything, and the largest of them, Tambora, is followed by no recorded revolution
                at all in this data. Read it as a question worth asking, not an answer.
              </p>
            </div>
          )}

          <p className="waves-caveat">
            Read the recent end with care. The database still holds far more entries after 1900
            than before it, so a tall recent bar partly measures how much was recorded, not only
            how much happened.
          </p>
        </>
      )}
    </div>
  );
};
