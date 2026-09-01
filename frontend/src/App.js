import React, { useState, useEffect } from 'react';
import './App.css';


const CATEGORY_COLORS = {
  Leaders:      '#e05252',
  Scientists:   '#4a90e2',
  Artists:      '#b07fd8',
  Thinkers:     '#27ae80',
  Military:     '#e67e22',
  Explorers:    '#16a085',
  Wars:         '#c0392b',
  Battles:      '#e74c3c',
  Revolutions:  '#e67e22',
};
const DEFAULT_DOT_COLOR = '#d4a017';

const REGIONS = {
  'Southeast Asia': { latMin: -10, latMax: 28,  lonMin: 92,   lonMax: 141 },
  'East Asia':      { latMin: 20,  latMax: 55,  lonMin: 100,  lonMax: 145 },
  'South Asia':     { latMin: 5,   latMax: 37,  lonMin: 60,   lonMax: 100 },
  'Middle East':    { latMin: 12,  latMax: 42,  lonMin: 25,   lonMax: 65  },
  'Europe':         { latMin: 35,  latMax: 72,  lonMin: -25,  lonMax: 45  },
  'Africa':         { latMin: -35, latMax: 37,  lonMin: -20,  lonMax: 52  },
  'Americas':       { latMin: -55, latMax: 72,  lonMin: -170, lonMax: -30 },
};

const isInRegion = (p, region) =>
  p.latitude >= region.latMin && p.latitude <= region.latMax &&
  p.longitude >= region.lonMin && p.longitude <= region.lonMax;

const MIN_COINCIDENCE_DIST = 15;

