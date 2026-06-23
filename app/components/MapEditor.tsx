"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cursor02Icon,
  Square01Icon,
  RectangularIcon,
  CircleIcon,
  HexagonIcon,
  Move02Icon,
  FitToScreenIcon,
  Undo02Icon,
  Redo02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  Delete02Icon,
  Download04Icon,
  ImageUpload01Icon,
  File02Icon,
  Tick02Icon,
  CancelCircleIcon,
  Building03Icon,
  GaugeIcon,
  ArrowLeft01Icon,
  ArrowDown01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { parsePgm, encodePgm } from "../lib/pgm";
import { MapMeta, parseMapYaml, serializeMapYaml } from "../lib/rosYaml";
import { maskMetaFor } from "../lib/mask";
import { createZip, ZipEntry } from "../lib/zip";

interface MapData {
  width: number;
  height: number;
  gray: Uint8Array;
  meta: MapMeta;
  pgmName: string;
}

export default function MapEditor() {
  const [map, setMap] = useState<MapData | null>(null);
  if (!map) return <Uploader onReady={setMap} />;
  return <Editor map={map} onClose={() => setMap(null)} />;
}

/* ===================================================================== */
/* Upload gate                                                            */
/* ===================================================================== */

function Uploader({ onReady }: { onReady: (m: MapData) => void }) {
  const [pgm, setPgm] = useState<File | null>(null);
  const [yaml, setYaml] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const n = f.name.toLowerCase();
      if (n.endsWith(".pgm")) setPgm(f);
      else if (n.endsWith(".yaml") || n.endsWith(".yml")) setYaml(f);
    }
  };

  const open = async () => {
    if (!pgm || !yaml) return;
    try {
      const [pBuf, yText] = await Promise.all([pgm.arrayBuffer(), yaml.text()]);
      const img = parsePgm(pBuf);
      const meta = { ...parseMapYaml(yText), image: pgm.name };
      onReady({ width: img.width, height: img.height, gray: img.data, meta, pgmName: pgm.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read files");
    }
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-ink p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        accept(e.dataTransfer.files);
      }}
    >
      <div className="w-full max-w-md">
        <div className="space-y-2.5">
          <FilePick
            icon={ImageUpload01Icon}
            label="Map image"
            hint={pgm ? pgm.name : "Select a .pgm file"}
            done={!!pgm}
            accept=".pgm"
            onPick={setPgm}
          />
          <FilePick
            icon={File02Icon}
            label="Map metadata"
            hint={yaml ? yaml.name : "Select a .yaml file"}
            done={!!yaml}
            accept=".yaml,.yml"
            onPick={setYaml}
          />
        </div>

        <p className="mt-3 text-center text-[11px] text-fg-faint">or drop both files here</p>
        {error && <p className="mt-3 text-sm text-keepout">{error}</p>}

        <button
          onClick={open}
          disabled={!pgm || !yaml}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-medium text-white shadow-md shadow-brand/20 transition enabled:hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-40"
        >
          <HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.8} />
          Open editor
        </button>
      </div>
    </div>
  );
}

