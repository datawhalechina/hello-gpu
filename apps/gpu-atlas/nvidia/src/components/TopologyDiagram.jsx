import { useId } from 'react';
import { ARCHITECTURE_FACTS } from '../data/architectureFacts';
import './TopologyDiagram.css';

const CHIP_NAMES = {
  tesla: 'G80', fermi: 'GF100', kepler: 'GK104', maxwell: 'GM204', pascal: 'GP102',
  volta: 'GV100', turing: 'TU102', ampere: 'GA100', hopper: 'GH100', ada: 'AD102', blackwell: 'GB202',
};
const PAD = (number) => String(number).padStart(2, '0');
const IS_COMPUTE = new Set(['volta', 'ampere', 'hopper']);

function resolveGeneration(gpu) {
  const identity = `${gpu?.id || ''} ${gpu?.name || ''}`.toLowerCase();
  return Object.keys(ARCHITECTURE_FACTS).find((key) => identity.includes(key)) || 'blackwell';
}

function Control({ part, label, selected, onSelect, children, className = '', onActivate, onDrill, ...props }) {
  const activate = (event) => {
    event.stopPropagation();
    onActivate?.();
    onSelect?.(part);
  };
  return (
    <g {...props} className={`td-control ${selected ? 'is-selected' : ''} ${className}`} role="button" tabIndex={0}
      aria-label={label} aria-pressed={selected} data-part={part}
      onClick={activate}
      onDoubleClick={onDrill ? (event) => { event.stopPropagation(); onActivate?.(); onDrill(); } : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
      }}>
      <title>{label}{onDrill ? '；双击进入 SM 内部' : ''}</title>
      {children}
    </g>
  );
}

