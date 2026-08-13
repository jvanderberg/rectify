const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const worker = read('detector-worker.js');
const app = read('app.js');
const serviceWorker = read('sw.js');

assert.ok(worker.includes("detector: 'docaligner'"), 'worker must identify DocAligner results');
assert.ok(!worker.includes('RectifyFastDetector'), 'worker must not invoke a geometric fallback');
assert.ok(!worker.includes('fast-detector.js'), 'worker must not load a geometric fallback');
assert.ok(!app.includes('detectQuadrilateral'), 'app must not invoke the legacy ray fallback');
assert.ok(app.includes('AI edge detection failed'), 'model failure must be visible to the user');
assert.ok(!serviceWorker.includes('fast-detector.js'), 'fallback must not remain in the offline cache');

console.log('DocAligner is the only automatic boundary detector.');
