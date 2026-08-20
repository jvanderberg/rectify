const build = new URL(self.location.href).searchParams.get('v') || 'dev';
self.RECTIFY_BUILD = build;
const assetUrl = name => new URL(`${name}?v=${encodeURIComponent(build)}`, self.location.href).href;
importScripts(
  assetUrl('ort.wasm.min.js'),
  assetUrl('model-detector.js')
);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
  mjs: assetUrl('ort-wasm-simd-threaded.mjs'),
  wasm: assetUrl('ort-wasm-simd-threaded.wasm')
};

let sessionPromise;
let lastReportedPercent = -1;
function reportProgress(loaded, total, phase = 'download') {
  const percent = total ? Math.round(loaded / total * 100) : -1;
  if (phase === 'download' && percent === lastReportedPercent) return;
  if (phase === 'download') lastReportedPercent = percent;
  self.postMessage({ progress: true, loaded, total, phase });
}

async function modelBytes() {
  const url = assetUrl('docaligner-fastvit-sa24.onnx');
  const request = new Request(url);
  const cache = await caches.open(`rectify-${build}`);
  let response = await cache.match(request);
  const cached = Boolean(response);
  if (!response) response = await fetch(new Request(request, { cache: 'reload' }));
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 83084930;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!cached) await cache.put(request, new Response(bytes, { headers: response.headers }));
    reportProgress(bytes.byteLength, total);
    return bytes;
  }

  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    reportProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!cached) await cache.put(request, new Response(bytes, { headers: response.headers }));
  return bytes;
}

function modelSession() {
  if (!sessionPromise) {
    sessionPromise = modelBytes().then(bytes => {
      reportProgress(1, 1, 'initializing');
      return ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
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
    self.postMessage({ id, error: modelError?.message || 'AI boundary detection failed' });
  }
};
