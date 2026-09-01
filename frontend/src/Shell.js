import React, { useState, useEffect, useCallback, useRef } from 'react';
import MapExplorer from './App';
import { PairCard } from './PairCard';
import { Compare } from './Compare';
import { YearCard } from './YearCard';
import { Waves } from './Waves';
import { OnThisDay, NearMisses } from './OnThisDay';
import { api } from './lib';
import './Shell.css';

// The map is the landing page, so it owns "/". Every other view carries its
// own path, which is why the path is listed here rather than derived from the
// id: the reveal's id and its path differ.
const VIEWS = [
  { id: 'map',     label: 'Map',         path: '/' },
  { id: 'reveal',  label: 'Coincidence', path: '/coincidence' },
  { id: 'onthisday', label: 'On this day', path: '/on-this-day' },
  { id: 'year',    label: 'A year',      path: '/year' },
  { id: 'compare', label: 'Compare two', path: '/compare' },
  { id: 'waves',   label: 'Waves',       path: '/waves' },
];

// Routes are read from and written to the address bar so any card can be sent
// to someone else and come back as the same card.
//
//   /                     the map
//   /coincidence          a pair picked for you
//   /on-this-day          one calendar date across all of history
//   /pair/Q36014/Q5582    one specific pair
//   /year/1789            one year across the world
//   /compare              the two-name picker
//   /waves                event clustering
function parseRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { view: 'map' };
  const [head, ...rest] = parts;
  if (head === 'pair' && rest.length === 2) return { view: 'reveal', pair: [rest[0], rest[1]] };
  if (head === 'coincidence') return { view: 'reveal' };
  if (head === 'on-this-day') return { view: 'onthisday' };
  if (head === 'year' && rest.length === 1) {
    const y = parseInt(rest[0], 10);
    if (!Number.isNaN(y)) return { view: 'year', year: y };
  }
  if (VIEWS.some(v => v.id === head)) return { view: head };
  return { view: 'map' };
}

export default function Shell() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState(() => parseRoute(window.location.pathname).year ?? 1789);
  // Which pair is already loaded, so the effect above never refetches it.
  const loadedKeyRef = useRef(null);
  // Set to the date string while today's pick is on screen.
  const [isDaily, setIsDaily] = useState(null);

  const go = useCallback((path, next) => {
    window.history.pushState({}, '', path);
    setRoute(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const r = parseRoute(window.location.pathname);
      setRoute(r);
      if (r.year !== undefined) setYear(r.year);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const drawDaily = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const d = await api('/daily');
      if (d && d.pair && d.pair.headline) {
        setPair(d.pair);
        setIsDaily(d.date);
        loadedKeyRef.current = `${d.pair.a.id}/${d.pair.b.id}`;
        window.history.replaceState({}, '', `/pair/${d.pair.a.id}/${d.pair.b.id}`);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, []);

  const drawReveal = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setIsDaily(null);
    try {
      const p = await api('/reveal');
      if (p && p.headline) {
        setPair(p);
        loadedKeyRef.current = `${p.a.id}/${p.b.id}`;
        window.history.replaceState({}, '', `/pair/${p.a.id}/${p.b.id}`);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, []);

  // Load whatever the address bar asked for.
  //
  // The key guards against a refetch loop: this effect calls setPair, and pair
  // has to stay out of the dependency list or every successful load would
  // trigger the next one until the rate limiter started refusing them.
  const wantKey = route.view === 'reveal' && route.pair ? route.pair.join('/') : null;
  useEffect(() => {
    if (route.view !== 'reveal') return;
    if (!wantKey) {
      if (!loadedKeyRef.current) drawDaily();
      return;
    }
    if (loadedKeyRef.current === wantKey) return;
    loadedKeyRef.current = wantKey;
    const [a, b] = wantKey.split('/');
    setLoading(true);
    setFailed(false);
    setIsDaily(null);
    api('/pair', { a, b })
      .then(p => { setPair(p); setLoading(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  }, [route.view, wantKey, drawReveal, drawDaily]);

  const openPerson = person => {
    // Anchor the next reveal on the person that was clicked.
    setLoading(true);
    api('/reveal', { anchor: person.id })
      .then(p => {
        if (p && p.headline) {
          setPair(p);
          setIsDaily(null);
          loadedKeyRef.current = `${p.a.id}/${p.b.id}`;
          window.history.pushState({}, '', `/pair/${p.a.id}/${p.b.id}`);
          setRoute({ view: 'reveal', pair: [p.a.id, p.b.id] });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // Open a specific pair, used by the near miss list.
  const openPair = (idA, idB) => {
    loadedKeyRef.current = null;
    go(`/pair/${idA}/${idB}`, { view: 'reveal', pair: [idA, idB] });
  };

  const setYearAndRoute = y => {
    setYear(y);
    go(`/year/${y}`, { view: 'year', year: y });
  };

  return (
    <div className="shell">
      <header className="shell-nav">
        <button
          className="shell-brand"
          onClick={() => go('/', { view: 'map' })}
        >
          Coincidence
        </button>
        <nav>
          {VIEWS.map(v => (
            <button
              key={v.id}
              className={`shell-tab${route.view === v.id ? ' active' : ''}`}
              onClick={() => go(v.path, { view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={`shell-main view-${route.view}`}>
        {route.view === 'reveal' && (
          <div className="reveal-view">
            {failed && <p className="shell-status">Could not find a coincidence. Try again.</p>}
            {loading && !pair && <p className="shell-status">Looking through history...</p>}
            {pair && (
              <div className="reveal-stack">
                {isDaily && (
                  <p className="daily-banner">
                    Today's coincidence <span>{isDaily}</span>
                  </p>
                )}
                <PairCard
                  pair={pair}
                  busy={loading}
                  onNext={() => { setPair(null); loadedKeyRef.current = null; drawReveal(); }}
                  onOpenPerson={openPerson}
                />
                <NearMisses onOpenPair={openPair} />
              </div>
            )}
          </div>
        )}

        {route.view === 'onthisday' && <OnThisDay onPick={openPerson} />}

        {route.view === 'year' && (
          <YearCard year={year} onYearChange={setYearAndRoute} onPick={openPerson} />
        )}

        {route.view === 'compare' && (
          <Compare
            onPairChange={(a, b) => window.history.replaceState({}, '', `/compare?a=${a}&b=${b}`)}
          />
        )}

        {route.view === 'waves' && <Waves onYearPick={setYearAndRoute} />}

        {/* The map stays mounted and is hidden instead of unmounted. It is the
            landing page now, and unmounting it threw away the year, the zoom
            and the pinned region every time a tab was visited. */}
        <div className="map-host" hidden={route.view !== 'map'}>
          <MapExplorer />
        </div>
      </main>
    </div>
  );
}
