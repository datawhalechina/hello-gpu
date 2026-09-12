import React, { useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ArrowUpRight, Cpu, X, Info, CaretRight, Sun, Moon, ArrowLeft } from '@phosphor-icons/react';
import generations from './data/generations.json';
import CinematicStory from './components/CinematicStory.jsx';
import { useMotionPreference } from './hooks/useMotionPreference.js';
import ArchitecturePanel from './components/ArchitecturePanel.jsx';
import { HARDWARE_REFERENCES } from './components/cinematic/generationHardware.js';
import ArchiveLanding from './components/ArchiveLanding.jsx';
import PerformancePage from './components/PerformancePage.jsx';
import { useAtlasTheme } from './hooks/useAtlasTheme.js';

const format = (n) => typeof n === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n) : n;
function GlobalGenerationRail({ generations, selected, onSelect }) {
  const railRef = useRef(null);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const reveal = () => {
      const active = rail.querySelector('.selected');
      if (!active || rail.scrollWidth <= rail.clientWidth) return;
      const railBox = rail.getBoundingClientRect(), activeBox = active.getBoundingClientRect();
      rail.scrollTo({ left: rail.scrollLeft + activeBox.left - railBox.left - (rail.clientWidth - activeBox.width) / 2, behavior: 'instant' });
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(rail); reveal();
    return () => observer.disconnect();
  }, [selected.id]);
  const move = (event, current) => {
    const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (event.key !== 'Home' && event.key !== 'End' && !offset) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? generations.length - 1 : Math.max(0, Math.min(generations.length - 1, current + offset));
    onSelect(generations[next].id);
    requestAnimationFrame(() => document.querySelector(`.site-generation-rail [data-generation="${generations[next].id}"]`)?.focus());
  };
  return <div className="site-generation-rail" aria-label="GPU 架构代际导航"><div className="site-generation-rail-inner"><div ref={railRef} className="generation-rail" role="tablist" aria-label="切换 GPU 架构">{generations.map((g, i) => <button type="button" key={g.id} className={`generation-choice ${g.id === selected.id ? 'selected' : ''}`} role="tab" aria-selected={g.id === selected.id} tabIndex={g.id === selected.id ? 0 : -1} data-generation={g.id} onClick={() => onSelect(g.id)} onKeyDown={event => move(event, i)}><span>{g.year}</span><strong>{g.id === 'ada' ? 'Ada Lovelace' : g.name}</strong></button>)}</div></div></div>;
}

function SourcesDialog({ generation, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement;
    el.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; prev?.focus(); };
  }, []);
  return <dialog ref={ref} className="sources-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="sources-title">
    <div className="sources-inner"><button className="icon-btn dialog-close" aria-label="关闭资料库" onClick={onClose}><X size={23}/></button>
      <span className="eyebrow">THE REFERENCE LIBRARY</span><h2 id="sources-title">每一步演进，<br/>都有据可循。</h2><p>以 NVIDIA 官方白皮书、产品规格和架构技术文章为依据。选择一代架构，查看原始资料。</p>
      <div className="reference-note"><Info size={21}/><span>滚动展示覆盖 Tesla 至 Blackwell 共 11 代代表产品。整卡根据各代外形与散热特征重建；V100、A100、H100 均选用 PCIe 成品卡版本，模型与参数对应同一产品形态。封装与计算单元依据公开架构制作。它不是官方 CAD 或实物扫描；SM 为逻辑结构可视化，不能等同于真实晶体管版图。年份优先标注架构首次亮相时间，代表产品可能更晚发布。</span></div>
      <section className="source-group"><div className="source-gen"><span>VISUAL REFERENCE</span><h3>模型与视觉来源</h3><small>个人学习 · 非商业展示</small></div><div><a href="https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/" target="_blank" rel="noreferrer">RTX 5090 FE 官方产品外观与散热设计<ArrowUpRight size={17}/></a><a href="https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf" target="_blank" rel="noreferrer">RTX Blackwell 官方架构白皮书<ArrowUpRight size={17}/></a><p className="source-note">程序化三维几何由本项目重建。Blackwell 芯片表面的 NVIDIA 官方架构宣传图经过透视校正后用作视觉纹理；其他代际使用对应逻辑结构的程序化纹理。图片版权归 NVIDIA，纹理中的分区不代表经测量的物理版图。</p></div></section>
      {generations.map(g => <section className={`source-group ${g.id === generation.id ? 'source-current' : ''}`} key={g.id}><div className="source-gen"><span>{g.year}</span><h3>{g.name}</h3><small>{g.card}</small></div><div>{(g.sources || []).map((s, i) => <a key={i} href={typeof s === 'string' ? s : s.url} target="_blank" rel="noreferrer">{typeof s === 'string' ? 'NVIDIA 官方资料' : s.title}<ArrowUpRight size={17}/></a>)}{(HARDWARE_REFERENCES[g.id] || []).filter(url=>!(g.sources || []).some(s=>(typeof s==='string'?s:s.url)===url)).map(url=><a key={url} href={url} target="_blank" rel="noreferrer">官方硬件外观与封装参考<ArrowUpRight size={17}/></a>)}<p className="source-note">{g.note}</p>{g.sibling && <div className="sibling-note"><strong>同代数据中心：{g.sibling.name}</strong><p>{g.sibling.description}</p>{g.sibling.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}<ArrowUpRight size={15}/></a>)}</div>}</div></section>)}
      <p className="sources-footnote">FP32 为非 Tensor 理论峰值，不能视为游戏帧率或应用实测排名。频率、产品形态、工作负载与数值精度都会影响实际性能。</p>
    </div>
  </dialog>;
}

