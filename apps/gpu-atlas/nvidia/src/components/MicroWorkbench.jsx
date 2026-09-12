import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsIn, ArrowLeft, Eye, EyeSlash, Minus, Plus, X, Cpu, Cube, Stack } from '@phosphor-icons/react';
import * as THREE from 'three';
import { createMicroModels, MICRO_PROFILES } from './cinematic/microModels.js';
import { MICRO_PALETTE as MICRO_REGION_COLORS, microRegion as regionForLabel } from './cinematic/microPalette.js';
import { pickMicroRegion, regionCorners } from './cinematic/microPicking.js';
import { ARCHITECTURE_FACTS } from '../data/architectureFacts.js';
import MicroInspector from './MicroInspector.jsx';
import './MicroWorkbench.css';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const fmt = n => new Intl.NumberFormat('en-US').format(n);
const regionStyle = (id, view) => ({ '--region-accent': MICRO_REGION_COLORS[regionForLabel(id, view)].accent });

function detailsFor(g, view) {
  const p = MICRO_PROFILES[g.id], facts = ARCHITECTURE_FACTS[g.id], cluster = facts.clusterLabel;
  if (view === 'chip') return [
    { id: 'gpc', name: `${cluster} 计算簇`, value: `${facts.fullClusters} × ${facts.smPerCluster} ${g.smLabel}`, text: `完整 ${g.chip} 共 ${facts.fullClusters} 个 ${cluster}、${g.fullSm} 个 ${g.smLabel}。${g.card} 实际启用 ${g.sm} 个 ${g.smLabel}；不以涂黑特定位置来猜测屏蔽单元的物理位置。` },
    { id: 'l2', name: g.id === 'tesla' ? '纹理缓存与互连' : '共享 L2 与互连', value: facts.fullL2 === facts.l2 ? facts.l2 : `${facts.fullL2} 完整 / ${facts.l2} 本卡`, text: g.id === 'tesla' ? 'G80 的纹理缓存路径不等同于 Fermi 之后的统一 L2。图中纹理区域按逻辑关系整理。' : '缓存连接计算单元和显存子系统，用于片上复用数据。带状排布表达逻辑关系，不能用它推断实际缓存形状或导线位置。' },
    { id: 'memoryController', name: '显存接口', value: facts.memoryInterface, text: `${g.card} 配置 ${g.memory} ${g.memoryType}。周边控制器分组按完整芯片的接口组织绘制；这里的位宽对应本卡。控制器位置、面积与细密走线仍是逻辑示意。` },
    { id: 'frontend', name: '主机与任务分发', value: 'PCIe → 计算簇', text: g.category === '数据中心' ? '主机提交计算工作，经芯片内工作分发逻辑送往计算簇。数据中心 GA100／GH100 不套用消费图形流水线。' : '前端接收主机工作并组织任务分发；图形和计算任务在对应架构的执行资源上运行。' },
  ];
  const partitioned = ['maxwell', 'pascal', 'volta', 'turing', 'ampere', 'hopper', 'ada', 'blackwell'].includes(g.id);
  const separateShared = ['tesla', 'maxwell', 'pascal'].includes(g.id);
  const result = [
    { id: 'scheduler', name: 'Warp 调度与派发', value: `${facts.sm.schedulers} 调度器 · ${facts.sm.dispatch} 派发单元`, text: g.id === 'kepler' ? '四个 Warp 调度器向共享的 192 核心 SMX 派发指令；不是六个独立调度分区。每个调度器有两条指令派发路径。' : `一个 warp 包含 32 个线程。调度器选择就绪 warp 并向执行通路派发指令。${p.schedulers} 是每个 ${g.smLabel} 的调度器数，不是每周期发射指令数。` },
    { id: 'registers', name: '寄存器文件', value: facts.sm.registers, text: '寄存器保存线程正在使用的局部状态。上方标明当前选区的容量，下方另列整个 SM 的总量。多个线程共同使用这些寄存器，单个线程不能独占整个寄存器文件。' },
    { id: 'cuda', name: g.id === 'tesla' ? '标量流处理器' : g.id === 'blackwell' ? 'FP32／INT32 统一通路' : 'FP32 执行通路', value: `${p.cores} ${g.id === 'tesla' ? 'SP' : 'FP32'} / ${g.smLabel}`, text: g.id === 'blackwell' ? 'GB20x 将 FP32 与 INT32 执行能力统一到同一组核心。一个核心在同一时钟周期执行其中一种类型，不能把两种能力相加成 256 个独立核心。' : g.id === 'ada' ? 'Ada 的 128 个 FP32 执行能力由 64 条专用 FP32 通路与 64 条可执行 FP32 或 INT32 的通路组成。混合通路共享执行资源。' : `${g.card} 的 ${fmt(g.cores)} 个已启用流处理器分布在 ${g.sm} 个 ${g.smLabel} 中。各代核心的执行组织和吞吐不同，不能仅按数量判断性能。` },
  ];
  result.splice(1, 0, { id: 'instructionCache', name: '指令缓存', value: 'SM 级指令供给', text: '缓存待执行的程序指令，减少重复获取指令的开销。它保存的是指令；Warp 调度器负责选择就绪的 warp 并派发，两者是不同的功能模块。' });
  if (partitioned) result.splice(2, 0, ['maxwell', 'pascal'].includes(g.id)
    ? { id: 'instructionBuffer', name: '指令缓冲区', value: `${p.partitions} 组指令缓冲区`, text: '暂存处理分区待执行的指令，供调度与派发使用。这里按该代架构的指令缓冲区标示，与 Volta 起引入的分区 L0 指令缓存分别呈现。' }
    : { id: 'l0InstructionCache', name: 'L0 指令缓存', value: `${p.partitions} 组 L0 指令缓存`, text: '靠近执行通路的指令缓存，为本处理分区提供指令。它与同一分区内的 Warp 调度器、派发单元及寄存器文件分别承担指令供给、调度和线程状态保存。' });
  if (g.id === 'fermi') result.push({ id: 'integer', name: 'CUDA Core 内整数执行资源', value: '32 个 CUDA Core 内含整数 ALU', text: 'Fermi 的每个 CUDA Core 包含浮点与整数执行资源，并共用调度资源。选中的说明条表示核心内部的整数能力，不能将它计为额外的独立 INT32 核心阵列。' });
  if (p.int32 || (p.sharedInt32 && g.id !== 'blackwell')) result.push({ id: 'integer', name: p.sharedInt32 ? '整数与浮点共用资源' : 'INT32 整数通路', value: `${p.int32 || p.sharedInt32} ${p.sharedInt32?'条共用通路':'INT32'} / ${g.smLabel}`, text: facts.sm.int32 });
  if (facts.sm.fp64) result.push({ id: 'fp64', name: 'FP64 双精度通路', value: typeof facts.sm.fp64==='number'?`${facts.sm.fp64} FP64 / ${g.smLabel}`:'支持双精度 · 复用执行资源', text: `${typeof facts.sm.fp64==='string'?facts.sm.fp64+'。':''}用于双精度浮点计算。硬件资源数量与具体产品的吞吐限制是不同概念，不能据此直接得出消费卡的 FP64 峰值。` });
  if (p.tensor) result.push({ id: 'tensor', name: 'Tensor Core', value: `${p.tensor} 个 · 第 ${g.tensorGeneration} 代`, text: '矩阵乘加专用单元。数据格式、稀疏性支持和吞吐随代际变化，Tensor Core 数量不与普通 CUDA 核心数直接相加。' });
  result.push({ id: 'cache', name: separateShared ? '独立共享存储' : 'L1／共享存储', value: separateShared ? facts.sm.shared : facts.sm.l1, text: ['maxwell', 'pascal'].includes(g.id) ? '共享存储独立于纹理／L1 缓存，不能画成后续架构的统一存储池。两种资源在模型中分别展示。' : g.id === 'tesla' ? '16 KB 共享存储支持同一个线程块内的协作；它不是现代 SM 的统一 L1／共享存储池。' : `${facts.sm.l1}。统一池容量与可申请的最大共享存储容量不同，实际分配还受架构和软件配置限制。` });
  if (p.rt) result.push({ id: 'rt', name: 'RT Core', value: `1 个 · 第 ${g.rtGeneration} 代`, text: '加速光线遍历、包围盒与几何求交。只在具备该硬件的 Turing、Ada 和 RTX Blackwell 代表芯片中显示；A100 和 H100 没有 RT Core。' });
  if (p.tma) result.push({ id: 'tma', name: 'Tensor Memory Accelerator', value: '异步张量搬运', text: 'Hopper TMA 负责多维张量的异步数据传输，配合同步机制减少线程参与搬运的开销。它是数据搬运机制，不是额外的 Tensor Core。' });
  result.push(g.id === 'tesla'
    ? { id: 'sfu', name: '特殊函数单元', value: '2 SFU / SM', text: '所选区域是 G80 SM 的两个特殊函数单元，承担部分数学运算。此块不包含单独计数的加载／存储阵列。' }
    : { id: 'sfu', name: '特殊函数与访存', value: `SFU ${facts.sm.sfu} · LD/ST ${facts.sm.loadStore}`, text: '特殊函数单元处理部分数学指令，加载／存储单元在寄存器和存储层级间传输数据。图中将两类功能相邻展示；数量分别统计，不表示它们共用执行资源。' });
  if (g.id === 'tesla') result.push({ id: 'textureInterface', name: '纹理簇接口', value: 'SM → TPC 纹理资源', text: '连接 SM 与所属纹理处理簇的纹理资源。G80 的纹理单元按 TPC 组织，这个接口块不代表每个 SM 额外拥有一套纹理单元。' });
  else if (g.id === 'fermi') result.push({ id: 'textureCache', name: '纹理／Uniform 缓存', value: '纹理与一致数据的缓存路径', text: '此区域表示纹理及 Uniform 数据的缓存路径，与保存程序指令的指令缓存、可配置的 L1／共享存储分别展示。图中未标容量，不据此推算缓存大小。' });
  else if (['maxwell', 'pascal'].includes(g.id)) result.push({ id: 'textureL1', name: '纹理／L1 缓存', value: '48 KB / SM · 2 × 24 KB', text: '两组纹理／L1 缓存分别服务成对的处理分区，每组 24 KB。它们与 96 KB 独立共享存储分开，不能把两者当作后续架构的统一存储池。' });
  else result.push({ id: 'textureUnits', name: g.id === 'kepler' ? '纹理单元与纹理缓存' : '纹理单元', value: `${g.id === 'kepler' ? 16 : 4} 纹理单元 / ${g.smLabel}`, text: g.id === 'kepler' ? 'GK104 的一个 SMX 配置 16 个纹理单元；这里将纹理单元及其纹理缓存路径一起表示。它与 SMX 的可配置 L1／共享存储分开。' : '纹理单元负责纹理寻址、采样与过滤等操作，并使用相应的纹理缓存路径。它们与 CUDA、Tensor 和 RT 执行单元分别计数。' });
  return result;
}

