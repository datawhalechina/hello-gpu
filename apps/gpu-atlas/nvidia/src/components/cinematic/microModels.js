import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import officialDieUrl from '../../assets/blackwell-official-die-texture.webp';
import { ARCHITECTURE_FACTS } from '../../data/architectureFacts.js';
import { MICRO_PALETTE, microRegion } from './microPalette.js';

/**
 * Semiconductor visual reconstruction, deliberately kept physically thin.
 * Logical hierarchy / Blackwell SM counts follow NVIDIA's RTX Blackwell GPU
 * Architecture v1.1, figures 3–5. Placement, area, wiring and package contacts
 * are illustrative: NVIDIA does not publish the foundry mask layout.
 */

const DEFAULT = { id: 'blackwell', chip: 'GB202', fullGpc: 12, fullSm: 192, sm: 170, cores: 21760, tensorGeneration: 5, rtGeneration: 4 };
const OFFICIAL_DIE_SOURCE = 'https://www.nvidia.com/content/dam/en-zz/Solutions/geforce/graphic-cards/50-series/rtx-5090/geforce-rtx-50-series-architecture-ari.jpg';

function randomFactory(seed = 2025) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasOf(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d', { alpha: false })];
}

function textureOf(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// Colored functional fields carry subdued circuitry; the label plate is drawn
// last on an opaque backing, so routing never runs through the letterforms.
function circuitry(ctx, x, y, w, h, seed, type = 'compute') {
  const rnd = randomFactory(seed);
  const color = MICRO_PALETTE[type] || MICRO_PALETTE.compute;
  ctx.save();
  const field = ctx.createLinearGradient(x,y,x+w*.5,y+h);
  field.addColorStop(0, new THREE.Color(color.base).lerp(new THREE.Color(color.accent),.36).getStyle());
  field.addColorStop(.36, new THREE.Color(color.base).lerp(new THREE.Color(color.accent),.18).getStyle());
  field.addColorStop(1, color.base);
  ctx.fillStyle = field; ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
  const pitch = type === 'memory' ? 5 : 7;
  ctx.fillStyle = color.accent;
  for (let cy = y + 3; cy < y + h - 2; cy += pitch) {
    for (let cx = x + 3; cx < x + w - 2; cx += pitch) {
      const v = rnd(); ctx.globalAlpha = .08 + v * .17;
      ctx.fillRect(cx, cy, pitch - 2, type === 'memory' ? 1.5 : pitch - 3);
    }
  }
  const tracks = Math.max(3, Math.floor(w / 22));
  ctx.strokeStyle = color.accent; ctx.lineWidth = .85;
  for (let i = 0; i < tracks; i++) {
    const tx = x + 4 + i * (w - 8) / tracks;
    ctx.globalAlpha = i % 4 === 0 ? .30 : .14;
    ctx.beginPath(); ctx.moveTo(tx, y);
    const yy = y + h * (.24 + rnd() * .5);
    ctx.lineTo(tx, yy); ctx.lineTo(tx + 4, yy + 4); ctx.lineTo(tx + 4, y + h); ctx.stroke();
  }
  ctx.globalAlpha = .14;
  for (let line = 0; line < Math.floor(h / 24); line++) ctx.fillRect(x, y + 12 + line * 24, w, .85);
  ctx.restore();
  ctx.strokeStyle = '#0b151b'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = color.accent; ctx.globalAlpha = .62; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  ctx.globalAlpha=.3;ctx.strokeStyle='#d2e8ef';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(x+6,y+h-6);ctx.lineTo(x+6,y+6);ctx.lineTo(x+w-6,y+6);ctx.stroke();
  ctx.globalAlpha=1;
}

function regionTitle(ctx, text, x, y, w, h, type = 'compute', size = 32) {
  const color = MICRO_PALETTE[type] || MICRO_PALETTE.compute;
  ctx.save();
  ctx.fillStyle = '#0b141f'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color.accent; ctx.fillRect(x, y, 5, h);
  let fontSize = Math.min(size, h - 10);
  ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  // Fit with a real font size instead of canvas maxWidth, which squeezes glyphs.
  while (ctx.measureText(text).width > w - 26 && fontSize > 18) {
    fontSize -= 1; ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  }
  ctx.beginPath(); ctx.rect(x + 8, y, w - 12, h); ctx.clip();
  ctx.fillStyle = '#f5f8fc'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 13, y + h / 2 + 1);
  ctx.restore();
}

