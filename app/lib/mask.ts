// Costmap-filter mask model and export helpers for Nav2.
//
// A mask stores an OccupancyGrid value per cell (0..100):
//   - Keepout mask:  100 = keepout (lethal), 0 = free.
//   - Speed mask:    value = speed limit as a percentage of max speed
//                    (0 = no restriction). Used by Nav2 SpeedFilter in
//                    "percentage" mode with base=0.0, multiplier=1.0.
//
// On export we choose pixel values + YAML thresholds so that nav2's
// map_server reconstructs exactly these OccupancyGrid values.
//
// nav2 maps a pixel p (negate=0) to occupancy via  occ = (255 - p) / 255.

import { encodePgm } from "./pgm";
import { MapMeta, serializeMapYaml } from "./rosYaml";

export type MaskType = "keepout" | "speed";

export interface MaskLayer {
  id: string;
  name: string;
  type: MaskType;
  /** OccupancyGrid value per cell, 0..100, row-major top-left origin. */
  data: Uint8Array;
  visible: boolean;
}

export const MASK_INFO: Record<MaskType, { label: string; blurb: string }> = {
  keepout: {
    label: "Keepout zone",
    blurb: "Areas the robot must never enter (treated as lethal obstacles).",
  },
  speed: {
    label: "Speed limit",
    blurb: "Restrict the robot's max speed (percentage) in painted areas.",
  },
};

/** Convert an OccupancyGrid value (0..100) to a PGM pixel for a given mask type. */
function valueToPixel(type: MaskType, value: number): number {
  if (type === "keepout") {
    // trinary mode: occupied (>=50) -> black (occ 1.0), free -> near-white.
    return value >= 50 ? 0 : 254;
  }
  // speed: scale mode, occ = value/100  ->  p = round(255 * (1 - value/100))
  const v = Math.max(0, Math.min(100, value));
  return Math.round(255 * (1 - v / 100));
}

export function maskMetaFor(type: MaskType, base: MapMeta, imageName: string): MapMeta {
  if (type === "keepout") {
    return {
      image: imageName,
      mode: "trinary",
      resolution: base.resolution,
      origin: base.origin,
      negate: 0,
      occupied_thresh: 0.65,
      free_thresh: 0.196,
    };
  }
  // Speed mask: scale mode with thresholds outside the data range so that
  // every cell is linearly scaled (value = round(occ * 100)), never clamped.
  return {
    image: imageName,
    mode: "scale",
    resolution: base.resolution,
    origin: base.origin,
    negate: 0,
    occupied_thresh: 1.0,
    free_thresh: 0.0,
  };
}

export interface MaskExport {
  pgm: Uint8Array;
  yaml: string;
  pgmName: string;
  yamlName: string;
}

export function exportMask(
  layer: MaskLayer,
  width: number,
  height: number,
  base: MapMeta,
): MaskExport {
  const safeName = (layer.name || layer.type).trim().replace(/[^\w.-]+/g, "_");
  const pgmName = `${safeName}.pgm`;
  const yamlName = `${safeName}.yaml`;

  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = valueToPixel(layer.type, layer.data[i]);
  }

  const meta = maskMetaFor(layer.type, base, pgmName);
  return {
    pgm: encodePgm(width, height, pixels),
    yaml: serializeMapYaml(meta),
    pgmName,
    yamlName,
  };
}
