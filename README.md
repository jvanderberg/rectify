# Rectify

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

Boundary detection uses the official OpenCV.js 4.13 WebAssembly build (`opencv.js`, SHA-256 `63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0`) with a multi-pass Canny/threshold, morphology, contour, polygon-approximation, and quadrilateral-scoring pipeline. Detection runs in a Web Worker with bounded candidate processing and an eight-second fallback cutoff. The WASM bundle loads on demand, is cached after its first use, and is preserved across app-shell cache upgrades.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches only the app shell.
