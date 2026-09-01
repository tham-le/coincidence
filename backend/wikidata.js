// Shared Wikidata fetching used by the seeding and gap-filling harvesters.
//
// Both need the same three things for a person: real dates with their
// precision, a coordinate to put on the map, and the occupations that decide a
// category. Keeping the queries here means one place to fix when a fallback
// turns out to be wrong.

const axios = require('axios');

const UA = 'CoincidenceMap/1.0 (https://github.com/tham/coincidence; tham@kyber.tech)';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const PREC = { 11: 'day', 10: 'month', 9: 'year' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// "-0384-01-01T00:00:00Z" -> { year: -384, iso: "-0384-01-01", prec: "day" }
function parseTime(value, precision) {
  if (!value) return null;
  const m = value.match(/^(-?)(\d{4,})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const prec = PREC[parseInt(precision, 10)] || null;
  if (!prec) return null;
  return {
    year: (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10),
    iso: `${m[1]}${m[2]}-${m[3]}-${m[4]}`,
    prec,
  };
}

// The query service fails often under load: 502 and 504 when a query is heavy,
// 429 when we have been asking too fast. Retrying here rather than at each call
// site means one unlucky request cannot end a long harvest, which is what used
// to happen: fetchFacts was the one call with no retry around it, and a single
// 429 killed the whole run partway through.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function sparql(query, timeout = 120000, attempts = 4) {
  let backoff = 5000;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await axios.get(SPARQL_URL, {
        params: { query, format: 'json' },
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        timeout,
      });
      return res.data.results.bindings;
    } catch (e) {
      const status = e.response?.status;
      // A timeout or a dropped connection has no status and is worth retrying.
      if (attempt >= attempts || (status && !RETRYABLE.has(status))) throw e;

      let wait = backoff;
      if (status === 429) {
        // Being told to slow down is different from a server hiccup. Honour
        // Retry-After when it is sent, and wait far longer regardless.
        const after = parseInt(e.response.headers?.['retry-after'], 10);
        wait = Number.isFinite(after) ? after * 1000 : Math.max(backoff, 60000);
      }
      await sleep(wait);
      backoff = Math.min(backoff * 2, 120000);
    }
  }
}

// Facts for a known set of ids: dates, reach, birth-place coordinates and
// occupations.
async function fetchFacts(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const bindings = await sparql(`
SELECT ?item ?itemLabel ?birth ?bprec ?death ?dprec ?sitelinks ?lat ?lon
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?occ),"entity/"); separator=",") AS ?occs) WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item p:P569/psv:P569 ?bn . ?bn wikibase:timeValue ?birth ; wikibase:timePrecision ?bprec . }
  OPTIONAL { ?item p:P570/psv:P570 ?dn . ?dn wikibase:timeValue ?death ; wikibase:timePrecision ?dprec . }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks . }
  OPTIONAL { ?item wdt:P106 ?occ . }
  OPTIONAL {
    ?item wdt:P19 ?birthPlace .
    ?birthPlace wdt:P625 ?coord .
    BIND(geof:latitude(?coord) AS ?lat)
    BIND(geof:longitude(?coord) AS ?lon)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?birth ?bprec ?death ?dprec ?sitelinks ?lat ?lon`);

  const out = new Map();
  for (const b of bindings) {
    const id = b.item.value.split('/').pop();
    const rec = {
      label: b.itemLabel?.value || id,
      birth: parseTime(b.birth?.value, b.bprec?.value),
      death: parseTime(b.death?.value, b.dprec?.value),
      sitelinks: b.sitelinks ? parseInt(b.sitelinks.value, 10) : 0,
      lat: b.lat ? parseFloat(b.lat.value) : null,
      lon: b.lon ? parseFloat(b.lon.value) : null,
      occs: b.occs?.value ? b.occs.value.split(',').filter(Boolean) : [],
    };
    const prev = out.get(id);
    // Prefer the row that carries coordinates when an item appears twice.
    if (!prev || (prev.lat === null && rec.lat !== null)) out.set(id, rec);
  }
  return out;
}

