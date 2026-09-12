import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChartBar, Info, CaretDown } from '@phosphor-icons/react';
import generations from '../data/generations.json';
import './PerformanceTrend.css';

export const PERFORMANCE_METRICS = {
  transistors: { label: '晶体管规模', subtitle: '晶体管数量随架构演进的变化', axis: '晶体管数量（十亿）', unit: 'B' },
  bandwidth: { label: '显存带宽', subtitle: '代表产品的显存数据传输能力', axis: '显存带宽（GB/s）', unit: 'GB/s' },
  fp32: { label: 'FP32 算力', subtitle: '代表产品的非 Tensor FP32 理论峰值', axis: 'FP32 算力（TFLOPS）', unit: 'TFLOPS' },
};

function number(value, metric, precise = false) {
  if (!Number.isFinite(value)) return '暂无同口径数据';
  const decimals = metric === 'bandwidth' ? (precise ? 2 : 1) : (precise ? 3 : 1);
  return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
}
function chartScale(max) {
  const rough = max * 1.12 / 6;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const step = [1, 2, 2.5, 5, 10].find(n => n * power >= rough) * power;
  const ceiling = Math.ceil(max * 1.12 / step) * step;
  return { step, max: ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step) };
}

export default function PerformanceTrend({ selected, metric = 'transistors', onMetricChange, onSelect, onSources }) {
  const unique = useId().replace(/:/g, '');
  const plotRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const selectedId = typeof selected === 'string' ? selected : selected?.id;
  const currentMetric = PERFORMANCE_METRICS[metric] ? metric : 'transistors';
  const info = PERFORMANCE_METRICS[currentMetric];
  const data = useMemo(() => generations.filter(gpu => filter === 'all' || gpu.category === filter), [filter]);
  const scale = useMemo(() => chartScale(Math.max(...data.map(gpu => gpu[currentMetric] || 0))), [data, currentMetric]);
  const width = 744, height = 350;
  const box = { left: 42, right: 710, top: 17, bottom: 291 };
  const points = data.map((gpu, index) => ({
    ...gpu, value: gpu[currentMetric], x: box.left + index * (box.right - box.left) / Math.max(data.length - 1, 1),
    y: Number.isFinite(gpu[currentMetric]) ? box.bottom - gpu[currentMetric] / scale.max * (box.bottom - box.top) : box.bottom,
  }));
  const segments = [];
  for (const point of points) {
    if (!Number.isFinite(point.value)) { if (segments.at(-1)?.length) segments.push([]); }
    else { if (!segments.length) segments.push([]); segments.at(-1).push(point); }
  }
  const activeId = hovered || focused || selectedId;
  const active = points.find(point => point.id === activeId);
  const tooltipWidth = Math.max(85, Math.ceil((active?.name.length || 0) * 6.9 + 22), active && Number.isFinite(active.value) ? number(active.value, currentMetric).length * 10 + info.unit.length * 7 + 25 : 105);
  const tooltipHeight = 67;
  const tooltipBeside = active && active.y < tooltipHeight + 10;
  const tooltipX = active ? Math.min(width - tooltipWidth - 7, Math.max(7, tooltipBeside ? active.x - tooltipWidth - 15 : active.x - tooltipWidth / 2)) : 0;
  const tooltipY = active ? Math.max(3, tooltipBeside ? active.y - tooltipHeight / 2 : active.y - tooltipHeight - 16) : 0;
  const landmarkIds = currentMetric === 'transistors' && data.length > 8 ? ['tesla', 'volta', 'turing', 'ampere'] : [];
  const landmarks = points.filter(point => landmarkIds.includes(point.id) && active?.id !== point.id && Math.abs((active?.x ?? -1000) - point.x) > 76);
  const setMetric = next => { setHovered(null); setFocused(null); onMetricChange?.(next); };
  const metricKeys = Object.keys(PERFORMANCE_METRICS);
  const onMetricKey = (event, key) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next;
    if (direction) next = metricKeys[(metricKeys.indexOf(key) + direction + metricKeys.length) % metricKeys.length];
    else if (event.key === 'Home') next = metricKeys[0];
    else if (event.key === 'End') next = metricKeys.at(-1);
    if (!next) return;
    event.preventDefault();
    setMetric(next);
    event.currentTarget.parentElement.querySelector(`[data-metric="${next}"]`)?.focus();
  };
  useEffect(() => { setHovered(null); setFocused(null); }, [selectedId]);
  useEffect(() => {
    const viewport = plotRef.current;
    if (!viewport) return;
    let frame;
    const revealSelected = () => {
      if (viewport.scrollWidth <= viewport.clientWidth + 1) return;
      const node = viewport.querySelector(`[data-generation="${selectedId}"]`);
      if (!node) return;
      const bounds = viewport.getBoundingClientRect(), point = node.getBoundingClientRect();
      if (point.left >= bounds.left + 15 && point.right <= bounds.right - 15) return;
      viewport.scrollTo({ left: Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + (point.left + point.right - bounds.left - bounds.right) / 2)), behavior: 'instant' });
    };
    const scheduleReveal = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(revealSelected); };
    const observer = new ResizeObserver(scheduleReveal);
    observer.observe(viewport);
    scheduleReveal();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [selectedId, filter]);
  const selectNode = point => onSelect?.(point.id);
  const accessibleSummary = `${info.axis}。横轴按架构代际排列，间距不代表年份间隔。${points.map(point => `${point.name} ${Number.isFinite(point.value) ? `${number(point.value, currentMetric, true)} ${info.unit}` : '暂无同口径数据'}`).join('；')}。`;

  return <article className="pt-card" aria-label="GPU 性能演进趋势">
    <header className="pt-header">
      <div className="pt-heading"><ChartBar size={27} weight="duotone" aria-hidden="true"/><div><h3>性能演进</h3><p>{info.subtitle}</p></div></div>
      <div className="pt-metrics" role="tablist" aria-label="切换性能指标">
        {Object.entries(PERFORMANCE_METRICS).map(([key, item]) => <button key={key} role="tab" type="button" data-metric={key} tabIndex={currentMetric === key ? 0 : -1} aria-selected={currentMetric === key} className={currentMetric === key ? 'is-active' : ''} onClick={() => setMetric(key)} onKeyDown={event => onMetricKey(event, key)}>{item.label}</button>)}
      </div>
    </header>
    <div className="pt-chart-tools"><span>{info.axis}</span><label className="pt-filter"><span className="pt-sr-only">筛选 GPU 类型</span><select value={filter} onChange={event => { setFilter(event.target.value); setHovered(null); setFocused(null); }}><option value="all">全部 GPU</option><option value="消费级">消费级 GPU</option><option value="数据中心">数据中心 GPU</option></select><CaretDown size={11} aria-hidden="true"/></label></div>
    <div className="pt-plot-scroll" ref={plotRef} tabIndex={0} aria-label="性能曲线，可横向滚动查看全部架构">
      <svg className="pt-plot" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={accessibleSummary}>
        <defs>
          <linearGradient id={`${unique}-area`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#bfe6d5" stopOpacity=".19"/><stop offset="1" stopColor="#a6d2c4" stopOpacity=".006"/></linearGradient>
          <filter id={`${unique}-point`} x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>
          <filter id={`${unique}-line`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
        </defs>
        <g className="pt-grid" aria-hidden="true">
          {scale.ticks.map(tick => { const y = box.bottom - tick / scale.max * (box.bottom - box.top); return <g key={tick}><line x1={box.left} x2={box.right + 12} y1={y} y2={y}/><text x={box.left - 13} y={y + 4} textAnchor="end">{number(tick, currentMetric)}</text></g>; })}
          {points.map(point => <line key={point.id} x1={point.x} x2={point.x} y1={box.top} y2={box.bottom}/>)}
          <path className="pt-axis" d={`M${box.left} ${box.top}V${box.bottom}H${box.right + 12}`}/>
        </g>
        <g key={`${currentMetric}-${filter}`} className="pt-traces" aria-hidden="true">
          {segments.filter(segment => segment.length).map((segment, index) => { const path = segment.map((point, n) => `${n ? 'L' : 'M'}${point.x} ${point.y}`).join(' '); return <g key={index}><path className="pt-area" d={`${path} L${segment.at(-1).x} ${box.bottom} L${segment[0].x} ${box.bottom}Z`} fill={`url(#${unique}-area)`}/><path className="pt-line-glow" d={path} filter={`url(#${unique}-line)`}/><path className="pt-line" pathLength="1" d={path}/></g>; })}
        </g>
        {landmarks.map(point => { const labelX = point.id === 'ampere' ? point.x - 58 : point.x + 8; return point.id === 'turing' ? <g className="pt-landmark" key={point.id} aria-hidden="true"><line x1={point.x} x2={point.x} y1={point.y + 8} y2={point.y + 14}/><text x={point.x} y={point.y + 27} textAnchor="middle">Turing · <tspan className="pt-landmark-value">18.6 B</tspan></text></g> : <g className="pt-landmark" key={point.id} aria-hidden="true"><line x1={point.x} x2={point.x} y1={point.y - 7} y2={point.y - 57}/><text x={labelX} y={point.y - 55}><tspan x={labelX}>{point.year}</tspan><tspan x={labelX} dy="14">{point.name}</tspan><tspan className="pt-landmark-value" x={labelX} dy="19">{number(point.value, currentMetric)} {info.unit}</tspan></text></g>; })}
        {points.map(point => <g key={point.id} className={`pt-node ${point.id === activeId ? 'is-highlighted' : ''} ${point.id === selectedId ? 'is-selected' : ''} ${Number.isFinite(point.value) ? '' : 'is-missing'}`} role="button" tabIndex={0} aria-label={`${point.name}，${point.year} 年，${Number.isFinite(point.value) ? `${info.label} ${number(point.value, currentMetric, true)} ${info.unit}` : '暂无同口径 FP32 数据'}，点击查看该架构`} aria-pressed={point.id === selectedId} data-generation={point.id} data-value={point.value ?? 'missing'} onClick={() => selectNode(point)} onPointerEnter={() => setHovered(point.id)} onPointerLeave={() => setHovered(null)} onFocus={() => setFocused(point.id)} onBlur={() => setFocused(null)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(point); } }}>
          <rect className="pt-node-hit" x={point.x - 20} y={Math.max(0, point.y - 20)} width="40" height={height - Math.max(0, point.y - 20) - 7} fill="transparent"/>
          {Number.isFinite(point.value) ? <><circle className="pt-halo" cx={point.x} cy={point.y} r="11" filter={`url(#${unique}-point)`}/><circle className="pt-node-outer" cx={point.x} cy={point.y} r="5.2"/><circle className="pt-node-inner" cx={point.x} cy={point.y} r="2.8"/></> : <><path className="pt-missing-symbol" d={`M${point.x - 4} ${point.y - 4}l8 8m-8 0l8 -8`}/><text className="pt-missing-label" x={point.x + 7} y={point.y - 16}>暂无数据</text></>}
          <text className="pt-x-year" x={point.x} y={box.bottom + 27} textAnchor="middle">{point.year}</text>
          <text className="pt-x-name" x={point.x} y={box.bottom + 44} textAnchor="middle">{point.id === 'ada' ? 'Ada Lovelace' : point.name}</text>
        </g>)}
        {active && <g className="pt-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} aria-hidden="true" pointerEvents="none">
          <rect width={tooltipWidth} height={tooltipHeight} rx="7"/><text x="11" y="15" className="pt-tooltip-year">{active.year}</text><text x="11" y="31" className="pt-tooltip-name">{active.name}</text><text x="11" y="54" className={Number.isFinite(active.value) ? 'pt-tooltip-value' : 'pt-tooltip-missing'}>{Number.isFinite(active.value) ? <>{number(active.value, currentMetric)} <tspan className="pt-tooltip-unit">{info.unit}</tspan></> : '暂无同口径数据'}</text>
        </g>}
      </svg>
    </div>
    <footer className="pt-source"><Info size={17} aria-hidden="true"/><p>按代际排列。晶体管对应芯片，带宽与 FP32 对应所选代表产品；不同产品定位不等于代际性能排名。</p><button type="button" onClick={onSources}>了解数据来源 <ArrowUpRight size={12}/></button></footer>
  </article>;
}
