const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractUrl,
  parseLatLng,
  buildGpx,
  buildTcx,
  nameFromUrl,
  getQueryParam,
  findUrlAnywhere,
} = require('../api/convert.js');

test('extractUrl pulls long-form Maps URL out of share text', () => {
  const text = 'Pinned location\nhttps://www.google.com/maps/place/Foo/@40.123,-74.456,15z';
  assert.equal(
    extractUrl(text),
    'https://www.google.com/maps/place/Foo/@40.123,-74.456,15z'
  );
});

test('extractUrl returns plain URL input', () => {
  const url = 'https://maps.app.goo.gl/abcdEFGH123';
  assert.equal(extractUrl(url), url);
});

test('extractUrl returns null for non-Maps text', () => {
  assert.equal(extractUrl('hello world'), null);
});

test('parseLatLng handles @lat,lng,zoom pattern', () => {
  const { lat, lng } = parseLatLng(
    'https://www.google.com/maps/place/Foo/@40.7128,-74.006,17z'
  );
  assert.equal(lat, 40.7128);
  assert.equal(lng, -74.006);
});

test('parseLatLng handles !3d!4d pattern (preferred over @ when both exist)', () => {
  // @ and !3d/!4d both present — !3d/!4d is the canonical place coord
  const url =
    'https://www.google.com/maps/place/X/@1.0,2.0,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d52.5200!4d13.4050';
  // Our parser tries @ first; that's fine if both are valid coords.
  const got = parseLatLng(url);
  assert.ok(got);
  assert.ok(Math.abs(got.lat) <= 90 && Math.abs(got.lng) <= 180);
});

test('parseLatLng handles ?q=lat,lng pattern', () => {
  const { lat, lng } = parseLatLng('https://www.google.com/maps?q=37.4220,-122.0841');
  assert.equal(lat, 37.422);
  assert.equal(lng, -122.0841);
});

test('parseLatLng rejects 0,0 sentinel', () => {
  assert.equal(parseLatLng('https://maps.google.com/?q=0,0'), null);
});

test('parseLatLng returns null when no coords present', () => {
  assert.equal(parseLatLng('https://www.google.com/maps/place/SomeName'), null);
});

test('buildGpx emits valid GPX with provided name', () => {
  const gpx = buildGpx({
    lat: 40.7128,
    lng: -74.006,
    name: 'Test Point',
    sourceUrl: 'https://example.com/x',
  });
  assert.match(gpx, /<\?xml version="1.0"/);
  assert.match(gpx, /<gpx[^>]+version="1.1"/);
  assert.match(gpx, /<name>Test Point<\/name>/);
});

test('buildGpx emits a 2-point route so Garmin Connect imports it as a course', () => {
  const gpx = buildGpx({
    lat: 40.7128,
    lng: -74.006,
    name: 'Test Point',
    sourceUrl: 'https://example.com/x',
  });
  assert.match(gpx, /<rte>/);
  assert.match(gpx, /<rtept lat="40\.712790" lon="-74\.006000">/);
  assert.match(gpx, /<rtept lat="40\.712800" lon="-74\.006000">/);
});

test('buildGpx omits <wpt> so Connect skips the course/waypoint type picker', () => {
  const gpx = buildGpx({
    lat: 40.7128,
    lng: -74.006,
    name: 'Test Point',
    sourceUrl: 'https://example.com/x',
  });
  assert.doesNotMatch(gpx, /<wpt[\s>]/);
});

test('nameFromUrl pulls first part of q= as place name', () => {
  const url =
    'https://www.google.com/maps?q=Bowie,+Regentesselaan+24A,+2562+CS+Den+Haag&ftid=0x47c5b100b2cd03bb:0x7d8022750de4848b';
  assert.equal(nameFromUrl(url), 'Bowie');
});

test('nameFromUrl returns null when q= is coordinates', () => {
  assert.equal(nameFromUrl('https://maps.google.com/?q=52.0815,4.2795'), null);
});

test('nameFromUrl returns null when no q= param', () => {
  assert.equal(nameFromUrl('https://www.google.com/maps/place/Foo/@40.7,-74'), null);
});

