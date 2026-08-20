const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const worker = read('detector-worker.js');
const app = read('app.js');
const serviceWorker = read('sw.js');

assert.ok(worker.includes("detector: 'docaligner'"), 'worker must identify DocAligner results');
assert.ok(worker.includes('docaligner-fastvit-sa24.onnx'), 'worker must load the FastViT checkpoint');
assert.ok(!worker.includes('lcnet'), 'worker must not load the rejected LCNet checkpoint');
assert.ok(!worker.includes('RectifyFastDetector'), 'worker must not invoke a geometric fallback');
assert.ok(!worker.includes('fast-detector.js'), 'worker must not load a geometric fallback');
assert.ok(!app.includes('detectQuadrilateral'), 'app must not invoke the legacy ray fallback');
assert.ok(app.includes('AI edge detection failed'), 'model failure must be visible to the user');
assert.ok(!serviceWorker.includes('fast-detector.js'), 'fallback must not remain in the offline cache');
assert.ok(!serviceWorker.includes('docaligner-fastvit-sa24.onnx'), 'large model must cache on demand, not block service-worker install');
assert.ok(worker.includes("caches.open(`rectify-${build}`)"), 'downloaded model must enter the versioned PWA cache');
assert.ok(worker.includes('reportProgress(loaded, total)'), 'model download must report byte progress');
assert.ok(worker.includes("const assetUrl = name => new URL("), 'worker assets must use absolute browser-resolvable URLs');
assert.ok(worker.includes("mjs: assetUrl('ort-wasm-simd-threaded.mjs')"), 'versioned runtime module must not be a bare specifier');
assert.ok(worker.includes("assetUrl('docaligner-fastvit-sa24.onnx')"), 'model cache key must include the current build URL');
assert.ok(worker.includes('`${name}?v=${encodeURIComponent(build)}`'), 'every worker asset URL must be cache-busted by build');
assert.ok(serviceWorker.includes('keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))'), 'activation must delete every stale model cache');
assert.ok(serviceWorker.includes("url.pathname.endsWith('.onnx')"), 'service worker must let the model worker stream downloads');

console.log('DocAligner is the only automatic boundary detector.');