function Definitions({ id }) {
  return <defs>
    <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#263e37" /><stop offset=".12" stopColor="#101f1c" />
      <stop offset=".53" stopColor="#172920" /><stop offset=".84" stopColor="#0b1715" /><stop offset="1" stopColor="#30453b" />
    </linearGradient>
    <linearGradient id={`${id}-die`} x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0" stopColor="#12251c" /><stop offset=".5" stopColor="#0d1b17" /><stop offset="1" stopColor="#0c1714" />
    </linearGradient>
    <linearGradient id={`${id}-header`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#12261e" /><stop offset=".5" stopColor="#0b1614" /><stop offset="1" stopColor="#0d1b18" />
    </linearGradient>
    <linearGradient id={`${id}-cluster`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#1c3524" /><stop offset=".22" stopColor="#12291c" /><stop offset="1" stopColor="#0d2018" />
    </linearGradient>
    <linearGradient id={`${id}-cluster-selected`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#344d22" /><stop offset=".48" stopColor="#1e351b" /><stop offset="1" stopColor="#142715" />
    </linearGradient>
    <linearGradient id={`${id}-sm`} x1="0" y1="0" x2=".85" y2="1">
      <stop stopColor="#4a8150" /><stop offset=".5" stopColor="#35673e" /><stop offset="1" stopColor="#244d30" />
    </linearGradient>
    <linearGradient id={`${id}-sm-selected`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#cefa86" /><stop offset=".44" stopColor="#a8df61" /><stop offset="1" stopColor="#78ad3d" />
    </linearGradient>
    <linearGradient id={`${id}-cache`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#223e2f" /><stop offset="1" stopColor="#142c23" />
    </linearGradient>
    <pattern id={`${id}-mesh`} width="11" height="11" patternUnits="userSpaceOnUse">
      <path d="M11 0H0V11" fill="none" stroke="#85be8b" strokeWidth=".45" opacity=".17" />
    </pattern>
    <pattern id={`${id}-silicon`} width="7" height="9" patternUnits="userSpaceOnUse">
      <path d="M1 0V9M4 0V4M4 6V9" stroke="#75a777" strokeWidth=".4" opacity=".2" />
      <path d="M1 3H4M4 7H7" stroke="#8cbe8b" strokeWidth=".4" opacity=".13" />
    </pattern>
    <pattern id={`${id}-pins`} width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M1 0V8M4 0V8" stroke="#668771" strokeWidth=".65" opacity=".45" />
    </pattern>
    <filter id={`${id}-glow`} x="-15%" y="-20%" width="130%" height="140%">
      <feGaussianBlur stdDeviation="2.2" />
    </filter>
  </defs>;
}

function DieFrame({ id }) {
  return <g aria-hidden="true" className="td-die-frame">
    <rect x="87" y="12" width="626" height="513" fill="#07110f" stroke="#1b3028" />
    <rect x="93" y="18" width="614" height="501" fill={`url(#${id}-metal)`} stroke="#375742" />
    <rect x="97" y="22" width="606" height="493" fill={`url(#${id}-die)`} stroke="#618660" strokeOpacity=".66" />
    <rect x="100" y="25" width="600" height="487" fill={`url(#${id}-silicon)`} stroke="#152b22" />
    <rect x="107" y="31" width="586" height="475" fill="none" stroke="#3e5846" strokeOpacity=".36" />
    <path d="M96 123V21H194M606 21H704V123M704 416V516H606M194 516H96V416" className="td-metal-corners" />
    {[103, 697].map((x) => [36, 132, 228, 324, 420, 502].map((y) => <rect key={`${x}-${y}`} x={x - 1} y={y - 1} width="2" height="2" fill="#67866a" opacity=".5" />))}
    <rect x="122" y="38" width="556" height="464" fill="#0a1613" stroke="#385546" strokeWidth=".8" />
  </g>;
}

function BusRail({ id, x, y = 127, height = 279, selected, onSelect }) {
  return <Control part="memory" label="芯片内部数据互连与显存通路" selected={selected} onSelect={onSelect} className="td-rail">
    <rect className="td-module-outline" x={x} y={y} width="17" height={height} fill="#162d29" stroke="#34574a" />
    <rect x={x + 1} y={y + 1} width="15" height={height - 2} fill={`url(#${id}-mesh)`} />
    {[.18, .4, .62, .84].map((fraction) => <rect key={fraction} x={x + 6} y={y + height * fraction} width="5" height="5" fill="#77b76d" opacity=".68" />)}
  </Control>;
}

function ChipPorts({ id, generation, selected, onSelect }) {
  const compute = IS_COMPUTE.has(generation);
  const ports = [
    { y: 106, lines: ['PCIe', '接口'], part: 'frontend', label: 'PCI Express 主机接口与命令前端' },
    { y: 205, lines: compute ? ['命令', '处理'] : ['显示', '引擎'], part: compute ? 'frontend' : 'io', label: compute ? '命令处理与工作提交' : '显示引擎与输出接口' },
    { y: 304, lines: compute ? ['任务', '分发'] : ['视频', '处理'], part: compute ? 'frontend' : 'io', label: compute ? '并行计算任务分发' : '视频处理功能' },
    { y: 403, lines: ['其他', 'I/O'], part: 'io', label: '芯片辅助输入输出功能' },
  ];
  return <g>
    {ports.map((port) => <Control key={port.y} part={port.part} label={port.label} selected={selected === port.part} onSelect={onSelect} className="td-port">
      <rect x="6" y={port.y} width="72" height="69" fill="transparent" />
      <path d={`M77 ${port.y + 34}H93`} stroke="#2e5143" strokeWidth=".8" />
      <rect className="td-module-outline" x="60" y={port.y} width="18" height="69" fill="#10211f" stroke="#2c4440" />
      <rect x="62" y={port.y + 2} width="14" height="65" fill={`url(#${id}-silicon)`} opacity=".55" />
      <rect x="66.5" y={port.y + 31} width="5" height="5" fill="#83b76d" opacity=".75" />
      <text className="td-label td-port-label" x="45" y={port.y + 28} textAnchor="end"><tspan x="45">{port.lines[0]}</tspan><tspan x="45" dy="16">{port.lines[1]}</tspan></text>
    </Control>)}
    <Control part="memory" label="显存接口与数据传输" selected={selected === 'memory'} onSelect={onSelect} className="td-port">
      <rect x="716" y="208" width="79" height="126" fill="transparent" />
      <path d="M707 270H725" stroke="#2e5143" strokeWidth=".8" />
      <rect className="td-module-outline" x="725" y="218" width="18" height="106" fill="#12251e" stroke="#365544" />
      <rect x="727" y="220" width="14" height="102" fill={`url(#${id}-pins)`} />
      <text className="td-label td-port-label" x="756" y="263"><tspan x="756">显存</tspan><tspan x="756" dy="16">接口</tspan></text>
    </Control>
  </g>;
}

function ChipView({ gpu, generation, facts, id, selected, activeGroup, onSelect, onGroupSelect, onDrill }) {
  const chip = gpu?.chip || CHIP_NAMES[generation];
  const smName = gpu?.smLabel || 'SM';
  const columns = facts.fullClusters === 6 ? 3 : facts.fullClusters <= 4 ? 2 : 4;
  const rows = Math.ceil(facts.fullClusters / columns);
  const gap = 8;
  const width = (534 - gap * (columns - 1)) / columns;
  const height = (304 - gap * (rows - 1)) / rows;
  const memoryType = gpu?.memoryType || facts.memoryInterface.match(/(?:GDDR|HBM)[\w.]*/)?.[0] || '';
  const fullWidth = generation === 'pascal' || generation === 'turing' ? '384-bit' : facts.memoryInterface.split(' ')[0];
  const memoryCaption = `${memoryType} · ${IS_COMPUTE.has(generation) ? '本卡 ' : ''}${fullWidth}`;
  const cacheCaption = generation === 'tesla' ? '纹理 / 常量缓存 · 分布式，无统一 L2' : generation === 'ampere' ? '共享 L2 缓存 · 完整芯片容量未单列' : `共享 L2 缓存（${facts.fullL2}）`;
  const cacheMeta = generation === 'tesla' ? 'NO UNIFIED L2' : generation === 'ampere' ? 'L2 CAPACITY NOT SPECIFIED' : `${facts.fullL2} L2`;
  return <>
    <ChipPorts id={id} generation={generation} selected={selected} onSelect={onSelect} />
    <Control part="frontend" label={`${chip} 主机命令前端与工作分发`} selected={selected === 'frontend'} onSelect={onSelect} className="td-chip-header">
      <rect className="td-module-outline" x="123" y="39" width="554" height="54" fill={`url(#${id}-header)`} stroke="#355447" />
      <text className="td-chip-name" x="139" y="74">{chip}</text>
      <text className="td-label td-header-architecture" x="661" y="59" textAnchor="end">{generation.toUpperCase()} ARCHITECTURE</text>
      <text className="td-label td-header-facts" x="661" y="77" textAnchor="end">{facts.fullClusters} {facts.clusterLabel} · {facts.fullSm} {smName} · {cacheMeta}</text>
    </Control>
    <BusRail id={id} x={111} selected={selected === 'memory'} onSelect={onSelect} />
    <BusRail id={id} x={672} selected={selected === 'memory'} onSelect={onSelect} />
    <g className="td-clusters">
      {Array.from({ length: facts.fullClusters }, (_, index) => {
        const x = 133 + (index % columns) * (width + gap);
        const y = 103 + Math.floor(index / columns) * (height + gap);
        const chosen = selected === 'compute' && activeGroup === index;
        const tileCols = facts.smPerCluster <= 5 ? facts.smPerCluster : facts.smPerCluster === 14 ? 7 : facts.smPerCluster === 18 ? 6 : 4;
        const tileRows = Math.ceil(facts.smPerCluster / tileCols);
        const tileWidth = (width - 16 - (tileCols - 1) * 3) / tileCols;
        const tileHeight = (height - 44 - (tileRows - 1) * 3) / tileRows;
        return <Control key={index} part="compute" label={`${facts.clusterLabel} ${PAD(index + 1)}，${facts.smPerCluster} 个 ${smName}`} selected={chosen} onSelect={onSelect}
          onActivate={() => onGroupSelect?.(index)} onDrill={onDrill} className="td-cluster" data-cluster-index={index}>
          {chosen && <rect x={x - 1} y={y - 1} width={width + 2} height={height + 2} fill="none" stroke="#a8df63" strokeWidth="2" opacity=".3" filter={`url(#${id}-glow)`} aria-hidden="true" />}
          <rect className="td-module-outline" x={x} y={y} width={width} height={height} fill={`url(#${id}-${chosen ? 'cluster-selected' : 'cluster'})`} stroke={chosen ? '#b5e774' : '#4e7350'} strokeWidth={chosen ? 1.5 : .8} />
          <rect x={x + 2} y={y + 2} width={width - 4} height={height - 4} fill={`url(#${id}-silicon)`} opacity=".35" pointerEvents="none" />
          <path d={`M${x + 1} ${y + 10}V${y + 1}H${x + 16}M${x + width - 15} ${y + 1}H${x + width - 1}V${y + 14}`} fill="none" stroke={chosen ? '#dcf3a8' : '#779572'} strokeOpacity={chosen ? '.85' : '.5'} aria-hidden="true" />
          <text className="td-label td-cluster-name" x={x + 8} y={y + 17}>{facts.clusterLabel} {PAD(index + 1)}</text>
          <text className="td-label td-cluster-count" x={x + 8} y={y + 31}>{facts.smPerCluster} {smName}</text>
          {Array.from({ length: facts.smPerCluster }, (_, unit) => {
            const ux = x + 8 + (unit % tileCols) * (tileWidth + 3);
            const uy = y + 38 + Math.floor(unit / tileCols) * (tileHeight + 3);
            return <g key={unit} className="td-sm-tile" data-sm-index={unit} aria-hidden="true">
              <rect x={ux} y={uy} width={tileWidth} height={tileHeight} fill={`url(#${id}-${chosen ? 'sm-selected' : 'sm'})`} stroke={chosen ? '#b1d46c' : '#456947'} strokeWidth=".7" />
              <path d={`M${ux + 1} ${uy + tileHeight - 1}V${uy + 1}H${ux + tileWidth - 1}`} fill="none" stroke={chosen ? '#dcfaaa' : '#76a77a'} strokeOpacity={chosen ? '.65' : '.4'} strokeWidth=".7" />
              <rect x={ux + 1} y={uy + 1} width={Math.max(1, tileWidth - 2)} height={Math.max(1, tileHeight - 2)} fill={`url(#${id}-silicon)`} opacity=".2" />
            </g>;
          })}
        </Control>;
      })}
    </g>
    <Control part="cache" label={cacheCaption} selected={selected === 'cache'} onSelect={onSelect} className="td-cache">
      <rect className="td-module-outline" x="133" y="416" width="534" height="36" fill={`url(#${id}-cache)`} stroke="#527b58" />
      <rect x="134" y="417" width="532" height="34" fill={`url(#${id}-mesh)`} />
      <text className="td-label td-cache-label" x="400" y="439" textAnchor="middle">{cacheCaption}</text>
    </Control>
    <Control part="memory" label={`显存接口；${generation === 'pascal' || generation === 'turing' ? '完整芯片 384-bit；' : ''}所选卡 ${facts.memoryInterface}`} selected={selected === 'memory'} onSelect={onSelect} className="td-memory">
      <rect className="td-module-outline" x="133" y="461" width="534" height="34" fill={`url(#${id}-header)`} stroke="#365448" />
      <rect x="308" y="468" width="156" height="20" fill={`url(#${id}-pins)`} stroke="#45614c" strokeWidth=".4" opacity=".55" aria-hidden="true" />
      <text className="td-label td-memory-label" x="144" y="482">MEMORY INTERFACE</text>
      <text className="td-label td-memory-label" x="654" y="482" textAnchor="end">{memoryCaption}</text>
    </Control>
  </>;
}

const INTEGER_CAPTIONS = {
  tesla: 'SP 支持整数指令 · 与浮点执行资源共用',
  fermi: '整数 ALU 位于 CUDA Core 内 · 共用调度资源',
  kepler: '整数与 FP32 共用 SMX 执行资源',
  maxwell: '整数与浮点共用 CUDA 执行通路',
  pascal: '整数与浮点共用执行通路 · 支持 DP4A',
  volta: '64 个独立 INT32 核心 · 可与 FP32 并发',
  turing: '64 个独立 INT32 核心 · 可与 FP32 并发',
  ampere: '64 个独立 INT32 核心 · 可与 FP32 并发',
  hopper: '64 个独立 INT32 核心 · 可与 FP32 并发',
  ada: '64 条 FP32 专用 + 64 条 FP32 / INT32 共用通路',
  blackwell: '128 条 FP32 / INT32 统一通路 · 同周期二选一',
};

function ResourceCard({ id, x, width, part, value, label, caption, selected, onSelect }) {
  return <Control part={part} label={`${label}：${value}${caption ? `，${caption}` : ''}`} selected={selected === part} onSelect={onSelect} className={`td-resource td-resource-${part}`}>
    <rect className="td-module-outline" x={x} y="365" width={width} height="65" fill={`url(#${id}-cluster)`} stroke="#466449" />
    <rect x={x + 1} y="366" width={width - 2} height="63" fill={`url(#${id}-mesh)`} opacity=".45" />
    <text className="td-label td-resource-label" x={x + 10} y="382">{label}</text>
    <text className={`td-resource-value ${String(value).length > 6 ? 'td-resource-value-small' : ''}`} x={x + 10} y="406">{value}</text>
    {caption && <text className="td-label td-resource-caption" x={x + 10} y="421">{caption}</text>}
  </Control>;
}

function SmView({ gpu, generation, facts, id, selected, onSelect }) {
  const sm = facts.sm;
  const chip = gpu?.chip || CHIP_NAMES[generation];
  const smName = gpu?.smLabel || (generation === 'kepler' ? 'SMX' : generation === 'maxwell' ? 'SMM' : 'SM');
  // Kepler's four issue schedulers feed a shared wide SMX. They are not four
  // independent 48-core execution partitions; its CUDA array stays whole here.
  const partitionCount = generation === 'kepler' ? 1 : sm.partitions;
  const partitionWidth = (534 - 8 * (partitionCount - 1)) / partitionCount;
  const coresPerPartition = sm.cores / partitionCount;
  const sfuValue = typeof sm.sfu === 'number' ? sm.sfu : Number.parseInt(sm.sfu, 10);
  const resources = [
    ...(sm.tensor ? [{ part: 'tensor', label: 'TENSOR CORES', value: sm.tensor, caption: '矩阵乘加' }] : []),
    ...(sm.rt ? [{ part: 'rt', label: 'RT CORE', value: sm.rt, caption: 'BVH / 求交' }] : []),
    ...(sm.fp64 ? [{ part: 'fp64', label: 'FP64', value: typeof sm.fp64 === 'number' ? sm.fp64 : '支持', caption: typeof sm.fp64 === 'number' ? '双精度核心' : generation === 'kepler' ? 'GK104 低吞吐' : '配合 CUDA 资源' }] : []),
    { part: 'sfu', label: 'SFU', value: sfuValue, caption: typeof sm.sfu === 'number' ? '特殊函数单元' : '逻辑模块' },
  ];
  const resourceWidth = (534 - 8 * (resources.length - 1)) / resources.length;
  return <>
    <rect x="123" y="39" width="554" height="54" fill={`url(#${id}-header)`} stroke="#355447" />
    <text className="td-chip-name" x="139" y="74">{smName}</text>
    <text className="td-label td-header-architecture" x="661" y="59" textAnchor="end">{chip} · {generation.toUpperCase()}</text>
    <text className="td-label td-header-facts" x="661" y="77" textAnchor="end">{sm.cores} {generation === 'tesla' ? 'SP' : 'FP32'} · {sm.schedulers} WARP SCHEDULERS{sm.tensor ? ` · ${sm.tensor} TENSOR` : ''}</text>
    <g aria-hidden="true" className="td-sm-wiring">
      {Array.from({ length: sm.schedulers }, (_, i) => { const x = 133 + (i + .5) * (534 / sm.schedulers); return <path key={i} d={`M${x} 146V365M${x - 3} 207H${x + 3}`} />; })}
      <path d="M117 127H126V478H133M683 127H674V478H667M117 176H126M674 176H683" />
      <rect x="113" y="106" width="7" height="324" fill={`url(#${id}-pins)`} opacity=".35" stroke="#44674a" />
      <rect x="680" y="106" width="7" height="324" fill={`url(#${id}-pins)`} opacity=".35" stroke="#44674a" />
    </g>
    <Control part="scheduler" label={`${sm.schedulers} 个 Warp 调度器，${sm.dispatch} 个指令发射单元`} selected={selected === 'scheduler'} onSelect={onSelect} className="td-schedulers">
      <rect x="133" y="105" width="534" height="42" fill="transparent" />
      {Array.from({ length: sm.schedulers }, (_, i) => {
        const w = (534 - 8 * (sm.schedulers - 1)) / sm.schedulers;
        const x = 133 + i * (w + 8);
        return <g key={i}>
          <rect className="td-module-outline" x={x} y="105" width={w} height="42" fill={`url(#${id}-cache)`} stroke="#4d7054" />
          <text className="td-label td-scheduler-title" x={x + w / 2} y="122" textAnchor="middle">WARP SCHED. {sm.schedulers > 1 ? PAD(i + 1) : ''}</text>
          <text className="td-label td-scheduler-detail" x={x + w / 2} y="139" textAnchor="middle">{sm.dispatch / sm.schedulers} × DISPATCH</text>
        </g>;
      })}
    </Control>
    <Control part="registers" label={`寄存器文件，${sm.registers}`} selected={selected === 'registers'} onSelect={onSelect} className="td-registers">
      <rect className="td-module-outline" x="133" y="157" width="534" height="42" fill={`url(#${id}-header)`} stroke="#4b6a53" />
      <rect x="134" y="158" width="532" height="40" fill={`url(#${id}-silicon)`} opacity=".32" />
      <text className="td-label td-storage-label" x="145" y="182">REGISTER FILE</text>
      <text className="td-label td-register-count" x="654" y="182" textAnchor="end">{sm.registers}</text>
    </Control>
    {Array.from({ length: partitionCount }, (_, i) => {
      const x = 133 + i * (partitionWidth + 8);
      const unified = generation === 'blackwell';
      const ada = generation === 'ada';
      const chosen = selected === 'cuda';
      return <Control key={i} part="cuda" label={generation === 'kepler' ? '完整 SMX 的共享执行资源：192 个 CUDA 核心' : `${partitionCount > 1 ? `执行分区 ${PAD(i + 1)}：` : ''}${coresPerPartition} 个 ${generation === 'tesla' ? 'SP' : 'FP32 执行通路'}${unified ? '；全部与 INT32 共用' : ada ? '；一半为 FP32 专用，一半与 INT32 共用' : ''}`} selected={chosen} onSelect={onSelect} className="td-execution">
        <rect className="td-module-outline" x={x} y="213" width={partitionWidth} height="102" fill={`url(#${id}-${chosen ? 'cluster-selected' : 'cluster'})`} stroke={chosen ? '#b5e774' : '#4e7350'} />
        <text className="td-label td-partition-label" x={x + 10} y="230">{generation === 'kepler' ? 'SMX · 共享执行资源' : partitionCount > 1 ? `执行分区 ${PAD(i + 1)}` : '统一流处理器阵列'}</text>
        <rect x={x + 9} y="240" width={partitionWidth - 18} height="65" fill={`url(#${id}-${chosen ? 'sm-selected' : 'sm'})`} stroke={chosen ? '#b6db73' : '#567e54'} strokeWidth=".7" />
        <rect x={x + 10} y="241" width={partitionWidth - 20} height="63" fill={`url(#${id}-silicon)`} opacity=".37" />
        <text className={`td-core-value ${chosen ? 'is-lit' : ''}`} x={x + partitionWidth / 2} y="269" textAnchor="middle">{coresPerPartition}</text>
        <text className={`td-label td-core-label ${chosen ? 'is-lit' : ''}`} x={x + partitionWidth / 2} y="287" textAnchor="middle">{unified ? 'FP32 / INT32' : generation === 'tesla' ? 'STREAM PROCESSORS' : 'FP32 CUDA CORES'}</text>
        {ada && <text className={`td-label td-core-detail ${chosen ? 'is-lit' : ''}`} x={x + partitionWidth / 2} y="299" textAnchor="middle">16 专用 + 16 共用</text>}
      </Control>;
    })}
    <Control part="int32" label={sm.int32} selected={selected === 'int32'} onSelect={onSelect} className="td-integer-path">
      <rect className="td-module-outline" x="133" y="325" width="534" height="29" fill="#14291f" stroke="#405c42" />
      <path d="M144 338h19m-3-3 3 3-3 3" stroke="#8eba70" fill="none" />
      <text className="td-label td-integer-label" x="174" y="344">{INTEGER_CAPTIONS[generation]}</text>
    </Control>
    {resources.map((resource, i) => <ResourceCard key={resource.part} {...resource} id={id} x={133 + i * (resourceWidth + 8)} width={resourceWidth} selected={selected} onSelect={onSelect} />)}
    <Control part="shared" label={`共享存储：${sm.shared}。L1：${sm.l1}`} selected={selected === 'shared'} onSelect={onSelect} className="td-shared">
      <rect className="td-module-outline" x="133" y="441" width="534" height="53" fill={`url(#${id}-cache)`} stroke="#57775b" />
      <rect x="134" y="442" width="532" height="51" fill={`url(#${id}-mesh)`} opacity=".7" />
      <text className="td-label td-storage-label" x="145" y="461">SHARED MEMORY{generation === 'tesla' ? '' : ' / L1'}</text>
      <text className="td-label td-shared-capacity" x="654" y="461" textAnchor="end">{sm.shared}</text>
      <text className="td-label td-shared-detail" x="145" y="483">{sm.l1}</text>
      {typeof sm.loadStore === 'number' && <text className="td-label td-load-store" x="654" y="483" textAnchor="end">{sm.loadStore} LD / ST</text>}
    </Control>
  </>;
}

/** Public architecture view. Unit counts describe complete silicon; all areas
 * are logical resources, never a claim about physical floorplan or die area. */
export default function TopologyDiagram({ gpu = {}, view = 'chip', selected = 'compute', activeGroup = 0, onSelect, onGroupSelect, onDrill, labelsVisible = true }) {
  const uid = useId();
  const id = `topology-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const generation = resolveGeneration(gpu);
  const facts = ARCHITECTURE_FACTS[generation];
  const chip = gpu?.chip || CHIP_NAMES[generation];
  return <svg className={`topology-diagram${labelsVisible ? '' : ' td-hide-labels'}`} viewBox="0 0 800 540" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
    role="group" aria-label={view === 'sm' ? `${chip} 单个 SM 内部功能资源，逻辑结构示意` : `完整 ${chip} 逻辑拓扑：${facts.fullClusters} 个 ${facts.clusterLabel}，${facts.fullSm} 个 SM`} data-generation={generation} data-view={view}>
    <Definitions id={id} />
    <DieFrame id={id} />
    {view === 'sm'
      ? <SmView gpu={gpu} generation={generation} facts={facts} id={id} selected={selected} onSelect={onSelect} />
      : <ChipView gpu={gpu} generation={generation} facts={facts} id={id} selected={selected} activeGroup={activeGroup} onSelect={onSelect} onGroupSelect={onGroupSelect} onDrill={onDrill} />}
  </svg>;
}
