// Shared helpers for formatting people and dates.

export const CATEGORY_COLORS = {
  Leaders:       '#e05252',
  Scientists:    '#4a90e2',
  Artists:       '#b07fd8',
  Thinkers:      '#27ae80',
  Military:      '#e67e22',
  Explorers:     '#16a085',
  Sport:         '#7f8c8d',
  Entertainment: '#d081a8',
  Wars:          '#c0392b',
  Battles:       '#e74c3c',
  Revolutions:   '#f39c12',
  Events:        '#d4a017',
};

export const DEFAULT_DOT_COLOR = '#d4a017';

export const catColor = c => CATEGORY_COLORS[c] || DEFAULT_DOT_COLOR;

// Present year. Matches the constant the server uses for a living person.
export const CURRENT_YEAR = 2026;

export const formatYear = y => {
  if (y === null || y === undefined) return '?';
  return y < 0 ? `${Math.abs(y)} BCE` : `${y}`;
};

// The end of a lifespan as the site should draw it. A null death year means
// either the person is alive or nobody recorded it; the caller decides how to
// label that, this only gives a number to draw with.
export const effectiveEnd = p => {
  if (p.end_year !== null && p.end_year !== undefined) return p.end_year;
  return p.alive ? CURRENT_YEAR : p.start_year + 65;
};

// "1752 to 1792", "1935 to today", "c. 1280 to c. 1337"
export const lifespanLabel = p => {
  const circa = p.date_precision === 'circa' ? 'c. ' : '';
  const from = `${circa}${formatYear(p.start_year)}`;
  if (p.end_year === null || p.end_year === undefined) {
    return p.alive ? `${from} to today` : `${from}, death unknown`;
  }
  return `${from} to ${circa}${formatYear(p.end_year)}`;
};

// Age in whole years at a given year, or null when the date is not solid
// enough to state one.
export const ageInYear = (p, year) => {
  if (p.start_year === null || p.start_year === undefined) return null;
  const age = year - p.start_year;
  return age >= 0 ? age : null;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// "1890-07-29" -> "29 July 1890". Handles the BCE form Wikidata uses.
export const formatDate = iso => {
  if (!iso) return null;
  const neg = iso.startsWith('-');
  const body = neg ? iso.slice(1) : iso;
  const [y, m, d] = body.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS[m - 1]} ${neg ? `${y} BCE` : y}`;
};

export const api = async (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
};
