import { ArrowRight, ArrowDown, Cube, Cpu, SquaresFour, Circuitry, Memory } from '@phosphor-icons/react';
import ArchiveChipScene from './ArchiveChipScene.jsx';
import ArchivePreviewArt from './ArchivePreviewArt.jsx';
import './ArchiveLanding.css';

const format = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
const introductions = {
  tesla: '统一着色架构，让图形与通用计算走向同一片硅。',
  fermi: '可编程并行计算，走进更广阔的科学与工程领域。',
  kepler: '更宽的 SMX，让并行计算释放更高的能效。',
  maxwell: '重新组织计算资源，在性能与功耗间迈进一步。',
  pascal: '更先进的工艺，为图形计算带来更高的吞吐。',
  volta: 'Tensor Core 首次登场，开启矩阵计算的新篇章。',
  turing: '专用光追与矩阵单元，让实时图形迎来新可能。',
  ampere: '为数据中心而生，让 AI 与科学计算协同加速。',
  hopper: '面向 Transformer，将大模型计算推向新的规模。',
  ada: '光线追踪与神经渲染，重新描绘实时图形的边界。',
  blackwell: '新一代 GPU 架构，为生成式 AI 与神经渲染而生。',
};

function Metric({ Icon, label, value, unit, detail, fullValue }) {
  return <div className="al-metric">
    <Icon className="al-metric-icon" size={21} weight="light" aria-hidden="true" />
    <div><dt>{label}</dt><dd title={fullValue}>{value}{unit && <small>{unit}</small>}</dd><span>{detail}</span></div>
  </div>;
}

export default function ArchiveLanding({ generation: g, onExplore, onTopology, onCompute, onPerformance, onSources, onSpecs }) {
  const processNode = g.process.match(/\d+\s*nm/);
  const processValue = processNode ? processNode[0] : g.process;
  const processDetail = processNode ? g.process.replace(processNode[0], '').trim().replace(/\s+/g, ' · ') || '官方工艺命名' : '官方工艺命名';
  const cards = [
    { kind: 'topology', title: '芯片拓扑', copy: <>深入模块结构，了解完整的<br />{g.chip} 逻辑布局。</>, action: onTopology },
    { kind: 'compute', title: '计算单元', copy: <>探索 {g.smLabel}{g.tensorGeneration ? '、Tensor Core' : ' 与执行通路'}，<br />理解核心模块的协同工作。</>, action: onCompute },
    { kind: 'performance', title: '性能跃迁', copy: <>从 Tesla 到 Blackwell，<br />见证计算规模的持续演进。</>, action: onPerformance },
    { kind: 'documents', title: '技术文档', copy: <>深入架构白皮书与技术资料，<br />获取更多细节。</>, action: onSources },
  ];
  return <section id="archive" className="archive-landing" aria-labelledby="al-title">
    <div className="al-content">
      <div className="al-hero">
        <div className="al-atmosphere" aria-hidden="true"><i className="al-light-shaft" /><i className="al-floor-light" /><i className="al-floor-line" /><i className="al-dust" /></div>
        <div className="al-copy">
          <span className="al-eyebrow">THE ARCHITECTURE COLLECTION</span>
          <h2 id="al-title"><span>十九年进化。</span><span>每一代，都打开新的可能。</span></h2>
          <p>11 代架构，11 款代表 GPU。选择一个时代，<br className="al-desktop-break" />从对应的三维硬件深入芯片与计算单元，见证计算的持续进化。</p>
          <div className="al-actions">
            <button className="al-primary" onClick={onExplore}><Cube size={25} weight="duotone" aria-hidden="true" /><span>以三维探索 {g.name}</span><ArrowRight size={21} aria-hidden="true" /></button>
            <button className="al-continue" onClick={() => document.getElementById('al-contents')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })}>继续探索 <ArrowDown size={20} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="al-model"><ArchiveChipScene generation={g} /></div>
        <aside className="al-caption" aria-label={`${g.name} 架构简介`} key={g.id}>
          <span className="al-caption-dot" aria-hidden="true" />
          <h3>{g.name.toUpperCase()}</h3><p>{introductions[g.id]}</p>
          <div className="al-caption-meta"><span>{g.chip} / {g.productYear}</span><span>{g.innovations[0]}</span><span>{g.innovations[1]}</span></div>
        </aside>
      </div>
      <div className="al-specs" aria-label="当前 GPU 关键参数" aria-live="polite">
        <button className="al-spec-identity" onClick={onSpecs} aria-label={`查看 ${g.card} 完整参数`}><span className="al-eyebrow">AT A GLANCE</span><strong>{g.chip}</strong><span className="al-card-name">{g.card}<ArrowRight size={12} aria-hidden="true" /></span></button>
        <dl className="al-metrics">
          <Metric Icon={SquaresFour} label="晶体管数量" value={format(g.transistors)} unit="B" detail="十亿个晶体管" />
          <Metric Icon={Circuitry} label="制造工艺" value={processValue} fullValue={g.process} detail={processDetail} />
          <Metric Icon={Cpu} label="计算核心" value={format(g.cores)} detail={g.coreLabel || 'CUDA / 流处理器'} />
          <Metric Icon={Memory} label="显存配置" value={g.memory} detail={g.memoryType} />
        </dl>
        <button className="al-circle al-spec-more" onClick={onSpecs} aria-label="展开完整 GPU 参数"><ArrowRight size={18} aria-hidden="true" /></button>
      </div>
      <div className="al-contents" id="al-contents">
        <div className="al-contents-heading"><h3>探索更多架构内容</h3><button onClick={onSources}>查看架构原始资料 <ArrowRight size={16} aria-hidden="true" /></button></div>
        <div className="al-cards">{cards.map(({ kind, title, copy, action }, index) => <button className="al-card" key={kind} onClick={action} aria-label={title === '技术文档' ? '打开技术文档资料库' : `查看${title}`}>
          <div className="al-card-art"><ArchivePreviewArt kind={kind} generation={g} /></div>
          <div className="al-card-content"><span className="al-card-number">{String(index + 1).padStart(2, '0')}</span><strong>{title}</strong><p>{copy}</p><span className="al-circle" aria-hidden="true"><ArrowRight size={17} /></span></div>
        </button>)}</div>
      </div>
    </div>
    <div className="al-colophon"><span>GPU ATLAS <i /> 让复杂的计算，看得见。</span><small>独立 GPU 科普项目。NVIDIA 名称及商标归其所有。</small><span>探索 · 学习 · 理解 · 更进一步</span></div>
  </section>;
}