function FilePick({
  icon,
  label,
  hint,
  done,
  accept,
  onPick,
}: {
  icon: typeof File02Icon;
  label: string;
  hint: string;
  done: boolean;
  accept: string;
  onPick: (f: File) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-elevated px-3.5 py-3 transition hover:border-brand hover:bg-brand-soft">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          done ? "bg-emerald-100 text-emerald-600" : "bg-white text-fg-muted"
        }`}
      >
        <HugeiconsIcon icon={done ? Tick02Icon : icon} size={18} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">{label}</span>
        <span className="block truncate text-[11px] text-fg-faint">{hint}</span>
      </span>
      <span className="rounded-lg bg-white px-2.5 py-1 text-xs text-fg-muted ring-1 ring-line">Browse</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  );
}

/* ===================================================================== */
/* Editor                                                                 */
/* ===================================================================== */

type ZoneType = "keepout" | "wall" | "speed";
type ShapeKind = "rect" | "ellipse" | "polygon";
type Tool = "select" | "rect" | "ellipse" | "polygon" | "pan";

interface Pt {
  x: number;
  y: number;
}

interface Shape {
  id: string;
  type: ZoneType;
  kind: ShapeKind;
  // rect / ellipse: axis box (pre-rotation) + rotation about center
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  // polygon: vertices in grid coordinates (empty for rect/ellipse)
  points: Pt[];
  speed: number;
}

const ZONE: Record<ZoneType, { label: string; stroke: string; fill: string; icon: typeof GaugeIcon }> = {
  keepout: { label: "Keepout", stroke: "#ef4444", fill: "rgba(239,68,68,0.26)", icon: CancelCircleIcon },
  wall: { label: "Wall", stroke: "#475569", fill: "rgba(51,65,85,0.5)", icon: Building03Icon },
  speed: { label: "Speed", stroke: "#f59e0b", fill: "rgba(245,158,11,0.26)", icon: GaugeIcon },
};

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];
const HANDLE_PX = 9;
let shapeSeq = 0;

interface View {
  scale: number;
  x: number;
  y: number;
}

function Editor({ map, onClose }: { map: MapData; onClose: () => void }) {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ wx: number; wy: number } | null>(null);
  const [hIndex, setHIndex] = useState(0);
  const [histLen, setHistLen] = useState(1);
  const [draftPoly, setDraftPoly] = useState<Pt[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);

  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const viewRef = useRef(view);
  viewRef.current = view;
  const draftPolyRef = useRef<Pt[] | null>(null);
  draftPolyRef.current = draftPoly;
  const previewGrid = useRef<Pt | null>(null);

  // Undo/redo history: each entry is a full snapshot of the shapes array.
  const historyRef = useRef<Shape[][]>([[]]);
  const hIndexRef = useRef(0);

  const ix = useRef<{
    mode: "create" | "move" | "resize" | "rotate" | "vertex" | "pan" | null;
    handle: Handle | null;
    start: { col: number; row: number } | null;
    origin: Shape | null;
    panStart: { x: number; y: number; vx: number; vy: number } | null;
    draftId: string | null;
    vertex: number;
    dirty: boolean;
  }>({ mode: null, handle: null, start: null, origin: null, panStart: null, draftId: null, vertex: -1, dirty: false });

  const selected = shapes.find((s) => s.id === selectedId) ?? null;

  /* ---- history ------------------------------------------------------- */
  const pushHistory = (next: Shape[]) => {
    const idx = hIndexRef.current;
    const cur = historyRef.current[idx];
    // Skip no-op commits (e.g. focusing a field and blurring without editing).
    if (cur && cur.length === next.length && cur.every((s, i) => s === next[i])) return;
    const hist = historyRef.current.slice(0, idx + 1);
    hist.push(next);
    historyRef.current = hist;
    hIndexRef.current = hist.length - 1;
    setHIndex(hIndexRef.current);
    setHistLen(hist.length);
  };
  const undo = () => {
    if (hIndexRef.current <= 0) return;
    hIndexRef.current -= 1;
    setHIndex(hIndexRef.current);
    setShapes(historyRef.current[hIndexRef.current]);
    setSelectedId(null);
  };
  const redo = () => {
    if (hIndexRef.current >= historyRef.current.length - 1) return;
    hIndexRef.current += 1;
    setHIndex(hIndexRef.current);
    setShapes(historyRef.current[hIndexRef.current]);
    setSelectedId(null);
  };
  const canUndo = hIndex > 0;
  const canRedo = hIndex < histLen - 1;

  /* ---- base image + fit --------------------------------------------- */
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = map.width;
    c.height = map.height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.gray.length; i++) {
      const v = map.gray[i];
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    baseRef.current = c;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / map.width, el.clientHeight / map.height) * 0.9;
    setView({ scale: s, x: (el.clientWidth - map.width * s) / 2, y: (el.clientHeight - map.height * s) / 2 });
  }, [map.width, map.height]);

  /* ---- transforms ---------------------------------------------------- */
  const screenToGrid = (clientX: number, clientY: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { col: (clientX - r.left - v.x) / v.scale, row: (clientY - r.top - v.y) / v.scale };
  };
  const gridToScreen = (col: number, row: number) => {
    const v = viewRef.current;
    return { x: v.x + col * v.scale, y: v.y + row * v.scale };
  };

  /* ---- draw ---------------------------------------------------------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const el = containerRef.current;
    const base = baseRef.current;
    if (!canvas || !el || !base) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    const v = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#eceef3";
    ctx.fillRect(0, 0, cw, ch);

    // dotted background grid
    const gap = 26;
    const ox = ((v.x % gap) + gap) % gap;
    const oy = ((v.y % gap) + gap) % gap;
    ctx.fillStyle = "rgba(15,23,42,0.06)";
    for (let y = oy; y < ch; y += gap) for (let x = ox; x < cw; x += gap) ctx.fillRect(x, y, 1.5, 1.5);

    // world space
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
    ctx.imageSmoothingEnabled = false;
    // map drop shadow
    ctx.shadowColor = "rgba(15,23,42,0.18)";
    ctx.shadowBlur = 22 / v.scale;
    ctx.shadowOffsetY = 6 / v.scale;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, map.width, map.height);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = "transparent";
    ctx.drawImage(base, 0, 0);
    for (const s of shapesRef.current) {
      const z = ZONE[s.type];
      ctx.fillStyle = z.fill;
      ctx.strokeStyle = z.stroke;
      ctx.lineWidth = (s.id === selectedId ? 2.5 : 1.5) / v.scale;
      if (s.kind === "polygon") {
        if (s.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
        ctx.rotate(s.rot);
        ctx.beginPath();
        if (s.kind === "ellipse") ctx.ellipse(0, 0, Math.max(0.1, s.w / 2), Math.max(0.1, s.h / 2), 0, 0, Math.PI * 2);
        else ctx.rect(-s.w / 2, -s.h / 2, s.w, s.h);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // draft polygon being drawn
    const dp = draftPolyRef.current;
    if (dp && dp.length) {
      ctx.fillStyle = "rgba(79,70,229,0.12)";
      ctx.strokeStyle = "#4f46e5";
      ctx.lineWidth = 1.5 / v.scale;
      ctx.beginPath();
      ctx.moveTo(dp[0].x, dp[0].y);
      for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i].x, dp[i].y);
      if (previewGrid.current) ctx.lineTo(previewGrid.current.x, previewGrid.current.y);
      ctx.stroke();
    }
    ctx.restore();

    // screen space: labels + handles
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const s of shapesRef.current) {
      const anchor = s.kind === "polygon" ? (s.points.length ? { col: polyBBox(s.points).x, row: polyBBox(s.points).y } : null) : handleCenter(s, "nw");
      if (!anchor) continue;
      const p = gridToScreen(anchor.col, anchor.row);
      const label = s.type === "speed" ? `Speed ${s.speed}%` : ZONE[s.type].label;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = ZONE[s.type].stroke;
      roundRect(ctx, p.x, p.y - 20, tw + 14, 17, 4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, p.x + 7, p.y - 11);
    }

    // draft polygon vertices (screen space)
    if (dp) {
      for (let i = 0; i < dp.length; i++) {
        const p = gridToScreen(dp[i].x, dp[i].y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#4f46e5" : "#fff";
        ctx.fill();
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const sel = shapesRef.current.find((s) => s.id === selectedId);
    if (sel && sel.kind === "polygon") {
      // selection bounding box (matches rect/ellipse)
      if (sel.points.length) {
        const b = polyBBox(sel.points);
        const c0 = gridToScreen(b.x, b.y);
        const c1 = gridToScreen(b.x + b.w, b.y + b.h);
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c0.x, c0.y, c1.x - c0.x, c1.y - c0.y);
      }
      for (const pt of sel.points) {
        const p = gridToScreen(pt.x, pt.y);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 2;
        roundRect(ctx, p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX, 2.5);
        ctx.fill();
        ctx.stroke();
      }
    } else if (sel) {
      // selection bounding box (rotated) — connects the corner handles
      const corners = (["nw", "ne", "se", "sw"] as Handle[]).map((h) => {
        const c = handleCenter(sel, h);
        return gridToScreen(c.col, c.row);
      });
      ctx.strokeStyle = "#4f46e5";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();

      // rotation knob + connector
      const nh = handleCenter(sel, "n");
      const np = gridToScreen(nh.col, nh.row);
      const rk = rotateKnobCenter(sel, v.scale);
      const rp = gridToScreen(rk.col, rk.row);
      ctx.beginPath();
      ctx.moveTo(np.x, np.y);
      ctx.lineTo(rp.x, rp.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      for (const h of HANDLES) {
        const c = handleCenter(sel, h);
        const p = gridToScreen(c.col, c.row);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 2;
        roundRect(ctx, p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX, 2.5);
        ctx.fill();
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draftPoly]);

  useEffect(() => {
    draw();
  });
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Discard an in-progress polygon if the user switches away from the tool.
  useEffect(() => {
    if (tool !== "polygon") {
      setDraftPoly(null);
      previewGrid.current = null;
    }
  }, [tool]);

  /* ---- hit testing --------------------------------------------------- */
  const hitHandle = (s: Shape, clientX: number, clientY: number): Handle | null => {
    const r = containerRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    for (const h of HANDLES) {
      const c = handleCenter(s, h);
      const p = gridToScreen(c.col, c.row);
      if (Math.abs(p.x - sx) <= HANDLE_PX && Math.abs(p.y - sy) <= HANDLE_PX) return h;
    }
    return null;
  };
  const topShapeAt = (col: number, row: number): Shape | null => {
    for (let i = shapesRef.current.length - 1; i >= 0; i--) {
      const s = shapesRef.current[i];
      if (pointInShape(s, col, row)) return s;
    }
    return null;
  };
  const hitRotateKnob = (s: Shape, clientX: number, clientY: number): boolean => {
    const r = containerRef.current!.getBoundingClientRect();
    const k = rotateKnobCenter(s, viewRef.current.scale);
    const p = gridToScreen(k.col, k.row);
    return Math.hypot(p.x - (clientX - r.left), p.y - (clientY - r.top)) <= 10;
  };
  const hitVertex = (s: Shape, clientX: number, clientY: number): number => {
    const r = containerRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    for (let i = 0; i < s.points.length; i++) {
      const p = gridToScreen(s.points[i].x, s.points[i].y);
      if (Math.abs(p.x - sx) <= HANDLE_PX && Math.abs(p.y - sy) <= HANDLE_PX) return i;
    }
    return -1;
  };

  const finishPoly = (raw: Pt[]) => {
    // drop near-duplicate consecutive vertices
    const pts: Pt[] = [];
    for (const p of raw) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) pts.push(p);
    }
    setDraftPoly(null);
    previewGrid.current = null;
    if (pts.length < 3) return;
    shapeSeq += 1;
    const id = `s${shapeSeq}`;
    const b = polyBBox(pts);
    const shape: Shape = { id, type: "keepout", kind: "polygon", x: b.x, y: b.y, w: b.w, h: b.h, rot: 0, points: pts, speed: 30 };
    const next = [...shapesRef.current, shape];
    setShapes(next);
    pushHistory(next);
    setSelectedId(id);
    setTool("select");
  };

  /* ---- pointer ------------------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const g = screenToGrid(e.clientX, e.clientY);
    const wantPan = tool === "pan" || e.button === 1 || e.button === 2 || e.shiftKey;
    if (wantPan) {
      ix.current = { ...ix.current, mode: "pan", panStart: { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } };
      return;
    }
    if (tool === "polygon") {
      const cur = draftPolyRef.current;
      if (!cur) {
        setDraftPoly([{ x: g.col, y: g.row }]);
      } else if (cur.length >= 3) {
        const r = containerRef.current!.getBoundingClientRect();
        const fp = gridToScreen(cur[0].x, cur[0].y);
        if (Math.hypot(fp.x - (e.clientX - r.left), fp.y - (e.clientY - r.top)) <= 10) {
          finishPoly(cur);
          return;
        }
        setDraftPoly([...cur, { x: g.col, y: g.row }]);
      } else {
        setDraftPoly([...cur, { x: g.col, y: g.row }]);
      }
      return;
    }
    if (tool === "rect" || tool === "ellipse") {
      shapeSeq += 1;
      const id = `s${shapeSeq}`;
      const draft: Shape = { id, type: "keepout", kind: tool, x: g.col, y: g.row, w: 0, h: 0, rot: 0, points: [], speed: 30 };
      setShapes((p) => [...p, draft]);
      setSelectedId(id);
      ix.current = { ...ix.current, mode: "create", start: g, origin: draft, panStart: null, draftId: id, dirty: false };
      return;
    }
    if (selected) {
      if (selected.kind === "polygon") {
        const vi = hitVertex(selected, e.clientX, e.clientY);
        if (vi >= 0) {
          ix.current = { ...ix.current, mode: "vertex", vertex: vi, start: g, origin: { ...selected }, draftId: selected.id, dirty: false };
          return;
        }
      } else {
        if (hitRotateKnob(selected, e.clientX, e.clientY)) {
          ix.current = { ...ix.current, mode: "rotate", handle: null, start: g, origin: { ...selected }, draftId: null, dirty: false };
          return;
        }
        const h = hitHandle(selected, e.clientX, e.clientY);
        if (h) {
          ix.current = { ...ix.current, mode: "resize", handle: h, start: g, origin: { ...selected }, draftId: null, dirty: false };
          return;
        }
      }
    }
    const hit = topShapeAt(g.col, g.row);
    if (hit) {
      setSelectedId(hit.id);
      ix.current = { ...ix.current, mode: "move", handle: null, start: g, origin: { ...hit }, draftId: hit.id, dirty: false };
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = screenToGrid(e.clientX, e.clientY);
    if (g.col >= 0 && g.col < map.width && g.row >= 0 && g.row < map.height) {
      const { resolution, origin } = map.meta;
      setCursor({ wx: origin[0] + g.col * resolution, wy: origin[1] + (map.height - g.row) * resolution });
    } else setCursor(null);

    // live preview while drawing a polygon
    if (tool === "polygon" && draftPolyRef.current) {
      previewGrid.current = { x: g.col, y: g.row };
      setCursor((c) => (c ? { ...c } : c)); // nudge a redraw
    }

    const it = ix.current;
    if (!it.mode) return;

    if (it.mode === "pan" && it.panStart) {
      const p = it.panStart;
      setView((v) => ({ ...v, x: p.vx + (e.clientX - p.x), y: p.vy + (e.clientY - p.y) }));
      return;
    }
    it.dirty = true;
    if (it.mode === "create" && it.start && it.draftId) {
      const s0 = it.start;
      setShapes((p) =>
        p.map((s) =>
          s.id === it.draftId
            ? { ...s, x: Math.min(s0.col, g.col), y: Math.min(s0.row, g.row), w: Math.abs(g.col - s0.col), h: Math.abs(g.row - s0.row) }
            : s,
        ),
      );
      return;
    }
    if (it.mode === "vertex" && it.origin && it.draftId && it.vertex >= 0) {
      const o = it.origin;
      const pts = o.points.map((p, i) => (i === it.vertex ? { x: g.col, y: g.row } : p));
      const b = polyBBox(pts);
      setShapes((p) => p.map((s) => (s.id === it.draftId ? { ...s, points: pts, x: b.x, y: b.y, w: b.w, h: b.h } : s)));
      return;
    }
    if (it.mode === "move" && it.origin && it.start && it.draftId) {
      const dx = g.col - it.start.col;
      const dy = g.row - it.start.row;
      const o = it.origin;
      if (o.kind === "polygon") {
        const pts = o.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        const b = polyBBox(pts);
        setShapes((p) => p.map((s) => (s.id === it.draftId ? { ...s, points: pts, x: b.x, y: b.y, w: b.w, h: b.h } : s)));
      } else {
        setShapes((p) =>
          p.map((s) =>
            s.id === it.draftId ? { ...s, x: clamp(o.x + dx, 0, map.width - s.w), y: clamp(o.y + dy, 0, map.height - s.h) } : s,
          ),
        );
      }
      return;
    }
    if (it.mode === "rotate" && it.origin) {
      const o = it.origin;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      let ang = Math.atan2(g.row - cy, g.col - cx) + Math.PI / 2;
      if (e.shiftKey) {
        const step = Math.PI / 12; // snap to 15°
        ang = Math.round(ang / step) * step;
      }
      setShapes((p) => p.map((s) => (s.id === o.id ? { ...s, rot: ang } : s)));
      return;
    }
    if (it.mode === "resize" && it.origin && it.handle) {
      const o = it.origin;
      const cos = Math.cos(o.rot);
      const sin = Math.sin(o.rot);
      const ux = { x: cos, y: sin }; // local +x axis in world
      const uy = { x: -sin, y: cos }; // local +y axis in world
      const anchor = handleCenter(o, oppositeHandle(it.handle)); // stays fixed
      const dX = g.col - anchor.col;
      const dY = g.row - anchor.row;
      const lw = dX * ux.x + dY * ux.y; // signed extent along local x
      const lh = dX * uy.x + dY * uy.y; // signed extent along local y
      const corner = it.handle.length === 2;
      let newW = o.w;
      let newH = o.h;
      let cx = o.x + o.w / 2;
      let cy = o.y + o.h / 2;
      if (corner) {
        newW = Math.max(1, Math.abs(lw));
        newH = Math.max(1, Math.abs(lh));
        cx = anchor.col + (ux.x * lw + uy.x * lh) / 2;
        cy = anchor.row + (ux.y * lw + uy.y * lh) / 2;
      } else if (it.handle === "e" || it.handle === "w") {
        newW = Math.max(1, Math.abs(lw));
        cx = anchor.col + (ux.x * lw) / 2;
        cy = anchor.row + (ux.y * lw) / 2;
      } else {
        newH = Math.max(1, Math.abs(lh));
        cx = anchor.col + (uy.x * lh) / 2;
        cy = anchor.row + (uy.y * lh) / 2;
      }
      const nx = cx - newW / 2;
      const ny = cy - newH / 2;
      setShapes((p) => p.map((s) => (s.id === o.id ? { ...s, x: nx, y: ny, w: newW, h: newH } : s)));
    }
  };

  const onPointerUp = () => {
    const it = ix.current;
    if (it.mode === "create" && it.draftId) {
      const id = it.draftId;
      const next = shapesRef.current.filter((s) => !(s.id === id && (s.w < 2 || s.h < 2)));
      setShapes(next);
      if (next.some((s) => s.id === id)) pushHistory(next); // shape survived → record it
      setTool("select");
    } else if ((it.mode === "move" || it.mode === "resize" || it.mode === "rotate" || it.mode === "vertex") && it.dirty) {
      pushHistory(shapesRef.current);
    }
    ix.current = { mode: null, handle: null, start: null, origin: null, panStart: null, draftId: null, vertex: -1, dirty: false };
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const scale = clamp(v.scale * factor, 0.05, 60);
      const k = scale / v.scale;
      return { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
    });
  };

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const scale = clamp(v.scale * factor, 0.05, 60);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  /* ---- mutators ------------------------------------------------------ */
  // Live edit (no history entry) — used while dragging a slider/field.
  const patchSelected = (patch: Partial<Shape>) =>
    setShapes((p) => p.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  // Committed edit (records a history entry) — used for discrete changes.
  const commitSelected = (patch: Partial<Shape>) => {
    let changed = false;
    const next = shapesRef.current.map((s) => {
      if (s.id !== selectedId) return s;
      const updated = { ...s, ...patch };
      if ((Object.keys(patch) as (keyof Shape)[]).some((k) => s[k] !== updated[k])) changed = true;
      return updated;
    });
    if (!changed) return;
    setShapes(next);
    pushHistory(next);
  };
  const commitLiveEdit = () => pushHistory(shapesRef.current);
  const deleteSelected = () => {
    const next = shapesRef.current.filter((s) => s.id !== selectedId);
    setShapes(next);
    pushHistory(next);
    setSelectedId(null);
  };

  /* ---- keyboard ------------------------------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape" && draftPolyRef.current) {
        setDraftPoly(null);
        previewGrid.current = null;
        return;
      }
      if (e.key === "Enter" && draftPolyRef.current) {
        finishPoly(draftPolyRef.current);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "r" || e.key === "R") setTool("rect");
      else if (e.key === "o" || e.key === "O") setTool("ellipse");
      else if (e.key === "p" || e.key === "P") setTool("polygon");
      else if (e.key === "h" || e.key === "H") setTool("pan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* ---- export -------------------------------------------------------- */
  const rasterize = (predicate: (s: Shape) => boolean, valueOf: (s: Shape) => number) => {
    const W = map.width;
    const H = map.height;
    const data = new Uint8Array(W * H);
    for (const s of shapes) {
      if (!predicate(s)) continue;
      const val = valueOf(s);

      if (s.kind === "polygon") {
        if (s.points.length < 3) continue;
        const b = polyBBox(s.points);
        const x0 = clamp(Math.floor(b.x), 0, W);
        const x1 = clamp(Math.ceil(b.x + b.w), 0, W);
        const y0 = clamp(Math.floor(b.y), 0, H);
        const y1 = clamp(Math.ceil(b.y + b.h), 0, H);
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++)
            if (pointInPolygon(s.points, x + 0.5, y + 0.5)) data[y * W + x] = val;
        continue;
      }

      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const cos = Math.cos(s.rot);
      const sin = Math.sin(s.rot);
      const hw = s.w / 2;
      const hh = s.h / 2;
      const ellipse = s.kind === "ellipse";
      // axis-aligned bounding box of the rotated shape
      const lxs = [-hw, hw, hw, -hw];
      const lys = [-hh, -hh, hh, hh];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 4; k++) {
        const wx = cx + lxs[k] * cos - lys[k] * sin;
        const wy = cy + lxs[k] * sin + lys[k] * cos;
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      }
      const x0 = clamp(Math.floor(minX), 0, W);
      const x1 = clamp(Math.ceil(maxX), 0, W);
      const y0 = clamp(Math.floor(minY), 0, H);
      const y1 = clamp(Math.ceil(maxY), 0, H);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const lx = dx * cos + dy * sin;
          const ly = -dx * sin + dy * cos;
          const inside = ellipse
            ? (lx * lx) / (hw * hw || 1) + (ly * ly) / (hh * hh || 1) <= 1
            : Math.abs(lx) <= hw && Math.abs(ly) <= hh;
          if (inside) data[y * W + x] = val;
        }
      }
    }
    return data;
  };

  const baseName = map.pgmName.replace(/\.pgm$/i, "");

  const exportAll = async () => {
    const enc = new TextEncoder();
    const entries: ZipEntry[] = [];

    // 1. The map itself — with walls baked in as occupied pixels if any exist.
    const mapPx = new Uint8Array(map.gray);
    if (shapes.some((s) => s.type === "wall")) {
      const wall = rasterize((s) => s.type === "wall", () => 1);
      for (let i = 0; i < mapPx.length; i++) if (wall[i]) mapPx[i] = 0;
    }
    entries.push({ name: map.pgmName, data: encodePgm(map.width, map.height, mapPx) });
    entries.push({
      name: `${baseName}.yaml`,
      data: enc.encode(serializeMapYaml({ ...map.meta, image: map.pgmName })),
    });

    // 2. Keepout filter mask.
    if (shapes.some((s) => s.type === "keepout")) {
      const data = rasterize((s) => s.type === "keepout", () => 100);
      const px = new Uint8Array(map.width * map.height);
      for (let i = 0; i < px.length; i++) px[i] = data[i] >= 50 ? 0 : 254;
      const name = `${baseName}_keepout`;
      entries.push({ name: `${name}.pgm`, data: encodePgm(map.width, map.height, px) });
      entries.push({ name: `${name}.yaml`, data: enc.encode(serializeMapYaml(maskMetaFor("keepout", map.meta, `${name}.pgm`))) });
    }

    // 3. Speed filter mask.
    if (shapes.some((s) => s.type === "speed")) {
      const data = rasterize((s) => s.type === "speed", (s) => clamp(s.speed, 0, 100));
      const px = new Uint8Array(map.width * map.height);
      for (let i = 0; i < px.length; i++) px[i] = Math.round(255 * (1 - data[i] / 100));
      const name = `${baseName}_speed`;
      entries.push({ name: `${name}.pgm`, data: encodePgm(map.width, map.height, px) });
      entries.push({ name: `${name}.yaml`, data: enc.encode(serializeMapYaml(maskMetaFor("speed", map.meta, `${name}.pgm`))) });
    }

    const blob = await createZip(entries);
    downloadBlob(`${baseName}_costmap.zip`, blob);
  };

  const counts = {
    keepout: shapes.filter((s) => s.type === "keepout").length,
    wall: shapes.filter((s) => s.type === "wall").length,
    speed: shapes.filter((s) => s.type === "speed").length,
  };

  /* ---- render -------------------------------------------------------- */
  return (
    <div className="flex h-full w-full bg-ink text-fg">
      {/* Canvas */}
      <main className="relative flex-1 overflow-hidden">
        {/* Floating toolbar */}
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-line bg-panel/95 p-1.5 shadow-lg ring-1 ring-black/5 backdrop-blur">
          <ToolButton active={tool === "select"} onClick={() => setTool("select")} icon={Cursor02Icon} label="Select" shortcut="V" />
          <ToolButton active={tool === "pan"} onClick={() => setTool("pan")} icon={Move02Icon} label="Pan" shortcut="H" />
          <div className="mx-1 h-6 w-px bg-line" />
          <ToolButton onClick={undo} disabled={!canUndo} icon={Undo02Icon} label="Undo" shortcut="⌘Z" />
          <ToolButton onClick={redo} disabled={!canRedo} icon={Redo02Icon} label="Redo" shortcut="⇧⌘Z" />
          <div className="mx-1 h-6 w-px bg-line" />
          <ToolButton active={tool === "rect"} onClick={() => setTool("rect")} icon={RectangularIcon} label="Rectangle" shortcut="R" />
          <ToolButton active={tool === "ellipse"} onClick={() => setTool("ellipse")} icon={CircleIcon} label="Ellipse" shortcut="O" />
          <ToolButton active={tool === "polygon"} onClick={() => setTool("polygon")} icon={HexagonIcon} label="Polygon" shortcut="P" />
          <div className="mx-1 h-6 w-px bg-line" />
          <ToolButton onClick={fit} icon={FitToScreenIcon} label="Fit to screen" />
        </div>

        <div ref={containerRef} className="h-full w-full touch-none" onContextMenu={(e) => e.preventDefault()}>
          <canvas
            ref={canvasRef}
            className={`h-full w-full ${
              tool === "rect" || tool === "ellipse" || tool === "polygon"
                ? "cursor-crosshair"
                : tool === "pan"
                  ? "cursor-grab"
                  : "cursor-default"
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onDoubleClick={() => {
              if (tool === "polygon" && draftPolyRef.current) finishPoly(draftPolyRef.current);
            }}
            onWheel={onWheel}
          />
        </div>

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-line bg-panel/90 px-3 py-1.5 text-[11px] text-fg-muted backdrop-blur">
          <span className="tabular-nums">
            {cursor ? `world  ${cursor.wx.toFixed(2)}, ${cursor.wy.toFixed(2)} m` : "world  —, — m"}
          </span>
          <span className="flex items-center gap-1">
            <button onClick={() => zoomBy(1 / 1.2)} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-elevated hover:text-fg">
              <HugeiconsIcon icon={ZoomOutAreaIcon} size={15} strokeWidth={1.8} />
            </button>
            <span className="w-10 text-center tabular-nums">{Math.round(view.scale * 100)}%</span>
            <button onClick={() => zoomBy(1.2)} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-elevated hover:text-fg">
              <HugeiconsIcon icon={ZoomInAreaIcon} size={15} strokeWidth={1.8} />
            </button>
            <button onClick={fit} className="ml-1 rounded-md px-2 py-0.5 hover:bg-elevated hover:text-fg">Fit</button>
          </span>
        </div>
      </main>

      {/* Right panel */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-chrome">
        {/* header: change map + export */}
        <div className="flex items-center gap-2 border-b border-line p-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-fg-muted transition hover:bg-elevated hover:text-fg"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.8} />
            Change map
          </button>
          <button
            onClick={exportAll}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white shadow-sm shadow-brand/20 transition hover:bg-brand-hi"
          >
            <HugeiconsIcon icon={Download04Icon} size={16} strokeWidth={1.8} />
            Export
          </button>
        </div>

        {/* selected zone */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-faint">Selected zone</p>
          {!selected ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-elevated/60 px-4 py-9 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-fg-faint ring-1 ring-line">
                <HugeiconsIcon icon={Square01Icon} size={22} strokeWidth={1.8} />
              </div>
              <p className="text-sm text-fg-muted">Nothing selected</p>
              <p className="mt-1 text-xs text-fg-faint">
                Pick the Rectangle tool, drag on the map, then Select to edit it.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-fg-muted">Zone type</p>
                <ZoneTypeDropdown value={selected.type} onChange={(t) => commitSelected({ type: t })} />
              </div>

              {selected.type === "speed" && (
                <div className="rounded-xl border border-line bg-panel p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-fg-muted">Speed limit</span>
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700">
                      {selected.speed}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selected.speed}
                    onChange={(e) => patchSelected({ speed: +e.target.value })}
                    onPointerUp={commitLiveEdit}
                    onBlur={commitLiveEdit}
                    style={{ ["--range-accent" as string]: "#f59e0b" }}
                    className="w-full"
                  />
                  <p className="mt-1.5 text-[11px] text-fg-faint">Percentage of the robot&apos;s max speed.</p>
                </div>
              )}

              {selected.kind === "polygon" ? (
                <div className="rounded-xl border border-line bg-panel px-3 py-2.5 text-xs text-fg-muted">
                  Polygon · <span className="font-semibold text-fg">{selected.points.length}</span> points.
                  Drag a vertex to reshape, or drag inside to move.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="X" value={selected.x} onInput={(v) => patchSelected({ x: v })} onCommit={commitLiveEdit} />
                    <NumField label="Y" value={selected.y} onInput={(v) => patchSelected({ y: v })} onCommit={commitLiveEdit} />
                    <NumField label="W" value={selected.w} min={1} onInput={(v) => patchSelected({ w: Math.max(1, v) })} onCommit={commitLiveEdit} />
                    <NumField label="H" value={selected.h} min={1} onInput={(v) => patchSelected({ h: Math.max(1, v) })} onCommit={commitLiveEdit} />
                  </div>

                  <div className="rounded-xl border border-line bg-panel p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-fg-muted">Rotation</span>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-elevated px-2 py-0.5 text-xs font-semibold tabular-nums text-fg">
                          {Math.round((selected.rot * 180) / Math.PI)}°
                        </span>
                        <button
                          onClick={() => commitSelected({ rot: 0 })}
                          className="rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted transition hover:bg-elevated hover:text-fg"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={Math.round((selected.rot * 180) / Math.PI)}
                      onChange={(e) => patchSelected({ rot: (+e.target.value * Math.PI) / 180 })}
                      onPointerUp={commitLiveEdit}
                    onBlur={commitLiveEdit}
                      className="w-full"
                    />
                  </div>
                </>
              )}

              <button
                onClick={deleteSelected}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel py-2.5 text-sm text-fg-muted transition hover:border-keepout/50 hover:bg-red-50 hover:text-red-600"
              >
                <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.8} />
                Delete zone
              </button>
            </div>
          )}

          {/* zones summary */}
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-faint">Zones</p>
            <div className="space-y-1">
              {(["keepout", "wall", "speed"] as ZoneType[]).map((t) => (
                <div key={t} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-fg-muted">
                    <HugeiconsIcon icon={ZONE[t].icon} size={15} strokeWidth={1.8} color={ZONE[t].stroke} />
                    {ZONE[t].label}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-fg">{counts[t]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ===================================================================== */
/* small components & helpers                                             */
/* ===================================================================== */

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: typeof Cursor02Icon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
        active
          ? "bg-brand text-white shadow-sm shadow-brand/30"
          : disabled
            ? "text-fg-faint/40"
            : "text-fg-muted hover:bg-elevated hover:text-fg"
      }`}
    >
      <HugeiconsIcon icon={icon} size={19} strokeWidth={1.8} />
      <span className="pointer-events-none absolute left-1/2 top-11 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-fg shadow-lg group-hover:block">
        {label}
        {shortcut && <span className="ml-1.5 text-fg-faint">{shortcut}</span>}
      </span>
    </button>
  );
}

function ZoneTypeDropdown({ value, onChange }: { value: ZoneType; onChange: (t: ZoneType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cur = ZONE[value];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-panel px-3 py-2.5 text-left transition ${
          open ? "border-brand ring-2 ring-brand/15" : "border-line hover:bg-elevated"
        }`}
      >
        <HugeiconsIcon icon={cur.icon} size={18} strokeWidth={1.8} color={cur.stroke} />
        <span className="flex-1 text-sm text-fg">{cur.label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={16}
          strokeWidth={1.8}
          color="#98a1af"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-xl ring-1 ring-black/5">
          {(["keepout", "wall", "speed"] as ZoneType[]).map((t) => {
            const z = ZONE[t];
            const on = t === value;
            return (
              <button
                key={t}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                  on ? "bg-brand-soft text-fg" : "text-fg-muted hover:bg-elevated hover:text-fg"
                }`}
              >
                <HugeiconsIcon icon={z.icon} size={18} strokeWidth={1.8} color={z.stroke} />
                <span className="flex-1">{z.label}</span>
                {on && <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} color="#4f46e5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  onInput,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onInput: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
      <span className="text-[11px] font-medium text-fg-faint">{label}</span>
      <input
        type="number"
        min={min}
        value={Math.round(value)}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onInput(n);
        }}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full min-w-0 bg-transparent text-xs tabular-nums text-fg focus:outline-none"
      />
    </label>
  );
}

// World position of a resize handle, accounting for rotation about the center.
function handleCenter(s: Shape, h: Handle): { col: number; row: number } {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const lx = h.includes("w") ? -s.w / 2 : h.includes("e") ? s.w / 2 : 0;
  const ly = h.includes("n") ? -s.h / 2 : h.includes("s") ? s.h / 2 : 0;
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  return { col: cx + lx * cos - ly * sin, row: cy + lx * sin + ly * cos };
}

// World position of the rotation knob, a fixed screen distance above the top edge.
function rotateKnobCenter(s: Shape, scale: number): { col: number; row: number } {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const ly = -s.h / 2 - 24 / scale;
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  return { col: cx - ly * sin, row: cy + ly * cos };
}

function oppositeHandle(h: Handle): Handle {
  const m: Record<string, string> = { n: "s", s: "n", e: "w", w: "e" };
  return h
    .split("")
    .map((c) => m[c])
    .join("") as Handle;
}

function pointInShape(s: Shape, col: number, row: number): boolean {
  if (s.kind === "polygon") return pointInPolygon(s.points, col, row);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const dx = col - cx;
  const dy = row - cy;
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  if (s.kind === "ellipse") {
    const rx = s.w / 2 || 1;
    const ry = s.h / 2 || 1;
    return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
  }
  return Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.h / 2;
}

function pointInPolygon(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyBBox(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
