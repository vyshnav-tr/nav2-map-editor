// Targeted reader/writer for ROS2 map_server YAML metadata files.
// The format is flat key/value with a single array (origin), so a tiny
// purpose-built parser is safer and lighter than a full YAML dependency.

export interface MapMeta {
  image: string;
  resolution: number;
  origin: [number, number, number];
  negate: number;
  occupied_thresh: number;
  free_thresh: number;
  mode: string;
}

export const DEFAULT_META: MapMeta = {
  image: "map.pgm",
  resolution: 0.05,
  origin: [0, 0, 0],
  negate: 0,
  occupied_thresh: 0.65,
  free_thresh: 0.196,
  mode: "trinary",
};

export function parseMapYaml(text: string): MapMeta {
  const meta: MapMeta = { ...DEFAULT_META };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    switch (key) {
      case "image":
        meta.image = stripQuotes(value);
        break;
      case "resolution":
        meta.resolution = parseFloat(value);
        break;
      case "origin": {
        const nums = value
          .replace(/[[\]]/g, "")
          .split(",")
          .map((n) => parseFloat(n.trim()))
          .filter((n) => !Number.isNaN(n));
        if (nums.length >= 2) meta.origin = [nums[0], nums[1], nums[2] ?? 0];
        break;
      }
      case "negate":
        meta.negate = parseInt(value, 10) || 0;
        break;
      case "occupied_thresh":
        meta.occupied_thresh = parseFloat(value);
        break;
      case "free_thresh":
        meta.free_thresh = parseFloat(value);
        break;
      case "mode":
        meta.mode = stripQuotes(value);
        break;
    }
  }
  return meta;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}

export function serializeMapYaml(meta: MapMeta): string {
  const o = meta.origin;
  return [
    `image: ${meta.image}`,
    `mode: ${meta.mode}`,
    `resolution: ${meta.resolution}`,
    `origin: [${o[0]}, ${o[1]}, ${o[2]}]`,
    `negate: ${meta.negate}`,
    `occupied_thresh: ${meta.occupied_thresh}`,
    `free_thresh: ${meta.free_thresh}`,
    "",
  ].join("\n");
}
