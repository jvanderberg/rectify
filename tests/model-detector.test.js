const assert = require('node:assert/strict');
const detector = require('../model-detector.js');

const rgba = new Uint8ClampedArray([10, 20, 30, 255]);
class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
}
const input = detector.tensorFromRgba(rgba, 1, 1, Tensor);
assert.deepEqual(input.dims, [1, 3, 256, 256]);
assert.ok(Math.abs(input.data[0] - 30 / 255) < 1e-7, 'the first plane should be OpenCV blue');
assert.ok(Math.abs(input.data[256 * 256] - 20 / 255) < 1e-7, 'the second plane should be green');
assert.ok(Math.abs(input.data[2 * 256 * 256] - 10 / 255) < 1e-7, 'the third plane should be red');

const heatmap = { dims: [1, 4, 8, 8], data: new Float32Array(4 * 8 * 8) };
for (const [channel, x, y] of [[0, 1, 1], [1, 6, 1], [2, 6, 6], [3, 1, 6]]) {
  heatmap.data[channel * 64 + y * 8 + x] = .9;
}
const points = detector.pointsFromHeatmap(heatmap, 80, 80);
assert.deepEqual(points, [
  { x: 15, y: 15 }, { x: 65, y: 15 }, { x: 65, y: 65 }, { x: 15, y: 65 }
]);
assert.equal(detector.isPlausibleQuad(points, 80, 80), true);
assert.equal(detector.isPlausibleQuad([points[0], points[0], points[2], points[3]], 80, 80), false);

const weakHeatmap = { dims: [1, 4, 8, 8], data: new Float32Array(4 * 8 * 8).fill(.1) };
assert.throws(() => detector.pointsFromHeatmap(weakHeatmap, 80, 80), /confidence is too low/);

console.log('Model preprocessing, heatmap decoding, and quality guard passed.');
