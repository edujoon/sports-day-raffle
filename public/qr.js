/**
 * Compact, self-contained ISO/IEC 18004 QR Code SVG Generator (Byte Mode, ECC Level L, Versions 1-6)
 * Works 100% offline in local training venues without external image APIs.
 */
(function (global) {
  // Version parameters for ECC Level L (totalCodewords, ecCodewordsPerBlock, alignmentCenters)
  const VERSIONS = [
    null,
    { size: 21, total: 26, ec: 7, align: [] },           // v1: up to 17 bytes
    { size: 25, total: 44, ec: 10, align: [6, 18] },     // v2: up to 32 bytes
    { size: 29, total: 70, ec: 15, align: [6, 22] },     // v3: up to 53 bytes
    { size: 33, total: 100, ec: 20, align: [6, 26] },    // v4: up to 78 bytes
    { size: 37, total: 134, ec: 26, align: [6, 30] },    // v5: up to 106 bytes
    { size: 41, total: 172, ec: 18, blocks: 2, align: [6, 34] } // v6: 2 blocks of (68 data + 18 ec), up to 134 bytes
  ];

  // GF(256) log/exp tables with primitive polynomial 0x11d
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const root = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], root);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const rem = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[ecLen - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < ecLen; j++) {
          rem[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return rem;
  }

  function computeFormatBits(ecLevelBits, maskPattern) {
    const data = (ecLevelBits << 3) | maskPattern;
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function encodeMatrix(text) {
    const bytes = new TextEncoder().encode(text);
    let ver = 1;
    while (ver <= 6) {
      const info = VERSIONS[ver];
      const blocks = info.blocks || 1;
      const dataCap = info.total - info.ec * blocks;
      if (bytes.length + 2 <= dataCap) break;
      ver++;
    }
    if (ver > 6) throw new Error('URL too long for compact QR');

    const info = VERSIONS[ver];
    const blocks = info.blocks || 1;
    const dataCap = info.total - info.ec * blocks;

    // Bit buffer: Byte mode (0100) + 8-bit char count + bytes + terminator + pad
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4);
    pushBits(bytes.length, 8);
    for (const b of bytes) pushBits(b, 8);
    const maxBits = dataCap * 8;
    for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataBytes = new Uint8Array(dataCap);
    for (let i = 0; i < bits.length / 8; i++) {
      let v = 0;
      for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
      dataBytes[i] = v;
    }
    const pads = [0xec, 0x11];
    for (let i = bits.length / 8, p = 0; i < dataCap; i++, p ^= 1) {
      dataBytes[i] = pads[p];
    }

    // Interleave blocks if blocks > 1
    const allCodewords = [];
    if (blocks === 1) {
      const ec = rsEncode(dataBytes, info.ec);
      for (const b of dataBytes) allCodewords.push(b);
      for (const b of ec) allCodewords.push(b);
    } else {
      const blockLen = dataCap / blocks;
      const dBlocks = [];
      const eBlocks = [];
      for (let b = 0; b < blocks; b++) {
        const slice = dataBytes.slice(b * blockLen, (b + 1) * blockLen);
        dBlocks.push(slice);
        eBlocks.push(rsEncode(slice, info.ec));
      }
      for (let i = 0; i < blockLen; i++) {
        for (let b = 0; b < blocks; b++) allCodewords.push(dBlocks[b][i]);
      }
      for (let i = 0; i < info.ec; i++) {
        for (let b = 0; b < blocks; b++) allCodewords.push(eBlocks[b][i]);
      }
    }

    const size = info.size;
    const grid = Array.from({ length: size }, () => new Uint8Array(size));
    const reserved = Array.from({ length: size }, () => new Uint8Array(size));

    function setFunc(r, c, dark) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      grid[r][c] = dark ? 1 : 0;
      reserved[r][c] = 1;
    }

    function placeFinder(top, left) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          setFunc(top + r, left + c, inOuter && (onBorder || inCenter));
        }
      }
    }

    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // Alignment patterns
    const centers = info.align;
    for (let i = 0; i < centers.length; i++) {
      for (let j = 0; j < centers.length; j++) {
        const cr = centers[i];
        const cc = centers[j];
        if (reserved[cr][cc]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunc(cr + dr, cc + dc, dark);
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!reserved[6][i]) setFunc(6, i, i % 2 === 0);
      if (!reserved[i][6]) setFunc(i, 6, i % 2 === 0);
    }

    // Dark module & reserve format info slots
    setFunc(4 * ver + 9, 8, true);
    for (let i = 0; i < 9; i++) {
      if (!reserved[8][i]) reserved[8][i] = 1;
      if (!reserved[i][8]) reserved[i][8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = 1;
      reserved[size - 1 - i][8] = 1;
    }

    // Place data bits with Mask 0: (r + c) % 2 === 0
    const codeBits = [];
    for (const cw of allCodewords) {
      for (let b = 7; b >= 0; b--) codeBits.push((cw >>> b) & 1);
    }

    let bitIdx = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!reserved[r][c]) {
            const bit = bitIdx < codeBits.length ? codeBits[bitIdx++] : 0;
            const mask = (r + c) % 2 === 0 ? 1 : 0;
            grid[r][c] = bit ^ mask;
          }
        }
      }
      upward = !upward;
    }

    // Format info: ECC Level L = 0b01, Mask = 0
    const fmt = computeFormatBits(0b01, 0);
    for (let i = 0; i <= 5; i++) setFunc(8, i, (fmt >>> i) & 1);
    setFunc(8, 7, (fmt >>> 6) & 1);
    setFunc(8, 8, (fmt >>> 7) & 1);
    setFunc(7, 8, (fmt >>> 8) & 1);
    for (let i = 9; i < 15; i++) setFunc(14 - i, 8, (fmt >>> i) & 1);

    for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, (fmt >>> i) & 1);
    for (let i = 8; i < 15; i++) setFunc(size - 15 + i, 8, (fmt >>> i) & 1);

    return grid;
  }

  function createQrSvg(text, margin = 2) {
    try {
      const grid = encodeMatrix(text);
      const n = grid.length;
      const total = n + margin * 2;
      let pathData = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (grid[r][c]) {
            pathData += `M${c + margin},${r + margin}h1v1h-1z`;
          }
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${pathData}" fill="#0f172a"/></svg>`;
    } catch (e) {
      return `<div style="padding:16px;text-align:center;color:#ef4444;font-size:14px;">QR 표시 오류</div>`;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQrSvg, encodeMatrix };
  }
  global.QRGen = { createQrSvg };
})(typeof window !== 'undefined' ? window : globalThis);

