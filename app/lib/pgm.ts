// Minimal PGM (Portable Gray Map) reader/writer for ROS2 map images.
// Supports P5 (binary) and P2 (ASCII). 8-bit only (maxval <= 255), which is
// what map_server / nav2 produce.

export interface Pgm {
  width: number;
  height: number;
  /** Grayscale pixel values, row-major, top-left origin, 0..255. */
  data: Uint8Array;
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]); // space, tab, LF, CR

export function parsePgm(buffer: ArrayBuffer): Pgm {
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  const skipSeparators = () => {
    while (pos < bytes.length) {
      const c = bytes[pos];
      if (c === 0x23) {
        // comment until end of line
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      } else if (WHITESPACE.has(c)) {
        pos++;
      } else {
        break;
      }
    }
  };

  const readToken = (): string => {
    skipSeparators();
    const start = pos;
    while (pos < bytes.length && !WHITESPACE.has(bytes[pos]) && bytes[pos] !== 0x23) {
      pos++;
    }
    if (pos === start) throw new Error("Unexpected end of PGM header");
    let s = "";
    for (let i = start; i < pos; i++) s += String.fromCharCode(bytes[i]);
    return s;
  };

  const magic = readToken();
  if (magic !== "P5" && magic !== "P2") {
    throw new Error(`Unsupported PGM magic "${magic}" (expected P5 or P2)`);
  }
  const width = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  const maxval = parseInt(readToken(), 10);
  if (!width || !height || !maxval) throw new Error("Invalid PGM dimensions");
  if (maxval > 255) throw new Error("16-bit PGM is not supported (maxval > 255)");

  const count = width * height;
  const data = new Uint8Array(count);
  const scale = maxval === 255 ? 1 : 255 / maxval;

  if (magic === "P5") {
    pos++; // exactly one whitespace separates the header from binary data
    if (pos + count > bytes.length) throw new Error("PGM data is truncated");
    for (let i = 0; i < count; i++) {
      const v = bytes[pos + i];
      data[i] = maxval === 255 ? v : Math.round(v * scale);
    }
  } else {
    for (let i = 0; i < count; i++) {
      const v = parseInt(readToken(), 10);
      data[i] = maxval === 255 ? v : Math.round(v * scale);
    }
  }

  return { width, height, data };
}

/** Encode an 8-bit grayscale buffer as a binary (P5) PGM file. */
export function encodePgm(width: number, height: number, data: Uint8Array): Uint8Array {
  const header = `P5\n# Created with ROS2 Map Mask Editor\n${width} ${height}\n255\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.length + data.length);
  out.set(headerBytes, 0);
  out.set(data, headerBytes.length);
  return out;
}
