(function initSecondQrCode(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondQrCode = api;
  if (typeof window === "object") window.SecondQrCode = api;
  if (typeof globalThis === "object") globalThis.SecondQrCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondQrCode(root) {
  "use strict";

  const VERSION = 8;
  const SIZE = 17 + VERSION * 4;
  const DATA_CODEWORDS = 194;
  const BLOCK_DATA_CODEWORDS = 97;
  const ECC_CODEWORDS = 24;
  const MAX_BYTES = 192;
  const ALIGNMENT = [6, 24, 42];
  const ECC_LOW_FORMAT_BITS = 1;

  function toSvg(text, options = {}) {
    const matrix = encode(String(text || ""));
    const quiet = Number.isFinite(options.quiet) ? options.quiet : 4;
    const viewSize = matrix.length + quiet * 2;
    const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
    const className = options.className ? ` class="${escapeXml(options.className)}"` : "";
    let path = "";
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix.length; x += 1) {
        if (matrix[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    return `<svg${className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="${escapeXml(options.label || "QR code")}">${title}<rect width="${viewSize}" height="${viewSize}" fill="#fff"/><path fill="#1d1b17" d="${path}"/></svg>`;
  }

  function toDataUrl(text, options = {}) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(toSvg(text, options))}`;
  }

  function encode(text) {
    const bytes = utf8Bytes(text);
    if (bytes.length > MAX_BYTES) {
      throw new Error(`QR pairing URL is too long (${bytes.length}/${MAX_BYTES} bytes)`);
    }

    const modules = emptyMatrix(null);
    const isFunction = emptyMatrix(false);
    drawFunctionPatterns(modules, isFunction);

    const dataCodewords = encodeDataCodewords(bytes);
    const allCodewords = addEccAndInterleave(dataCodewords);
    drawCodewords(modules, isFunction, allCodewords);

    let bestMask = 0;
    let bestModules = null;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const candidate = cloneMatrix(modules);
      applyMask(candidate, isFunction, mask);
      drawFormatBits(candidate, isFunction, mask);
      drawVersionBits(candidate, isFunction);
      const penalty = getPenaltyScore(candidate);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestModules = candidate;
      }
    }
    drawFormatBits(bestModules, isFunction, bestMask);
    drawVersionBits(bestModules, isFunction);
    return bestModules;
  }

  function emptyMatrix(value) {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(value));
  }

  function cloneMatrix(matrix) {
    return matrix.map((row) => row.slice());
  }

  function drawFunctionPatterns(modules, isFunction) {
    drawFinderPattern(modules, isFunction, 3, 3);
    drawFinderPattern(modules, isFunction, SIZE - 4, 3);
    drawFinderPattern(modules, isFunction, 3, SIZE - 4);

    for (let i = 8; i < SIZE - 8; i += 1) {
      const dark = i % 2 === 0;
      setFunction(modules, isFunction, i, 6, dark);
      setFunction(modules, isFunction, 6, i, dark);
    }

    for (const x of ALIGNMENT) {
      for (const y of ALIGNMENT) {
        const overlapsFinder = (x === 6 && y === 6) || (x === 6 && y === SIZE - 7) || (x === SIZE - 7 && y === 6);
        if (!overlapsFinder) drawAlignmentPattern(modules, isFunction, x, y);
      }
    }

    drawFormatBits(modules, isFunction, 0);
    drawVersionBits(modules, isFunction);
  }

  function drawFinderPattern(modules, isFunction, cx, cy) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(modules, isFunction, x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignmentPattern(modules, isFunction, cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(modules, isFunction, cx + dx, cy + dy, dist !== 1);
      }
    }
  }

  function drawFormatBits(modules, isFunction, mask) {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i += 1) setFunction(modules, isFunction, 8, i, getBit(bits, i));
    setFunction(modules, isFunction, 8, 7, getBit(bits, 6));
    setFunction(modules, isFunction, 8, 8, getBit(bits, 7));
    setFunction(modules, isFunction, 7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) setFunction(modules, isFunction, 14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i += 1) setFunction(modules, isFunction, SIZE - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i += 1) setFunction(modules, isFunction, 8, SIZE - 15 + i, getBit(bits, i));
    setFunction(modules, isFunction, 8, SIZE - 8, true);
  }

  function drawVersionBits(modules, isFunction) {
    const bits = versionBits();
    for (let i = 0; i < 18; i += 1) {
      const dark = getBit(bits, i);
      const a = SIZE - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(modules, isFunction, a, b, dark);
      setFunction(modules, isFunction, b, a, dark);
    }
  }

  function setFunction(modules, isFunction, x, y, dark) {
    modules[y][x] = Boolean(dark);
    isFunction[y][x] = true;
  }

  function encodeDataCodewords(bytes) {
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, 8);
    for (const value of bytes) appendBits(bits, value, 8);
    const capacityBits = DATA_CODEWORDS * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
      codewords.push(value);
    }
    for (let pad = 0; codewords.length < DATA_CODEWORDS; pad += 1) {
      codewords.push(pad % 2 === 0 ? 0xec : 0x11);
    }
    return codewords;
  }

  function appendBits(output, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) output.push((value >>> i) & 1);
  }

  function addEccAndInterleave(dataCodewords) {
    const first = dataCodewords.slice(0, BLOCK_DATA_CODEWORDS);
    const second = dataCodewords.slice(BLOCK_DATA_CODEWORDS, BLOCK_DATA_CODEWORDS * 2);
    const blocks = [first, second];
    const ecc = blocks.map((block) => reedSolomonRemainder(block, ECC_CODEWORDS));
    const result = [];
    for (let i = 0; i < BLOCK_DATA_CODEWORDS; i += 1) {
      result.push(first[i], second[i]);
    }
    for (let i = 0; i < ECC_CODEWORDS; i += 1) {
      result.push(ecc[0][i], ecc[1][i]);
    }
    return result;
  }

  function drawCodewords(modules, isFunction, codewords) {
    const bits = [];
    for (const word of codewords) appendBits(bits, word, 8);
    let index = 0;
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < SIZE; vert += 1) {
        const y = upward ? SIZE - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          if (!isFunction[y][x]) {
            modules[y][x] = index < bits.length ? Boolean(bits[index]) : false;
            index += 1;
          }
        }
      }
      upward = !upward;
    }
  }

  function applyMask(modules, isFunction, mask) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (!isFunction[y][x] && maskCondition(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  function maskCondition(mask, x, y) {
    if (mask === 0) return (x + y) % 2 === 0;
    if (mask === 1) return y % 2 === 0;
    if (mask === 2) return x % 3 === 0;
    if (mask === 3) return (x + y) % 3 === 0;
    if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
    if (mask === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }

  function getPenaltyScore(modules) {
    let result = 0;
    for (let y = 0; y < SIZE; y += 1) result += runPenalty(modules[y]);
    for (let x = 0; x < SIZE; x += 1) result += runPenalty(modules.map((row) => row[x]));

    for (let y = 0; y < SIZE - 1; y += 1) {
      for (let x = 0; x < SIZE - 1; x += 1) {
        const dark = modules[y][x];
        if (dark === modules[y][x + 1] && dark === modules[y + 1][x] && dark === modules[y + 1][x + 1]) result += 3;
      }
    }

    for (let y = 0; y < SIZE; y += 1) result += finderLikePenalty(modules[y]);
    for (let x = 0; x < SIZE; x += 1) result += finderLikePenalty(modules.map((row) => row[x]));

    const darkCount = modules.flat().filter(Boolean).length;
    const total = SIZE * SIZE;
    result += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
    return result;
  }

  function runPenalty(line) {
    let result = 0;
    let runColor = line[0];
    let runLength = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) result += 3 + runLength - 5;
        runColor = line[i];
        runLength = 1;
      }
    }
    if (runLength >= 5) result += 3 + runLength - 5;
    return result;
  }

  function finderLikePenalty(line) {
    let result = 0;
    const pattern = [true, false, true, true, true, false, true];
    for (let i = 0; i <= line.length - 7; i += 1) {
      let matches = true;
      for (let j = 0; j < 7; j += 1) {
        if (line[i + j] !== pattern[j]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      const before = i >= 4 && line.slice(i - 4, i).every((value) => !value);
      const after = i + 11 <= line.length && line.slice(i + 7, i + 11).every((value) => !value);
      if (before || after) result += 40;
    }
    return result;
  }

  function reedSolomonRemainder(data, degree) {
    const generator = reedSolomonGenerator(degree);
    const result = Array(degree).fill(0);
    for (const value of data) {
      const factor = value ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i += 1) {
        result[i] ^= gfMultiply(generator[i], factor);
      }
    }
    return result;
  }

  function reedSolomonGenerator(degree) {
    let result = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = Array(result.length + 1).fill(0);
      for (let j = 0; j < result.length; j += 1) {
        next[j] ^= result[j];
        next[j + 1] ^= gfMultiply(result[j], gfPow(2, i));
      }
      result = next;
    }
    return result.slice(1);
  }

  function gfPow(value, exponent) {
    let result = 1;
    for (let i = 0; i < exponent; i += 1) result = gfMultiply(result, value);
    return result;
  }

  function gfMultiply(left, right) {
    let x = left;
    let y = right;
    let result = 0;
    while (y !== 0) {
      if ((y & 1) !== 0) result ^= x;
      y >>>= 1;
      x <<= 1;
      if ((x & 0x100) !== 0) x ^= 0x11d;
    }
    return result;
  }

  function formatBits(mask) {
    const data = (ECC_LOW_FORMAT_BITS << 3) | mask;
    return ((data << 10) | bchRemainder(data << 10, 0x537, 10)) ^ 0x5412;
  }

  function versionBits() {
    return (VERSION << 12) | bchRemainder(VERSION << 12, 0x1f25, 12);
  }

  function bchRemainder(value, polynomial, degree) {
    let result = value;
    for (let i = bitLength(result) - 1; i >= degree; i -= 1) {
      if (((result >>> i) & 1) !== 0) result ^= polynomial << (i - degree);
    }
    return result;
  }

  function bitLength(value) {
    let length = 0;
    for (let current = value; current !== 0; current >>>= 1) length += 1;
    return length;
  }

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === "function") return Array.from(new TextEncoder().encode(text));
    if (root?.TextEncoder) return Array.from(new root.TextEncoder().encode(text));
    if (typeof Buffer === "function") return Array.from(Buffer.from(text, "utf8"));
    return Array.from(unescape(encodeURIComponent(text))).map((char) => char.charCodeAt(0));
  }

  function escapeXml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]
    ));
  }

  return {
    encode,
    toDataUrl,
    toSvg,
  };
});
