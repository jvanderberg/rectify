(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RectifyModelDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const INPUT_SIZE = 256;

  function tensorFromRgba(rgba, width, height, Tensor) {
    const plane = INPUT_SIZE * INPUT_SIZE;
    const data = new Float32Array(plane * 3);
    for (let y = 0; y < INPUT_SIZE; y++) {
      const sy = Math.min(height - 1, Math.round((y + .5) * height / INPUT_SIZE - .5));
      for (let x = 0; x < INPUT_SIZE; x++) {
        const sx = Math.min(width - 1, Math.round((x + .5) * width / INPUT_SIZE - .5));
        const source = (sy * width + sx) * 4;
        const target = y * INPUT_SIZE + x;
        // DocAligner's reference pipeline feeds OpenCV BGR pixels to the model.
        data[target] = rgba[source + 2] / 255;
        data[plane + target] = rgba[source + 1] / 255;
        data[plane * 2 + target] = rgba[source] / 255;
      }
    }
    return new Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }

  function pointsFromHeatmap(tensor, width, height) {
    const dims = tensor.dims;
    if (dims.length !== 4 || dims[1] !== 4) throw new Error(`Unexpected heatmap shape: ${dims.join('x')}`);
    const mapHeight = dims[2], mapWidth = dims[3], channelSize = mapWidth * mapHeight;
    const points = [];
    for (let channel = 0; channel < 4; channel++) {
      const center = largestComponent(tensor.data, channel * channelSize, mapWidth, mapHeight, .3);
      points.push({
        x: (center.x + .5) * width / mapWidth,
        y: (center.y + .5) * height / mapHeight
      });
    }
    return orderPoints(points);
  }

  function largestComponent(data, offset, width, height, threshold) {
    const seen = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let best = null;
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[offset + start] < threshold) continue;
      let head = 0, tail = 0, count = 0, sumX = 0, sumY = 0;
      queue[tail++] = start; seen[start] = 1;
      while (head < tail) {
        const index = queue[head++], x = index % width, y = (index / width) | 0;
        count++; sumX += x; sumY += y;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && data[offset + next] >= threshold) {
            seen[next] = 1; queue[tail++] = next;
          }
        }
      }
      if (!best || count > best.count) best = { count, x: sumX / count, y: sumY / count };
    }
    if (best) return best;

    let max = -Infinity, maxIndex = 0;
    for (let i = 0; i < width * height; i++) {
      if (data[offset + i] > max) { max = data[offset + i]; maxIndex = i; }
    }
    return { x: maxIndex % width, y: (maxIndex / width) | 0, count: 1 };
  }

  function refineToEdges(points, rgba, width, height) {
    const gray = new Float32Array(width * height);
    const gradient = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const p = i * 4;
      gray[i] = rgba[p] * .299 + rgba[p + 1] * .587 + rgba[p + 2] * .114;
    }
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = gray[i + 1] - gray[i - 1], gy = gray[i + width] - gray[i - width];
      gradient[i] = Math.abs(gx) + Math.abs(gy);
    }

    const range = Math.max(5, Math.min(24, Math.round(Math.min(width, height) * .035)));
    const lines = points.map((a, side) => {
      const b = points[(side + 1) % 4], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
      let bestOffset = 0, bestScore = -Infinity;
      for (let offset = -range; offset <= range; offset++) {
        let score = 0, samples = 0;
        const count = Math.max(24, Math.min(96, Math.round(length / 5)));
        for (let sample = 2; sample < count - 1; sample++) {
          const t = sample / count;
          const x = Math.round(a.x + dx * t + nx * offset), y = Math.round(a.y + dy * t + ny * offset);
          if (x > 1 && y > 1 && x < width - 2 && y < height - 2) { score += gradient[y * width + x]; samples++; }
        }
        if (samples && score / samples > bestScore) { bestScore = score / samples; bestOffset = offset; }
      }
      return {
        a: { x: a.x + nx * bestOffset, y: a.y + ny * bestOffset },
        b: { x: b.x + nx * bestOffset, y: b.y + ny * bestOffset }
      };
    });

    return lines.map((line, i) => {
      const previous = lines[(i + 3) % 4], hit = intersection(previous.a, previous.b, line.a, line.b);
      if (!hit || hit.x < -range || hit.y < -range || hit.x > width + range || hit.y > height + range) return points[i];
      return { x: clamp(hit.x, 0, width - 1), y: clamp(hit.y, 0, height - 1) };
    });
  }

  function intersection(a, b, c, d) {
    const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, x3 = c.x, y3 = c.y, x4 = d.x, y4 = d.y;
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denominator) < 1e-6) return null;
    return {
      x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
      y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator
    };
  }

  function orderPoints(points) {
    const center = { x: points.reduce((sum, p) => sum + p.x, 0) / 4, y: points.reduce((sum, p) => sum + p.y, 0) / 4 };
    const cyclic = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    let start = 0;
    for (let i = 1; i < 4; i++) if (cyclic[i].x + cyclic[i].y < cyclic[start].x + cyclic[start].y) start = i;
    const ordered = cyclic.map((_, i) => cyclic[(start + i) % 4]);
    return ordered[1].x < ordered[3].x ? [ordered[0], ordered[3], ordered[2], ordered[1]] : ordered;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  async function detect(session, Tensor, rgba, width, height) {
    const input = tensorFromRgba(rgba, width, height, Tensor);
    const outputs = await session.run({ img: input });
    const heatmap = outputs.heatmap || outputs[Object.keys(outputs)[0]];
    const points = pointsFromHeatmap(heatmap, width, height);
    if (!isPlausibleQuad(points, width, height)) throw new Error('Model did not find a plausible boundary');
    const refined = refineToEdges(points, rgba, width, height);
    return isPlausibleQuad(refined, width, height) ? refined : points;
  }

  function isPlausibleQuad(points, width, height) {
    if (!Array.isArray(points) || points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
    let signedArea = 0;
    for (let i = 0; i < 4; i++) {
      const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
      signedArea += a.x * b.y - b.x * a.y;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1 || (i && Math.sign(cross) !== Math.sign((points[1].x - points[0].x) * (points[2].y - points[1].y) - (points[1].y - points[0].y) * (points[2].x - points[1].x)))) return false;
      if (Math.hypot(b.x - a.x, b.y - a.y) < Math.min(width, height) * .06) return false;
    }
    return Math.abs(signedArea) / 2 > width * height * .04;
  }

  return { detect, tensorFromRgba, pointsFromHeatmap, refineToEdges, isPlausibleQuad };
});