function ProductDetails({ gen }) {
  return <details className="product-details section-shell"><summary>查看 {gen.card} 完整参数与架构突破 <CaretRight size={16}/></summary><div className="product-details-body"><div><h3>{gen.tagline}</h3><p>{gen.description}</p><div className="innovation-tags">{gen.innovations.map(x=><span key={x}>{x}</span>)}</div><p className="detail-source-note">{gen.note}</p></div><dl>{[['非 Tensor FP32',gen.fp32 == null ? '暂无同口径数据' : `${format(gen.fp32)} TFLOPS`],['显存带宽',`${format(gen.bandwidth)} GB/s`],['显卡 / 模块功耗',gen.power == null ? '官方数值待核验' : `${gen.power} W`],['启用计算单元',`${gen.sm} ${gen.smLabel}`],['显存类型',gen.memoryType],['代表产品年份',gen.productYear]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></details>;
}

function App() {
  const [selectedId,setSelectedId] = useState(()=>{
    const requested=new URLSearchParams(window.location.search).get('architecture');
    return generations.some(g=>g.id===requested)?requested:'blackwell';
  });
  const [sources,setSources] = useState(false);
  const [navSection,setNavSection] = useState('explore');
  const [architectureModeRequest,setArchitectureModeRequest] = useState(null);
  const reduced = useMotionPreference();
  const { theme, toggleTheme } = useAtlasTheme();
  const gen = generations.find(g=>g.id===selectedId) || generations.at(-1);
  useEffect(() => {
    const sections = ['explore', 'archive', 'performance'];
    const update = () => {
      const threshold = window.innerHeight * .32;
      const current = sections.filter(id => document.getElementById(id)?.getBoundingClientRect().top <= threshold).at(-1);
      setNavSection(current || 'explore');
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    const valid = new Set(['explore', 'archive', 'architecture', 'performance', 'milestones']);
    const revealHash = () => {
      const id = window.location.hash.slice(1);
      if (!valid.has(id) || id === 'explore') return;
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' }), 40);
    };
    revealHash();
    window.addEventListener('hashchange', revealHash);
    return () => window.removeEventListener('hashchange', revealHash);
  }, []);
  const select=(id)=>{
    setSelectedId(id);
    const url=new URL(window.location.href);url.searchParams.set('architecture',id);
    window.history.replaceState(null,'',url);
  };
  const jump=(id)=>{
    const url = new URL(window.location.href); url.hash = id;
    window.history.replaceState(null, '', url);
    document.getElementById(id)?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'});
  };
  const inspectArchitecture = view => { setArchitectureModeRequest({ view }); jump('architecture'); };
  const showSpecs = () => {
    const detail = document.querySelector('.product-details');
    if (detail) { detail.open = true; detail.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' }); }
  };
  return <MotionConfig reducedMotion={reduced?'always':'never'}><div className="app cinematic-app">
    <a className="skip-exploration" href="#archive">跳至架构资料</a><header className="header"><a className="brand" href="../" aria-label="返回 GPU 图谱总入口"><span className="brand-symbol"><Cpu size={23} weight="fill"/></span><strong>GPU <span>ATLAS</span></strong><span className="brand-divider"/><small>NVIDIA</small></a><nav aria-label="主导航">{[['explore','沉浸探索'],['archive','架构档案'],['performance','性能跃迁']].map(([id,label])=><a key={id} href={`#${id}`} className={navSection===id?'nav-active':''} aria-current={navSection===id?'location':undefined}>{label}</a>)}</nav><div className="header-actions"><a className="tutorial-return" href="../../"><ArrowLeft size={14}/><span>Hello GPU</span></a><button className="library-button" onClick={()=>setSources(true)}>资料库 <ArrowUpRight size={17}/></button><button className="atlas-theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到日间模式' : '切换到深色模式'} title={theme === 'dark' ? '切换到日间模式' : '切换到深色模式'}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button></div></header>
    <GlobalGenerationRail generations={generations} selected={gen} onSelect={select}/><main id="main-content">
      <CinematicStory generation={gen} generations={generations} onSelect={select} onSources={()=>setSources(true)} onArchive={()=>jump('archive')}/>
      <ArchiveLanding generation={gen} onExplore={()=>jump('explore')} onTopology={()=>inspectArchitecture('chip')} onCompute={()=>inspectArchitecture('sm')} onPerformance={()=>jump('performance')} onSources={()=>setSources(true)} onSpecs={showSpecs}/>
      <ProductDetails gen={gen}/><section id="architecture" className="topology-page" aria-labelledby="topology-title"><ArchitecturePanel gpu={gen} modeRequest={architectureModeRequest} onSources={()=>setSources(true)}/></section>
      <PerformancePage generations={generations} selected={gen} onSelect={select} onSources={()=>setSources(true)} onArchive={id=>{select(id);jump('archive')}}/>
    </main><footer className="performance-footer"><a href="../">GPU ATLAS<span>返回图谱总入口</span></a><span>探索 · 学习 · 理解 · 更进一步</span></footer>
    {sources&&<SourcesDialog generation={gen} onClose={()=>setSources(false)}/>}
  </div></MotionConfig>;
}
export default App;