function FlatCanvas({ generation, view, items, labelsOn, hidden, selected, selectedRegionKey, onRegionResolved, onSelect, onDrill, focusRequest, zoom, pan, onCamera, panelCollapsed }) {
  const host = useRef(null), api = useRef(null), drag = useRef(null);
  const [pins, setPins] = useState([]), [shapes, setShapes] = useState([]), [hover, setHover] = useState(null), [focused, setFocused] = useState(null), [failed, setFailed] = useState(false);
  const latest = useRef({ zoom, pan }); latest.current = { zoom, pan, onCamera, selected, selectedRegionKey, onRegionResolved, focusRequest, panelCollapsed };
  useEffect(() => {
    const mount = host.current;
    let model, renderer, observer, scene, frame = 0;
    const replacedMaterials = new Set();
    setHover(null); setFocused(null);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
      renderer.domElement.setAttribute('aria-hidden', 'true'); mount.prepend(renderer.domElement);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xf2f3e9, 0x58655f, 1.5));
      const light = new THREE.DirectionalLight(0xffffff, 1.8); light.position.set(-7, 10, 6); scene.add(light);
      const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 50);
      camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
      model = createMicroModels(generation); model.update(generation, view === 'sm' ? .98 : .74);
      model.packaging.visible = false;
      const root = view === 'sm' ? model.sm : model.chip; scene.add(root);
      root.traverse(object => {
        if (object.material?.map) {
          replacedMaterials.add(object.material);
          object.material = new THREE.MeshBasicMaterial({ map: object.material.map, toneMapped: false });
        }
      });
      const dimensions = view === 'sm' ? [4.02, 3.015] : [model.bounds.dieWidth, model.bounds.dieDepth];
      const anchors = view === 'sm' ? { ...model.smAnchors } : { ...model.chipAnchors };
      const regions = model.hitRegions[view];
      const unmapped = regions.filter(r => r.action !== 'drill' && !items.some(i => i.id === r.id));
      if (unmapped.length) throw new Error(`Missing micro-region details: ${[...new Set(unmapped.map(r => r.id))].join(', ')}`);
      const metrics = () => {
        const w = mount.clientWidth, h = mount.clientHeight, aspect = w / h;
        const bounds = mount.getBoundingClientRect(), guide = mount.parentElement.querySelector('.micro-framing-guide')?.getBoundingClientRect();
        const mobile = w <= 760;
        const left = Math.max(0, (guide?.left ?? bounds.left) - bounds.left);
        const right = Math.min(w, (guide?.right ?? bounds.right) - bounds.left);
        const top = Math.max(0, (guide?.top ?? bounds.top) - bounds.top);
        const bottom = Math.min(h, (guide?.bottom ?? bounds.bottom) - bounds.top);
        const fitWidth = Math.max(180, right-left), fitHeight = Math.max(180,bottom-top);
        const visibleHeight = Math.max(dimensions[1] * 1.13 * h / fitHeight, dimensions[0] * 1.13 * h / fitWidth);
        const t = clamp((latest.current.zoom - 1) / .55, 0, 1);
        const fitX = (left + right) / 2, detailX = ((mobile ? left : 24) + right) / 2;
        return { w, h, aspect, visibleHeight, centerX: fitX+(detailX-fitX)*t, centerY:(top+bottom)/2, detailWidth: right - (mobile ? left : 24) };
      };
      if (view === 'chip') for (const id of ['frontend', 'memoryController']) {
        const first = regions.find(r => r.id === id);
        if (first) anchors[id] = root.worldToLocal(regionCorners(model, view, first).reduce((v,p)=>v.add(p), new THREE.Vector3()).multiplyScalar(.25));
      }
      const render = () => {
        const { w, h, aspect, visibleHeight, centerX, centerY } = metrics();
        if (!w || !h) return;
        const halfH = visibleHeight / 2, halfW = halfH * aspect;
        const { zoom: z, pan: p } = latest.current;
        camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH; camera.zoom = z;
        camera.position.x = (w / 2 - centerX - p.x) * visibleHeight / h / z;
        camera.position.z = (h / 2 - centerY - p.y) * visibleHeight / h / z;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        renderer.setSize(w, h, false); renderer.render(scene, camera);
        const current = latest.current;
        const matches = regions.filter(r => r.id === current.selected);
        const selectedRegion = matches.find(r => r.key === current.selectedRegionKey) || matches[current.selected === 'tensor' ? Math.floor((matches.length - 1) * .67) : 0];
        if (selectedRegion) current.onRegionResolved({ ...selectedRegion, generationId: generation.id, view });
        setShapes(regions.map(r => ({ ...r, selected: r.key === selectedRegion?.key, points: regionCorners(model, view, r).map(p => { p.project(camera); return `${(p.x+1)*w/2},${(1-p.y)*h/2}`; }).join(' ') })));
        const available = items.filter(i => anchors[i.id]);
        setPins(available.map((i, index) => {
          const point = i.id === current.selected && selectedRegion ? regionCorners(model, view, selectedRegion).reduce((v,p)=>v.add(p), new THREE.Vector3()).multiplyScalar(.25).project(camera) : root.localToWorld(anchors[i.id].clone()).project(camera);
          const side = index < Math.ceil(available.length / 2) ? 'left' : 'right';
          const row = side === 'left' ? index : index - Math.ceil(available.length / 2);
          const count = side === 'left' ? Math.ceil(available.length / 2) : Math.floor(available.length / 2);
          const docked = w > 600;
          return { ...i, x: (point.x + 1) * w / 2, y: (1 - point.y) * h / 2, labelX: side==='left'?12:w-192, labelY: h * .12 + row * h * .72 / Math.max(1,count-1), side, docked };
        }));
      };
      const stop = () => { cancelAnimationFrame(frame); mount.dataset.animating = 'false'; };
      const focus = request => {
        const matches = regions.filter(r => r.id === request.id);
        const region = matches.find(r => r.key === request.key) || matches[request.id === 'tensor' ? Math.floor((matches.length - 1) * .67) : 0];
        if (!region) return;
        stop(); setHover(null); setFocused(region.key);
        const corners = regionCorners(model, view, region), bounds = new THREE.Box3().setFromPoints(corners), center = bounds.getCenter(new THREE.Vector3());
        const { w, h, aspect, visibleHeight, detailWidth } = metrics();
        const targetZoom = clamp(Math.min(visibleHeight / ((bounds.max.z-bounds.min.z)*1.8), visibleHeight*detailWidth/h / ((bounds.max.x-bounds.min.x)*1.8)), 1.25, 4);
        const target = { zoom: targetZoom, pan: { x: -center.x*w*targetZoom/(visibleHeight*aspect), y: -center.z*h*targetZoom/visibleHeight } };
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { latest.current.onCamera(target); return; }
        const from = { zoom: latest.current.zoom, pan: { ...latest.current.pan } }, start = performance.now();
        mount.dataset.animating = 'true';
        const tick = now => {
          const t = clamp((now-start)/480, 0, 1), ease = 1-Math.pow(1-t, 3);
          latest.current.onCamera({ zoom: from.zoom+(target.zoom-from.zoom)*ease, pan: { x: from.pan.x+(target.pan.x-from.pan.x)*ease, y: from.pan.y+(target.pan.y-from.pan.y)*ease } });
          if (t<1) frame=requestAnimationFrame(tick); else mount.dataset.animating='false';
        };
        frame=requestAnimationFrame(tick);
      };
      api.current = { render, focus, stop, clear: () => { stop(); setFocused(null); }, pick: (x,y) => {
        const hit = pickMicroRegion(model, view, camera, mount, x, y);
        return hit && regions.find(r => r.key === hit.key) || null;
      } };
      observer = new ResizeObserver(render); observer.observe(mount);
      const guide = mount.parentElement.querySelector('.micro-framing-guide'); if (guide) observer.observe(guide);
      render(); setFailed(false);
      mount.dataset.ready = 'true'; mount.dataset.regionCount = String(regions.length);
    } catch (e) { console.error(e); setFailed(true); mount.dataset.ready = 'error'; }
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); api.current = null; model?.dispose(); replacedMaterials.forEach(m=>m.dispose()); renderer?.dispose(); renderer?.domElement.remove(); };
  }, [generation.id, view]);
  useEffect(() => { api.current?.render(); }, [zoom, pan, selected, selectedRegionKey, focusRequest, panelCollapsed]);
  useEffect(() => { if (focusRequest?.id) api.current?.focus(focusRequest); else api.current?.clear(); }, [focusRequest]);
  const activate = region => { if (region.action === 'drill') onDrill(region); else onSelect(region.id, region.key); };
  return <div className="micro-flat-canvas" ref={host} data-generation={generation.id} data-view={view} data-focused-region={focused || ''} data-selected-region={selected} data-selected-region-key={selectedRegionKey || shapes.find(s => s.selected)?.key || ''} data-hover-region={hover?.key || ''} aria-label="可点击功能区域放大，拖动和缩放的正交俯视芯片模型；也可使用结构目录中的按钮" tabIndex={0}
    onWheel={e => { api.current?.stop(); onCamera({ zoom: clamp(zoom * (e.deltaY > 0 ? .92 : 1.08), 1, 4), pan }); }}
    onKeyDown={e => { if (e.target!==e.currentTarget) return; if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); api.current?.stop(); onCamera({ zoom, pan: { x: pan.x + (e.key === 'ArrowLeft' ? 32 : e.key === 'ArrowRight' ? -32 : 0), y: pan.y + (e.key === 'ArrowUp' ? 32 : e.key === 'ArrowDown' ? -32 : 0) } }); } }}
    onPointerDown={e => { if (e.target.closest('button') || e.button !== 0) return; api.current?.stop(); drag.current = { x: e.clientX, y: e.clientY, origin: pan, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => {
      if (drag.current) { const dx=e.clientX-drag.current.x, dy=e.clientY-drag.current.y; if (Math.hypot(dx,dy)>6) drag.current.moved=true; if (drag.current.moved) { setHover(null); onCamera({ zoom, pan: { x: drag.current.origin.x+dx, y: drag.current.origin.y+dy } }); } }
      else if (!e.target.closest('button')) setHover(api.current?.pick(e.clientX,e.clientY) || null);
    }}
    onPointerUp={e => { const gesture=drag.current; drag.current=null; if (gesture && !gesture.moved) { const hit=api.current?.pick(e.clientX,e.clientY); if(hit) activate(hit); } if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerLeave={() => { if(!drag.current) setHover(null); }} onPointerCancel={() => { drag.current=null; }} onLostPointerCapture={() => { drag.current=null; }}>
    {failed && <div className="micro-flat-error">当前环境无法显示三维模型。右侧仍可阅读架构参数与来源。</div>}
    <svg className="micro-hit-regions" aria-hidden="true">{shapes.map(s=><polygon key={s.key} data-region={s.id} data-region-key={s.key} data-region-label={s.label} data-local-value={s.localValue} data-partition={s.partition} data-action={s.action || 'focus'} points={s.points} className={hover?.key===s.key?'hovered':s.selected?'focused':''} style={regionStyle(s.id==='sm'?'gpc':s.id, view)}/>)}</svg>
    {hover&&<div className="micro-hit-hint">{hover.action==='drill'?`进入 ${ARCHITECTURE_FACTS[generation.id].clusterLabel} ${hover.cluster} · ${generation.smLabel} ${hover.unit}`:`点击放大 · ${items.find(i=>i.id===hover.id)?.name}`}</div>}
    <div className="micro-pins" aria-label="详细结构标签">{labelsOn && pins.filter(p => !hidden.has(p.id)).map(p => <div key={p.id} className="micro-pin-group" style={regionStyle(p.id, view)}>{p.docked&&<svg className="micro-pin-leader" aria-hidden="true"><path d={`M ${p.x} ${p.y} L ${p.side==='left'?p.labelX+174:p.labelX} ${p.labelY+14}`}/></svg>}<button className={`micro-pin ${p.docked?'docked':''} ${selected === p.id ? 'selected' : ''}`} style={{ left: p.x, top: p.y }} onClick={() => onSelect(p.id)} aria-label={`${p.name} · ${p.value}`} aria-pressed={selected === p.id}><i>{String(items.findIndex(it=>it.id===p.id)+1).padStart(2,'0')}</i><span style={p.docked?{position:'absolute',left:p.labelX-p.x+10,top:p.labelY-p.y+10}:undefined} title={`${p.name} · ${p.value}`}>{p.name}<small>{p.value}</small></span></button></div>)}</div>
  </div>;
}

export default function MicroWorkbench({ generation, generations, initialView = 'chip', onSelectGeneration, onClose }) {
  const dialog = useRef(null), chipViewport = useRef(null), pendingRestore = useRef(null), closeTimer = useRef(null), closingRef = useRef(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selectedRegionKey, setSelectedRegionKey] = useState(null), [resolvedRegion, setResolvedRegion] = useState(null);
  const regionResolved = useCallback(region => { setResolvedRegion(prev => prev?.key === region.key && prev.generationId === region.generationId && prev.view === region.view ? prev : region); }, []);
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState(initialView), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [focusRequest, setFocusRequest] = useState(null), [drilled, setDrilled] = useState(null);
  const [labelsOn, setLabelsOn] = useState(true), [hidden, setHidden] = useState(new Set()), [selected, setSelected] = useState(initialView === 'sm' ? (MICRO_PROFILES[generation.id].tensor ? 'tensor' : 'cuda') : 'gpc');
  const items = useMemo(() => detailsFor(generation, view), [generation, view]);
  const regions = useMemo(() => [...new Set(items.map(item => regionForLabel(item.id, view)))], [items, view]);
  const active = items.find(i => i.id === selected) || items[0];
  const currentRegion = resolvedRegion?.generationId === generation.id && resolvedRegion.view === view && resolvedRegion.id === active.id && (!selectedRegionKey || resolvedRegion.key === selectedRegionKey) ? resolvedRegion : null;
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); setFocusRequest(null); };
  const focus = (id, key) => { setSelected(id); setSelectedRegionKey(key || null); setFocusRequest({ id, key, serial: performance.now() }); };
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 300);
  };
  const camera = ({ zoom: z, pan: p }) => { setZoom(z); setPan(p); };
  const drill = region => { if (view === 'chip') chipViewport.current = { zoom, pan: { ...pan } }; setDrilled(region); setView('sm'); };
  const backToChip = () => { pendingRestore.current = chipViewport.current; setView('chip'); };
  const changeView = next => { if (next === view) return; if (next === 'sm') drill(null); else backToChip(); };
  useEffect(() => {
    setDrilled(null); chipViewport.current = null; pendingRestore.current = null;
    const timeline = dialog.current?.querySelector('.micro-generation-timeline');
    const centerCurrent = () => { const button = timeline?.querySelector('[aria-current="true"]'); if (button) timeline.scrollLeft += button.getBoundingClientRect().left - timeline.getBoundingClientRect().left - (timeline.clientWidth - button.clientWidth) / 2; };
    const observer = new ResizeObserver(centerCurrent);
    if (timeline) observer.observe(timeline);
    return () => observer.disconnect();
  }, [generation.id]);
  useEffect(() => {
    const restore = pendingRestore.current; pendingRestore.current = null;
    if (restore) { setZoom(restore.zoom); setPan(restore.pan); setFocusRequest(null); } else reset();
    setSelectedRegionKey(null); setResolvedRegion(null);
    setHidden(new Set()); setSelected(view === 'chip' ? 'gpc' : MICRO_PROFILES[generation.id].tensor ? 'tensor' : 'cuda');
  }, [generation.id, view]);
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.current.showModal(); dialog.current.focus(); document.body.style.overflow = 'hidden';
    return () => { clearTimeout(closeTimer.current); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className={`micro-workbench ${closing ? 'is-closing' : ''}`} onCancel={e => { e.preventDefault(); requestClose(); }} aria-labelledby="micro-workbench-title">
    <header className="micro-workbench-header">
      <div className="micro-workbench-identity"><Cpu size={29} weight="regular"/><span>GPU ATLAS</span><small>探索 GPU 的每一层</small></div>
      <div className="micro-header-context"><span>沉浸探索</span><i>/</i><span>芯片观察室</span></div>
      <div className="micro-workbench-actions"><label className="micro-generation-label"><span>当前架构</span><select value={generation.id} onChange={e => onSelectGeneration(e.target.value)} aria-label="平铺视图架构">{generations.map(g => <option key={g.id} value={g.id}>{g.name} · {g.chip}</option>)}</select></label><button className="micro-close" onClick={requestClose} aria-label="关闭平铺视图"><X size={22}/></button></div>
    </header>
    <nav className="micro-generation-timeline" aria-label="架构时间线">{generations.map(g => <button key={g.id} aria-current={generation.id===g.id?'true':undefined} onClick={()=>onSelectGeneration(g.id)}><i/><small>{g.year}</small><span>{g.name}</span></button>)}</nav>
    <div className="micro-toolbar">
      <button className="micro-back-chip" onClick={view==='sm'?backToChip:requestClose} aria-label={view==='sm'?'返回芯片架构':'返回滚动探索'}><ArrowLeft size={16}/><span>返回</span></button>
      <div className="micro-breadcrumb"><span>{generation.name}</span><i>/</i><span>{generation.chip}</span><i>/</i><span>{view==='chip'?'芯片架构':`${generation.smLabel} 内部`}</span><i>/</i><strong>{active.name}</strong></div>
      <button className="micro-label-toggle" onClick={() => setLabelsOn(v=>!v)} aria-pressed={labelsOn} aria-label={labelsOn?'隐藏全部标签':'显示全部标签'}>{labelsOn?<Eye size={18}/>:<EyeSlash size={18}/>}<span>{labelsOn?'隐藏全部标签':'显示全部标签'}</span></button>
    </div>
    <div className={`micro-workbench-body ${zoom > 1.06 ? 'is-zoomed' : ''} ${panelCollapsed ? 'is-inspector-collapsed' : ''}`}>
      <aside className="micro-intro">
        <span className="micro-intro-kicker">{generation.name.toUpperCase()} <i>{generation.chip}</i></span>
        <h2 id="micro-workbench-title">{view==='chip'?<>计算的全貌，<br/>尽在眼前。</>:<>微小之中，<br/>自有宏大。</>}</h2>
        <p className="micro-intro-description">{view==='chip'?`从 ${ARCHITECTURE_FACTS[generation.id].clusterLabel} 到 ${generation.smLabel}，探索计算、缓存与访存如何连接。`:`深入 ${generation.smLabel} 内部，探索每一个计算单元如何协同。`}</p>
        <span className="micro-intro-rule"/>
        <p className="micro-intro-help">点击图中模块，探索功能细节。<br/>拖动与缩放，发现芯片的每一层。</p>
        <div className="micro-region-legend" aria-label="功能分区颜色图例">{regions.map(region => <span key={region} style={{ '--region-accent': MICRO_REGION_COLORS[region].accent }}><i aria-hidden="true"/>{MICRO_REGION_COLORS[region].label}</span>)}</div>
        <div className="micro-stage-caption"><span>{generation.card}</span><strong>{view==='chip'?`${generation.fullSm} ${generation.smLabel} 完整配置 / ${generation.sm} 已启用`:`${MICRO_PROFILES[generation.id].cores} ${generation.coreLabel} / ${generation.smLabel}`}</strong></div>
      </aside>
      <section className="micro-stage" aria-label="芯片观察区域">
        <div className="micro-framing-guide" aria-hidden="true"/>
        {view==='sm'&&drilled&&<p className="micro-drill-path">{ARCHITECTURE_FACTS[generation.id].clusterLabel} {drilled.cluster} / {generation.smLabel} {drilled.unit}<span>同代逻辑结构 · 编号为示意位置</span></p>}
        <FlatCanvas generation={generation} view={view} items={items} labelsOn={labelsOn} hidden={hidden} selected={active.id} selectedRegionKey={selectedRegionKey} onRegionResolved={regionResolved} onSelect={focus} onDrill={drill} focusRequest={focusRequest} zoom={zoom} pan={pan} onCamera={camera} panelCollapsed={panelCollapsed}/>
        <div className="micro-stage-bottom"><span>正交俯视<span className="micro-desktop-hint"> · 点击深入</span></span><div className="micro-zoom"><button aria-label="缩小平铺模型" disabled={zoom<=1} onClick={()=>{setFocusRequest(null);setZoom(z=>clamp(z-.25,1,4));}}><Minus size={18}/></button><output aria-label="当前缩放">{Math.round(zoom*100)}%</output><button aria-label="放大平铺模型" disabled={zoom>=4} onClick={()=>{setFocusRequest(null);setZoom(z=>clamp(z+.25,1,4));}}><Plus size={18}/></button><button aria-label="适应视口" onClick={reset}><ArrowsIn size={19}/></button></div></div>
      </section>
      <MicroInspector generation={generation} view={view} active={active} items={items} currentRegion={currentRegion} hidden={hidden} onFocus={focus} onToggleHidden={id => setHidden(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })} onDrill={drill} collapsed={panelCollapsed} onToggleCollapsed={() => setPanelCollapsed(v => !v)} regionStyle={regionStyle}/>
    </div>
    <nav className="micro-view-dock" aria-label="观察层级"><button onClick={requestClose}><Cube size={23}/><span>返回三维</span></button><i/><div className="micro-view-switch" aria-label="切换观察结构">{[['chip','芯片架构',Stack],['sm',`${generation.smLabel} 内部`,Cpu]].map(([v,l,Icon]) => <button key={v} aria-pressed={view===v} onClick={() => changeView(v)}><Icon size={23}/><span>{l}</span></button>)}</div></nav>
    <footer className="micro-workbench-footer"><span>公开架构的逻辑示意。排布、面积与装饰走线不代表真实晶体管版图。</span><button onClick={requestClose}><ArrowLeft size={14}/>返回滚动探索</button></footer>
  </dialog>,document.body);
}