function drawDie(canvas, generation) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const regions = [];
  const hit = (id, x, y, w, h, extra = {}) => regions.push({ key: `${id}-${regions.length}`, id, rect: [x / S, y / S, w / S, h / S], ...extra });
  const rnd = randomFactory(714 + (generation.year || 2025));
  const spec = profileOf(generation);
  const isCompute = Boolean(spec.hbm);
  ctx.fillStyle = '#2a3237'; ctx.fillRect(0, 0, S, S);
  const gradient = ctx.createLinearGradient(0, 0, S, S);
  gradient.addColorStop(0, '#24313a');
  gradient.addColorStop(.35, '#1d2933');
  gradient.addColorStop(.64, '#17232b');
  gradient.addColorStop(1, '#2a3840');
  ctx.fillStyle = gradient; ctx.fillRect(8, 8, S - 16, S - 16);
  // One box per full-chip memory controller; their placement is schematic.
  const controllerCount = { tesla: 6, fermi: 6, kepler: 4, maxwell: 4, pascal: 12, volta: 8, turing: 12, ampere: 12, hopper: 12, ada: 12, blackwell: 16 }[generation.id] || 16;
  const perEdge = controllerCount / 2;
  for (let k = 0; k < perEdge; k++) {
    const span = (S - 112) / perEdge;
    hit('memoryController', 54 + span * k, 50, span - 4, 65);
    hit('memoryController', 54 + span * k, S - 161, span - 4, 111);
    circuitry(ctx, 54 + span * k, 50, span - 4, 65, 910 + k, 'io');
    circuitry(ctx, 54 + span * k, S - 161, span - 4, 111, 950 + k, 'io');
  }
  hit('memoryController', 45, 185, 110, S - 370);
  hit('memoryController', S - 155, 185, 110, S - 370);
  hit('frontend', 187, 127, S - 374, 49);
  circuitry(ctx, 45, 185, 110, S - 370, 892, 'io');
  circuitry(ctx, S - 155, 185, 110, S - 370, 893, 'io');

  circuitry(ctx, 187, 127, S - 374, 49, 901, 'control');
  regionTitle(ctx, 'HOST INTERFACE / WORK DISTRIBUTOR', 192, 131, S - 384, 40, 'control');
  const facts = ARCHITECTURE_FACTS[generation.id];
  const gpcs = facts?.fullClusters || generation.fullGpc || 12;
  const cols = spec.clusterCols;
  const rows = Math.ceil(gpcs / cols);
  const left = 187, top = 188, usableW = S - 374, usableH = S - 460 - (isCompute ? 106 : 0);
  const gW = usableW / cols, gH = usableH / rows;
  const smPer = facts?.smPerCluster || Math.round((generation.fullSm || 192) / gpcs);
  for (let g = 0; g < gpcs; g++) {
    const gx = left + (g % cols) * gW;
    const row = Math.floor(g / cols);
    const gy = top + row * gH + (isCompute && row >= Math.ceil(rows / 2) ? 106 : 0);
    hit('gpc', gx, gy, gW - 9, gH - 14, { cluster: g + 1 });
    ctx.fillStyle = '#0e2028'; ctx.fillRect(gx, gy, gW - 9, gH - 14);
    ctx.strokeStyle = MICRO_PALETTE.compute.accent; ctx.lineWidth = 2;
    ctx.strokeRect(gx + 3, gy + 3, gW - 15, gH - 20);
    regionTitle(ctx, `${facts?.clusterLabel || 'GPC'} ${g + 1} / ${smPer} ${generation.smLabel || 'SM'}`, gx + 10, gy + 9, gW - 29, 36, 'compute', 28);
    const smCols = smPer < 4 ? smPer : smPer === 14 ? 2 : 4, smRows = Math.ceil(smPer / smCols);
    const sw = (gW - 29) / smCols, sh = (gH - 74) / smRows;
    for (let s = 0; s < smPer; s++) {
      const sx = gx + 10 + (s % smCols) * sw;
      const sy = gy + 47 + Math.floor(s / smCols) * sh;
      hit('sm', sx, sy, sw - 4, sh - 5, { action: 'drill', cluster: g + 1, unit: s + 1, index: g * smPer + s + 1 });
      circuitry(ctx, sx, sy, sw - 4, sh - 5, 420 + s + g * 34);
      // Small SRAM arrays and the four execution lanes of one logical SM.
      circuitry(ctx, sx + 5, sy + 5, sw - 14, Math.max(7, sh * .19), 11 + s, 'memory');
      ctx.fillStyle = 'rgba(20,28,31,.65)';
      for (let lane = 1; lane < spec.partitions; lane++) ctx.fillRect(sx + sw * lane / spec.partitions, sy + sh * .26, 2, sh * .58);
    }
    // A non-rectangular SM count (e.g. GP102's five / GH100's eighteen)
    // leaves room for local control and SRAM, not physically empty black die.
    for (let slot = smPer; slot < smCols * smRows; slot++) {
      const sx = gx + 10 + (slot % smCols) * sw;
      const sy = gy + 47 + Math.floor(slot / smCols) * sh;
      circuitry(ctx, sx, sy, sw - 4, sh - 5, 1810 + slot + g * 23, 'memory');
      ctx.fillStyle = 'rgba(12,25,26,.35)'; ctx.fillRect(sx + 4, sy + 4, sw - 12, sh - 13);
    }
    circuitry(ctx, gx + 10, gy + gH - 28, gW - 29, 8, 871 + g);
  }
  // A distinct continuous shared-cache band and finely layered interconnect.
  const cacheY = isCompute ? top + gH * Math.ceil(rows / 2) : S - 257;
  hit('l2', 190, cacheY, S - 380, 68);
  circuitry(ctx, 190, cacheY, S - 380, 68, 4126, 'memory');
  regionTitle(ctx, generation.id === 'tesla' ? 'TEXTURE CLUSTERS / ROP INTERCONNECT' : 'L2 CACHE / ON-CHIP INTERCONNECT', 194, cacheY + 4, S - 388, 42, 'memory', 30);
  ctx.save();
  ctx.beginPath();
  ctx.rect(24, 24, 145, S - 48); ctx.rect(S - 169, 24, 145, S - 48); ctx.clip();
  ctx.globalAlpha = .13;
  for (let i = 0; i < 180; i++) {
    const x = 30 + rnd() * (S - 60), y = 30 + rnd() * (S - 60);
    ctx.strokeStyle = i % 3 === 0 ? '#a49676' : '#9ba8a7';
    ctx.lineWidth = .65;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + rnd() * 40, y);
    ctx.lineTo(x + 10 + rnd() * 40, y + 12 + rnd() * 65); ctx.stroke();
  }
  ctx.restore();
  // Seal-ring and lithography alignment marks, visible in macro product shots.
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = i % 2 ? '#aaa995' : '#323c41';
    ctx.lineWidth = i % 2 ? 1 : 2;
    ctx.strokeRect(13 + i * 4, 13 + i * 4, S - 26 - i * 8, S - 26 - i * 8);
  }
  for (const [x, y] of [[36, 36], [S - 36, 36], [36, S - 36], [S - 36, S - 36]]) {
    ctx.strokeStyle = '#c1c0ad'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke();
  }
  return regions;
}

