# garmin-nav-exporter

A tiny PWA + serverless function that turns a shared **Google Maps** location
into a **GPX waypoint file** you can import into Garmin Connect or copy onto a
Garmin Edge / GPSMAP unit.

Single-shot scope: one shared link → one waypoint. No turn-by-turn routing, no
multi-stop trips, no third-party mapping services.

## How it works

```
Maps share → /api/convert (POST JSON) → GPX 1.1 download
```

The API understands three Google Maps URL shapes:

| Shape                                                      | Example                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `@lat,lng,zoom` in the path                                | `https://www.google.com/maps/.../@40.7128,-74.0060,17z`         |
| `!3d<lat>!4d<lng>` in the data segment                     | `https://www.google.com/maps/place/X/data=...!3d52.52!4d13.41`  |
| Short link `maps.app.goo.gl/<id>` (resolved via redirects) | `https://maps.app.goo.gl/abcDEF123`                             |

If the body field is `text` rather than `url`, the URL is extracted from
anywhere in the string (Android Maps shares typically include a leading title
line and a trailing URL). The server also scans nested JSON values and
falls back to the raw body, so awkward client serializations still work.

New-style "place share" links (`maps.app.goo.gl/...` that resolve to
`google.com/maps?q=<address>&ftid=<id>` without coords) are handled too: the
API scrapes the Maps page for the viewport center, and falls back to OSM
Nominatim geocoding of the address.

## API

```
GET  /api/convert?url=<maps URL>[&name=<waypoint name>]
POST /api/convert
Content-Type: application/json | text/plain | application/x-www-form-urlencoded

{ "url": "https://maps.app.goo.gl/abcDEF123" }
{ "text": "Pinned location\nhttps://www.google.com/maps/place/...@40.7,-74.0,17z" }
{ "url": "...", "name": "Trailhead" }
```

Query-string params (`?url=`, `?text=`, `?name=`, `?debug=1`) work on both GET
and POST; on POST they override the body if both are present.

Append `?debug=1` to get an echo of the parsed body and the URL the server
extracted, instead of a GPX file. Useful when an iOS Shortcut or external
client misbehaves.

Responses:

| Status | Body                                                              |
| ------ | ----------------------------------------------------------------- |
| 200    | `application/gpx+xml` body, `Content-Disposition: attachment`     |
| 400    | `{ "error": "no_url", "message": "...", "hint": "..." }`           |
| 422    | `{ "error": "no_coords", "message": "...", "resolvedUrl": "..." }` |
| 502    | `{ "error": "redirect_failed", "message": "...", "detail": "..." }`|

## Using it from your phone

### Android

1. Open the deployed site once in Chrome.
2. Menu → **Add to Home Screen** (or **Install app**).
3. From Google Maps: **Share** → pick **Maps→GPX**. The app opens with the
   shared text prefilled and auto-converts.
4. Save the resulting `.gpx` to Files / Drive, then upload it to
   <https://connect.garmin.com> (Training → Courses / Saved Locations) or copy
   it to `GARMIN/NewFiles` over USB.

### iOS

iOS does not support Web Share Target, so use a Shortcut. Create one called
**Save to Garmin** with these actions:

1. **Receive** *URLs* from Share Sheet.
2. **URL Encode** *Shortcut Input* (Text Encoding → URL Encode).
3. **Text** action: `https://<your-deployment>/api/convert?url=`
   followed by the *URL Encoded Text* magic variable from step 2.
4. **Get Contents of URL**
   * URL: the *Text* from step 3
   * Method: `GET`
   * Request Body: *(none)*
5. **Save File** → choose iCloud Drive (or Files), name it `waypoint.gpx`.
6. (Optional) **Open File** in Garmin Connect to import directly.

In the Shortcut settings, enable **Show in Share Sheet** and check **URLs**.
From Maps: **Share** → **Save to Garmin**.

GET with `?url=` is the simplest path because there's no Request Body field to
get wrong. POST with a JSON body works too — the API accepts JSON, form-
urlencoded, raw `text/plain`, and falls back to the query string. If something
looks off, change the URL to `https://<your-deployment>/api/convert?debug=1&url=...`
and the response will echo back exactly what reached the server (method,
content-type, body, and the URL it extracted).

You can also just open the deployed site and paste the link into the textarea.

## Local development

```bash
# Run the unit tests for the URL/coord/GPX logic
npm test

# Serve the static frontend
npx --yes serve public

# (Optional) full Vercel emulation, including /api/convert
npm i -g vercel
vercel dev
```

The serverless function lives at `api/convert.js` and uses only Node 20
built-ins (`fetch`, no third-party packages).

## Deploying

Push to a Git repo and import it into [Vercel](https://vercel.com). No build
configuration needed:

* `public/` is served as static assets.
* `api/convert.js` is exposed as `POST /api/convert`.
* `vercel.json` sets correct headers for the service worker and manifest.

## License

MIT — see [LICENSE](./LICENSE).
