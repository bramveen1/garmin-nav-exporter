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
  if (!coords)
    return sendJson(res, 422, {
      error: 'no_coords',
      message: 'Could not extract coordinates from the URL',
      resolvedUrl: resolved,
    });

  const gpx = buildGpx({
    lat: coords.lat,
    lng: coords.lng,
    name: body.name,
    sourceUrl: resolved,
  });

  const filename = `${safeFilename(body.name)}.gpx`;
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
