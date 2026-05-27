import React, { useState, useEffect } from 'react';
import './App.css';

const FACE_THRESHOLD = 150;

const CATEGORY_COLORS = {
  Leaders: '#e05252',
  Scientists: '#4a90e2',
  Artists: '#b07fd8',
  Philosophers: '#27ae80',
  Military: '#e67e22',
  Explorers: '#16a085',
  Events: '#d4a017',
};
const DEFAULT_DOT_COLOR = '#d4a017';

const MIN_COINCIDENCE_DIST = 15; // roughly cross-continental minimum

const scoreCoincidence = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < MIN_COINCIDENCE_DIST) return 0;
  const importance = Math.sqrt((a.importance_score || 1) * (b.importance_score || 1));
  const categoryBonus = a.category !== b.category ? 1.4 : 1.0;
  return importance * dist * categoryBonus;
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
  const inside = pointsInBox(points, box).filter(p => (p.importance_score || 0) >= 20);
  const outside = points
    .filter(p => !pointsInBox([p], box).length && (p.importance_score || 0) >= 60 && p.thumbnailUrl);
  if (inside.length === 0 || outside.length === 0) return [];
  const pairs = [];
  for (const a of inside) {
    for (const b of outside) {
      pairs.push({ a, b, score: scoreCoincidence(a, b) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, n);
};

const findCoincidences = (points, n = 8) => {
  const candidates = points
    .filter(p => (p.importance_score || 0) >= 80 && p.thumbnailUrl)
    .slice(0, 40);
  const pairs = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      pairs.push({ a: candidates[i], b: candidates[j], score: scoreCoincidence(candidates[i], candidates[j]) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, n);
};

const formatYear = y => y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`;

const CoincidenceCard = ({ pair, onDismiss }) => {
  const [extractA, setExtractA] = useState('');
  const [extractB, setExtractB] = useState('');

  useEffect(() => {
    const fetchExtract = (entity, setter) => {
      if (!entity.wpTitle) return;
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.wpTitle)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.extract) setter(d.extract.split('.')[0] + '.'); })
        .catch(() => {});
    };
    fetchExtract(pair.a, setExtractA);
    fetchExtract(pair.b, setExtractB);
  }, [pair.a.id, pair.b.id]);

  const overlapStart = Math.max(pair.a.start_year, pair.b.start_year);
  const overlapEnd = Math.min(pair.a.end_year ?? 2024, pair.b.end_year ?? 2024);
  const overlapYears = Math.max(0, overlapEnd - overlapStart);

  return (
    <div className="coincidence-card animate-in">
      <button className="coincidence-dismiss" onClick={onDismiss}>x</button>
      <div className="coincidence-header">
        <span className="coincidence-label">Coincidence</span>
        {overlapYears > 0 && (
          <span className="coincidence-overlap">{overlapYears} yrs · {formatYear(overlapStart)} to {formatYear(overlapEnd)}</span>
        )}
      </div>
      <div className="coincidence-faces">
        <div className="coincidence-person">
          {pair.a.thumbnailUrl && <img src={pair.a.thumbnailUrl} alt={pair.a.name} />}
          <strong>{pair.a.name}</strong>
          <span className="coincidence-years">{formatYear(pair.a.start_year)} to {formatYear(pair.a.end_year ?? 2024)}</span>
          {pair.a.category && <span className="cat-badge" style={{ '--cat-color': CATEGORY_COLORS[pair.a.category] || DEFAULT_DOT_COLOR }}>{pair.a.category}</span>}
        </div>
        <div className="coincidence-symbol">&#x2229;</div>
        <div className="coincidence-person">
          {pair.b.thumbnailUrl && <img src={pair.b.thumbnailUrl} alt={pair.b.name} />}
          <strong>{pair.b.name}</strong>
          <span className="coincidence-years">{formatYear(pair.b.start_year)} to {formatYear(pair.b.end_year ?? 2024)}</span>
          {pair.b.category && <span className="cat-badge" style={{ '--cat-color': CATEGORY_COLORS[pair.b.category] || DEFAULT_DOT_COLOR }}>{pair.b.category}</span>}
        </div>
      </div>
      {(extractA || extractB) && (
        <p className="coincidence-text">
          {extractA}
          {extractA && extractB ? ' Meanwhile, ' : ''}
          {extractB}
        </p>
      )}
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

const Search = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/search-name?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => setResults(data));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="search-container">
      <input
        type="text"
        placeholder="Search for a name (e.g. Einstein, Plato)..."
        value={query}
        onChange={e => { setQuery(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
        className="search-input"
      />
      {showResults && results.length > 0 && (
        <div className="search-results">
          {results.map(r => (
            <div
              key={r.id}
              className="search-item"
              onClick={() => {
                onSelect(r);
                setQuery('');
                setShowResults(false);
              }}
            >
              <div className="search-item-left">
                <span className="search-item-name">{r.name}</span>
                <span className={`type-badge mini ${r.type}`}>{r.type}</span>
              </div>
              <span className="search-item-year">({r.start_year})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const HistorySparkline = ({ data, currentYear, onYearChange }) => {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map(d => d.count));
  const minYear = -1374;
  const maxYear = 2024;
  const range = maxYear - minYear;

  // Use a non-linear scale (square root) to boost low-density areas
  const points = data.map(d => {
    // Filter out data points before -1374 for the sparkline drawing
    if (d.decade < minYear) return null;
    const x = ((d.decade - minYear) / range) * 100;
    const y = 100 - (Math.sqrt(d.count) / Math.sqrt(maxCount)) * 100;
    return `${x},${y}`;
  }).filter(p => p !== null).join(' ');

  const currentX = ((currentYear - minYear) / range) * 100;

  const eras = [
    { name: 'Ancient', year: -1300 },
    { name: 'Classical', year: -400 },
    { name: 'Middle', year: 800 },
    { name: 'Renaiss.', year: 1550 },
    { name: 'Modern', year: 1940 }
  ];

  return (
    <div className="sparkline-container-wrapper">
      <div className="sparkline-container">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sparkline-svg">
          <polyline points={points} className="sparkline-path" />
          <line x1={currentX} y1="0" x2={currentX} y2="100" className="sparkline-indicator" />
        </svg>
      </div>
      <div className="timeline-markers">
        {eras.map(era => (
          <span 
            key={era.name} 
            onClick={() => onYearChange(era.year)}
            style={{ left: `${((era.year - minYear) / range) * 100}%`, position: 'absolute', transform: 'translateX(-50%)' }}
          >
            {era.name}
          </span>
        ))}
      </div>
    </div>
  );
};

const WorldMap = ({ points, onMapClick, selectedPoint, syncActive, onPointClick, coincidencePair, onCoincidenceClick, onSelectionChange }) => {
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

  const arcPath = coincidencePair && !syncActive ? (() => {
    const { a, b } = coincidencePair;
    const cx = (a.x + b.x) / 2;
    const cy = Math.max(2, (a.y + b.y) / 2 - 22);
    return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
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

        {arcPath && (
          <svg className="coincidence-arc-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={arcPath} className="coincidence-arc-path" />
          </svg>
        )}

        <div className={`map-overlay${syncActive ? ' sync-active' : ''}`} onClick={handleClick}>
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
                  zIndex: showThumb ? 100 : 10,
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
                  <span>{formatYear(p.start_year)}{p.end_year ? ` to ${formatYear(p.end_year)}` : ''}</span>
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
  const [selectedCoincidence, setSelectedCoincidence] = useState(null);
  const [zoneSelection, setZoneSelection] = useState(null);
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
        setSelectedCoincidence(null);
      }
      if (e.key === 'ArrowLeft') {
        setCoincidenceIndex(i => (i - 1 + coincidences.length) % coincidences.length);
        setSelectedCoincidence(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [syncMode, coincidences.length]);

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
            return {
              ...d,
              x: pos.x,
              y: pos.y,
              showFace: (d.importance_score || 0) >= FACE_THRESHOLD && d.type === 'person'
            };
          })
          .filter(p => p !== null);
        setHistoricalPoints(points);
        setZoneSelection(null);
        setCoincidences(findCoincidences(points));
        setCoincidenceIndex(0);
        setSelectedCoincidence(null);
      });
  }, [year, syncMode]);

  useEffect(() => {
    if (!historicalPoints.length) return;
    if (zoneSelection) {
      const pairs = findZoneCoincidences(historicalPoints, zoneSelection);
      setCoincidences(pairs.length > 0 ? pairs : findCoincidences(historicalPoints));
    } else {
      setCoincidences(findCoincidences(historicalPoints));
    }
    setCoincidenceIndex(0);
    setSelectedCoincidence(null);
  }, [zoneSelection]);

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
                  showFace: (d.importance_score || 0) >= FACE_THRESHOLD && d.type === 'person'
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
    setSelectedCoincidence(null);
  };

  const handleMapClick = region => {
    fetch(`/api/search-region?year=${year}&lat=${region.lat}&lon=${region.lon}`)
      .then(res => res.json())
      .then(data => { if (data.length > 0) startSynchronicity(data[0]); });
  };

  const handleBack = () => {
    setSyncMode(false);
    setSelectedEntity(null);
    setContemporaries([]);
  };

  const selectedPos = selectedEntity ? calculateXY(selectedEntity.latitude, selectedEntity.longitude) : null;
  if (selectedPos && selectedEntity) selectedPos.id = selectedEntity.id;

  return (
    <div className="app-container">
      <div className="map-stage">
        <WorldMap
          points={historicalPoints}
          onMapClick={handleMapClick}
          selectedPoint={selectedPos}
          syncActive={syncMode}
          onPointClick={startSynchronicity}
          coincidencePair={coincidencePair}
          onCoincidenceClick={setSelectedCoincidence}
          onSelectionChange={setZoneSelection}
        />
      </div>

      {selectedCoincidence && (
        <CoincidenceCard
          pair={selectedCoincidence}
          onDismiss={() => setSelectedCoincidence(null)}
        />
      )}

      <div className={`chaos-ui animate-fade-in ${syncMode ? 'minimized' : ''}`}>
        <div className="chaos-header">
          {!syncMode && <Search onSelect={startSynchronicity} />}
          <div className="year-row">
            <h1>{displayYear < 0 ? `${Math.abs(displayYear)} BCE` : `${displayYear} CE`}</h1>
            {!syncMode && coincidences.length > 1 && (
              <button
                className={`shuffle-btn${zoneSelection ? ' zone-active' : ''}`}
                title="Next coincidence"
                onClick={() => {
                  setCoincidenceIndex(i => (i + 1) % coincidences.length);
                  setSelectedCoincidence(null);
                }}
              >
                {zoneSelection ? 'Zone ' : ''}{coincidenceIndex + 1} / {coincidences.length}
              </button>
            )}
          </div>
          {!syncMode && <p className="map-instructions">Scroll to Zoom · Alt + Drag to Highlight Zone · Arrow Keys to cycle coincidences</p>}
        </div>
        <div className="timeline-wrapper">
          <HistorySparkline data={densityData} currentYear={displayYear} onYearChange={v => { setDisplayYear(v); setYear(v); }} />
          <input
            type="range"
            min="-1374"
            max="2024"
            value={displayYear}
            onChange={e => setDisplayYear(parseInt(e.target.value))}
            className="chaos-slider"
            style={{
              background: `linear-gradient(to right, var(--gold) 0%, var(--gold) ${((displayYear + 1374) / 3398) * 100}%, #e2e8f0 ${((displayYear + 1374) / 3398) * 100}%, #e2e8f0 100%)`
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
                      const overlapYrs = selectedEntity ? Math.max(0,
                        Math.min(e.end_year || 2024, selectedEntity.end_year || 2024) -
                        Math.max(e.start_year, selectedEntity.start_year)
                      ) : 0;
                      return (
                        <div key={e.id} className="contemporary-mini-card" onClick={() => startSynchronicity(e)}>
                          {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" />}
                          <div className="mini-info">
                            <strong>{e.name}</strong>
                            <span>{formatYear(e.start_year)} to {formatYear(e.end_year || 2024)}</span>
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