const formatYear = y => y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`;

// A null death year now means "alive" or "unknown", not "2024". Every label
// that used to print a made-up year goes through this.
const lifespanText = p => {
  const from = formatYear(p.start_year);
  if (p.end_year === null || p.end_year === undefined) {
    return p.alive ? `${from} to today` : `${from}, death unknown`;
  }
  return `${from} to ${formatYear(p.end_year)}`;
};

const regionOfPoint = (p) => {
  if (!p.latitude || !p.longitude) return null;
  for (const [name, r] of Object.entries(REGIONS)) {
    if (p.latitude >= r.latMin && p.latitude <= r.latMax &&
        p.longitude >= r.lonMin && p.longitude <= r.lonMax) return name;
  }
  return null;
};

// Years both people were in their active phase (roughly age 20-60).
const activeOverlap = (a, b) => {
  const aEnd = a.end_year ?? a.start_year + 72;
  const bEnd = b.end_year ?? b.start_year + 72;
  const start = Math.max(a.start_year + 18, b.start_year + 18);
  const end   = Math.min(aEnd - 12,         bEnd - 12);
  return Math.max(0, end - start);
};

const geoDist = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const makeConnectionLabel = (a, b) => {
  if (a.type === 'event' || b.type === 'event') {
    const ev = a.type === 'event' ? a : b;
    return `During the ${ev.name}`;
  }
  const ca = a.category || '';
  const cb = b.category || '';
  const has = (...cats) => cats.some(c => ca === c || cb === c);
  const both = (c) => ca === c && cb === c;
  if (both('Leaders'))      return 'Rulers of different worlds';
  if (both('Scientists'))   return 'Parallel discoveries';
  if (both('Artists'))      return 'Two creators, worlds apart';
  if (both('Philosophers')) return 'Two great minds';
  if (has('Leaders') && has('Scientists'))      return 'Power and discovery';
  if (has('Leaders') && has('Artists'))         return 'Empire and art';
  if (has('Leaders') && has('Philosophers'))    return 'Sword and thought';
  if (has('Leaders') && has('Military'))        return 'Two commanders';
  if (has('Leaders') && has('Explorers'))       return 'Rulers and explorers';
  if (has('Scientists') && has('Philosophers')) return 'Knowledge across continents';
  if (has('Military') && has('Philosophers'))   return 'War and wisdom';
  if (has('Wars') || has('Battles') || has('Revolutions')) return 'War and the world';
  return 'Worlds apart, time shared';
};

const makeConnectionSentence = (a, b, overlapYears, overlapStart, overlapEnd) => {
  if (overlapYears <= 0) return null;
  if (a.type === 'event' || b.type === 'event') {
    const ev     = a.type === 'event' ? a : b;
    const person = a.type === 'event' ? b : a;
    const region = regionOfPoint(person);
    return `${person.name}${region ? `, in ${region},` : ''} was alive throughout ${ev.name}.`;
  }
  const regionA = regionOfPoint(a);
  const regionB = regionOfPoint(b);
  const placeA = regionA ? ` in ${regionA}` : '';
  const placeB = regionB ? ` in ${regionB}` : '';
  return (
    `For ${overlapYears} years (${formatYear(overlapStart)} to ${formatYear(overlapEnd)}), ` +
    `${a.name}${placeA} and ${b.name}${placeB} walked the same Earth. ` +
    `Did their paths ever cross?`
  );
};

// Score a pair for zone/global mode: distance x cross-domain x active overlap.
const scorePair = (a, b) => {
  const dist = geoDist(a, b);
  if (dist < MIN_COINCIDENCE_DIST) return 0;
  const overlap = activeOverlap(a, b);
  if (overlap < 2) return 0;
  const crossDomain = a.category !== b.category ? 1.5 : 1.0;
  return dist * crossDomain * Math.log(overlap + 2);
};

// Score an event+person pair: simple temporal overlap, not active-phase.
const scoreEventPair = (event, person) => {
  const dist = geoDist(event, person);
  if (dist < MIN_COINCIDENCE_DIST) return 0;
  const eventEnd  = event.end_year  || event.start_year  + 10;
  const personEnd = person.end_year || 2024;
  const overlap = Math.max(0, Math.min(eventEnd, personEnd) - Math.max(event.start_year, person.start_year));
  if (overlap < 1) return 0;
  const personFame = Math.pow(person.importance_score || 1, 0.6);
  const eventFame  = Math.pow(event.importance_score  || 1, 0.4);
  return dist * personFame * eventFame * Math.log(overlap + 2);
};

// Weighted random sample: picks n items from pool proportional to score.
const weightedSample = (pool, n) => {
  if (pool.length <= n) return [...pool];
  const out = [];
  const rem = [...pool];
  while (out.length < n && rem.length > 0) {
    const total = rem.reduce((s, p) => s + p.score, 0);
    let r = Math.random() * total;
    let picked = rem.length - 1;
    for (let i = 0; i < rem.length; i++) { r -= rem[i].score; if (r <= 0) { picked = i; break; } }
    out.push(rem[picked]);
    rem.splice(picked, 1);
  }
  return out;
};

// Score a regional pair: weight toward famous world figures x active overlap.
// This is what surfaces Quang Trung + Napoleon and Hai Ba Trung + Roman figures.
const scorePinnedPair = (regional, world) => {
  const dist = geoDist(regional, world);
  if (dist < MIN_COINCIDENCE_DIST) return 0;
  const overlap = activeOverlap(regional, world);
  if (overlap < 2) return 0;
  const worldFame = Math.pow(world.importance_score || 1, 0.7);
  const crossDomain = regional.category !== world.category ? 1.4 : 1.0;
  return worldFame * overlap * crossDomain * (dist / 30);
};

const pointsInBox = (points, box) => {
  if (!box) return [];
  const xMin = Math.min(box.x1, box.x2);
  const xMax = Math.max(box.x1, box.x2);
  const yMin = Math.min(box.y1, box.y2);
  const yMax = Math.max(box.y1, box.y2);
  return points.filter(p => p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax);
};

const findZoneCoincidences = (points, box, n = 8) => {
  const inBox   = pointsInBox(points, box);
  const inside  = inBox.filter(p => p.type === 'person' && (p.importance_score || 0) >= 10);
  const insideEvents = inBox.filter(p => p.type === 'event' && (p.importance_score || 0) >= 15);
  const outside = points.filter(p => !pointsInBox([p], box).length && p.type === 'person' && (p.importance_score || 0) >= 50);
  if ((!inside.length && !insideEvents.length) || !outside.length) return [];
  const pairs = [];
  for (const a of inside) {
    for (const b of outside) {
      const score = scorePinnedPair(a, b);
      if (score > 0) pairs.push({ a, b, score });
    }
  }
  for (const ev of insideEvents) {
    for (const person of outside) {
      const score = scoreEventPair(ev, person);
      if (score > 0) pairs.push({ a: ev, b: person, score });
    }
  }
  if (!pairs.length) return [];
  return weightedSample(pairs, n);
};

const findCoincidences = (points, n = 8) => {
  const people = points.filter(p => p.type === 'person' && (p.importance_score || 0) >= 50);
  const events = points.filter(p => p.type === 'event'  && (p.importance_score || 0) >= 20);

  const personPairs = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const score = scorePair(people[i], people[j]);
      if (score > 0) personPairs.push({ a: people[i], b: people[j], score });
    }
  }

  const eventPairs = [];
  for (const ev of events) {
    for (const person of people) {
      const score = scoreEventPair(ev, person);
      if (score > 0) eventPairs.push({ a: ev, b: person, score });
    }
  }

  const nEvent  = Math.min(3, eventPairs.length);
  const nPerson = n - nEvent;
  return weightedSample(eventPairs, nEvent).concat(weightedSample(personPairs, nPerson));
};

const findCoincidencesForPerson = (person, points, n = 8) => {
  const others = points.filter(p => p.type === 'person' && p.id !== person.id);
  const events = points.filter(p => p.type === 'event'  && (p.importance_score || 0) >= 20);

  const personPairs = [];
  for (const other of others) {
    const score = scorePair(person, other);
    if (score > 0) personPairs.push({ a: person, b: other, score });
  }

  const eventPairs = [];
  for (const ev of events) {
    const score = scoreEventPair(ev, person);
    if (score > 0) eventPairs.push({ a: ev, b: person, score });
  }

  const nEvent  = Math.min(2, eventPairs.length);
  const nPerson = n - nEvent;
  return weightedSample(eventPairs, nEvent).concat(weightedSample(personPairs, nPerson));
};

const GEO_NEAR_RADIUS = 10;
const GEO_FAR_RADIUS  = 20;

const findGeoAnchoredCoincidences = (points, cx, cy, n = 8) => {
  const dist2 = p => { const dx = p.x - cx, dy = p.y - cy; return dx*dx + dy*dy; };
  const people = points.filter(p => p.type === 'person');
  const events = points.filter(p => p.type === 'event' && (p.importance_score || 0) >= 15);

  const nearby       = people.filter(p => dist2(p) <= GEO_NEAR_RADIUS**2 && (p.importance_score || 0) >= 8);
  const nearbyEvents = events.filter(p => dist2(p) <= GEO_NEAR_RADIUS**2);
  const farAway      = people.filter(p => dist2(p) >  GEO_FAR_RADIUS**2  && (p.importance_score || 0) >= 50);

  if ((!nearby.length && !nearbyEvents.length) || !farAway.length) return findCoincidences(points, n);

  const pairs = [];
  for (const a of nearby) {
    for (const b of farAway) {
      const score = scorePinnedPair(a, b);
      if (score > 0) pairs.push({ a, b, score });
    }
  }
  for (const ev of nearbyEvents) {
    for (const person of farAway) {
      const score = scoreEventPair(ev, person);
      if (score > 0) pairs.push({ a: ev, b: person, score });
    }
  }

  if (!pairs.length) return findCoincidences(points, n);
  return weightedSample(pairs, n);
};

const findPinnedRegionCoincidences = (points, region, n = 8) => {
  const people = points.filter(p => p.type === 'person');
  const events = points.filter(p => p.type === 'event' && (p.importance_score || 0) >= 15);
  // Low threshold so figures like Hai Ba Trung appear even with modest sitelinks.
  const inside       = people.filter(p =>  isInRegion(p, region) && (p.importance_score || 0) >= 8);
  const insideEvents = events.filter(p =>  isInRegion(p, region));
  // High threshold for world figures: the pairing only surprises if the other person is very famous.
  const outside      = people.filter(p => !isInRegion(p, region) && (p.importance_score || 0) >= 80);
  if ((!inside.length && !insideEvents.length) || !outside.length) return findCoincidences(points, n);
  const pairs = [];
  for (const a of inside) {
    for (const b of outside) {
      const score = scorePinnedPair(a, b);
      if (score > 0) pairs.push({ a, b, score });
    }
  }
  for (const ev of insideEvents) {
    for (const person of outside) {
      const score = scoreEventPair(ev, person);
      if (score > 0) pairs.push({ a: ev, b: person, score });
    }
  }
  const result = weightedSample(pairs, n);
  return result.length > 0 ? result : findCoincidences(points, n);
};

const CoincidenceCard = ({ pair, onDismiss, onNext, index, total }) => {
  const [extractA, setExtractA] = useState('');
  const [extractB, setExtractB] = useState('');

  useEffect(() => {
    setExtractA('');
    setExtractB('');
    const fetchExtract = (entity, setter) => {
      if (!entity.wpTitle) return;
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.wpTitle)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.extract) setter(d.extract.split('.').slice(0, 3).join('.') + '.'); })
        .catch(() => {});
    };
    fetchExtract(pair.a, setExtractA);
    fetchExtract(pair.b, setExtractB);
  }, [pair.a.id, pair.b.id]);

  const overlapStart = Math.max(pair.a.start_year, pair.b.start_year);
  const overlapEnd   = Math.min(pair.a.end_year ?? 2024, pair.b.end_year ?? 2024);
  const overlapYears = Math.max(0, overlapEnd - overlapStart);

  const renderEntry = (p, extract, label) => {
    const catColor = CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR;
    const region = regionOfPoint(p);
    return (
      <div className="cc-entry">
        <div className="cc-avatar-wrap">
          {p.thumbnailUrl
            ? <img src={p.thumbnailUrl} alt={p.name} className="cc-avatar" />
            : <div className="cc-avatar-blank" style={{ borderColor: catColor }} />}
          {p.type === 'event' && <div className="cc-event-badge" style={{ background: catColor }} />}
        </div>
        <div className="cc-entry-body">
          <div className="cc-entry-top">
            <span className="cc-name">{p.name}</span>
            {p.category && (
              <span className="cat-badge" style={{ '--cat-color': catColor }}>{p.category}</span>
            )}
          </div>
          <div className="cc-entry-sub">
            {region && <span className="cc-region">{region}</span>}
            <span className="cc-lifespan">
              {formatYear(p.start_year)}{p.end_year ? ` to ${formatYear(p.end_year)}` : ''}
            </span>
          </div>
          {extract
            ? <p className="cc-extract">{extract}</p>
            : <p className="cc-extract cc-extract-loading">Loading...</p>}
        </div>
      </div>
    );
  };

  const label = makeConnectionLabel(pair.a, pair.b);
  const sentence = makeConnectionSentence(pair.a, pair.b, overlapYears, overlapStart, overlapEnd);
  const regionA = regionOfPoint(pair.a);
  const regionB = regionOfPoint(pair.b);
  const bridgeText = (regionA && regionB && regionA !== regionB)
    ? `${regionA} ↔ ${regionB}`
    : 'meanwhile';

  return (
    <div className="coincidence-card animate-slide-in-left">
      <div className="cc-topbar">
        <div className="cc-topbar-left">
          <span className="coincidence-label">{label}</span>
        </div>
        <div className="cc-topbar-right">
          {total > 1 && (
            <button className="cc-next-btn" onClick={onNext}>
              {index + 1}&thinsp;/&thinsp;{total} &rarr;
            </button>
          )}
          <button className="coincidence-dismiss" onClick={onDismiss}>&#x2715;</button>
        </div>
      </div>

      {overlapYears > 0 && (
        <div className="cc-overlap-bar">
          <span className="cc-overlap-years">{overlapYears} shared years</span>
          <span className="cc-overlap-range">{formatYear(overlapStart)} to {formatYear(overlapEnd)}</span>
        </div>
      )}

      {sentence && <p className="cc-sentence">{sentence}</p>}

      {renderEntry(pair.a, extractA)}
      <div className="cc-meanwhile">{bridgeText}</div>
      {renderEntry(pair.b, extractB)}
    </div>
  );
};

const YearSnapshotPanel = ({ points, year, onSelect, onClose }) => {
  const notable = [...points]
    .filter(p => p.thumbnailUrl)
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 24);

  const yearLabel = year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;

  return (
    <div className="snapshot-panel animate-slide-in-left">
      <div className="snapshot-header">
        <span className="snapshot-title">Alive in {yearLabel}</span>
        <button className="snapshot-close" onClick={onClose}>&#x2715;</button>
      </div>
      <div className="snapshot-count">{points.length} figures on record</div>
      <div className="snapshot-grid">
        {notable.map(p => (
          <div key={p.id} className="snapshot-person" onClick={() => onSelect(p)}
            style={{ '--dot-color': CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR }}>
            <div className="snapshot-avatar">
              <img src={p.thumbnailUrl} alt={p.name} />
              {p.category && (
                <span className="snapshot-cat-dot" style={{ background: CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR }} />
              )}
            </div>
            <div className="snapshot-info">
              <strong>{p.name}</strong>
              <span>{formatYear(p.start_year)}{p.end_year ? ` to ${formatYear(p.end_year)}` : ''}</span>
              {p.category && <span className="snapshot-cat">{p.category}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RegionPicker = ({ pinned, onPin }) => (
  <div className="region-picker">
    <span className="region-picker-label">Home region</span>
    <div className="region-picker-buttons">
      {Object.keys(REGIONS).map(name => (
        <button
          key={name}
          className={`region-btn${pinned === name ? ' active' : ''}`}
          onClick={() => onPin(pinned === name ? null : name)}
        >
          {name}
        </button>
      ))}
    </div>
  </div>
);

const EventPanel = ({ event, region, onPersonSelect, onClose }) => {
  const [extract, setExtract] = useState('');
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setExtract('');
    setPeople([]);
    setLoading(true);

    if (event.wpTitle) {
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(event.wpTitle)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.extract) setExtract(d.extract.split('.').slice(0, 2).join('.') + '.'); })
        .catch(() => {});
    }

    const params = new URLSearchParams({
      start: event.start_year,
      end: event.end_year || event.start_year + 10,
    });
    if (region) {
      const r = REGIONS[region];
      params.set('latMin', r.latMin);
      params.set('latMax', r.latMax);
      params.set('lonMin', r.lonMin);
      params.set('lonMax', r.lonMax);
    }
    fetch(`/api/event-contemporaries?${params}`)
      .then(r => r.json())
      .then(data => { setPeople(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [event.id, region]);

  const catColor = CATEGORY_COLORS[event.category] || DEFAULT_DOT_COLOR;
  const duration = event.end_year && event.end_year !== event.start_year
    ? event.end_year - event.start_year : null;

  const ageContext = (p) => {
    const ageAtStart = event.start_year - p.start_year;
    if (ageAtStart < 0) return `born ${Math.abs(ageAtStart)} years after it began`;
    if (ageAtStart === 0) return 'born the year it began';
    if (p.end_year && p.end_year < event.start_year) return 'died before it began';
    return `${ageAtStart} years old when it began`;
  };

  return (
    <div className="snapshot-panel event-panel animate-slide-in-left">
      <div className="snapshot-header">
        <span className="snapshot-title">{event.name}</span>
        <button className="snapshot-close" onClick={onClose}>&#x2715;</button>
      </div>
      <div className="event-panel-meta">
        <span className="cat-badge" style={{ '--cat-color': catColor }}>{event.category}</span>
        <span className="event-panel-years">
          {formatYear(event.start_year)}
          {duration ? ` to ${formatYear(event.end_year)} (${duration} yrs)` : ''}
        </span>
      </div>
      {extract && <p className="event-panel-extract">{extract}</p>}
      <div className="snapshot-count">
        {!loading && people.length > 0 && (
          <span>
            While this unfolded, {people.length} known figures were shaping the world.
            Click any name to explore their story.
          </span>
        )}
        {!loading && people.length === 0 && (
          <span>{region ? `No records found for ${region}.` : 'No records found.'}</span>
        )}
        {loading && <span>Searching history...</span>}
      </div>
      <div className="snapshot-grid">
        {people.map(p => (
          <div key={p.id} className="snapshot-person" onClick={() => onPersonSelect(p)}
            style={{ '--dot-color': CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR }}>
            <div className="snapshot-avatar">
              {p.thumbnailUrl
                ? <img src={p.thumbnailUrl} alt={p.name} />
                : <div className="snapshot-avatar-placeholder" />}
              {p.category && (
                <span className="snapshot-cat-dot" style={{ background: CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR }} />
              )}
            </div>
            <div className="snapshot-info">
              <strong>{p.name}</strong>
              <span className="snapshot-age-context">{ageContext(p)}</span>
              {p.category && <span className="snapshot-cat">{p.category}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EntityCard = ({ entity }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/entity/${entity.id}`)
      .then(res => (res.ok ? res.json() : null))
      .then(result => { 
        setData(result); 
        setLoading(false); 
      })
      .catch(() => setLoading(false));
  }, [entity.id]);

  if (loading) return <div className="card loading">Loading...</div>;
  if (!data || !data.summary) return <div className="card error">No data for {entity.name}</div>;

  const { summary } = data;

  return (
    <div className="card animate-in">
      {summary.thumbnail && (
        <img src={summary.thumbnail.source} alt={entity.name} className="card-img" />
      )}
      <div className="card-content">
        <div className="card-header">
          <h4>{entity.name}</h4>
          <span className={`type-badge ${entity.type}`}>{entity.type}</span>
        </div>
        <p className="card-extract">{summary.extract}</p>
      </div>
    </div>
  );
};

