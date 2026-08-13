# Rectify

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

Boundary detection starts with a small line-based detector in a Web Worker: adaptive Sobel edges, a bounded Hough transform, opposite-line pairing, and quadrilateral scoring. Confident results return without loading WebAssembly. Uncertain images fall back to the official OpenCV.js 4.13 WebAssembly build (`opencv.js`, SHA-256 `63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0`) with a multi-pass contour pipeline and a 2.5-second overall cutoff. The WASM bundle loads on demand, is cached after its first use, and is preserved across app-shell cache upgrades.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

Run the lightweight detector regression suite with `node tests/fast-detector.test.js`.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches only the app shell.