function drawPackage(canvas, generation) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const rnd = randomFactory(4182);
  ctx.fillStyle = profileOf(generation).color; ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 16000; k++) {
    ctx.fillStyle = `rgba(${rnd() > .5 ? '114,129,89' : '4,22,13'},${.035 + rnd() * .1})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
  }
  // Substrate routing remains recessed under the solder mask.
  for (let side = 0; side < 4; side++) {
    ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(side * Math.PI / 2); ctx.translate(-S / 2, -S / 2);
    for (let lane = 0; lane < 110; lane++) {
      const x = 75 + lane * (S - 150) / 110;
      const inset = 68 + (lane % 11) * 5;
      ctx.strokeStyle = lane % 4 === 0 ? 'rgba(166,147,88,.20)' : 'rgba(153,170,113,.12)';
      ctx.lineWidth = lane % 4 === 0 ? 1.4 : .65;
      ctx.beginPath(); ctx.moveTo(x, 22); ctx.lineTo(x, inset);
      ctx.lineTo(x + (S / 2 - x) * .2, inset + 58); ctx.lineTo(x + (S / 2 - x) * .2, S * .29); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = '#8c956b'; ctx.lineWidth = 1.5;
  ctx.strokeRect(15, 15, S - 30, S - 30);
  ctx.fillStyle = '#bcc0a9';
  ctx.font = '600 25px monospace'; ctx.fillText('NVIDIA', 63, S - 92);
  ctx.font = '19px monospace'; ctx.fillText(generation.chip || 'GB202', 63, S - 58);
  if (profileOf(generation).hbm) {
    ctx.font = '12px monospace'; ctx.fillText(`${profileOf(generation).hbm} ACTIVE ${generation.memoryType} STACKS`, 420, S - 62);
  }
  ctx.font = '10px monospace'; ctx.fillText('VISUAL RECONSTRUCTION', S - 236, S - 57);
  ctx.beginPath(); ctx.moveTo(30, 30); ctx.lineTo(54, 30); ctx.lineTo(30, 54); ctx.closePath(); ctx.fill();
}

// SM quantities and organization follow the linked NVIDIA architecture papers.
// The execution cells are count-faithful logical groups, not die area estimates.
// Kepler has FOUR warp schedulers feeding a shared 192-core SMX; its six banks
// below are presentation groupings and must not be mistaken for six schedulers.
export const MICRO_PROFILES = {
  tesla: { package: [3.55, 3.42], die: [2.40, 2.12], color: '#38503a', cores: 8, partitions: 1, schedulers: 1, tensor: 0, rt: 0, int32: 0, fp64: 0, shared: '16 KB SHARED MEMORY', registers: '32 KB REGISTER FILE', family: 'legacy', clusterCols: 4 },
  fermi: { package: [3.75, 3.75], die: [2.42, 2.24], color: '#374c3c', cores: 32, partitions: 2, schedulers: 2, tensor: 0, rt: 0, int32: 0, fp64: 0, shared: '64 KB SHARED / L1', registers: '128 KB REGISTER FILE', family: 'dual', clusterCols: 2 },
  kepler: { package: [3.5, 3.56], die: [1.93, 2.02], color: '#274737', cores: 192, partitions: 4, schedulers: 4, tensor: 0, rt: 0, int32: 0, fp64: 0, shared: '64 KB SHARED / L1', registers: '256 KB REGISTER FILE', family: 'smx', clusterCols: 2 },
  maxwell: { package: [3.70, 3.60], die: [2.27, 2.09], color: '#264533', cores: 128, partitions: 4, schedulers: 4, localInstructionKind: 'instructionBuffer', tensor: 0, rt: 0, int32: 0, fp64: 0, shared: '96 KB DEDICATED SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'quadrant', clusterCols: 2 },
  pascal: { package: [3.78, 3.90], die: [2.21, 2.41], color: '#2c4836', cores: 128, partitions: 4, schedulers: 4, localInstructionKind: 'instructionBuffer', tensor: 0, rt: 0, int32: 0, fp64: 0, shared: '96 KB DEDICATED SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'quadrant', clusterCols: 3 },
  volta: { package: [4.34, 3.55], die: [2.13, 2.26], color: '#394a30', cores: 64, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 8, rt: 0, int32: 64, fp64: 32, shared: '128 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'compute', clusterCols: 3, hbm: 4, hbmSites: 4, hbmLayers: 4 },
  turing: { package: [3.93, 4.0], die: [2.39, 2.69], color: '#344637', cores: 64, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 8, rt: 1, int32: 64, fp64: 0, shared: '96 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'rtx', clusterCols: 3 },
  ampere: { package: [4.38, 3.91], die: [2.16, 2.26], color: '#354830', cores: 64, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 4, rt: 0, int32: 64, fp64: 32, shared: '192 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'compute', clusterCols: 4, hbm: 5, hbmSites: 6, hbmLayers: 8 },
  hopper: { package: [4.4, 4.0], die: [2.22, 2.31], color: '#364d34', cores: 128, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 4, rt: 0, int32: 64, fp64: 64, shared: '256 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'compute', clusterCols: 4, hbm: 5, hbmSites: 6, hbmLayers: 8, tma: true },
  ada: { package: [3.96, 3.91], die: [2.35, 2.55], color: '#294331', cores: 128, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 4, rt: 1, int32: 0, fp64: 0, shared: '128 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'rtx', clusterCols: 4 },
  blackwell: { package: [4.0, 4.0], die: [2.49, 2.51], color: '#263c2e', cores: 128, partitions: 4, schedulers: 4, localInstructionKind: 'l0InstructionCache', tensor: 4, rt: 1, int32: 0, fp64: 0, shared: '128 KB L1 / SHARED MEMORY', registers: '256 KB REGISTER FILE', family: 'rtx', clusterCols: 4 },
};

// Supplement main diagrams with units omitted by NVIDIA for clarity (e.g. 2 FP64
// on TU102/AD102/GB202). Shared FP32/INT32 paths are never counted twice.
for (const [id, profile] of Object.entries(MICRO_PROFILES)) {
  const facts = ARCHITECTURE_FACTS[id];
  profile.dispatch = facts.sm.dispatch;
  profile.fp64 = typeof facts.sm.fp64 === 'number' ? facts.sm.fp64 : 0;
  profile.fp64Description = facts.sm.fp64;
  profile.sfu = facts.sm.sfu;
  profile.loadStore = facts.sm.loadStore;
  profile.sharedInt32 = id === 'ada' ? 64 : id === 'blackwell' ? 128 : 0;
}

function profileOf(generation) { return MICRO_PROFILES[generation?.id] || MICRO_PROFILES.blackwell; }

function smRoutingRows(spec) {
  return spec.family === 'legacy' ? [570, 1045] : spec.family === 'dual' ? [532, 1220] : spec.family === 'smx' ? [550, 1155] : [482, 1167];
}

function drawSM(canvas, generation) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const spec = profileOf(generation);
  const anchors = {}, regions = [];
  let activePartition = null;
  const hit = (id, x, y, w, h, metadata) => {
    if (id) regions.push({
      key: `${id}-${regions.length}`, id, rect: [x / W, y / H, w / W, h / H],
      localScope: activePartition ? '当前处理分区' : '当前 SM',
      ...(activePartition ? { partition: activePartition } : {}),
      ...metadata,
    });
  };
  ctx.fillStyle = '#222d31'; ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#24343e');
  grad.addColorStop(.53, '#111f29');
  grad.addColorStop(1, '#26373d');
  ctx.fillStyle = grad; ctx.fillRect(12, 12, W - 24, H - 24);
  // Fine-grained electronic features remain subordinate to the actual units.
  const block = (name, label, x, y, w, h, seed, type = 'compute', metadata = {}) => {
    const region = name ? microRegion(name) : type;
    hit(name, x, y, w, h, { label, localValue: label, ...metadata });
    circuitry(ctx, x, y, w, h, seed, region);
    regionTitle(ctx, label, x + 4, y + 4, w - 8, Math.min(45, h - 8), region);
    if (name && !anchors[name]) anchors[name] = [(x + w / 2) / W, (y + h / 2) / H];
  };
  const array = (name, total, x, y, w, h, seed, columns = 8, type = 'compute') => {
    const region = name ? microRegion(name) : type;
    const resource = name === 'cuda' ? generation.id === 'tesla' ? 'SP' : generation.id === 'blackwell' ? 'FP32 / INT32' : 'FP32' : name === 'integer' ? spec.sharedInt32 ? 'FP32 / INT32' : 'INT32' : 'FP64';
    const label = `${total} ${resource}`;
    hit(name, x, y, w, h, { label, localValue: label });
    const titleH = h >= 150 ? 40 : 0;
    const rows = Math.ceil(total / columns), cw = w / columns, ch = (h - titleH) / rows;
    for (let i = 0; i < total; i++) circuitry(ctx, x + i % columns * cw, y + titleH + Math.floor(i / columns) * ch, cw - 5, ch - 5, seed + i, region);
    if (titleH) {
      regionTitle(ctx, label, x, y, w - 5, titleH - 4, region, 30);
    }
    if (name && !anchors[name]) anchors[name] = [(x + w * .38) / W, (y + titleH + (h - titleH) * .45) / H];
  };
  const margin = 72, usable = W - margin * 2;
  block('instructionCache', 'INSTRUCTION CACHE', margin, 58, usable, 57, 201, 'control', { localValue: '指令缓存' });
  if (spec.family === 'legacy') {
    block('scheduler', 'WARP SCHEDULER / DISPATCH', margin, 137, usable, 120, 711, 'control', { localValue: '1 调度器 · 1 派发单元', localScope: '当前调度单元', unit: 1 });
    block('registers', spec.registers, margin, 285, usable, 265, 712, 'memory', { localValue: '32 KB' });
    // G80: one 8-SP SM, with no Tensor or RT units and no modern 4-way partition.
    array('cuda', 8, margin, 590, usable * .73, 440, 713, 4);
    block('sfu', '2 SPECIAL FUNCTION UNITS', margin + usable * .75, 590, usable * .25, 440, 715, 'io', { localValue: '2 SFU' });
    block('cache', spec.shared, margin, 1060, usable, 285, 716, 'memory', { localValue: '16 KB' });
    block('textureInterface', 'TEXTURE CLUSTER INTERFACE', margin, 1370, usable, 60, 717, 'io', { localValue: '纹理簇接口' });
  } else if (spec.family === 'dual') {
    // GF100: two scheduler/dispatch units, one shared register file and shared
    // LD/ST/SFU resources. Do not invent Maxwell-like independent partitions.
    for (let i = 0; i < 2; i++) block('scheduler', `SCHEDULER ${i + 1} / 1 DISPATCH`, margin + i * usable / 2, 137, usable / 2 - 12, 120, 718 + i, 'control', { localValue: '1 调度器 · 1 派发单元', localScope: '当前调度单元', unit: i + 1 });
    block('registers', spec.registers, margin, 285, usable, 230, 720, 'memory', { localValue: '128 KB' });
    array('cuda', 32, margin, 550, usable, 400, 721, 16);
    block('integer', 'CUDA CORE: FP UNIT + INT UNIT / SHARED EXECUTION', margin, 970, usable, 65, 723, 'compute', { localValue: '32 CUDA Core 内部的整数执行资源' });
    block('fp64', 'FP64 SUPPORTED BY CUDA EXECUTION RESOURCES', margin, 1055, usable, 65, 724, 'compute', { localValue: 'CUDA 执行资源支持 FP64' });
    block('sfu', '16 LD / ST + 4 SFU', margin, 1140, usable, 70, 725, 'io', { localValue: '16 LD/ST · 4 SFU' });
    block('cache', spec.shared, margin, 1230, usable, 170, 726, 'memory', { localValue: '64 KB' });
    block('textureCache', 'TEXTURE / UNIFORM CACHE', margin, 1420, usable, 45, 727, 'memory', { localValue: '纹理 / Uniform 缓存' });
  } else if (spec.family === 'smx') {
    // The scheduler and register file are shared across the wide SMX. Keep the
    // 192-core array visually continuous, unlike Maxwell's isolated quadrants.
    const sw = usable / 4;
    for (let i = 0; i < 4; i++) block('scheduler', `SCHEDULER ${i + 1} / 2 DISPATCH`, margin + i * sw, 137, sw - 12, 128, 721 + i, 'control', { localValue: '1 调度器 · 2 派发单元', localScope: '当前调度单元', unit: i + 1 });
    block('registers', spec.registers, margin, 294, usable, 236, 725, 'memory', { localValue: '256 KB' });
    array('cuda', 192, margin, 570, usable, 465, 726, 32);
    block('sfu', '32 LD / ST + 32 SPECIAL FUNCTION UNITS', margin, 1060, usable, 80, 727, 'io', { localValue: '32 LD/ST · 32 SFU' });
    block('cache', spec.shared, margin, 1170, usable, 175, 728, 'memory', { localValue: '64 KB' });
    block('textureUnits', '16 TEXTURE UNITS / TEXTURE CACHE', margin, 1370, usable, 62, 729, 'io', { localValue: '16 纹理单元及纹理缓存' });
    block('fp64', 'LOW-THROUGHPUT FP64 SUPPORT (NOT GK110)', margin, 1450, usable, 35, 730, 'compute', { localValue: '低吞吐 FP64 支持' });
  } else {
    const count = spec.partitions;
    const cw = usable / count;
    const partitionFp64 = spec.fp64 >= count ? spec.fp64 / count : 0;
    const hasAux = spec.int32 > 0 || partitionFp64 > 0;
    for (let partition = 0; partition < count; partition++) {
      activePartition = partition + 1;
      const x = margin + partition * cw, ww = cw - 16;
      // Explicit isolation makes SMM / Pascal quadrants visibly different from
      // Kepler. FP32 + INT32 are separate, count-accurate Volta/Turing/A100 paths.
      ctx.fillStyle = 'rgba(12,25,28,.45)'; ctx.fillRect(x - 6, 129, ww + 12, 995);
      block('scheduler', `SCHEDULER ${partition + 1} / ${spec.dispatch / count} DISPATCH`, x, 137, ww, 95, 731 + partition, 'control', { localValue: `1 调度器 · ${spec.dispatch / count} 派发单元` });
      block(spec.localInstructionKind, spec.localInstructionKind === 'l0InstructionCache' ? 'L0 INSTRUCTION CACHE' : 'INSTRUCTION BUFFER', x, 246, ww, 45, 736 + partition, 'control', { localValue: spec.localInstructionKind === 'l0InstructionCache' ? 'L0 指令缓存' : '指令缓冲区' });
      block('registers', `${spec.registers.split(' ')[0] / count} KB REGISTERS`, x, 306, ww, 157, 741 + partition, 'memory', { localValue: `${spec.registers.split(' ')[0] / count} KB` });
      const fpHeight = hasAux ? 240 : generation.id === 'blackwell' ? 320 : 400;
      if (generation.id === 'ada') {
        array('cuda', 16, x, 500, ww, 190, 800 + partition * 173, 4);
        array('integer', 16, x, 735, ww, 170, 860 + partition * 173, 4, 'tensor');
      } else {
        array('cuda', spec.cores / count, x, 500, ww, fpHeight, 800 + partition * 173, 4);
        if (spec.sharedInt32) {
          block('cuda', '32 FP32 / INT32 UNIFIED', x, generation.id === 'blackwell' ? 830 : 915, ww, 40, 860 + partition, 'compute', { localValue: '32 FP32 / INT32 共用通路' });
        }
      }
      if (spec.int32) array('integer', spec.int32 / count, x, 760, ww, partitionFp64 ? 88 : 175, 900 + partition * 173, 8);
      if (partitionFp64) array('fp64', partitionFp64, x, 870, ww, 80, 1050 + partition * 173, Math.min(8, partitionFp64));
      if (spec.tensor) {
        const n = spec.tensor / count, gap = 9;
        for (let t = 0; t < n; t++) block('tensor', `TENSOR ${partition * n + t}`, x + t * ww / n, generation.id === 'blackwell' ? 890 : 980, ww / n - (n > 1 ? gap : 0), generation.id === 'blackwell' ? 175 : 85, 1200 + partition * 20 + t, 'tensor', { localValue: '1 Tensor Core', localScope: '当前单元', unit: partition * n + t + 1 });
      }
      const ls = typeof spec.loadStore === 'number' ? spec.loadStore / count : '';
      const sf = typeof spec.sfu === 'number' ? spec.sfu / count : 1;
      block('sfu', `${ls} LD / ST + ${sf} SFU`, x, 1090, ww, 65, 1300 + partition, 'io', { localValue: `${ls} LD/ST · ${sf} SFU` });
    }
    activePartition = null;
    const cacheW = spec.rt ? usable * .73 : spec.tma ? usable * .77 : usable;
    block('cache', spec.shared, margin, 1180, cacheW - (spec.rt || spec.tma ? 16 : 0), 228, 1401, 'memory', { localValue: `${spec.shared.split(' ')[0]} KB` });
    if (spec.rt) block('rt', `GEN ${generation.rtGeneration} RT CORE`, margin + usable * .73, 1180, usable * .27, 228, 1410, 'ray', { localValue: `1 个第 ${generation.rtGeneration} 代 RT Core`, localScope: '当前单元' });
    if (spec.tma) block('tma', 'TENSOR MEMORY ACCELERATOR', margin + usable * .77, 1180, usable * .23, 228, 1411, 'io', { localValue: 'TMA 数据搬运引擎' });
    if (spec.fp64 > 0 && spec.fp64 < count) {
      block('fp64', `${spec.fp64} FP64 CORES / LOW-THROUGHPUT SUPPORT`, margin, 1430, usable * .59, 50, 1418, 'compute', { localValue: `${spec.fp64} FP64` });
      block('textureUnits', '4 TEXTURE UNITS', margin + usable * .61, 1430, usable * .39, 50, 1419, 'io', { localValue: '4 纹理单元' });
    } else if (spec.tensor) {
      block('textureUnits', '4 TEXTURE UNITS', margin, 1430, usable, 50, 1419, 'io', { localValue: '4 纹理单元' });
    }
    if (spec.family === 'quadrant') {
      // Shared memory is separate from the paired texture / L1 caches on these
      // consumer chips. It is not the combined unified cache of later SMs.
      for (let i = 0; i < 2; i++) block('textureL1', '24 KB TEXTURE / L1', margin + i * usable / 2, 1430, usable / 2 - 12, 44, 1420 + i, 'memory', { localValue: '24 KB', localScope: '当前缓存单元（供两个处理分区使用）', unit: i + 1 });
    }
  }
  // Layered trunks and seal ring add physical depth without box-like blocks.
  for (const trunkY of smRoutingRows(spec)) for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = i % 4 ? 'rgba(127,158,172,.20)' : 'rgba(17,31,38,.65)';
    ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(42, trunkY + (i - 6.5) * .6); ctx.lineTo(W - 42, trunkY + (i - 6.5) * .6); ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = i % 2 ? '#aeb59f' : '#263238'; ctx.lineWidth = 1;
    ctx.strokeRect(16 + i * 5, 16 + i * 5, W - 32 - i * 10, H - 32 - i * 10);
  }
  ctx.font = '600 18px monospace'; ctx.fillStyle = '#cbd8df';
  ctx.fillText(`${generation.chip} / ${generation.smLabel || 'SM'} / ${spec.cores} ${generation.id === 'tesla' ? 'SP' : 'FP32'} / LOGICAL RECONSTRUCTION`, 72, H - 25);
  return { anchors, regions };
}

function surfacePlane(width, depth, material, height = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = height;
  return mesh;
}

function roundedSolid(w, h, d, material, radius = .012) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, h * .4)), material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function instances(parent, dimensions, material, positions) {
  const geometry = new THREE.BoxGeometry(...dimensions);
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const o = new THREE.Object3D();
  positions.forEach((p, i) => {
    o.position.set(p[0], p[1], p[2]); o.rotation.set(0, p[3] || 0, 0);
    o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildMicroModels(initialGeneration = DEFAULT) {
  // Older integrations passed the THREE namespace. Treat it as the default;
  // the current renderer passes a generation and rebuilds on generation.id.
  const generation = initialGeneration?.id ? initialGeneration : DEFAULT;
  const spec = profileOf(generation);
  const [packageW, packageD] = spec.package;
  const [dieW, dieD] = spec.die;
  const chip = new THREE.Group(); chip.name = 'GPU semiconductor package';
  const sm = new THREE.Group(); sm.name = 'Streaming multiprocessor logical reconstruction';
  chip.userData = { generation: generation.id, visualReconstruction: true, hbmStacks: spec.hbm || 0 };
  sm.userData = { generation: generation.id, logicalCounts: { fp32: spec.cores, tensor: spec.tensor, rt: spec.rt, warpSchedulers: spec.schedulers, dispatch: spec.dispatch, fp64: spec.fp64Description, independentInt32: spec.int32, sharedFp32Int32: spec.sharedInt32 }, physicalFloorplan: false };
  const textures = [];
  const [dieCanvas] = canvasOf(2048);
  const [packageCanvas] = canvasOf(1024);
  const [smCanvas] = canvasOf(2048, 1536);
  let chipRegions = drawDie(dieCanvas, generation); drawPackage(packageCanvas, generation);
  let smLayout = drawSM(smCanvas, generation);
  const dieTexture = textureOf(dieCanvas), packageTexture = textureOf(packageCanvas), smTexture = textureOf(smCanvas);
  textures.push(dieTexture, packageTexture, smTexture);
  let disposed = false;
  let officialReady = false;
  let currentProgress = 0;
  let currentId = generation.id;
  // Cropped / rectified from NVIDIA's public marketing illustration. It is
  // credited source imagery, not an electron micrograph or measured floorplan.
  // A GPU shader mixes textures, so scrubbing never redraws the 2048² canvas.
  const officialUniforms = {
    uOfficialDieMap: { value: null },
    uOfficialDieWeight: { value: 0 },
  };
  const officialWeight = () => currentId === 'blackwell' && officialReady
    ? 1 - THREE.MathUtils.smoothstep(currentProgress, .605, .715)
    : 0;
  const officialTexture = new THREE.TextureLoader().load(officialDieUrl, texture => {
    if (disposed) { texture.dispose(); return; }
    officialReady = true;
    officialUniforms.uOfficialDieWeight.value = officialWeight();
  }, undefined, () => {
    // The detailed procedural reconstruction remains available if an asset
    // cannot load; no missing-image plane interrupts the scroll sequence.
    officialReady = false;
    officialUniforms.uOfficialDieWeight.value = 0;
  });
  officialTexture.colorSpace = THREE.SRGBColorSpace;
  officialTexture.anisotropy = 8;
  officialTexture.userData = {
    creator: 'NVIDIA Corporation',
    source: OFFICIAL_DIE_SOURCE,
    description: 'Official RTX Blackwell marketing illustration, cropped and rectified; not a measured silicon floorplan.',
  };
  officialUniforms.uOfficialDieMap.value = officialTexture;
  textures.push(officialTexture);
  const substrateMaterial = new THREE.MeshStandardMaterial({ color: spec.color, metalness: .18, roughness: .58 });
  const laminateMaterial = new THREE.MeshStandardMaterial({ color: 0x62553b, metalness: .35, roughness: .48 });
  const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x171b1c, metalness: .15, roughness: .52 });
  const nickelMaterial = new THREE.MeshStandardMaterial({ color: 0xa4a7a1, metalness: .92, roughness: .28 });
  const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xa89962, metalness: .94, roughness: .26 });
  const siliconEdge = new THREE.MeshPhysicalMaterial({ color: 0x384348, metalness: .8, roughness: .2, clearcoat: .45, clearcoatRoughness: .18 });
  const dieMaterial = new THREE.MeshPhysicalMaterial({ map: dieTexture, metalness: .10, roughness: .78, clearcoat: .05, clearcoatRoughness: .65, iridescence: 0, iridescenceIOR: 1.35, iridescenceThicknessRange: [130, 230] });
  dieMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, officialUniforms);
    shader.fragmentShader = `uniform sampler2D uOfficialDieMap;\nuniform float uOfficialDieWeight;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        vec3 officialDieColor = texture2D(uOfficialDieMap, vMapUv).rgb * diffuse;
        diffuseColor.rgb = mix(diffuseColor.rgb, officialDieColor, uOfficialDieWeight);
      #endif
    `);
  };
  dieMaterial.customProgramCacheKey = () => 'atlas-official-blackwell-die-blend-v1';
  dieMaterial.userData.source = officialTexture.userData;
  const smMaterial = new THREE.MeshPhysicalMaterial({ map: smTexture, metalness: .08, roughness: .82, clearcoat: .03, clearcoatRoughness: .70, iridescence: 0, iridescenceThicknessRange: [120, 200] });
  const packageMaterial = new THREE.MeshStandardMaterial({ map: packageTexture, metalness: .22, roughness: .52 });

  // Shapes are normalized to a common camera scale. These are visual package
  // proportions, not metrology dimensions or a claim to proprietary CAD data.
  const base = roundedSolid(packageW, .082, packageD, substrateMaterial); base.position.y = -.064; chip.add(base);
  const laminate = roundedSolid(packageW - .01, .016, packageD - .01, laminateMaterial, .004); laminate.position.y = -.042; chip.add(laminate);
  const top = roundedSolid(packageW, .035, packageD, substrateMaterial); top.position.y = -.016; chip.add(top);
  chip.add(surfacePlane(packageW - .015, packageD - .015, packageMaterial, .003));

  if (spec.hbm) {
    // CoWoS-style interposer: the large GPU die and HBM are on one package.
    // V100: 4 stacks. A100 / H100: 5 active stacks, 6 interfaces in the full GPU.
    // The dim sixth position is an illustrative inactive site, not the measured
    // location of a disabled stack. See NVIDIA Ampere / Hopper in-depth articles:
    // https://developer.nvidia.com/blog/nvidia-ampere-architecture-in-depth/
    // https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/
    // https://images.nvidia.com/content/volta-architecture/pdf/volta-architecture-whitepaper.pdf
    const interposer = roundedSolid(packageW - .52, .026, packageD - .49, siliconEdge, .006);
    interposer.position.y = .021; chip.add(interposer);
    const routing = [];
    for (const side of [-1, 1]) for (let i = 0; i < 105; i++) {
      routing.push([side * (dieW * .5 + .10), .037, -dieD * .43 + i * dieD * .86 / 104]);
    }
    instances(chip, [.25, .0018, .0021], goldMaterial, routing);
  }
  const dieRaise = spec.hbm ? .04 : 0;
  const adhesive = roundedSolid(dieW + .06, .025, dieD + .06, blackMaterial, .006); adhesive.position.y = .025 + dieRaise; chip.add(adhesive);
  const silicon = roundedSolid(dieW, .097, dieD, siliconEdge, .007); silicon.position.y = .085 + dieRaise; chip.add(silicon);
  const dieTop = surfacePlane(dieW - .024, dieD - .024, dieMaterial, .135 + dieRaise); chip.add(dieTop);

  const hbmPositions = [];
  if (spec.hbm) {
    const perSide = spec.hbmSites / 2;
    for (let side = 0; side < 2; side++) for (let row = 0; row < perSide; row++) {
      const slot = side * perSide + row;
      const x = (side ? 1 : -1) * (packageW * .5 - .58);
      const z = perSide === 2 ? -.63 + row * 1.26 : -.98 + row * .98;
      const active = slot < spec.hbm;
      const memory = new THREE.Group(); memory.position.set(x, .038, z);
      memory.name = active ? `${generation.memoryType} active stack ${slot + 1}` : 'Inactive HBM interface site (illustrative position)';
      memory.userData = { kind: active ? 'hbm-stack' : 'inactive-hbm-site', active, logicalSite: slot + 1 };
      const [hbmCanvas, hc] = canvasOf(256, 320);
      hc.fillStyle = active ? '#505958' : '#272e2d'; hc.fillRect(0, 0, 256, 320);
      for (let i = 0; i < 2200; i++) {
        const x1 = (i * 37) % 248 + 4, y1 = (i * 53) % 310 + 5;
        hc.fillStyle = i % 3 ? 'rgba(139,153,141,.15)' : 'rgba(17,28,27,.16)'; hc.fillRect(x1, y1, 1, 7);
      }
      hc.strokeStyle = active ? '#acb5a9' : '#626d63'; hc.lineWidth = 2; hc.strokeRect(8, 8, 240, 304);
      hc.fillStyle = active ? '#c4cabd' : '#68766c'; hc.font = '500 22px monospace';
      hc.fillText(active ? generation.memoryType : 'HBM SITE', 25, 139, 211);
      hc.font = '15px monospace'; hc.fillText(active ? `STACK ${slot + 1}` : 'INACTIVE', 25, 172);
      hc.fillText(active ? `${spec.hbmLayers}-HI DRAM` : 'LOGICAL', 25, 201);
      const hbmTexture = textureOf(hbmCanvas); textures.push(hbmTexture);
      const hbmTopMaterial = new THREE.MeshPhysicalMaterial({ map: hbmTexture, metalness: .50, roughness: .40, clearcoat: .22 });
      if (active) {
        // Thin alternating die edges reveal the vertical DRAM stack in profile.
        const underfill = roundedSolid(.62, .018, .80, blackMaterial, .003); memory.add(underfill);
        for (let layer = 0; layer < spec.hbmLayers; layer++) {
          const slab = roundedSolid(.60 - layer * .001, .008, .78 - layer * .001, layer % 2 ? siliconEdge : nickelMaterial, .002);
          slab.position.y = .018 + layer * .011; memory.add(slab);
        }
        const lidY = .025 + spec.hbmLayers * .011;
        memory.add(surfacePlane(.598, .778, hbmTopMaterial, lidY));
        hbmPositions.push(new THREE.Vector3(x, .038 + lidY, z));
      } else {
        // A footprint avoids presenting a sixth active 16 GB stack on an 80 GB
        // product. The site's placement itself is explicitly illustrative.
        memory.add(surfacePlane(.60, .78, hbmTopMaterial, .003));
      }
      chip.add(memory);
    }
  }

  // Ceramic capacitors follow the actual free margin around each package type.
  // On HBM packages the side margins are occupied by DRAM, so decoupling moves
  // into the top/bottom edge lanes instead of being drawn through the stacks.
  const capacitors = [], terminations = [], pads = [];
  for (let side = 0; side < 4; side++) {
    const horizontal = side % 2 === 0;
    const span = horizontal ? packageW : packageD;
    const cross = horizontal ? packageD : packageW;
    const a = side * Math.PI / 2;
    const rotate = (x, z) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
    const rows = spec.hbm ? (horizontal ? 1 : 0) : 3;
    const n = Math.floor((span - .65) / .148);
    for (let row = 0; row < rows; row++) for (let i = 0; i < n; i++) {
      if (side === 2 && row > 0 && i < 6) continue;
      const x = -(n - 1) * .148 / 2, z = -cross * .5 + .19 + row * .15;
      const [xx, zz] = rotate(x + i * .148, z);
      // Keep package top details out of the active die footprint.
      if (Math.abs(xx) < dieW * .5 + .06 && Math.abs(zz) < dieD * .5 + .06) continue;
      capacitors.push([xx, .029, zz, a]);
      for (const end of [-1, 1]) {
        const [ex, ez] = rotate(x + i * .148 + end * .039, z);
        terminations.push([ex, .032, ez, a]);
      }
    }
    const contactCount = Math.floor((span - .40) / .114);
    for (let i = 0; i < contactCount; i++) {
      const [x, z] = rotate(-(contactCount - 1) * .114 / 2 + i * .114, -cross * .5 + .065);
      pads.push([x, .005, z, a]);
    }
  }
  instances(chip, [.092, .044, .054], blackMaterial, capacitors);
  instances(chip, [.022, .0445, .057], nickelMaterial, terminations);
  instances(chip, [.052, .004, .025], goldMaterial, pads);
  // Underside BGA grid scales with the normalized package; this is visual
  // contact density, not an asserted manufacturer ball map / pin count.
  const solder = new THREE.InstancedMesh(new THREE.SphereGeometry(.027, 8, 6), nickelMaterial, 28 * 28);
  const matrix = new THREE.Matrix4();
  for (let r = 0; r < 28; r++) for (let c = 0; c < 28; c++) {
    matrix.makeTranslation(-packageW * .45 + c * packageW * .9 / 27, -.122, -packageD * .45 + r * packageD * .9 / 27);
    solder.setMatrixAt(r * 28 + c, matrix);
  }
  solder.instanceMatrix.needsUpdate = true; chip.add(solder);

  const packaging = new THREE.Group(); packaging.name = 'Package substrate and interconnect';
  for (const child of [...chip.children]) {
    if (child !== silicon && child !== dieTop) packaging.add(child);
  }
  // The package fades away before the bare die. Do not share the die-edge
  // material with the interposer / HBM edges or those fades erase the die too.
  const packagingSilicon = siliconEdge.clone();
  packaging.traverse(object => {
    if (object.material === siliconEdge) object.material = packagingSilicon;
  });
  chip.add(packaging);

  // SM is a close-up of flat patterned silicon. Three thin material layers
  // communicate a semiconductor cross-section at oblique viewing angles.
  const smBase = roundedSolid(4.02, .10, 3.015, siliconEdge, .012); smBase.position.y = -.022; sm.add(smBase);
  const oxide = roundedSolid(4.004, .012, 2.999, blackMaterial, .003); oxide.position.y = .035; sm.add(oxide);
  const smTop = surfacePlane(3.99, 2.99, smMaterial, .043); sm.add(smTop);

  // Fine top-metal buses catch real environment reflections. Their height is
  // 0.002 units: circuitry stays on the die instead of becoming raised blocks.
  const tracePositions = [];
  // Reflective trunks stay in the gaps, clear of every region's title plate.
  for (const row of smRoutingRows(spec)) for (let lane = 0; lane < 24; lane++) {
    tracePositions.push([0, .045, (row / 1536 - .5) * 2.99 + (lane - 11.5) * .00045]);
  }
  const traceMaterial = new THREE.MeshStandardMaterial({ color: 0x637c86, metalness: .40, roughness: .65 });
  instances(sm, [3.68, .0016, .0011], traceMaterial, tracePositions);
  const vias = [];
  for (let p = 0; p < 4; p++) for (let i = 0; i < 30; i++) {
    vias.push([-1.59 + p * .914 + (i % 10) * .07, .045, -.705 + Math.floor(i / 10) * .02]);
  }
  instances(sm, [.008, .002, .008], goldMaterial, vias);

  const chipAnchors = {
    die: new THREE.Vector3(0, .15 + dieRaise, -dieD * .05),
    substrate: new THREE.Vector3(-packageW * .41, .04, packageD * .38),
    memory: hbmPositions[0]?.clone() || new THREE.Vector3(dieW * .42, .15, .1),
    gpc: new THREE.Vector3(-dieW * .27, .15 + dieRaise, -dieD * .26),
    l2: new THREE.Vector3(0, .15 + dieRaise, generation.category === '数据中心' ? 0 : dieD * .34),
  };
  const smAnchors = {};
  const updateSMAnchors = layout => {
    for (const key of Object.keys(smAnchors)) if (!(key in layout)) delete smAnchors[key];
    // Texture top-left maps to local (-X, -Z) on the horizontal die surface.
    for (const [key, uv] of Object.entries(layout)) {
      const anchor = smAnchors[key] || new THREE.Vector3();
      anchor.set((uv[0] - .5) * 3.99, .06, (uv[1] - .5) * 2.99);
      smAnchors[key] = anchor;
    }
    // Missing hardware never gets a visible label. A harmless in-bounds vector
    // keeps older consumers that read optional coordinates unconditionally safe.
    for (const key of ['cuda', 'tensor', 'rt', 'registers', 'scheduler', 'cache', 'tma']) {
      if (!smAnchors[key]) smAnchors[key] = new THREE.Vector3(0, .06, 0);
    }
  };
  updateSMAnchors(smLayout.anchors);
  const update = (generation = DEFAULT, progress = currentProgress) => {
    if (disposed) return;
    if (Number.isFinite(progress)) currentProgress = THREE.MathUtils.clamp(progress, 0, 1);
    if (generation && typeof generation === 'object' && (generation.id || 'blackwell') !== currentId) {
      currentId = generation.id || 'blackwell';
      chipRegions = drawDie(dieCanvas, generation); drawPackage(packageCanvas, generation); smLayout = drawSM(smCanvas, generation);
      updateSMAnchors(smLayout.anchors);
      dieTexture.needsUpdate = true; packageTexture.needsUpdate = true; smTexture.needsUpdate = true;
    }
    const weight = officialWeight();
    officialUniforms.uOfficialDieWeight.value = weight;
    // The source illustration contains a broad baked reflection. A restrained
    // live specular layer keeps it material without washing out source detail.
    dieMaterial.metalness = THREE.MathUtils.lerp(.10, .36, weight);
    dieMaterial.roughness = THREE.MathUtils.lerp(.78, .39, weight);
    dieMaterial.iridescence = THREE.MathUtils.lerp(0, .045, weight);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set(), materials = new Set();
    for (const group of [chip, sm]) group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  };
  return {
    chip, sm, packaging, anchors: { chip: chipAnchors, sm: smAnchors }, chipAnchors, smAnchors,
    profile: spec, bounds: { width: packageW, depth: packageD, dieWidth: dieW, dieDepth: dieD },
    hitSurfaces: { chip: dieTop, sm: smTop },
    get hitRegions() { return { chip: chipRegions, sm: smLayout.regions }; },
    hbmPositions, update, dispose,
  };
}

// Both names are exported to keep the renderer's existing integration stable.
export function createMicroModels(generation) { return buildMicroModels(generation); }
