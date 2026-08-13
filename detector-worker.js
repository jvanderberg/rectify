const build = new URL(self.location.href).searchParams.get('v') || 'dev';
self.RECTIFY_BUILD = build;
importScripts(
  `ort.wasm.min.js?v=${encodeURIComponent(build)}`,
  `model-detector.js?v=${encodeURIComponent(build)}`,
  `fast-detector.js?v=${encodeURIComponent(build)}`
);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
  mjs: `ort-wasm-simd-threaded.mjs?v=${encodeURIComponent(build)}`,
  wasm: `ort-wasm-simd-threaded.wasm?v=${encodeURIComponent(build)}`
};

let sessionPromise;
function modelSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(`docaligner-lcnet100.onnx?v=${encodeURIComponent(build)}`, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
  }
  return sessionPromise;
}

self.onmessage = async event => {
  const { id, type, rgba, width, height } = event.data;
  try {
    const session = await modelSession();
    if (type === 'warmup') return self.postMessage({ id, ready: true });
    const pixels = new Uint8ClampedArray(rgba);
    const points = await RectifyModelDetector.detect(session, ort.Tensor, pixels, width, height);
    self.postMessage({ id, points, detector: 'docaligner' });
  } catch (modelError) {
    if (type === 'warmup') return self.postMessage({ id, error: modelError?.message || 'Model initialization failed' });
    try {
      const result = RectifyFastDetector.detectRgba(new Uint8ClampedArray(rgba), width, height);
      self.postMessage({ id, points: result.points, detector: 'lines' });
    } catch {
      self.postMessage({ id, error: modelError?.message || 'Boundary detection failed' });
    }
  }
};