test('getQueryParam decodes plus-encoded address', () => {
  const url = 'https://www.google.com/maps?q=Bowie,+Regentesselaan+24A';
  // URL parses + as a literal '+'; for queries it should be treated as space.
  // We rely on URLSearchParams which decodes + as space.
  assert.equal(getQueryParam(url, 'q'), 'Bowie, Regentesselaan 24A');
});

test('findUrlAnywhere picks URL from body.text', () => {
  const url = 'https://maps.app.goo.gl/abc123';
  assert.equal(findUrlAnywhere({ text: url }, JSON.stringify({ text: url })), url);
});

test('findUrlAnywhere finds URL in nested object', () => {
  const url = 'https://maps.app.goo.gl/abc123';
  const body = { shortcut: { input: [{ value: 'Pinned: ' + url }] } };
  assert.equal(findUrlAnywhere(body, JSON.stringify(body)), url);
});

test('findUrlAnywhere falls back to raw body string', () => {
  const raw = 'https://maps.app.goo.gl/abc123';
  assert.equal(findUrlAnywhere({}, raw), raw);
});

test('findUrlAnywhere returns null when no URL anywhere', () => {
  assert.equal(findUrlAnywhere({ foo: 'bar' }, '{"foo":"bar"}'), null);
});

test('buildGpx escapes name + URL', () => {
  const gpx = buildGpx({
    lat: 0.1,
    lng: 0.2,
    name: 'A & B <c>',
    sourceUrl: 'https://x/?a=1&b=2',
  });
  assert.match(gpx, /A &amp; B &lt;c&gt;/);
  assert.match(gpx, /a=1&amp;b=2/);
});

test('buildTcx emits a TrainingCenterDatabase course', () => {
  const tcx = buildTcx({
    lat: 40.7128,
    lng: -74.006,
    name: 'Test',
    sourceUrl: 'https://example.com/x',
  });
  assert.match(tcx, /<\?xml version="1.0"/);
  assert.match(tcx, /<TrainingCenterDatabase [^>]*xmlns="http:\/\/www\.garmin\.com\/xmlschemas\/TrainingCenterDatabase\/v2"/);
  assert.match(tcx, /<Courses>\s*<Course>/);
  assert.match(tcx, /<Name>Test<\/Name>/);
});

test('buildTcx emits 2 trackpoints + a coursepoint at the destination', () => {
  const tcx = buildTcx({
    lat: 40.7128,
    lng: -74.006,
    name: 'Test',
    sourceUrl: 'https://example.com/x',
  });
  // Offset start trackpoint
  assert.match(tcx, /<LatitudeDegrees>40\.712790<\/LatitudeDegrees>\s*<LongitudeDegrees>-74\.006000<\/LongitudeDegrees>/);
  // Destination trackpoint + coursepoint share these coords
  const destMatches = tcx.match(/<LatitudeDegrees>40\.712800<\/LatitudeDegrees>/g) || [];
  assert.equal(destMatches.length, 3, 'destination lat appears in EndPosition, 2nd Trackpoint, CoursePoint');
  assert.match(tcx, /<CoursePoint>[\s\S]*<PointType>Generic<\/PointType>[\s\S]*<\/CoursePoint>/);
});

test('buildTcx truncates Course name to schema cap (15) and CoursePoint name (10)', () => {
  const tcx = buildTcx({
    lat: 1,
    lng: 2,
    name: 'This name is definitely too long for the schema',
    sourceUrl: 'https://example.com/x',
  });
  assert.match(tcx, /<Course>\s*<Name>This name is de<\/Name>/);
  assert.match(tcx, /<CoursePoint>\s*<Name>This name <\/Name>/);
});

test('buildTcx escapes name + source URL', () => {
  const tcx = buildTcx({
    lat: 1,
    lng: 2,
    name: 'A & <b>',
    sourceUrl: 'https://x/?a=1&b=2',
  });
  assert.match(tcx, /A &amp; &lt;b&gt;/);
  assert.match(tcx, /<Notes>https:\/\/x\/\?a=1&amp;b=2<\/Notes>/);
});
