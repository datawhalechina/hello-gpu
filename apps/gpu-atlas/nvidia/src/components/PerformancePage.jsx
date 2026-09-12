import { useState } from 'react';
import PerformanceTrend from './PerformanceTrend.jsx';
import { ProductArtwork as GpuProductArt } from './PerformanceArtwork.jsx';
import PerformanceMilestones from './PerformanceMilestones.jsx';
import './PerformancePage.css';

const metricLabels={transistors:'晶体管数量',bandwidth:'理论显存带宽',fp32:'非 Tensor FP32 理论峰值'};
const metricUnits={transistors:'B',bandwidth:'GB/s',fp32:'TFLOPS'};
const format=value=>typeof value==='number'?new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(value):'—';
function ProductCard({generation:g,metric}){
 const node=g.process.match(/\d+\s*nm/),process=node?node[0]:g.process,processDetail=node?g.process.replace(node[0],'').trim()||'制造工艺':'制造工艺';
 const value=g[metric],long=String(format(value)).length>6;
 return <div className="pf-product" data-generation={g.id} aria-label={`${g.card} 当前性能参数`}>
  <div className="pf-product-top"><span><i/>{g.year} / {g.name.toUpperCase()}</span><small>当前架构</small></div>
  <div className="pf-product-identity"><h3>{g.card}</h3><p>{g.name} 架构</p></div>
  <div className="pf-product-art"><GpuProductArt generation={g}/></div>
  <div className={`pf-product-value ${long?'is-long':''}`} key={`${g.id}-${metric}`} aria-live="polite"><strong>{format(value)}{value!=null&&metric==='transistors'&&<small>{metricUnits[metric]}</small>}</strong><span>{value==null?'暂无同口径数据':metric==='fp32'?'非 Tensor FP32 · TFLOPS':metric==='bandwidth'?'理论显存带宽 · GB/s':metricLabels[metric]}</span></div>
  <dl className="pf-product-stats"><div><dt>{g.coreLabel||'CUDA 核心'}</dt><dd>{format(g.cores)}</dd></div><div><dt>{g.memoryType} 显存</dt><dd>{g.memory}</dd></div><div><dt>{processDetail}</dt><dd title={g.process}>{process}</dd></div></dl>
 </div>;
}
export default function PerformancePage({generations,selected,onSelect,onSources,onArchive}){
 const [metric,setMetric]=useState('transistors');
 return <section id="performance" className="performance-page" aria-labelledby="performance-title">
  <div className="pf-main">
   <div className="pf-copy"><span className="pf-eyebrow">THE LEAP FORWARD</span><h2 id="performance-title">十九年。<br/>指数级的跨越。</h2><p className="pf-introduction">从几亿到数百亿个晶体管，见证每一次架构跃迁留下的轨迹。持续突破的计算能力，正推动更真实的图形、更强的 AI 与更广阔的可能。</p><ProductCard generation={selected} metric={metric}/></div>
   <PerformanceTrend generations={generations} selected={selected} metric={metric} onMetricChange={setMetric} onSelect={onSelect} onSources={onSources}/>
  </div>
  <PerformanceMilestones onSources={onSources} onArchive={onArchive}/>
 </section>;
}