const SearchOverlay = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = React.useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/search-name?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => setResults(data));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleKey = e => { if (e.key === 'Escape') onClose(); };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-overlay-box" onClick={e => e.stopPropagation()}>
        <div className="search-overlay-input-row">
          <span className="search-overlay-icon">&#128269;</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search a person or event..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            className="search-overlay-input"
          />
          <button className="search-overlay-close" onClick={onClose}>&#x2715;</button>
        </div>
        {results.length > 0 && (
          <div className="search-overlay-results">
            {results.map(r => {
              const catColor = CATEGORY_COLORS[r.category] || DEFAULT_DOT_COLOR;
              return (
                <div key={r.id} className="search-overlay-item" onClick={() => { onSelect(r); onClose(); }}>
                  <div className="search-overlay-item-main">
                    {r.thumbnailUrl
                      ? <img src={r.thumbnailUrl} alt="" className="search-overlay-thumb" />
                      : <div className="search-overlay-thumb-blank" style={{ borderColor: catColor }} />}
                    <div className="search-overlay-item-text">
                      <span className="search-overlay-name">{r.name}</span>
                      <span className="search-overlay-meta">{lifespanText(r)}</span>
                    </div>
                  </div>
                  {r.category && (
                    <span className="cat-badge" style={{ '--cat-color': catColor }}>{r.category}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {query.length >= 2 && results.length === 0 && (
          <p className="search-overlay-empty">No results found</p>
        )}
      </div>
    </div>
  );
};

const TIMELINE_MARKERS = [
  { year:    0, label: '0 CE'        },
  { year:  476, label: 'Rome falls'  },
  { year: 1066, label: 'Hastings'    },
  { year: 1347, label: 'Plague'      },
  { year: 1492, label: 'Columbus'    },
  { year: 1687, label: 'Newton'      },
  { year: 1789, label: 'Fr. Rev.'    },
  { year: 1848, label: 'Revolutions' },
  { year: 1914, label: 'WW1'         },
  { year: 1945, label: 'WW2'         },
  { year: 1969, label: 'Moon'        },
];

const ERAS = [
  { name: 'Ancient World',    year: -400,  civilizations: ['Persia', 'Maurya', 'Zhou'] },
  { name: 'Classical Age',    year: -50,   civilizations: ['Rome', 'Han', 'Parthia'] },
  { name: 'Golden Ages',      year: 800,   civilizations: ['Abbasid', 'Tang', 'Maya'] },
  { name: 'Medieval',         year: 1100,  civilizations: ['Song', 'Khmer', 'Mali'] },
  { name: 'Mongol Age',       year: 1270,  civilizations: ['Mongol', 'Mali', 'Delhi'] },
  { name: 'Early Modern',     year: 1500,  civilizations: ['Ottoman', 'Aztec', 'Ming'] },
  { name: 'Revolution Era',   year: 1800,  civilizations: ['Napoleon', 'Quang Trung', 'Bolívar'] },
];

// Non-linear time scale: each segment maps a range of years to a % of slider space.
// Pre-1700 is compressed; 1700-2024 (the dense modern era) gets 50% of the slider.
// 1800 CE lands at ~65% so Revolution Era feels late, not central.
const TIME_BREAKPOINTS = [
  { year: -1374, pos: 0   },
  { year:  -400, pos: 7   },  //  974 years →  7%
  { year:   500, pos: 15  },  //  900 years →  8%
  { year:  1000, pos: 22  },  //  500 years →  7%
  { year:  1400, pos: 32  },  //  400 years → 10%
  { year:  1700, pos: 50  },  //  300 years → 18%
  { year:  1800, pos: 65  },  //  100 years → 15%
  { year:  1900, pos: 82  },  //  100 years → 17%
  { year:  2024, pos: 100 },  //  124 years → 18%
];

const yearToSlider = (year) => {
  const bp = TIME_BREAKPOINTS;
  if (year <= bp[0].year) return bp[0].pos;
  if (year >= bp[bp.length - 1].year) return bp[bp.length - 1].pos;
  for (let i = 1; i < bp.length; i++) {
    if (year <= bp[i].year) {
      const t = (year - bp[i-1].year) / (bp[i].year - bp[i-1].year);
      return bp[i-1].pos + t * (bp[i].pos - bp[i-1].pos);
    }
  }
  return bp[bp.length - 1].pos;
};

const sliderToYear = (v) => {
  const bp = TIME_BREAKPOINTS;
  if (v <= bp[0].pos) return bp[0].year;
  if (v >= bp[bp.length - 1].pos) return bp[bp.length - 1].year;
  for (let i = 1; i < bp.length; i++) {
    if (v <= bp[i].pos) {
      const t = (v - bp[i-1].pos) / (bp[i].pos - bp[i-1].pos);
      return Math.round(bp[i-1].year + t * (bp[i].year - bp[i-1].year));
    }
  }
  return bp[bp.length - 1].year;
};

const HistorySparkline = ({ data, currentYear }) => {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map(d => d.count));

  const points = data
    .map(d => {
      const x = yearToSlider(d.decade);
      const y = 100 - (Math.sqrt(d.count) / Math.sqrt(maxCount)) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  const currentX = yearToSlider(currentYear);

  return (
    <div className="sparkline-container-wrapper">
      <div className="sparkline-container">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sparkline-svg">
          {TIME_BREAKPOINTS.slice(1, -1).map(bp => (
            <line key={bp.year} x1={bp.pos} y1="60" x2={bp.pos} y2="100"
              stroke="rgba(255,255,255,0.1)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={points} className="sparkline-path" />
          <line x1={currentX} y1="0" x2={currentX} y2="100"
            className="sparkline-indicator" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
};

const EraCards = ({ currentYear, onYearChange }) => {
  const nearest = ERAS.reduce((best, era) =>
    Math.abs(era.year - currentYear) < Math.abs(best.year - currentYear) ? era : best
  );
  return (
    <div className="era-cards-row">
      {ERAS.map(era => (
        <button
          key={era.name}
          className={`era-card${era === nearest ? ' active' : ''}`}
          onClick={() => onYearChange(era.year)}
        >
          <div className="era-card-name">{era.name}</div>
          <div className="era-card-year">{formatYear(era.year)}</div>
          <div className="era-card-civs">
            {era.civilizations.slice(0, 2).map(c => (
              <span key={c} className="era-civ-chip">{c}</span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
};

const WorldMap = ({ points, onMapClick, selectedPoint, syncActive, onPointClick, coincidencePair, onCoincidenceClick, onSelectionChange, geoAnchor }) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selection, setSelection] = useState(null); // { x1, y1, x2, y2 } in percentages

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.85 : 1.15;
    const newZoom = Math.min(Math.max(zoom * delta, 1), 12);

    if (newZoom !== zoom) {
      // Calculate world coordinates under the cursor before zoom
      const worldX = (mouseX - offset.x) / zoom;
      const worldY = (mouseY - offset.y) / zoom;

      // New offset ensures the same world point stays under the cursor
      const newOffsetX = mouseX - worldX * newZoom;
      const newOffsetY = mouseY - worldY * newZoom;

      setZoom(newZoom);
      setOffset({ x: newOffsetX, y: newOffsetY });
    }

    if (newZoom === 1) {
      setOffset({ x: 0, y: 0 });
      setSelection(null);
    }
  };

  const getMapCoords = (clientX, clientY, rect) => {
    const x = (clientX - rect.left - offset.x) / zoom;
    const y = (clientY - rect.top - offset.y) / zoom;
    return {
      px: (x / rect.width) * 100,
      py: (y / rect.height) * 100
    };
  };

  const onMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.altKey) {
      setIsSelecting(true);
      const coords = getMapCoords(e.clientX, e.clientY, rect);
      setSelection({ x1: coords.px, y1: coords.py, x2: coords.px, y2: coords.py });
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const onMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (isSelecting) {
      const coords = getMapCoords(e.clientX, e.clientY, rect);
      setSelection(prev => ({ ...prev, x2: coords.px, y2: coords.py }));
      return;
    }
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const onMouseUp = () => {
    if (isSelecting && selection) {
      const w = Math.abs(selection.x2 - selection.x1);
      const h = Math.abs(selection.y2 - selection.y1);
      if (w > 2 && h > 2) onSelectionChange(selection);
      else { setSelection(null); onSelectionChange(null); }
    }
    setIsDragging(false);
    setIsSelecting(false);
  };

  const handleClick = e => {
    if (isDragging || isSelecting) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const coords = getMapCoords(e.clientX, e.clientY, rect);
    
    const lon = coords.px * 3.6 - 180;
    const lat = 90 - coords.py * 1.8;
    onMapClick({ lat, lon, x: coords.px, y: coords.py });
    // Keep selection if it exists, or clear it if clicking outside? 
    // Let's clear it on a normal click to "un-highlight".
    if (!e.altKey) { setSelection(null); onSelectionChange(null); }
  };

  const isInsideSelection = (x, y) => {
    if (!selection) return false;
    const xMin = Math.min(selection.x1, selection.x2);
    const xMax = Math.max(selection.x1, selection.x2);
    const yMin = Math.min(selection.y1, selection.y2);
    const yMax = Math.max(selection.y1, selection.y2);
    return x >= xMin && x <= xMax && y >= yMin && y <= yMax;
  };

  const beamData = coincidencePair && !syncActive ? (() => {
    const { a, b } = coincidencePair;
    const cx = (a.x + b.x) / 2;
    const cy = Math.max(2, (a.y + b.y) / 2 - 22);
    return {
      d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
      colA: CATEGORY_COLORS[a.category] || DEFAULT_DOT_COLOR,
      colB: CATEGORY_COLORS[b.category] || DEFAULT_DOT_COLOR,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    };
  })() : null;

  return (
    <div
      className="map-stage-inner"
      onWheel={handleWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        cursor: isSelecting ? 'crosshair' : (zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'crosshair')
      }}
    >
      <div
        className="map-transform-layer"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: (isDragging || isSelecting) ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        <div className="map-bg" />

        {beamData && (
          <svg className="coincidence-arc-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="cbeam-grad" gradientUnits="userSpaceOnUse"
                x1={beamData.x1} y1={beamData.y1} x2={beamData.x2} y2={beamData.y2}>
                <stop offset="0%" stopColor={beamData.colA} stopOpacity="0.9" />
                <stop offset="38%" stopColor={beamData.colA} stopOpacity="0" />
                <stop offset="62%" stopColor={beamData.colB} stopOpacity="0" />
                <stop offset="100%" stopColor={beamData.colB} stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="cbeam-glow-grad" gradientUnits="userSpaceOnUse"
                x1={beamData.x1} y1={beamData.y1} x2={beamData.x2} y2={beamData.y2}>
                <stop offset="0%" stopColor={beamData.colA} stopOpacity="0.35" />
                <stop offset="50%" stopColor={beamData.colA} stopOpacity="0" />
                <stop offset="100%" stopColor={beamData.colB} stopOpacity="0.35" />
              </linearGradient>
              <filter id="cbeam-blur">
                <feGaussianBlur stdDeviation="0.9" />
              </filter>
            </defs>
            <path d={beamData.d} fill="none" stroke="url(#cbeam-glow-grad)"
              strokeWidth="4" filter="url(#cbeam-blur)" className="coincidence-beam-glow" />
            <path d={beamData.d} fill="none" stroke="url(#cbeam-grad)"
              strokeWidth="0.45" className="coincidence-beam-path" />
          </svg>
        )}

        <div className={`map-overlay${syncActive ? ' sync-active' : ''}`} onClick={handleClick}>
          {geoAnchor && !syncActive && (
            <div
              className="geo-anchor-ring"
              style={{
                left: `${geoAnchor.x}%`,
                top: `${geoAnchor.y}%`,
                transform: `translate(-50%, -50%) scale(${1 / Math.sqrt(zoom)})`
              }}
            />
          )}
          {selection && (
            <div className="selection-box" style={{
              left: `${Math.min(selection.x1, selection.x2)}%`,
              top: `${Math.min(selection.y1, selection.y2)}%`,
              width: `${Math.abs(selection.x2 - selection.x1)}%`,
              height: `${Math.abs(selection.y2 - selection.y1)}%`
            }} />
          )}

          {points.map((p, i) => {
            const isCoincidenceDot = !syncActive && coincidencePair &&
              (p.id === coincidencePair.a.id || p.id === coincidencePair.b.id);
            const showThumb = p.showFace || isCoincidenceDot || isInsideSelection(p.x, p.y);
            const isEvent = p.type === 'event';
            return (
              <div
                key={i}
                className={[
                  'history-dot',
                  p.type,
                  p.showFace ? 'face' : '',
                  isCoincidenceDot ? 'is-coincidence' : '',
                  p.id === selectedPoint?.id ? 'active' : ''
                ].filter(Boolean).join(' ')}
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  transform: `translate(-50%, -50%) scale(${1 / Math.sqrt(zoom)})`,
                  zIndex: isCoincidenceDot ? 150 : (isEvent ? 20 : (showThumb ? 100 : 10)),
                  '--dot-color': CATEGORY_COLORS[p.category] || DEFAULT_DOT_COLOR
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isCoincidenceDot) onCoincidenceClick(coincidencePair);
                  else onPointClick(p);
                }}
              >
                {showThumb && p.thumbnailUrl && (
                  <div className="dot-thumb-container">
                    <img src={p.thumbnailUrl} alt="" className="dot-thumb-img" />
                  </div>
                )}
                <div className="dot-core" />
                <span className={`dot-label ${showThumb ? 'always-show' : ''}`}>{p.name}</span>
                <div className="dot-tooltip">
                  <strong>{p.name}</strong>
                  <span>{lifespanText(p)}</span>
                  {p.category && <span className="dot-tooltip-cat">{p.category}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {zoom > 1 && (
        <button className="reset-zoom-btn" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>
          Reset Zoom
        </button>
      )}
    </div>
  );
};

const calculateXY = (lat, lon) => {
  const x = (parseFloat(lon) + 180) / 3.6;
  const y = (90 - parseFloat(lat)) / 1.8;
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y };
};

export default function App() {
  const [year, setYear] = useState(1000);
  const [displayYear, setDisplayYear] = useState(1000);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [contemporaries, setContemporaries] = useState([]);
  const [loadingSync, setLoadingSync] = useState(false);
  const [syncMode, setSyncMode] = useState(false);
  const [historicalPoints, setHistoricalPoints] = useState([]);
  const [densityData, setDensityData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [coincidences, setCoincidences] = useState([]);
  const [coincidenceIndex, setCoincidenceIndex] = useState(0);
  const [zoneSelection, setZoneSelection] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusPerson, setFocusPerson] = useState(null);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [pinnedRegion, setPinnedRegion] = useState(() => localStorage.getItem('pinnedRegion') || null);
  const [autoplay, setAutoplay] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventBeamPair, setEventBeamPair] = useState(null);
  const [cardDismissed, setCardDismissed] = useState(false);
  const [geoAnchor, setGeoAnchor] = useState(null);
  const coincidencePair = coincidences[coincidenceIndex] || null;

  // Debounce displayYear -> year so API calls don't fire on every slider tick
  useEffect(() => {
    const timer = setTimeout(() => setYear(displayYear), 300);
    return () => clearTimeout(timer);
  }, [displayYear]);

  useEffect(() => {
    fetch('/api/history-density').then(res => res.json()).then(setDensityData);
    fetch('/api/categories').then(res => res.json()).then(setCategories);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (syncMode || coincidences.length < 2) return;
      if (e.key === 'ArrowRight') {
        setCoincidenceIndex(i => (i + 1) % coincidences.length);
        setEventBeamPair(null);
        setCardDismissed(false);
      }
      if (e.key === 'ArrowLeft') {
        setCoincidenceIndex(i => (i - 1 + coincidences.length) % coincidences.length);
        setEventBeamPair(null);
        setCardDismissed(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [syncMode, coincidences.length]);

  // Reveal card whenever the active pair changes.
  useEffect(() => { setCardDismissed(false); }, [coincidenceIndex, eventBeamPair]);

  useEffect(() => {
    if (syncMode) return;
    fetch(`/api/year-summary?year=${year}`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        const points = data
          .map(d => {
            const pos = calculateXY(d.latitude, d.longitude);
            if (!pos) return null;
            return { ...d, x: pos.x, y: pos.y, showFace: false };
          })
          .filter(p => p !== null);
        // Mark the top 10 people with thumbnails as face-visible, regardless of era.
        [...points]
          .filter(p => p.type === 'person' && p.thumbnailUrl)
          .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
          .slice(0, 10)
          .forEach(p => { p.showFace = true; });
        setHistoricalPoints(points);
        setSelectedEvent(null);
        setEventBeamPair(null);
      });
  }, [year, syncMode]);

  // Recompute coincidences whenever points, zone selection, pinned region, focused person, or geo-anchor changes.
  useEffect(() => {
    if (!historicalPoints.length) return;
    setCoincidenceIndex(0);

    if (focusPerson) {
      const pairs = findCoincidencesForPerson(focusPerson, historicalPoints);
      if (pairs.length > 0) {
        setCoincidences(pairs);
        setFocusPerson(null);
        return;
      }
      setFocusPerson(null);
    }

    if (zoneSelection) {
      const pairs = findZoneCoincidences(historicalPoints, zoneSelection);
      setCoincidences(pairs.length > 0 ? pairs : (
        pinnedRegion
          ? findPinnedRegionCoincidences(historicalPoints, REGIONS[pinnedRegion])
          : findCoincidences(historicalPoints)
      ));
    } else if (geoAnchor) {
      const pairs = findGeoAnchoredCoincidences(historicalPoints, geoAnchor.x, geoAnchor.y);
      setCoincidences(pairs.length > 0 ? pairs : findCoincidences(historicalPoints));
    } else if (pinnedRegion) {
      setCoincidences(findPinnedRegionCoincidences(historicalPoints, REGIONS[pinnedRegion]));
    } else {
      setCoincidences(findCoincidences(historicalPoints));
    }
  }, [historicalPoints, zoneSelection, pinnedRegion, focusPerson, geoAnchor]);

  // Autoplay: advance coincidence every 4s.
  useEffect(() => {
    if (!autoplay || syncMode) return;
    const id = setInterval(() => {
      setCoincidenceIndex(i => (i + 1) % Math.max(coincidences.length, 1));
      setEventBeamPair(null);
    }, 4000);
    return () => clearInterval(id);
  }, [autoplay, syncMode, coincidences.length]);

  useEffect(() => {
    if (syncMode && selectedEntity) {
      setLoadingSync(true);
      fetch(`/api/contemporaries?start=${selectedEntity.start_year}&end=${selectedEntity.end_year}&excludeId=${selectedEntity.id}&category=${activeCategory}&lat=${selectedEntity.latitude}&lon=${selectedEntity.longitude}`)
        .then(res => res.json())
        .then(data => {
          setContemporaries(data);
          setLoadingSync(false);
          setHistoricalPoints(
            data
              .map(d => {
                const pos = calculateXY(d.latitude, d.longitude);
                if (!pos) return null;
                return {
                  ...d,
                  x: pos.x,
                  y: pos.y,
                  showFace: (d.importance_score || 0) >= 150 && d.type === 'person'
                };
              })
              .filter(p => p !== null)
          );
        });
    }
  }, [syncMode, selectedEntity, activeCategory]);

  const startSynchronicity = (entity) => {
    setSelectedEntity(entity);
    setSyncMode(true);
    setYear(entity.start_year);
    setDisplayYear(entity.start_year);
    setActiveCategory('All');
  };

  const handleMapClick = ({ lat, lon, x, y }) => {
    if (syncMode) {
      fetch(`/api/search-region?year=${year}&lat=${lat}&lon=${lon}`)
        .then(res => res.json())
        .then(data => { if (data.length > 0) startSynchronicity(data[0]); });
      return;
    }
    setGeoAnchor({ x, y });
    setZoneSelection(null);
    setCardDismissed(false);
    setEventBeamPair(null);
    setSelectedEvent(null);
  };

  const handleBack = () => {
    setSyncMode(false);
    setSelectedEntity(null);
    setContemporaries([]);
  };

  const handlePersonClick = (person) => {
    const pairs = findCoincidencesForPerson(person, historicalPoints);
    if (pairs.length === 0) return;
    setCoincidences(pairs);
    setCoincidenceIndex(0);
    setCardDismissed(false);
    setEventBeamPair(null);
    setSelectedEvent(null);
  };

  const handleSearchSelect = (person) => navigateToPerson(person);

  const handlePinRegion = (name) => {
    setPinnedRegion(name);
    setGeoAnchor(null);
    if (name) localStorage.setItem('pinnedRegion', name);
    else localStorage.removeItem('pinnedRegion');
    setAutoplay(false);
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setAutoplay(false);
    setEventBeamPair(null);
  };

  const navigateToPerson = (person) => {
    const targetYear = person.start_year + 10;
    setDisplayYear(targetYear);
    setYear(targetYear);
    setZoneSelection(null);
    setGeoAnchor(null);
    setCardDismissed(false);
    setSearchOpen(false);
    setSelectedEvent(null);
    setEventBeamPair(null);
    setFocusPerson(person);
  };

  const handleEventPersonSelect = (person) => navigateToPerson(person);

  const selectedPos = selectedEntity ? calculateXY(selectedEntity.latitude, selectedEntity.longitude) : null;
  if (selectedPos && selectedEntity) selectedPos.id = selectedEntity.id;

  const activePair = eventBeamPair || coincidencePair;

  const nearestEra = ERAS.reduce((best, era) =>
    Math.abs(era.year - displayYear) < Math.abs(best.year - displayYear) ? era : best
  );

  return (
    <div className="app-container">
      <div className="map-stage">
        <WorldMap
          points={historicalPoints}
          onMapClick={handleMapClick}
          selectedPoint={selectedPos}
          syncActive={syncMode}
          onPointClick={p => {
            if (p.type === 'event') handleEventClick(p);
            else handlePersonClick(p);
          }}
          coincidencePair={activePair}
          onCoincidenceClick={() => {}}
          onSelectionChange={sel => { setZoneSelection(sel); if (sel) setGeoAnchor(null); }}
          geoAnchor={geoAnchor}
        />
      </div>

      {selectedEvent && !syncMode && (
        <EventPanel
          event={selectedEvent}
          region={pinnedRegion}
          onPersonSelect={handleEventPersonSelect}
          onClose={() => { setSelectedEvent(null); setEventBeamPair(null); }}
        />
      )}

      {showSnapshot && !syncMode && !selectedEvent && (
        <YearSnapshotPanel
          points={historicalPoints}
          year={displayYear}
          onSelect={p => { startSynchronicity(p); setShowSnapshot(false); }}
          onClose={() => setShowSnapshot(false)}
        />
      )}

      {activePair && !syncMode && !cardDismissed && !selectedEvent && !showSnapshot && (
        <CoincidenceCard
          pair={activePair}
          onDismiss={() => setCardDismissed(true)}
          onNext={() => {
            setCoincidenceIndex(i => (i + 1) % coincidences.length);
            setEventBeamPair(null);
          }}
          index={coincidenceIndex}
          total={coincidences.length}
        />
      )}

      {searchOpen && (
        <SearchOverlay onSelect={handleSearchSelect} onClose={() => setSearchOpen(false)} />
      )}

      <div className={`chaos-ui animate-fade-in ${syncMode ? 'minimized' : ''}`}>
        <div className="chaos-header">
          <div className="year-row">
            <div className="year-era-block">
              <h1>{displayYear < 0 ? `${Math.abs(displayYear)} BCE` : `${displayYear} CE`}</h1>
              {!syncMode && <span className="era-subtitle">{nearestEra.name}</span>}
            </div>
            {!syncMode && (
              <div className="tl-controls">
                <button className="search-icon-btn" title="Search a person" onClick={() => setSearchOpen(true)}>
                  &#128269;
                </button>
                {historicalPoints.length > 0 && (
                  <button
                    className={`snapshot-toggle-btn${showSnapshot ? ' active' : ''}`}
                    title="Who was alive this year?"
                    onClick={() => setShowSnapshot(s => !s)}
                  >
                    {historicalPoints.length} alive
                  </button>
                )}
                {coincidences.length > 1 && (
                  <button
                    className={`autoplay-btn${autoplay ? ' active' : ''}`}
                    title={autoplay ? 'Pause autoplay' : 'Autoplay coincidences'}
                    onClick={() => setAutoplay(a => !a)}
                  >
                    {autoplay ? '⏸' : '▶'}
                  </button>
                )}
                {coincidences.length > 1 && (
                  <button
                    className={`shuffle-btn${zoneSelection || geoAnchor ? ' zone-active' : ''}`}
                    title="Next coincidence"
                    onClick={() => {
                      setCoincidenceIndex(i => (i + 1) % coincidences.length);
                      setEventBeamPair(null);
                    }}
                  >
                    {coincidenceIndex + 1}&thinsp;/&thinsp;{coincidences.length} &rarr;
                  </button>
                )}
              </div>
            )}
          </div>
          {!syncMode && (
            <div className="region-chips-row">
              {Object.keys(REGIONS).map(name => (
                <button
                  key={name}
                  className={`region-chip${pinnedRegion === name ? ' active' : ''}`}
                  onClick={() => handlePinRegion(pinnedRegion === name ? null : name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="timeline-wrapper">
          <HistorySparkline data={densityData} currentYear={displayYear} />
          <div className="timeline-markers-strip">
            {TIMELINE_MARKERS.map(m => (
              <div
                key={m.year}
                className="timeline-marker"
                style={{ left: `${yearToSlider(m.year)}%` }}
                onClick={() => { setDisplayYear(m.year); setYear(m.year); }}
                title={formatYear(m.year)}
              >
                <div className="tm-tick" />
                <span className="tm-label">{m.label}</span>
              </div>
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="0.05"
            value={yearToSlider(displayYear)}
            onChange={e => setDisplayYear(sliderToYear(parseFloat(e.target.value)))}
            className="chaos-slider"
            style={{
              background: `linear-gradient(to right, var(--gold) 0%, var(--gold) ${yearToSlider(displayYear)}%, rgba(255,255,255,0.1) ${yearToSlider(displayYear)}%, rgba(255,255,255,0.1) 100%)`
            }}
          />
        </div>
      </div>

      {syncMode && selectedEntity && (
        <div className="sync-panel animate-slide-in">
          <div className="sync-panel-header">
            <button className="back-btn" onClick={handleBack}>✕ Exit</button>
            <div className="sync-title">
              <h2>{selectedEntity.name}</h2>
              <p className="sync-subtitle">Maybe their paths crossed at one moment?</p>
            </div>
          </div>

          <div className="sync-panel-body">
             <div className="scroll-content">
                <EntityCard entity={selectedEntity} />

                <div className="filter-bar">
                   <button className={activeCategory === 'All' ? 'active' : ''} onClick={() => setActiveCategory('All')}>All</button>
                   {categories.map(cat => (
                     <button key={cat} className={activeCategory === cat ? 'active' : ''} onClick={() => setActiveCategory(cat)}>{cat}</button>
                   ))}
                </div>

                {loadingSync ? <p className="status-msg">Scanning time...</p> : (
                  <div className="contemporaries-list">
                    {contemporaries.map(e => {
                      const endOf = p => p.end_year ?? (p.alive ? 2026 : p.start_year + 65);
                      const overlapYrs = selectedEntity ? Math.max(0,
                        Math.min(endOf(e), endOf(selectedEntity)) -
                        Math.max(e.start_year, selectedEntity.start_year)
                      ) : 0;
                      return (
                        <div key={e.id} className="contemporary-mini-card" onClick={() => startSynchronicity(e)}>
                          {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" />}
                          <div className="mini-info">
                            <strong>{e.name}</strong>
                            <span>{lifespanText(e)}</span>
                            <div className="mini-meta">
                              {e.category && <span className="cat-badge" style={{ '--cat-color': CATEGORY_COLORS[e.category] || DEFAULT_DOT_COLOR }}>{e.category}</span>}
                              {overlapYrs > 0 && <span className="overlap-badge">{overlapYrs} yrs shared</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
