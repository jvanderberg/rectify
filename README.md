# Rectify

**[Open the Rectify PWA](https://jvanderberg.github.io/rectify/)**

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

## Features

- Take a photo or choose one from the photo library.
- Detect the four corners of a printed photo on-device.
- Adjust corners manually with touch-friendly controls.
- Correct perspective and save the rectangular result.
- Install as a fullscreen PWA and use it offline after initial setup.

Boundary detection uses DocAligner FastViT-SA24 in a Web Worker through ONNX Runtime Web. The app shows download progress while preparing the model and caches it for later use.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

Run the regression checks with `node tests/model-detector.test.js`, `node tests/model-only.test.js`, and `node tests/cache-version.test.js`.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches the app and on-device model.
