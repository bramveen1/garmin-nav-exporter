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
line and a trailing URL).

## API

```
POST /api/convert
Content-Type: application/json

{ "url": "https://maps.app.goo.gl/abcDEF123" }
{ "text": "Pinned location\nhttps://www.google.com/maps/place/...@40.7,-74.0,17z" }
{ "url": "...", "name": "Trailhead" }
```

Responses:

| Status | Body                                                              |
| ------ | ----------------------------------------------------------------- |
| 200    | `application/gpx+xml` body, `Content-Disposition: attachment`     |
| 400    | `{ "error": "no_url" \| "invalid_json", "message": "..." }`        |
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

1. **Receive** *URLs* and *Text* from Share Sheet.
2. **Get Contents of URL**
   * URL: `https://<your-deployment>/api/convert`
   * Method: `POST`
   * Headers: `Content-Type: application/json`
   * Request Body: **JSON** →
     `text` = *Shortcut Input* (the magic variable)
3. **Save File** → choose iCloud Drive (or Files), name it `waypoint.gpx`.
4. (Optional) **Open File** in Garmin Connect to import directly.

In the Shortcut settings, enable **Show in Share Sheet** and check **URLs** +
**Text** as accepted input. From Maps: **Share** → **Save to Garmin**.

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
