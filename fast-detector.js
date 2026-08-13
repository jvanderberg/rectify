(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RectifyFastDetector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const THETA_BINS = 180;
  const cosTable = Float32Array.from({ length: THETA_BINS }, (_, i) => Math.cos(i * Math.PI / THETA_BINS));
  const sinTable = Float32Array.from({ length: THETA_BINS }, (_, i) => Math.sin(i * Math.PI / THETA_BINS));

  function detectRgba(rgba, width, height) {
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) gray[p] = (rgba[i] * 54 + rgba[i + 1] * 183 + rgba[i + 2] * 19) >> 8;
    const { magnitude, threshold } = sobel(gray, width, height);
    const edges = collectEdges(magnitude, width, height, threshold);
    if (edges.length < 120) throw new Error('Not enough edge structure');
    const lines = houghLines(edges, width, height);
    const candidates = quadrilateralCandidates(lines, magnitude, threshold, width, height);
    if (!candidates.length) throw new Error('No line quadrilateral found');
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const runnerUp = candidates.find(c => cornerDifference(c.points, best.points) > Math.min(width, height) * .08);
    const continuityConfidence = clamp01((.3 - best.maxGapRatio) / .14);
    const weakestSideConfidence = clamp01((best.minSideSupport - .35) / .35);
    best.confidence = clamp01((.48 + best.support * .32 + best.minSideSupport * .22 + Math.min(.16, (best.score - (runnerUp?.score ?? best.score - .5)) * .1)) * continuityConfidence * weakestSideConfidence);
    return best;
  }

  function sobel(gray, width, height) {
    const magnitude = new Uint16Array(width * height);
    const histogram = new Uint32Array(256);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] + gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1];
      const gy = -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] + gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      const value = Math.min(255, (Math.abs(gx) + Math.abs(gy)) >> 1);
      magnitude[i] = value; histogram[value]++;
    }
    const target = width * height * .88;
    let sum = 0, percentile = 48;
    for (let i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= target) { percentile = i; break; } }
    return { magnitude, threshold: Math.max(36, Math.min(105, percentile)) };
  }

  function collectEdges(magnitude, width, height, threshold) {
    const all = [];
    for (let y = 2; y < height - 2; y += 2) for (let x = 2; x < width - 2; x += 2) {
      if (magnitude[y * width + x] >= threshold) all.push({ x, y, weight: magnitude[y * width + x] });
    }
    if (all.length <= 9000) return all;
    const step = all.length / 9000, sampled = [];
    for (let i = 0; i < 9000; i++) sampled.push(all[Math.floor(i * step)]);
    return sampled;
  }

  function houghLines(edges, width, height) {
    const diagonal = Math.ceil(Math.hypot(width, height));
    const rhoBins = diagonal * 2 + 1;
    const votes = new Uint32Array(THETA_BINS * rhoBins);
    for (const edge of edges) for (let theta = 0; theta < THETA_BINS; theta += 2) {
      const rho = Math.round(edge.x * cosTable[theta] + edge.y * sinTable[theta]) + diagonal;
      votes[theta * rhoBins + rho] += 1 + (edge.weight > 120 ? 1 : 0);
    }
    const peaks = [];
    for (let theta = 0; theta < THETA_BINS; theta += 2) for (let rho = 2; rho < rhoBins - 2; rho++) {
      const value = votes[theta * rhoBins + rho];
      if (value < 18) continue;
      let peak = true;
      for (let dt = -4; dt <= 4 && peak; dt += 2) for (let dr = -4; dr <= 4; dr++) {
        if (!dt && !dr) continue;
        const t = (theta + dt + THETA_BINS) % THETA_BINS;
        if (votes[t * rhoBins + rho + dr] > value) { peak = false; break; }
      }
      if (peak) peaks.push({ theta, rho: rho - diagonal, votes: value, a: cosTable[theta], b: sinTable[theta] });
    }
    peaks.sort((a, b) => b.votes - a.votes);
    const selected = [];
    for (const line of peaks) {
      if (selected.some(other => angleDistance(line.theta, other.theta) < 5 && Math.abs(line.rho - other.rho) < 12)) continue;
      selected.push(line);
      if (selected.length >= 36) break;
    }
    return selected;
  }

  function quadrilateralCandidates(lines, magnitude, threshold, width, height) {
    const minSep = Math.min(width, height) * .16;
    const pairs = [];
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const angle = angleDistance(lines[i].theta, lines[j].theta);
      if (angle > 18 || Math.abs(lines[i].rho - lines[j].rho) < minSep) continue;
      pairs.push({ one: lines[i], two: lines[j], theta: meanTheta(lines[i].theta, lines[j].theta), votes: lines[i].votes + lines[j].votes });
    }
    pairs.sort((a, b) => b.votes - a.votes);
    const candidates = [];
    for (let i = 0; i < Math.min(45, pairs.length); i++) for (let j = i + 1; j < Math.min(45, pairs.length); j++) {
      const angle = angleDistance(pairs[i].theta, pairs[j].theta);
      if (angle < 48 || angle > 132) continue;
      const intersections = [
        intersect(pairs[i].one, pairs[j].one), intersect(pairs[i].two, pairs[j].one),
        intersect(pairs[i].two, pairs[j].two), intersect(pairs[i].one, pairs[j].two)
      ];
      if (intersections.some(p => !p || p.x < -width * .08 || p.y < -height * .08 || p.x > width * 1.08 || p.y > height * 1.08)) continue;
      const points = orderPoints(intersections);
      const scored = scoreQuad(points, magnitude, threshold, width, height);
      if (scored) candidates.push(scored);
    }
    return candidates;
  }

  function scoreQuad(points, magnitude, threshold, width, height) {
    const area = polygonArea(points), areaRatio = area / (width * height);
    if (areaRatio < .09 || areaRatio > .94 || !pointInPolygon({ x: width / 2, y: height / 2 }, points)) return null;
    const lengths = points.map((p, i) => distance(p, points[(i + 1) % 4]));
    if (Math.min(...lengths) < Math.min(width, height) * .1) return null;
    let anglePenalty = 0;
    for (let i = 0; i < 4; i++) {
      const angle = cornerAngle(points[(i + 3) % 4], points[i], points[(i + 1) % 4]);
      if (angle < 30 || angle > 150) return null;
      anglePenalty += Math.abs(angle - 90) / 90;
    }
    const boundary = boundaryMetrics(points, magnitude, threshold, width, height);
    if (boundary.support < .34) return null;
    const margin = Math.min(width, height) * .018;
    const borderCorners = points.filter(p => p.x < margin || p.y < margin || p.x > width - margin || p.y > height - margin).length;
    // Once an edge has credible support, prefer the outer print over strong
    // rectangular content inside it (frames, windows, screens, artwork).
    return { points, areaRatio, ...boundary, score: boundary.support * 3.2 + boundary.minSideSupport * 1.4 + areaRatio * 5.4 - boundary.maxGapRatio * 2.2 - anglePenalty * .55 - borderCorners * 1.25 };
  }

  function boundaryMetrics(points, magnitude, threshold, width, height) {
    let hits = 0, samples = 0, minSideSupport = 1, maxGapRatio = 0;
    for (let side = 0; side < 4; side++) {
      const a = points[side], b = points[(side + 1) % 4], count = Math.max(12, Math.round(distance(a, b) / 4));
      let sideHits = 0, currentGap = 0, maxGap = 0;
      for (let i = 0; i <= count; i++) {
        const t = i / count, x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
        let strongest = 0;
        for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
          const sx = x + ox, sy = y + oy;
          if (sx >= 0 && sy >= 0 && sx < width && sy < height) strongest = Math.max(strongest, magnitude[sy * width + sx]);
        }
        const hit = strongest >= threshold;
        if (hit) { sideHits++; currentGap = 0; }
        else { currentGap++; maxGap = Math.max(maxGap, currentGap); }
        hits += hit ? 1 : 0; samples++;
      }
      minSideSupport = Math.min(minSideSupport, sideHits / (count + 1));
      maxGapRatio = Math.max(maxGapRatio, maxGap / (count + 1));
    }
    return { support: hits / samples, minSideSupport, maxGapRatio };
  }

  function intersect(one, two) { const d = one.a * two.b - two.a * one.b; return Math.abs(d) < .05 ? null : { x: (one.rho * two.b - two.rho * one.b) / d, y: (one.a * two.rho - two.a * one.rho) / d }; }
  function angleDistance(a, b) { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); }
  function meanTheta(a, b) { if (Math.abs(a - b) > 90) { if (a < b) a += 180; else b += 180; } return ((a + b) / 2) % 180; }
  function orderPoints(points) { const center = { x: points.reduce((s,p)=>s+p.x,0)/4, y: points.reduce((s,p)=>s+p.y,0)/4 }; const cyclic=[...points].sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x)); let start=0; for(let i=1;i<4;i++)if(cyclic[i].x+cyclic[i].y<cyclic[start].x+cyclic[start].y)start=i; const ordered=cyclic.map((_,i)=>cyclic[(start+i)%4]); return ordered[1].x<ordered[3].x?[ordered[0],ordered[3],ordered[2],ordered[1]]:ordered; }
  function polygonArea(points) { return Math.abs(points.reduce((s,p,i)=>s+p.x*points[(i+1)%4].y-p.y*points[(i+1)%4].x,0)/2); }
  function distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
  function cornerAngle(a,b,c) { const u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y}; return Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y)))))*180/Math.PI; }
  function pointInPolygon(p,poly) { let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!=(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;} return inside; }
  function cornerDifference(a,b) { return a.reduce((sum,p,i)=>sum+distance(p,b[i]),0)/4; }
  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  return { detectRgba, orderPoints };
});
