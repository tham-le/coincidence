import React from 'react';
import { catColor, formatYear, formatDate, lifespanLabel, effectiveEnd, ageInYear } from './lib';

// Two lifespans drawn on one shared axis, with the years they share filled in.
//
// A map shows where. Nothing in the old interface showed when, and a map
// cannot: two dots and a line look the same whether the pair overlapped for
// fifty years or for ten weeks. This is the piece that carries the whole idea.
export const LifespanBars = ({ a, b, overlapStart, overlapEnd, overlaps }) => {
  const aEnd = effectiveEnd(a);
  const bEnd = effectiveEnd(b);
  const min = Math.min(a.start_year, b.start_year);
  const max = Math.max(aEnd, bEnd);
  const span = Math.max(1, max - min);
  // A little air on each side so a bar never touches the edge of the track.
  const pad = span * 0.04;
  const scale = y => ((y - min + pad) / (span + pad * 2)) * 100;

  const row = (p, end) => {
    const left = scale(p.start_year);
    const width = Math.max(0.8, scale(end) - left);
    const estimated = p.end_year === null || p.end_year === undefined;
    return (
      <div className="lifespan-row" key={p.id}>
        <div className="lifespan-label">
          <span className="lifespan-name">{p.name}</span>
          <span className="lifespan-years">{lifespanLabel(p)}</span>
        </div>
        <div className="lifespan-track">
          <div
            className={`lifespan-bar${estimated ? ' estimated' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, '--bar-color': catColor(p.category) }}
            title={lifespanLabel(p)}
          />
          {overlaps && (
            <div
              className="lifespan-overlap"
              style={{
                left: `${scale(overlapStart)}%`,
                width: `${Math.max(0.6, scale(overlapEnd) - scale(overlapStart))}%`,
              }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="lifespan-chart">
      {row(a, aEnd)}
      {row(b, bEnd)}
      <div className="lifespan-axis">
        <span>{formatYear(Math.round(min))}</span>
        {overlaps && (
          <span className="lifespan-axis-mid">
            shared {formatYear(overlapStart)}
            {overlapEnd !== overlapStart ? ` to ${formatYear(overlapEnd)}` : ''}
          </span>
        )}
        <span>{formatYear(Math.round(max))}</span>
      </div>
    </div>
  );
};

const Portrait = ({ p }) => (
  p.thumbnailUrl
    ? <img src={p.thumbnailUrl} alt="" className="pair-portrait" style={{ borderColor: catColor(p.category) }} />
    : <div className="pair-portrait blank" style={{ borderColor: catColor(p.category) }}>
        {p.name.slice(0, 1)}
      </div>
);

// The line that turns two dates into a moment someone can picture.
const AgeLine = ({ pair }) => {
  const { a, b } = pair;
  const younger = b.start_year > a.start_year ? b : a;
  const older = younger === a ? b : a;
  const age = ageInYear(older, younger.start_year);
  if (age === null || age < 1) return null;

  const born = formatDate(younger.start_date);
  const died = formatDate(older.end_date);

  return (
    <p className="pair-age-line">
      When {younger.name} was born{born ? `, on ${born},` : ','}{' '}
      {older.name} was {age}.
      {died && pair.overlap_days !== undefined && pair.overlap_days < 400 &&
        ` They had ${pair.overlap_days} days together: ${older.name} died on ${died}.`}
    </p>
  );
};

export const PairCard = ({ pair, onNext, onOpenPerson, busy }) => {
  if (!pair) return null;
  const { a, b } = pair;

  return (
    <div className="pair-card">
      <p className="pair-headline">{pair.headline}</p>

      <div className="pair-people">
        <button className="pair-person" onClick={() => onOpenPerson?.(a)}>
          <Portrait p={a} />
          <span className="pair-person-name">{a.name}</span>
          <span className="pair-person-meta">{lifespanLabel(a)}</span>
          {a.region && <span className="pair-person-region">{a.region}</span>}
        </button>

        <div className="pair-join">
          <span className="pair-join-line" />
          <span className="pair-join-dist">{pair.distance_km.toLocaleString()} km</span>
          <span className="pair-join-line" />
        </div>

        <button className="pair-person" onClick={() => onOpenPerson?.(b)}>
          <Portrait p={b} />
          <span className="pair-person-name">{b.name}</span>
          <span className="pair-person-meta">{lifespanLabel(b)}</span>
          {b.region && <span className="pair-person-region">{b.region}</span>}
        </button>
      </div>

      <LifespanBars
        a={a}
        b={b}
        overlapStart={pair.overlap_start}
        overlapEnd={pair.overlap_end}
        overlaps={pair.overlaps}
      />

      <AgeLine pair={pair} />

      <div className="pair-chips">
        {pair.chips?.map(c => (
          <span key={c.kind + c.label} className={`pair-chip chip-${c.kind}`}>{c.label}</span>
        ))}
      </div>

      {onNext && (
        <button className="pair-next" onClick={onNext} disabled={busy}>
          {busy ? 'Looking...' : 'Show me another'}
        </button>
      )}
    </div>
  );
};
