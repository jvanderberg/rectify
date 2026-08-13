importScripts('detector.js', 'opencv.js');

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
    const cv = await openCvReady();
    const points = RectifyDetector.detectRgba(new Uint8ClampedArray(rgba), width, height, cv);
    self.postMessage({ id, points });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Boundary detection failed' });
  }
};
