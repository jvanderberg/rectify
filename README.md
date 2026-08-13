# Rectify

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

Boundary detection runs DocAligner's LCNet100 corner-heatmap model locally in a Web Worker using ONNX Runtime Web. Its initial four-corner estimate is refined against the image's full line gradients before the perspective correction is rendered. A small geometric detector remains as an offline-safe fallback if WebAssembly initialization fails.

The model and runtime are pre-cached with the rest of the versioned PWA, warmed while the start screen is idle, and never upload the user's photo.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

Run the regression checks with `node tests/fast-detector.test.js` and `node tests/cache-version.test.js`.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches only the app shell.