// Wikidata records a birth place with coordinates for most Europeans and far
// fewer people elsewhere, so a first pass drops exactly the figures this site
// exists to show. These walk outward: place of death, place of work, country.
async function fetchFallbacks(ids) {
  const values = ids.map(id => `wd:${id}`).join(' ');
  const bindings = await sparql(`
SELECT ?item ?deathLat ?deathLon ?workLat ?workLon ?countryLat ?countryLon ?floruit ?fprec WHERE {
  VALUES ?item { ${values} }
  OPTIONAL {
    ?item wdt:P20 ?dp . ?dp wdt:P625 ?dc .
    BIND(geof:latitude(?dc) AS ?deathLat) BIND(geof:longitude(?dc) AS ?deathLon)
  }
  OPTIONAL {
    ?item wdt:P937 ?wp . ?wp wdt:P625 ?wc .
    BIND(geof:latitude(?wc) AS ?workLat) BIND(geof:longitude(?wc) AS ?workLon)
  }
  OPTIONAL {
    ?item wdt:P27 ?country . ?country wdt:P625 ?cc .
    BIND(geof:latitude(?cc) AS ?countryLat) BIND(geof:longitude(?cc) AS ?countryLon)
  }
  OPTIONAL { ?item p:P1317/psv:P1317 ?fn . ?fn wikibase:timeValue ?floruit ; wikibase:timePrecision ?fprec . }
}`);

  const out = new Map();
  for (const b of bindings) {
    const id = b.item.value.split('/').pop();
    const num = k => (b[k] ? parseFloat(b[k].value) : null);
    const rec = {
      death: [num('deathLat'), num('deathLon')],
      work: [num('workLat'), num('workLon')],
      country: [num('countryLat'), num('countryLon')],
      floruit: parseTime(b.floruit?.value, b.fprec?.value),
    };
    const filled = r => [r.death[0], r.work[0], r.country[0], r.floruit]
      .filter(v => v !== null && v !== undefined).length;
    const prev = out.get(id);
    if (!prev || filled(rec) > filled(prev)) out.set(id, rec);
  }
  return out;
}

// Applies the fallbacks in order and reports which one was used, so a run log
// shows how a figure got onto the map.
function applyFallback(facts, fb) {
  let via = null;
  if ((facts.lat === null || facts.lon === null) && fb) {
    for (const [key, label] of [['death', 'place of death'], ['work', 'place of work'], ['country', 'country']]) {
      const [lat, lon] = fb[key];
      if (lat !== null && lon !== null && !Number.isNaN(lat)) {
        facts.lat = lat;
        facts.lon = lon;
        via = label;
        break;
      }
    }
  }
  if (!facts.birth && fb?.floruit) {
    // A floruit is when someone was active, not when they were born. Back off
    // by a working lifetime, and keep precision at year so no card claims a day.
    facts.birth = { year: fb.floruit.year - 30, iso: null, prec: 'year' };
    via = via ? `${via} + floruit` : 'floruit';
  }
  return via;
}

// The summary column holds the whole Wikipedia REST response as a JSON string,
// which is what /api/entity hands back untouched.
async function fetchSummary(title) {
  try {
    const res = await axios.get(WP_REST + encodeURIComponent(String(title).replace(/ /g, '_')), {
      headers: { 'User-Agent': UA }, timeout: 20000,
    });
    if (res.data?.type === 'disambiguation') return { summary: null, thumbnail: null };
    return {
      summary: JSON.stringify(res.data),
      thumbnail: res.data.thumbnail?.source || null,
    };
  } catch {
    return { summary: null, thumbnail: null };
  }
}

module.exports = {
  UA, SPARQL_URL, sparql, sleep, parseTime,
  fetchFacts, fetchFallbacks, applyFallback, fetchSummary,
};
