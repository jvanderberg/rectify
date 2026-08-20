# Rectify

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

Boundary detection runs DocAligner's full-precision FastViT-SA24 corner-heatmap model locally in a Web Worker using ONNX Runtime Web. The 79 MB model replaces the much less capable LCNet100 checkpoint. Its initial four-corner estimate is refined against the image's full line gradients before the perspective correction is rendered. There is no automatic backup detector: a model failure is reported explicitly and the editor opens with manual corners.

The runtime is pre-cached with the versioned app shell. The model streams on first use with visible percentage feedback, is stored in the same versioned PWA cache, and is warmed while the start screen is idle. Photos are never uploaded.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

Run the regression checks with `node tests/model-detector.test.js`, `node tests/model-only.test.js`, and `node tests/cache-version.test.js`.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches only the app shell.
