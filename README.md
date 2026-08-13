# Rectify

An installable, offline-capable photo straightener. It detects the edges of a photographed print, lets the user refine all four corners, and performs perspective correction entirely in the browser.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Camera access requires HTTPS when not using localhost.

## Privacy

Images stay in browser memory and are never uploaded. The service worker caches only the app shell.
