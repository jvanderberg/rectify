const build = new URL(self.location.href).searchParams.get('v') || 'dev';
self.RECTIFY_BUILD = build;
importScripts(`fast-detector.js?v=${encodeURIComponent(build)}`, `detector.js?v=${encodeURIComponent(build)}`);

async function openCvReady() {
  if (self.cv instanceof Promise) self.cv = await self.cv;
  const started = Date.now();
  while (!self.cv?.Mat) {
    if (Date.now() - started > 10000) throw new Error('OpenCV initialization timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return self.cv;
}

self.onmessage = async event => {
  const { id, rgba, width, height } = event.data;
  try {
    const pixels = new Uint8ClampedArray(rgba);
    try {
      const result = RectifyFastDetector.detectRgba(pixels, width, height);
      if (result.confidence >= .7) return self.postMessage({ id, points: result.points, detector: 'lines' });
    } catch {}
    importScripts(`opencv.js?v=${encodeURIComponent(build)}`);
    const cv = await openCvReady();
    const points = RectifyDetector.detectRgba(pixels, width, height, cv);
    self.postMessage({ id, points, detector: 'opencv' });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Boundary detection failed' });
  }
};
