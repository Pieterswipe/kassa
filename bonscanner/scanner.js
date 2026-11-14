// Kopie uit Pieterswipe/bon-scanner commit 9453c04 (proto/scanner.js), verder ongewijzigd.
/* SwipeDrinks OMR proof. Input is ordinary RGBA ImageData; no data leaves the browser. */
(function (global) {
  'use strict';

  const cornerLayout = [[42, 42], [558, 42], [558, 798], [42, 798]];
  const smallLayout = {
    id: 'K01', radius: 13,
    codeBlack: [88, 108, 138, 178, 198, 228],
    codeWhite: [73, 78, 98, 118, 128, 148, 158, 168, 188, 208, 218, 238, 243],
    centers: Array.from({ length: 6 }, (_, row) =>
      Array.from({ length: 6 }, (_, col) => [212 + 62 * col, 248 + 65 * row]))
  };
  const ringAngles = Array.from({ length: 20 }, (_, index) => {
    const radians = 2 * Math.PI * index / 20;
    return [Math.cos(radians), Math.sin(radians)];
  });
  const strongInk = 0.215;
  const inside = [];
  for (let y = -8; y <= 8; y++) {
    for (let x = -8; x <= 8; x++) {
      if (x * x + y * y <= 70) inside.push([x, y]);
    }
  }

  // One workspace for the current registration resolution. Video frames are processed
  // synchronously; results contain coordinates and scores, never references to these arrays.
  let workspace;
  function buffersFor(w, h) {
    if (!workspace || workspace.w !== w || workspace.h !== h) {
      const length = w * h;
      workspace = {
        w, h, values: new Uint8Array(length), mask: new Uint8Array(length),
        queue: new Int32Array(length), integral: new Uint32Array((w + 1) * (h + 1)),
        offsets: new Int32Array(w), weights: new Float64Array(w), sourceWidth: 0
      };
    }
    return workspace;
  }

  function grayscale(input) {
    const scale = Math.min(1, 1280 / Math.max(input.width, input.height));
    const w = Math.round(input.width * scale);
    const h = Math.round(input.height * scale);
    const buffers = buffersFor(w, h);
    const { values } = buffers;
    const { data, width, height } = input;
    const sx = width / w;
    const sy = height / h;
    function luminance(i) {
      const ink = (54 * data[i] + 183 * data[i + 1] + 19 * data[i + 2]) / 256;
      const alpha = data[i + 3];
      return alpha === 255 ? ink : 255 - (255 - ink) * (alpha / 255);
    }
    if (w === width && h === height) {
      for (let i = 0; i < values.length; i++) values[i] = luminance(i * 4);
      return { w, h, values, sx, sy, buffers };
    }
    // The same horizontal source pixels and interpolation weights serve every row.
    const { offsets, weights } = buffers;
    if (buffers.sourceWidth !== width) {
      buffers.sourceWidth = width;
      for (let x = 0; x < w; x++) {
        const source = (x + 0.5) * sx - 0.5;
        const first = Math.floor(source);
        offsets[x] = first * 4;
        weights[x] = source - first;
      }
    }
    for (let y = 0; y < h; y++) {
      const source = (y + 0.5) * sy - 0.5;
      const first = Math.floor(source);
      const topRow = first * width * 4;
      const bottomRow = Math.min(first + 1, height - 1) * width * 4;
      const fy = source - first;
      for (let x = 0; x < w; x++) {
        const top = topRow + offsets[x], bottom = bottomRow + offsets[x];
        const fx = weights[x], right = offsets[x] < (width - 1) * 4 ? 4 : 0;
        const upper = luminance(top) * (1 - fx) + luminance(top + right) * fx;
        const lower = luminance(bottom) * (1 - fx) + luminance(bottom + right) * fx;
        values[y * w + x] = upper * (1 - fy) + lower * fy;
      }
    }
    return { w, h, values, sx, sy, buffers };
  }

  // A local threshold keeps the four printed squares visible across a lighting gradient.
  function markerCandidates({ w, h, values, buffers }) {
    const stride = w + 1;
    // Row 0 and column 0 of the integral image always stay zero. Each frame
    // overwrites its other entries and the entire mask before any flood fill.
    const { integral, mask, queue } = buffers;
    for (let y = 0; y < h; y++) {
      let total = 0;
      for (let x = 0; x < w; x++) {
        total += values[y * w + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + total;
      }
    }
    const radius = Math.max(13, Math.round(Math.min(w, h) * 0.072));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w, x + radius + 1);
        const sum = integral[y1 * stride + x1] - integral[y1 * stride + x0]
          - integral[y0 * stride + x1] + integral[y0 * stride + x0];
        const background = sum / ((x1 - x0) * (y1 - y0));
        mask[y * w + x] = values[y * w + x] < background - Math.max(13, background * 0.18) ? 1 : 0;
      }
    }

    const found = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start]) continue;
      mask[start] = 0;
      let begin = 0, end = 1;
      queue[0] = start;
      let minX = w, minY = h, maxX = 0, maxY = 0;
      let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
      while (begin < end) {
        const index = queue[begin++];
        const x = index % w, y = (index - x) / w;
        sumX += x; sumY += y;
        sumXX += x * x; sumYY += y * y; sumXY += x * y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (x && mask[index - 1]) { mask[index - 1] = 0; queue[end++] = index - 1; }
        if (x + 1 < w && mask[index + 1]) { mask[index + 1] = 0; queue[end++] = index + 1; }
        if (y && mask[index - w]) { mask[index - w] = 0; queue[end++] = index - w; }
        if (y + 1 < h && mask[index + w]) { mask[index + w] = 0; queue[end++] = index + w; }
      }
      const area = end;
      if (area < 64 || area > w * h * 0.014 || minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1) continue;
      const occupancy = area / ((maxX - minX + 1) * (maxY - minY + 1));
      if (occupancy < 0.40) continue;
      const x = sumX / area, y = sumY / area;
      const xx = sumXX / area - x * x, yy = sumYY / area - y * y, xy = sumXY / area - x * y;
      const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
      const varianceRatio = (xx + yy + discriminant) / Math.max(1, xx + yy - discriminant);
      if (varianceRatio > 7.0) continue;
      found.push({ x, y, area, size: Math.sqrt(area) });
    }
    // Real corner marks are large contiguous squares. This cap also bounds work on cluttered photos.
    return found.sort((a, b) => b.area - a.area).slice(0, 56);
  }

  function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  // Project the rectangle between the four corner centres onto the camera image.
  function projection(a, b, c, d, reference) {
    const [left, top] = reference[0];
    const width = reference[1][0] - left, height = reference[3][1] - top;
    const dx1 = b.x - c.x, dx2 = d.x - c.x;
    const dy1 = b.y - c.y, dy2 = d.y - c.y;
    const dx3 = a.x - b.x + c.x - d.x, dy3 = a.y - b.y + c.y - d.y;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1) return null;
    const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
    if (1 + g < 0.3 || 1 + h < 0.3 || 1 + g + h < 0.3) return null;
    const ax = b.x - a.x + g * b.x, ay = b.y - a.y + g * b.y;
    const bx = d.x - a.x + h * d.x, by = d.y - a.y + h * d.y;
    return (x, y) => {
      const u = (x - left) / width, v = (y - top) / height;
      const f = 1 / (g * u + h * v + 1);
      return { x: (ax * u + bx * v + a.x) * f, y: (ay * u + by * v + a.y) * f };
    };
  }

  function pixel(image, p) {
    const { w, h, values } = image;
    if (p.x < 0 || p.y < 0 || p.x >= w - 1 || p.y >= h - 1) return 255;
    const xi = Math.floor(p.x), yi = Math.floor(p.y), i = yi * w + xi;
    const fx = p.x - xi, fy = p.y - yi;
    return (values[i] * (1 - fx) + values[i + 1] * fx) * (1 - fy)
      + (values[i + w] * (1 - fx) + values[i + w + 1] * fx) * fy;
  }

  function matchesAreas(map, corners, reference, markerSize) {
    const half = markerSize / 2;
    return reference.every(([x, y], i) => {
      const h0 = map(x - half, y), h1 = map(x + half, y);
      const v0 = map(x, y - half), v1 = map(x, y + half);
      const expected = Math.abs((h1.x - h0.x) * (v1.y - v0.y) - (h1.y - h0.y) * (v1.x - v0.x));
      const ratio = corners[i].area / expected;
      return ratio > 0.67 && ratio < 1.44;
    });
  }

  function codeContrast(map, image, layout) {
    function sampleBar(x) {
      return (pixel(image, map(x, 39)) + 2 * pixel(image, map(x, 42)) + pixel(image, map(x, 45))) / 4;
    }
    const black = layout.codeBlack.map(sampleBar);
    const white = layout.codeWhite.map(sampleBar);
    const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
    const dark = mean(black), light = mean(white), contrast = light - dark;
    if (contrast < 41) return 0;
    // Check each code element. Swapping one printed bit must invalidate the menu version.
    if (black.some(value => value > dark + 0.52 * contrast)
      || white.some(value => value < light - 0.52 * contrast)) return 0;
    return contrast;
  }

  function eachQuad(image, points, reference, markerSize, visit, topEdgePossible) {
    const spanX = reference[1][0] - reference[0][0];
    const spanY = reference[3][1] - reference[0][1];
    // Fiducial pairs recur in many corner quadruples on a filled K50 sheet.
    // Compute plausible horizontal and vertical edges once per pair.
    const horizontal = points.map(() => new Set());
    const vertical = points.map(() => []);
    const distances = points.map(() => new Float64Array(points.length));
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j];
        if (a.size > 2.7 * b.size || b.size > 2.7 * a.size) continue;
        const length = distance(a, b);
        distances[i][j] = distances[j][i] = length;
        const scale = Math.sqrt(a.size * b.size) / markerSize;
        const h = length / (spanX * scale), v = length / (spanY * scale);
        if (h > 0.61 && h < 1.64) { horizontal[i].add(j); horizontal[j].add(i); }
        if (v > 0.61 && v < 1.64) { vertical[i].push(j); vertical[j].push(i); }
      }
    }
    for (let ai = 0; ai < points.length; ai++) {
      const a = points[ai];
      for (const bi of horizontal[ai]) {
        const b = points[bi];
        if (topEdgePossible && !topEdgePossible(a, b)) continue;
        for (const di of vertical[ai]) {
          if (bi === di) continue;
          const d = points[di];
          const abx = b.x - a.x, aby = b.y - a.y, adx = d.x - a.x, ady = d.y - a.y;
          const cross = abx * ady - aby * adx;
          if (Math.abs(cross) < 0.045 * image.w * image.h) continue;
          if (Math.abs(abx * adx + aby * ady) > 0.71 * distances[ai][bi] * distances[ai][di]) continue;
          for (const ci of vertical[bi]) {
            if (ci === ai || !horizontal[di].has(ci)) continue;
            const c = points[ci];
            if ((abx * (c.y - b.y) - aby * (c.x - b.x)) * cross <= 0
              || ((c.x - d.x) * ady - (c.y - d.y) * adx) * cross <= 0) continue;
            const map = projection(a, b, c, d, reference);
            const corners = [a, b, c, d];
            if (!map || !matchesAreas(map, corners, reference, markerSize)) continue;
            visit(map, corners);
          }
        }
      }
    }
  }

  function locateLegacy(image, points, layouts) {
    let best = null;
    eachQuad(image, points, cornerLayout, 28, (map, corners) => {
      for (const layout of layouts) {
        const contrast = codeContrast(map, image, layout);
        if (contrast && (!best || contrast > best.contrast)) best = { map, corners, contrast, layout };
      }
    });
    return best;
  }

  // Read the small K50 bubbles directly from the source image, preserving pen strokes
  // lost by the registration downsample. We only need the pixels near the bubbles.
  function sourceSampler(input, registration, map) {
    if (registration.sx === 1 && registration.sy === 1) return (x, y) => pixel(registration, map(x, y));
    const { data, width, height } = input;
    function gray(i) {
      const value = (54 * data[i] + 183 * data[i + 1] + 19 * data[i + 2]) / 256;
      return 255 - (255 - value) * data[i + 3] / 255;
    }
    return (x, y) => {
      const p = map(x, y);
      const px = (p.x + 0.5) * registration.sx - 0.5, py = (p.y + 0.5) * registration.sy - 0.5;
      if (px < 0 || py < 0 || px >= width - 1 || py >= height - 1) return 255;
      const x0 = Math.floor(px), y0 = Math.floor(py), base = (y0 * width + x0) * 4;
      const fx = px - x0, fy = py - y0, below = base + width * 4;
      const top = gray(base) * (1 - fx) + gray(base + 4) * fx;
      const bottom = gray(below) * (1 - fx) + gray(below + 4) * fx;
      return top * (1 - fy) + bottom * fy;
    };
  }

  // Check foreshortening at the edges of the grid. A tilt can make the distant
  // bubbles unreadable while the near side still appears sharp.
  function enoughDetailAt(x, y, diameter, sourcePoint, minimum = 9.5) {
    const p = sourcePoint(x, y), h = sourcePoint(x + diameter, y), v = sourcePoint(x, y + diameter);
    const hx = h.x - p.x, hy = h.y - p.y, vx = v.x - p.x, vy = v.y - p.y;
    const trace = hx * hx + hy * hy + vx * vx + vy * vy;
    const det = hx * vy - hy * vx;
    const shortest = Math.sqrt((trace - Math.sqrt(Math.max(0, trace * trace - 4 * det * det))) / 2);
    return shortest >= minimum;
  }

  function enoughDetail(layout, sourcePoint) {
    const centers = layout.centers.flat();
    const xs = centers.map(p => p[0]), ys = centers.map(p => p[1]);
    return [Math.min(...xs), Math.max(...xs)].every(x =>
      [Math.min(...ys), Math.max(...ys)].every(y => enoughDetailAt(x, y, 2 * layout.radius, sourcePoint)));
  }

  function inspectBubble(sample, x, y, radius, fitted = false) {
    const scale = radius / 13;
    const read = (dx, dy) => sample(x + scale * dx, y + scale * dy);
    const around = ringAngles.map(([dx, dy]) => read(18 * dx, 18 * dy)).sort((a, b) => a - b);
    const paper = around[13];
    const blackThreshold = paper - Math.max(22, 0.16 * paper);
    const faintThreshold = paper - Math.max(11, 0.075 * paper);
    const outline = ringAngles.filter(([dx, dy]) =>
      [11.5, 12.3, 13, 13.7, 14.5].some(r => read(r * dx, r * dy) < blackThreshold)
    ).length;
    let dark = 0, faint = 0;
    for (const [dx, dy] of inside) {
      const value = read(dx, dy);
      if (value < blackThreshold) dark++;
      if (value < faintThreshold) faint++;
    }
    const ink = dark / inside.length;
    const maxBackgroundDrop = Math.max(44, paper * 0.28);
    let backgroundClear = paper - around[4] < maxBackgroundDrop;
    if (!backgroundClear && ink >= strongInk && paper - around[7] < maxBackgroundDrop) {
      // Long pen strokes can cross the first sampling ring. Check the paper a little
      // farther out before treating ink next to a well-marked bubble as a shadow.
      const outer = ringAngles.map(([dx, dy]) => read(24 * dx, 24 * dy)).sort((a, b) => a - b);
      backgroundClear = paper - outer[4] < maxBackgroundDrop;
    }
    // A thin printed ring can be spread across neighbouring sensor pixels.
    // Verify the local paper-to-rim drop around almost its entire perimeter,
    // only at a position already corroborated by adjacent printed circles.
    let supportedRim = false;
    if (fitted && outline < 16 && backgroundClear && paper > 64) {
      const minimumDrop = Math.max(18, paper * 0.11);
      const supported = ringAngles.filter(([dx, dy]) => {
        const outside = Math.min(paper, read(18.5 * dx, 18.5 * dy));
        const rim = Math.min(read(12 * dx, 12 * dy), read(13 * dx, 13 * dy), read(14 * dx, 14 * dy));
        return outside - rim >= minimumDrop;
      }).length;
      supportedRim = supported >= 18;
    }
    return {
      dark: ink, faint: faint / inside.length, outline, supportedRim, paper,
      readable: paper > 64 && (outline >= 14 || supportedRim) && backgroundClear
    };
  }

  // A faint stripe may cross a circle on its way across the paper. Fit its
  // direction using only interior pixels, then find independent evidence in
  // the clear paper on both sides. A mark stopping at the rim is inconclusive.
  function crossesPrintedCircle(sample, x, y, radius, paper, strong) {
    const read = (u, v) => sample(x + u * radius, y + v * radius);
    const noise = Math.max(12, 0.075 * paper);
    const points = [];
    let weight = 0, cx = 0, cy = 0;
    for (const [dx, dy] of inside) {
      const u = dx / 13, v = dy / 13;
      const contrast = paper - read(u, v);
      if (contrast <= noise) continue;
      const w = contrast - noise;
      points.push({ u, v, w });
      weight += w;
      cx += w * u;
      cy += w * v;
    }
    if (points.length < 6) return false;
    cx /= weight;
    cy /= weight;
    let xx = 0, yy = 0, xy = 0;
    for (const { u, v, w } of points) {
      xx += w * (u - cx) ** 2;
      yy += w * (v - cy) ** 2;
      xy += w * (u - cx) * (v - cy);
    }
    const spread = Math.hypot(xx - yy, 2 * xy);
    const major = (xx + yy + spread) / (2 * weight);
    const minor = (xx + yy - spread) / (2 * weight);
    const tooWide = strong ? minor > 0.032 || minor > 0.31 * major : minor > 0.012 || minor > 0.13 * major;
    if (major < (strong ? 0.038 : 0.055) || tooWide) return false;
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const a = Math.cos(angle), b = Math.sin(angle);
    const offset = cy * a - cx * b;
    // Preserve central slashes, and any substantial separate or branching
    // pen stroke inside the cell, even when a fibre happens to run across it.
    if (Math.abs(offset) > 0.60 || (!strong && Math.abs(offset) < 0.21)) return false;
    let offLine = 0;
    for (const p of points) {
      const deviation = Math.abs(a * p.v - b * p.u - offset);
      if (deviation > 0.23 && p.w > noise * 0.65) {
        if (!strong) return false;
        offLine += p.w;
      }
    }
    // For a strong mark the only possible change is a request for review.
    // A few noisy edge pixels should not hide an otherwise continuous line.
    if (offLine > 0.10 * weight) return false;
    function contrastAt(t, across) {
      const at = n => read(a * t - b * n, b * t + a * n);
      return Math.min(at(across - 0.30), at(across + 0.30)) - at(across);
    }
    const evidence = Math.max(8, paper * 0.045);
    // Each side must follow one smooth continuation at three distances
    // in the unprinted gutter; scattered dark pixels do not qualify.
    return [-1, 1].every(side =>
      [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15].some(bend =>
        [1.28, 1.42, 1.55].every(t => contrastAt(side * t, offset + bend * t * t) >= evidence)));
  }

  function classifyRow(cells, zoned = false) {
    const candidates = [], unreadable = [], inkCandidates = [], strong = [];
    for (const [i, cell] of cells.entries()) {
      const qty = i + 1;
      const ink = cell.dark >= 0.065 || cell.faint >= 0.13;
      if (!cell.readable) unreadable.push(qty);
      if (cell.readable && ink) inkCandidates.push(qty);
      if (ink || !cell.readable) candidates.push(qty);
      if (cell.dark >= strongInk && (!zoned || (cell.readable && !cell.reviewLine))) strong.push(qty);
    }
    let quantity = 0, status = 'blank';
    if (strong.length > 1) { quantity = null; status = 'ambiguous'; }
    else if (strong.length === 1 && candidates.length === 1 && !unreadable.length) {
      quantity = strong[0]; status = 'marked';
    } else if (candidates.length) { quantity = null; status = 'uncertain'; }
    return { quantity, status, candidates, unreadable, inkCandidates,
      scores: cells.map(cell => Math.round(cell.dark * 1000) / 1000) };
  }

  function readRows(layout, sample) {
    const rows = layout.centers.map(columns =>
      classifyRow(columns.map(([x, y]) => inspectBubble(sample, x, y, layout.radius))));
    return { rows, illegible: rows.reduce((n, row) => n + row.unreadable.length, 0) };
  }

  // All four panels share physical dimensions and bit positions. Decode each
  // candidate rectangle once. Two opposing signatures verify both ends of it.
  let zoneCodes;
  function stripPattern(dark, light) {
    const positions = [...dark, ...light].sort((a, b) => a - b);
    return { positions, bits: positions.map(x => dark.includes(x) ? '1' : '0').join('') };
  }

  function readStrip(map, image, positions, y) {
    const values = positions.map(x =>
      (pixel(image, map(x, y - 2)) + 2 * pixel(image, map(x, y)) + pixel(image, map(x, y + 2))) / 4);
    const dark = Math.min(...values), range = Math.max(...values) - dark;
    if (range < 52) return '';
    let bits = '';
    for (const value of values) {
      const level = (value - dark) / range;
      if (level > 0.39 && level < 0.61) return '';
      bits += level < 0.5 ? '1' : '0';
    }
    return bits;
  }

  function locateZones(image, points, layouts) {
    const base = layouts[0];
    if (!zoneCodes || zoneCodes.layouts !== layouts) {
      const byTop = new Map();
      for (const zone of layouts) {
        const top = stripPattern(zone.codeBlack, zone.codeWhite);
        const bottom = stripPattern(zone.bottomBlack, zone.bottomWhite);
        byTop.set(top.bits, { zone, bottomBits: bottom.bits });
      }
      zoneCodes = {
        layouts, byTop,
        top: stripPattern(base.codeBlack, base.codeWhite).positions,
        bottom: stripPattern(base.bottomBlack, base.bottomWhite).positions
      };
    }
    // Every upper signature starts with a quiet patch followed by a dark
    // bar. Reject impossible top edges before enumerating the other corners.
    // For a flat sheet, the projected area of a local square is proportional
    // to inverse projective depth cubed. This compensates for perspective
    // along the edge. Small offsets tolerate dot growth and camera blur.
    const span = base.corners[1][0] - base.corners[0][0];
    const margin = (zoneCodes.top[0] - base.corners[0][0]) / span;
    const firstBit = (zoneCodes.top[1] - base.corners[0][0]) / span;
    function hasStart(a, b) {
      const depth = Math.cbrt(a.area / b.area);
      const dx = b.x - a.x, dy = b.y - a.y;
      function along(u) {
        const fraction = u * depth / (1 + u * (depth - 1));
        return pixel(image, { x: a.x + fraction * dx, y: a.y + fraction * dy });
      }
      const slack = 1.5 / span;
      const paper = Math.max(along(margin), along(margin + slack));
      const ink = Math.min(along(firstBit), along(firstBit - slack), along(firstBit + slack));
      return paper - ink >= 28;
    }
    const found = new Map();
    let mixed = false;
    eachQuad(image, points, base.corners, base.markerSize, (map, corners) => {
      if (mixed) return;
      const top = readStrip(map, image, zoneCodes.top, base.codeY);
      const entry = zoneCodes.byTop.get(top);
      if (!entry || entry.bottomBits !== readStrip(map, image, zoneCodes.bottom, base.bottomY)) return;
      const { zone } = entry;
      if (found.has(zone.id)) {
        // Two matching codes on different pieces of paper must not be combined.
        mixed = true;
        return;
      }
      const offsetX = zone.corners[0][0] - base.corners[0][0];
      const offsetY = zone.corners[0][1] - base.corners[0][1];
      found.set(zone.id, { layout: zone, corners, map: (x, y) => map(x - offsetX, y - offsetY) });
    }, hasStart);
    // Adjacent visible panels must agree on their page positions. Compare the
    // nearest anchors, where extrapolation beyond either local fit is shortest.
    const geometries = [...found.values()];
    for (const [i, a] of geometries.entries()) {
      for (const b of geometries.slice(i + 1)) {
        let nearest = Infinity, bIndex = 0, aIndex = 0;
        for (const [j, p] of a.layout.corners.entries()) {
          for (const [k, q] of b.layout.corners.entries()) {
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (d < nearest) { nearest = d; aIndex = j; bIndex = k; }
          }
        }
        const tolerance = Math.min(distance(a.corners[0], a.corners[2]), distance(b.corners[0], b.corners[2])) * 0.13;
        // Neighboring pages can touch: compare panel orientation as well as position.
        const axisA = [a.corners[1].x - a.corners[0].x, a.corners[1].y - a.corners[0].y];
        const axisB = [b.corners[1].x - b.corners[0].x, b.corners[1].y - b.corners[0].y];
        if (axisA[0] * axisB[0] + axisA[1] * axisB[1] < 0.85 * Math.hypot(...axisA) * Math.hypot(...axisB)
          || distance(a.map(...b.layout.corners[bIndex]), b.corners[bIndex]) > tolerance
          || distance(b.map(...a.layout.corners[aIndex]), a.corners[aIndex]) > tolerance) mixed = true;
      }
    }
    return { geometries, mixed };
  }

  // Estimate the bend across a row from its printed circumferences. The
  // center, which can contain the customer's mark, is outside the fit.
  function alignOutlines(columns, sample, radius, partial = false) {
    function contrast(x, y) {
      let sum = 0;
      for (const [ux, uy] of ringAngles) {
        const rx = radius * ux, ry = radius * uy;
        const ring = sample(x + rx, y + ry);
        const paper = sample(x + 1.45 * rx, y + 1.45 * ry);
        sum += Math.max(-35, Math.min(100, paper - ring));
      }
      return sum / ringAngles.length;
    }

    // First find a shared offset. Four agreeing rims are enough even if a
    // long tick crosses a rim, or a reflection hides a circle.
    let best = -Infinity, shiftX = 0, shiftY = 0;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const dx = i * radius * 0.30, dy = j * radius * 0.30;
        const scores = columns.map(([x, y]) => contrast(x + dx, y + dy)).sort((a, b) => a - b);
        // An obstructed panel can have just three visible circles. They
        // guide the fit, but every cell must still prove its own circumference.
        const consensus = partial ? (scores[3] + scores[4] + scores[5]) / 3 :
          (scores[1] + scores[2] + scores[3] + scores[4]) / 4;
        const score = consensus - 0.3 * Math.hypot(dx, dy);
        if (score > best) { best = score; shiftX = dx; shiftY = dy; }
      }
    }
    if (best < 19) return null;
    // A separate small adjustment follows printing or curvature within this
    // row, bounded far inside half the spacing to any neighbouring circle.
    return columns.map(([x, y]) => {
      let strength = -Infinity, bestX = x, bestY = y;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const dx = shiftX + i * radius * 0.11, dy = shiftY + j * radius * 0.11;
          if (dx * dx + dy * dy > radius * radius * 0.75 ** 2) continue;
          const score = contrast(x + dx, y + dy) - 0.18 * Math.hypot(dx, dy);
          if (score > strength) { strength = score; bestX = x + dx; bestY = y + dy; }
        }
      }
      return { point: [bestX, bestY], strength };
    });
  }

  // With one hidden signature, the other three panels can still prove this
  // is an overview, rather than a partial close-up. Each independent fit
  // must put every missing anchor, including its quiet margin, inside frame.
  // This says nothing about the obscured answers: they remain unobserved.
  function isOverview(geometries, layouts, image) {
    if (geometries.length === 4) return true;
    if (geometries.length !== 3) return false;
    const missing = layouts.find(z => !geometries.some(g => g.layout === z));
    const margin = missing.markerSize * 0.75;
    const boundary = missing.corners.map(([x, y], i) =>
      [x + (i === 0 || i === 3 ? -margin : margin), y + (i < 2 ? -margin : margin)]);
    const estimates = geometries.map(geometry => boundary.map(([x, y]) => geometry.map(x, y)));
    const scale = Math.min(...geometries.map(g => distance(g.corners[0], g.corners[2])));
    for (const [i, quad] of estimates.entries()) {
      for (const [j, pt] of quad.entries()) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)
          || pt.x < 2 || pt.x > image.w - 3 || pt.y < 2 || pt.y > image.h - 3) return false;
        for (let k = 0; k < i; k++) {
          if (distance(pt, estimates[k][j]) > scale * 0.11) return false;
        }
      }
    }
    return true;
  }

  // Three authenticated panels predict the fourth panel's location. Require
  // four distinct, observed fiducials there and its own surviving signature.
  // A projected rectangle by itself cannot locate a customer's answers.
  function partialGeometry(geometries, layout, points, image) {
    const corners = [];
    for (const [x, y] of layout.corners) {
      const estimates = geometries.map(g => g.map(x, y));
      const candidates = points.filter(point =>
        estimates.every(estimate => distance(estimate, point) < point.size * 1.25) &&
        !geometries.some(g => g.corners.includes(point)) &&
        geometries.every(g => matchesAreas(g.map, [point], [[x, y]], layout.markerSize)));
      if (candidates.length !== 1 || corners.includes(candidates[0])) return null;
      corners.push(candidates[0]);
    }
    const map = projection(...corners, layout.corners);
    if (!map || !matchesAreas(map, corners, layout.corners, layout.markerSize)) return null;
    const top = readStrip(map, image, stripPattern(layout.codeBlack, layout.codeWhite).positions, layout.codeY);
    const bottom = readStrip(map, image, stripPattern(layout.bottomBlack, layout.bottomWhite).positions, layout.bottomY);
    const topOwner = zoneCodes.byTop.get(top);
    const bottomOwner = [...zoneCodes.byTop.values()].find(entry => entry.bottomBits === bottom);
    // A legible signature for another panel contradicts the prediction.
    if ((!topOwner && !bottomOwner) || (topOwner && topOwner.zone !== layout) ||
      (bottomOwner && bottomOwner.zone !== layout)) return null;
    return { layout, map };
  }

  // A pen can shade the neighbouring row even when all its bubbles are open.
  // Estimate the local paper brightness and slope from the unprinted gutter,
  // then check for an actual dark ring with light paper inside AND outside.
  // A smooth white occluder has no such ring. A stroke inside a printed ring
  // must remain ink evidence even if the other cells in the row are obscured.
  function inspectPartialCell(sample, x, y, radius) {
    const read = (u, v) => sample(x + radius * u, y + radius * v);
    const gutter = ringAngles.map(([u, v]) => read(1.5 * u, 1.5 * v));
    let paper = 0, dx = 0, dy = 0;
    for (const [i, value] of gutter.entries()) {
      paper += value;
      dx += value * ringAngles[i][0];
      dy += value * ringAngles[i][1];
    }
    paper /= gutter.length;
    dx /= 0.75 * gutter.length;
    dy /= 0.75 * gutter.length;
    const unknown = { readable: false, dark: 0, faint: 0 };
    if (paper < 82) return unknown;
    let noisy = 0, rim = 0, hollow = 0;
    const rimDrop = Math.max(12, 0.072 * paper);
    for (const [i, [u, v]] of ringAngles.entries()) {
      const residual = Math.abs(gutter[i] - (paper + 1.5 * (u * dx + v * dy)));
      if (residual > Math.max(32, paper * 0.22)) return unknown;
      if (residual > Math.max(12, paper * 0.09)) noisy++;
      const ring = Math.min(read(0.9 * u, 0.9 * v), read(u, v), read(1.1 * u, 1.1 * v));
      if (gutter[i] - ring >= rimDrop) {
        rim++;
        if (read(0.55 * u, 0.55 * v) - ring >= rimDrop) hollow++;
      }
    }
    if (noisy > 3 || rim < 18) return unknown;
    let dark = 0, faint = 0;
    for (const [ix, iy] of inside) {
      const u = ix / 13, v = iy / 13;
      const drop = paper + dx * u + dy * v - read(u, v);
      if (drop > Math.max(22, 0.16 * paper)) dark++;
      if (drop > Math.max(13, 0.075 * paper)) faint++;
    }
    dark /= inside.length;
    faint /= inside.length;
    if (hollow < 17 && dark < 0.065 && faint < 0.13) return unknown;
    let reviewLine = false;
    if (dark >= strongInk) {
      // A solid cover can resemble a filled disk at its centre. Require
      // some paper just outside the printed ring before counting a mark.
      const quiet = ringAngles.filter(([u, v]) =>
        paper + 1.24 * (u * dx + v * dy) - read(1.24 * u, 1.24 * v) < Math.max(28, paper * 0.20));
      reviewLine = quiet.length < 12 || (dark < 0.70 && crossesPrintedCircle(sample, x, y, radius, paper, true));
    }
    return { readable: true, dark, faint, reviewLine };
  }

  // The printed 1–6 heading separates runs of otherwise identical rows.
  // At least three digits must show compact ink between clear side gutters.
  function hasQuantityHeading(sample, columns, y) {
    let digits = 0;
    for (const [x] of columns) {
      const sides = [];
      for (const dx of [-7, 7]) {
        for (const dy of [-4, 0, 4]) sides.push(sample(x + dx, y + dy));
      }
      sides.sort((a, b) => a - b);
      const paper = sides[3];
      if (paper < 82 || sides[5] - sides[0] > Math.max(30, 0.19 * paper)) continue;
      let ink = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -2.5; dx <= 2.5; dx++) {
          if (paper - sample(x + dx, y + dy) > Math.max(26, 0.16 * paper)) ink++;
        }
      }
      if (ink >= 7 && ++digits >= 3) return true;
    }
    return false;
  }

  function visibleRowRim(sample, x, y, radius) {
    let visible = 0;
    for (const [u, v] of ringAngles) {
      const rx = radius * u, ry = radius * v;
      const paper = sample(x + 1.45 * rx, y + 1.45 * ry);
      const rim = Math.min(sample(x + 0.9 * rx, y + 0.9 * ry),
        sample(x + rx, y + ry), sample(x + 1.1 * rx, y + 1.1 * ry));
      if (Math.min(paper, sample(x + 0.55 * rx, y + 0.55 * ry)) - rim > Math.max(12, paper * 0.073)) visible++;
    }
    return visible >= 15;
  }

  function partialRead(input, image, geometry, toSource) {
    const { layout, map } = geometry;
    const sample = sourceSampler(input, image, map);
    const sourcePoint = (x, y) => toSource(map(x, y));
    const centers = [], rows = [], visibleColumns = [];
    for (const columns of layout.centers) {
      // At this size an outline must have its own contrast around almost the
      // entire circumference. A projected coordinate never counts as a read.
      const enough = columns.map(([x, y]) => enoughDetailAt(x, y, 2 * layout.radius, sourcePoint, 8));
      const fit = alignOutlines(columns, sample, layout.radius, true);
      const positions = columns.map((point, i) => fit?.[i]?.point || point);
      const cells = positions.map(([x, y], i) => {
        if (!enough[i] || !fit || fit[i].strength < 22) return { readable: false, dark: 0, faint: 0 };
        const cell = inspectPartialCell(sample, x, y, layout.radius);
        if (cell.readable || fit[i].strength < 35) return cell;
        // A broad cross can run outside the rim and disrupt the local
        // paper estimate. Retain it as a hint for manual review only.
        const ink = inspectBubble(sample, x, y, layout.radius, true);
        if (ink.readable && ink.outline >= 16 && ink.dark >= 0.55) {
          return { ...ink, reviewLine: true };
        }
        return cell;
      });
      const visible = positions.map(([x, y], i) => cells[i].readable ||
        (fit && fit[i].strength >= 20 && visibleRowRim(sample, x, y, layout.radius)));
      visibleColumns.push(visible);
      rows.push(classifyRow(cells, true));
      centers.push(positions.map(([x, y]) => sourcePoint(x, y)));
    }
    // A folded panel can move a genuine row exactly one pitch, giving six
    // perfect rings for the wrong product. Trace observed rows to a printed
    // heading; never bridge a break in the grid using projected answers.
    const headings = layout.headings.map(h => ({
      first: layout.centers.findIndex(columns => columns[0][1] > h.y),
      seen: hasQuantityHeading(sample, layout.centers[0], h.y)
    }));
    const anchored = new Set();
    function follow(start, end, step) {
      let previous = null;
      for (let i = start; i !== end; i += step) {
        const visible = visibleColumns[i];
        if (visible.filter(Boolean).length < 3 ||
          (previous && visible.filter((seen, j) => seen && previous[j]).length < 2)) break;
        anchored.add(i);
        previous = visible;
      }
    }
    for (const [j, heading] of headings.entries()) {
      const next = headings[j + 1], end = next ? next.first : rows.length;
      if (heading.seen) follow(heading.first, end, 1);
      if (next?.seen) follow(end - 1, heading.first - 1, -1);
    }
    rows.forEach((row, i) => {
      if (anchored.has(i)) return;
      rows[i] = { quantity: null, status: 'uncertain', candidates: [1, 2, 3, 4, 5, 6],
        unreadable: [1, 2, 3, 4, 5, 6], inkCandidates: [], scores: [] };
      // A well-formed but unanchored ring row could belong to the next
      // product on a fold. Its crop would show the wrong answers.
      if (visibleColumns[i].filter(Boolean).length >= 3) centers[i] = [];
    });
    return { id: layout.id, indices: layout.indices, rows, centers };
  }

  function scanZones(input, image, points, form) {
    const { geometries, mixed } = locateZones(image, points, form.zones);
    if (mixed) {
      const hint = 'Houd één bon in beeld. Toon het hele blad opnieuw.';
      return { ok: false, template: 'Z50', hint, reason: hint, rows: [], zones: [] };
    }
    if (!geometries.length) return null;
    const toSource = p => ({ x: (p.x + 0.5) * image.sx - 0.5, y: (p.y + 0.5) * image.sy - 0.5 });
    const zones = geometries.map(({ layout, map, corners }) => {
      const sourcePoint = (x, y) => toSource(map(x, y));
      const sample = sourceSampler(input, image, map);
      const detail = enoughDetail(layout, sourcePoint);
      const rows = [], centers = [];
      for (let columns of layout.centers) {
        const sizesOK = columns.map(([x, y]) => detail || enoughDetailAt(x, y, 2 * layout.radius, sourcePoint));
        const unknown = { dark: 0, faint: 0, readable: false, outline: 0 };
        let cells = columns.map(([x, y], i) => sizesOK[i] ? inspectBubble(sample, x, y, layout.radius) : unknown);
        let row = classifyRow(cells, true);
        // Leave clear decisions and true double marks on the fast path. At
        // small scales, accept a reread only with independently visible rims.
        const hasRingEvidence = cells.some((cell, i) => !sizesOK[i] || cell.outline > 0 || cell.faint >= 0.13);
        if (row.status === 'uncertain' && hasRingEvidence && columns.every(([x, y], i) =>
          sizesOK[i] || enoughDetailAt(x, y, 2 * layout.radius, sourcePoint, 9.0))) {
          const fit = alignOutlines(columns, sample, layout.radius);
          if (fit && fit.filter(f => f.strength >= 20).length >= 4) {
            const refined = fit.map(({ point: [x, y], strength }, i) => {
              const cell = inspectBubble(sample, x, y, layout.radius, true);
              if (strength < 17 || (!sizesOK[i] && (strength < 22 || (cell.outline < 16 && !cell.supportedRim)))) cell.readable = false;
              return cell;
            });
            const candidate = classifyRow(refined, true);
            // Never discard a genuinely strong pen mark because another
            // centre also resembles a printed ring.
            const retainsInk = cells.every((cell, i) =>
              !cell.readable || cell.dark < strongInk || candidate.inkCandidates.includes(i + 1));
            if (retainsInk && candidate.unreadable.length <= row.unreadable.length) {
              columns = fit.map(f => f.point);
              cells = refined;
              row = candidate;
            }
          }
        }
        if (row.inkCandidates.length && row.status !== 'ambiguous') {
          let filtered = false;
          for (const qty of row.inkCandidates) {
            const cell = cells[qty - 1];
            const [x, y] = columns[qty - 1];
            const strong = cell.dark >= strongInk;
            if (cell.dark < 0.70 && crossesPrintedCircle(sample, x, y, layout.radius, cell.paper, strong)) {
              // A dark single slash can be intentional: keep it for review.
              cells[qty - 1] = strong ? { ...cell, reviewLine: true } : { ...cell, dark: 0, faint: 0 };
              filtered = true;
            }
          }
          if (filtered) row = classifyRow(cells, true);
        }
        rows.push(row);
        centers.push(columns.map(([x, y]) => sourcePoint(x, y)));
      }
      return { id: layout.id, label: layout.label, indices: layout.indices, corners: corners.map(toSource), centers, rows };
    });
    const overviewEstablished = isOverview(geometries, form.zones, image);
    const partialZones = [];
    if (overviewEstablished && geometries.length === 3) {
      const missing = form.zones.find(layout => !geometries.some(g => g.layout === layout));
      const geometry = partialGeometry(geometries, missing, points, image);
      if (geometry) partialZones.push(partialRead(input, image, geometry, toSource));
    }
    const rows = [], overviewCenters = [], corners = [];
    const complete = zones.length === form.zones.length;
    if (overviewEstablished) {
      for (const z of zones) {
        z.indices.forEach((index, j) => {
          overviewCenters[index] = z.centers[j];
          if (complete) rows[index] = z.rows[j];
        });
      }
    }
    if (complete) {
      ['TL', 'TR', 'BR', 'BL'].forEach((id, i) => corners.push(zones.find(z => z.id === id).corners[i]));
    }
    return { ok: true, template: form.id, rows, centers: complete ? overviewCenters : [],
      corners, zones, partialZones, overviewEstablished, overviewCenters, reason: '' };
  }

  function scanForm(input) {
    const fail = reason => ({ ok: false, reason, rows: [] });
    if (!input || !Number.isInteger(input.width) || !Number.isInteger(input.height)
      || !input.data || input.data.length !== 4 * input.width * input.height) return fail('De foto kon niet worden gelezen.');
    if (Math.min(input.width, input.height) < 160) return fail('Te weinig beeldpunten. Neem de bon dichterbij en scherp in beeld.');
    const image = grayscale(input);
    const largeLayout = global.LargeBonForm?.layout;
    const layouts = largeLayout ? [smallLayout, largeLayout] : [smallLayout];
    const points = markerCandidates(image);
    if (global.ZoneBonForm) {
      const result = scanZones(input, image, points, global.ZoneBonForm);
      if (result) return result;
    }
    const geometry = locateLegacy(image, points, layouts);
    if (!geometry) return fail('Bon niet herkend. Leg de bon vlak, gebruik de juiste versie en breng de vier zwarte hoeken en de code volledig in beeld.');
    const { map, layout } = geometry;
    const dense = layout.id === 'K50';
    const toSource = p => ({ x: p.x * image.sx, y: p.y * image.sy });
    const sourcePoint = (x, y) => toSource(map(x, y));
    function unreadable(hint) { return { ok: false, template: layout.id, reason: hint, hint, rows: [] }; }
    if (dense && !enoughDetail(layout, sourcePoint)) {
      return unreadable('Houd de gsm recht boven de A4-bon en laat de bon het camerabeeld vullen.');
    }
    const sample = dense ? sourceSampler(input, image, map) : (x, y) => pixel(image, map(x, y));
    const { rows, illegible } = readRows(layout, sample);
    if (dense && illegible > layout.centers.length * 6 * 0.12) {
      return unreadable('De code is herkend, maar te veel vakjes zijn onleesbaar. Leg de A4-bon vlak en stel scherp.');
    }
    const corners = geometry.corners.map(toSource);
    const centers = layout.centers.map(columns => columns.map(([x, y]) => sourcePoint(x, y)));
    return { ok: true, template: layout.id, rows, corners, centers, reason: '' };
  }

  scanForm.releaseBuffers = () => { workspace = null; };
  global.scanForm = scanForm;
})(typeof window !== 'undefined' ? window : globalThis);
