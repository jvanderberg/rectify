(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RectifyDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const build = typeof globalThis !== 'undefined' && globalThis.RECTIFY_BUILD ? globalThis.RECTIFY_BUILD : 'dev';
  let worker, requestId = 0;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(`detector-worker.js?v=${encodeURIComponent(build)}`);
    worker.onmessage = event => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id); clearTimeout(request.timeout);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data);
    };
    worker.onerror = () => reset(new Error('Detector worker failed'));
    return worker;
  }

  function send(message, transfer, timeoutMs) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id); reset(new Error('Detector timed out')); reject(new Error('Detector timed out'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      ensureWorker().postMessage({ id, ...message }, transfer);
    });
  }

  async function detect(canvas) {
    const maxSide = 960, scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale)), height = Math.max(1, Math.round(canvas.height * scale));
    const work = document.createElement('canvas'); work.width = width; work.height = height;
    const context = work.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const result = await send({ rgba: image.data.buffer, width, height }, [image.data.buffer], 12000);
    return result.points.map(point => ({ x: point.x / scale, y: point.y / scale }));
  }

  function warmup() {
    if (typeof Worker === 'undefined') return Promise.resolve();
    return send({ type: 'warmup' }, [], 20000).catch(() => {});
  }

  function reset(error) {
    worker?.terminate(); worker = null;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error); }
    pending.clear();
  }

  return { detect, warmup };
});
