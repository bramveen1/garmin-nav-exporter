// POST /api/convert
// Body shapes accepted:
//   { "url": "https://maps.app.goo.gl/..." }
//   { "text": "Pinned location ... https://maps.app.goo.gl/..." }
//   { "url": "...", "name": "Trailhead" }
// Response: 200 with GPX 1.1 body (Content-Type: application/gpx+xml)
//          400 invalid input, 422 no coordinates extractable, 502 redirect fetch failed

const URL_RE =
  /https?:\/\/(?:www\.|maps\.)?(?:google\.[a-z.]+\/maps\S*|maps\.app\.goo\.gl\/[A-Za-z0-9_-]+|goo\.gl\/maps\/[A-Za-z0-9_-]+)/i;

const AT_RE = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,\d+(?:\.\d+)?[zmt])?/;
const BANG_RE = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/;
const Q_RE = /[?&]q=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
const SHORT_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

// Mobile UA: Google serves the mobile Maps page that embeds the viewport bootstrap
// (which contains lat/lng); the desktop page is JS-only and returns no coords inline.
const SCRAPE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function extractUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed) && !/\s/.test(trimmed)) return trimmed;
  const m = trimmed.match(URL_RE);
  return m ? m[0] : null;
}

function parseLatLng(url) {
  for (const re of [AT_RE, BANG_RE, Q_RE]) {
    const m = url.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (validCoord(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

function validCoord(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

async function resolveShortUrl(shortUrl) {
  let current = shortUrl;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; garmin-nav-exporter/1.0; +https://github.com/bramveen1/garmin-nav-exporter)',
      },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      if (!SHORT_RE.test(current)) return current;
      continue;
    }
    return current;
  }
  return current;
}

function getQueryParam(url, key) {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

function nameFromUrl(url) {
  const q = getQueryParam(url, 'q');
  if (!q) return null;
  const trimmed = q.trim();
  // Skip when q is itself coordinates ("lat,lng")
  if (/^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(trimmed)) return null;
  const first = trimmed.split(',')[0].trim();
  return first || null;
}

// New "place share" Maps URLs only carry an address + feature id (no @lat,lng).
// Google embeds the map viewport as a [scale, lng, lat] triple in inline bootstrap JS;
// for a place query the viewport is centered on the pin. Best-effort, may break if Google
// changes the format.
async function fetchCoordsFromPage(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': SCRAPE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let html;
  try {
    html = await res.text();
  } catch {
    return null;
  }
  const re = /\[(\d{2,7}(?:\.\d+)?),(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})\]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const scale = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    const lat = parseFloat(m[3]);
    if (scale > 10 && validCoord(lat, lng)) return { lat, lng };
  }
  return null;
}

async function nominatimSearch(query) {
  let res;
  try {
    res = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
        encodeURIComponent(query),
      {
        headers: {
          'User-Agent':
            'garmin-nav-exporter/1.0 (https://github.com/bramveen1/garmin-nav-exporter)',
          Accept: 'application/json',
        },
      }
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  return validCoord(lat, lng) ? { lat, lng } : null;
}

// Strip patterns that look like postcodes (US 5-digit, UK alphanumeric, Dutch 4-digit+2-letter,
// Canadian, etc.). Nominatim is picky about exact postcode matches; removing the postcode
// usually still leaves enough to geocode the street + city.
function stripPostcodes(s) {
  return s
    .replace(/\b\d{4}\s?[A-Z]{2}\b/gi, '') // NL, BE
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, '') // UK
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '') // US
    .replace(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi, '') // CA
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*,\s*,/g, ',')
    .trim();
}

// Fallback: geocode via OSM Nominatim (no API key, 1 req/s policy). Google's q= is typically
// "<place name>, <street>, <postcode> <city>"; if Nominatim misses, try progressively
// simpler variants — drop the business name, then drop the postcode.
async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  const seen = new Set();
  const variants = [];
  const push = (v) => {
    const t = v && v.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      variants.push(t);
    }
  };

  const trimmed = address.trim();
  push(trimmed);
  push(stripPostcodes(trimmed));
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const rest = parts.slice(1).join(', ');
    push(rest);
    push(stripPostcodes(rest));
  }

  for (const v of variants) {
    const hit = await nominatimSearch(v);
    if (hit) return hit;
  }
  return null;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

function buildGpx({ lat, lng, name, sourceUrl }) {
  const ts = new Date().toISOString();
  const wptName = escapeXml(name && name.trim() ? name.trim() : 'Google Maps Pin');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="garmin-nav-exporter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${wptName}</name>
    <time>${ts}</time>
    <link href="${escapeXml(sourceUrl)}"><text>Source</text></link>
  </metadata>
  <wpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">
    <name>${wptName}</name>
    <sym>Flag, Blue</sym>
  </wpt>
</gpx>
`;
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function safeFilename(name) {
  return (
    (name || 'waypoint')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'waypoint'
  );
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method !== 'POST')
    return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST' });

  const body = await readBody(req);
  if (body === null)
    return sendJson(res, 400, { error: 'invalid_json', message: 'Body must be valid JSON' });

  const candidate = body.url || body.text || '';
  const url = extractUrl(candidate);
  if (!url)
    return sendJson(res, 400, {
      error: 'no_url',
      message: 'No Google Maps URL found in url/text',
    });

  let resolved = url;
  if (SHORT_RE.test(url)) {
    try {
      resolved = await resolveShortUrl(url);
    } catch (err) {
      return sendJson(res, 502, {
        error: 'redirect_failed',
        message: 'Could not resolve short URL',
        detail: String(err && err.message ? err.message : err),
      });
    }
  }

  let coords = parseLatLng(resolved);
  if (!coords && resolved !== url) coords = parseLatLng(url);
  if (!coords) coords = await fetchCoordsFromPage(resolved);
  if (!coords) {
    const addr = getQueryParam(resolved, 'q');
    if (addr && !/^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(addr.trim())) {
      coords = await geocodeAddress(addr);
    }
  }
  if (!coords)
    return sendJson(res, 422, {
      error: 'no_coords',
      message: 'Could not extract coordinates from the URL',
      resolvedUrl: resolved,
    });

  const finalName =
    (body.name && body.name.trim()) || nameFromUrl(resolved) || nameFromUrl(url) || '';

  const gpx = buildGpx({
    lat: coords.lat,
    lng: coords.lng,
    name: finalName,
    sourceUrl: resolved,
  });

  const filename = `${safeFilename(finalName)}.gpx`;
  send(res, 200, gpx, {
    'Content-Type': 'application/gpx+xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
};

module.exports.extractUrl = extractUrl;
module.exports.parseLatLng = parseLatLng;
module.exports.buildGpx = buildGpx;
module.exports.resolveShortUrl = resolveShortUrl;
module.exports.fetchCoordsFromPage = fetchCoordsFromPage;
module.exports.geocodeAddress = geocodeAddress;
module.exports.nameFromUrl = nameFromUrl;
module.exports.getQueryParam = getQueryParam;
