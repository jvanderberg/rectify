(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RectifyDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  let openCvPromise;
  let worker;
  let workerRequest = 0;
  const pending = new Map();

  function loadOpenCv() {
    if (typeof window === 'undefined') return Promise.reject(new Error('OpenCV loader requires a browser'));
    if (window.cv?.Mat) return Promise.resolve(window.cv);
    if (openCvPromise) return openCvPromise;
    openCvPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'opencv.js';
      script.async = true;
      script.onerror = () => reject(new Error('Could not load the on-device detector'));
      script.onload = async () => {
        try {
          if (window.cv instanceof Promise) window.cv = await window.cv;
          const started = performance.now();
          const wait = () => {
            if (window.cv?.Mat) return resolve(window.cv);
            if (performance.now() - started > 20000) return reject(new Error('Detector initialization timed out'));
            setTimeout(wait, 25);
          };
          wait();
        } catch (error) { reject(error); }
      };
      document.head.appendChild(script);
    });
    return openCvPromise;
  }

  async function detect(canvas) {
    if (typeof Worker !== 'undefined') return detectInWorker(canvas);
    const cv = await loadOpenCv();
    const maxSide = 700;
    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const quad = detectRgba(rgba, width, height, cv);
    return quad.map(point => ({ x: point.x / scale, y: point.y / scale }));
  }

  function detectInWorker(canvas) {
    const maxSide = 700;
    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    if (!worker) {
      worker = new Worker('detector-worker.js');
      worker.onmessage = event => {
        const request = pending.get(event.data.id);
        if (!request) return;
        pending.delete(event.data.id);
        clearTimeout(request.timeout);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.points.map(point => ({ x: point.x / request.scale, y: point.y / request.scale })));
      };
      worker.onerror = () => resetWorker(new Error('Detector worker failed'));
    }
    const id = ++workerRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        resetWorker(new Error('Detector timed out'));
        reject(new Error('Detector timed out'));
      }, 8000);
      pending.set(id, { resolve, reject, scale, timeout });
      worker.postMessage({ id, rgba: image.data.buffer, width, height }, [image.data.buffer]);
    });
  }

  function resetWorker(error) {
    worker?.terminate(); worker = null;
    for (const request of pending.values()) {
      clearTimeout(request.timeout); request.reject(error);
    }
    pending.clear();
  }

  function detectRgba(rgba, width, height, cv) {
    const mats = [];
    const keep = mat => (mats.push(mat), mat);
    try {
      const src = keep(cv.matFromArray(height, width, cv.CV_8UC4, rgba));
      const gray = keep(new cv.Mat());
      const blurred = keep(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      const edgeMaps = [];
      const edges = keep(new cv.Mat());
      cv.Canny(blurred, edges, 35, 110, 3, true);
      edgeMaps.push({ mat: edges, closeSizes: [5, 11] });

      // Printed-photo borders are often low contrast or locally shadowed. Adaptive
      // thresholding adds region boundaries that Canny alone can miss.
      const adaptive = keep(new cv.Mat());
      cv.adaptiveThreshold(blurred, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 7);
      edgeMaps.push({ mat: adaptive, closeSizes: [5, 11] });

      const otsu = keep(new cv.Mat());
      cv.threshold(blurred, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      edgeMaps.push({ mat: otsu, closeSizes: [7] });

      const candidates = [];
      for (const { mat: base, closeSizes } of edgeMaps) {
        for (const closeSize of closeSizes) {
          const processed = new cv.Mat();
          const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeSize, closeSize));
          try {
            cv.morphologyEx(base, processed, cv.MORPH_CLOSE, kernel);
            if (base === edges) cv.dilate(processed, processed, kernel, new cv.Point(-1, -1), 1);
            collectCandidates(processed, edges, width, height, cv, candidates);
          } finally { processed.delete(); kernel.delete(); }
        }
      }

      if (!candidates.length) throw new Error('No plausible photo boundary found');
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].points;
    } finally {
      for (let i = mats.length - 1; i >= 0; i--) {
        try { mats[i].delete(); } catch {}
      }
    }
  }

  function collectCandidates(binary, edgeReference, width, height, cv, candidates) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const imageArea = width * height;
    const minArea = imageArea * 0.06;
    try {
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const plausible = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = Math.abs(cv.contourArea(contour));
        if (area >= minArea && area <= imageArea * 0.995) plausible.push({ contour, area });
        else contour.delete();
      }
      plausible.sort((a, b) => b.area - a.area);
      try {
        for (const { contour, area: contourArea } of plausible.slice(0, 80)) {
          const perimeter = cv.arcLength(contour, true);
          for (const epsilon of [0.012, 0.018, 0.025, 0.035, 0.05]) {
            const approx = new cv.Mat();
            try {
              cv.approxPolyDP(contour, approx, perimeter * epsilon, true);
              if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
              const raw = [];
              for (let p = 0; p < 4; p++) raw.push({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] });
              const points = orderPoints(raw);
              const score = scoreQuad(points, contourArea, edgeReference, width, height);
              if (Number.isFinite(score)) candidates.push({ points, score });
            } finally { approx.delete(); }
          }
        }
      } finally { for (const { contour } of plausible) contour.delete(); }
    } finally { contours.delete(); hierarchy.delete(); }
  }

  function scoreQuad(points, contourArea, edges, width, height) {
    const area = polygonArea(points);
    const imageArea = width * height;
    const areaRatio = area / imageArea;
    if (areaRatio < 0.06 || areaRatio > 0.97) return -Infinity;

    const lengths = points.map((point, i) => distance(point, points[(i + 1) % 4]));
    if (Math.min(...lengths) < Math.min(width, height) * 0.08) return -Infinity;
    const estimatedWidth = (lengths[0] + lengths[2]) / 2;
    const estimatedHeight = (lengths[1] + lengths[3]) / 2;
    const aspect = estimatedWidth / estimatedHeight;
    if (aspect < 0.22 || aspect > 4.5) return -Infinity;

    let anglePenalty = 0;
    for (let i = 0; i < 4; i++) {
      const prev = points[(i + 3) % 4], here = points[i], next = points[(i + 1) % 4];
      const angle = cornerAngle(prev, here, next);
      if (angle < 28 || angle > 152) return -Infinity;
      anglePenalty += Math.abs(angle - 90) / 90;
    }

    const margin = Math.min(width, height) * 0.012;
    const borderPoints = points.filter(p => p.x < margin || p.y < margin || p.x > width - margin || p.y > height - margin).length;
    const center = { x: width / 2, y: height / 2 };
    const containsCenter = pointInPolygon(center, points) ? 1 : 0;
    const edgeSupport = boundarySupport(points, edges, width, height);
    const contourFit = Math.min(contourArea, area) / Math.max(contourArea, area);

    // Edge evidence dominates. Area helps choose the full print over internal frames;
    // border penalties stop the camera frame/image boundary from winning.
    return edgeSupport * 7 + Math.sqrt(areaRatio) * 2.2 + contourFit * 1.4 + containsCenter * 0.8 - anglePenalty * 0.7 - borderPoints * 1.15;
  }

  function boundarySupport(points, edges, width, height) {
    const data = edges.data;
    let hits = 0, samples = 0;
    for (let side = 0; side < 4; side++) {
      const a = points[side], b = points[(side + 1) % 4];
      const length = distance(a, b);
      const count = Math.max(10, Math.round(length / 5));
      for (let i = 0; i <= count; i++) {
        const t = i / count, x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
        let found = false;
        for (let oy = -3; oy <= 3 && !found; oy++) for (let ox = -3; ox <= 3; ox++) {
          const sx = x + ox, sy = y + oy;
          if (sx >= 0 && sy >= 0 && sx < width && sy < height && data[sy * width + sx] > 0) { found = true; break; }
        }
        hits += found ? 1 : 0; samples++;
      }
    }
    return samples ? hits / samples : 0;
  }

  function orderPoints(points) {
    const center = { x: points.reduce((s, p) => s + p.x, 0) / 4, y: points.reduce((s, p) => s + p.y, 0) / 4 };
    const cyclic = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    let start = 0;
    for (let i = 1; i < 4; i++) if (cyclic[i].x + cyclic[i].y < cyclic[start].x + cyclic[start].y) start = i;
    const ordered = cyclic.map((_, i) => cyclic[(start + i) % 4]);
    if (ordered[1].x < ordered[3].x) return [ordered[0], ordered[3], ordered[2], ordered[1]];
    return ordered;
  }

  function polygonArea(points) { return Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0) / 2); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function cornerAngle(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
    const cosine = (ab.x * cb.x + ab.y * cb.y) / (Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y));
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }
  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  return { detect, detectRgba, orderPoints };
});
