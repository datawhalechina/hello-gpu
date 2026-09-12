import { useEffect, useRef, useState } from 'react';
import { useScroll } from 'motion/react';
import { useMotionPreference } from '../hooks/useMotionPreference.js';
import { ArrowDown, ArrowRight, ArrowsOut, Minus, Plus, CaretLeft, CaretRight, CaretDown, Cube, Stack, Circuitry, Cpu, GridFour, CirclesFour, SlidersHorizontal, Check } from '@phosphor-icons/react';
import CinematicScene from './cinematic/CinematicScene.jsx';
import MicroWorkbench from './MicroWorkbench.jsx';
import { generationPresentation } from './cinematic/generationPresentation.js';
import { STORY_CHAPTERS, STORY_BOUNDARIES, activeChapter } from './cinematic/storyTimeline.js';
import './CinematicStory.css';

const chapterIcons = [Cube, Stack, Circuitry, Cpu, GridFour, CirclesFour];
const chapters = STORY_CHAPTERS.map((chapter, index) => ({ ...chapter, icon: chapterIcons[index] }));
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t)};

export default function CinematicStory({ generation, generations, onSelect, onSources, onArchive }) {
  const container=useRef(null);
  const pin=useRef(null);
  const progressRef=useRef(0);
  const hudRef=useRef(null);
  const sceneRef=useRef(null);
  const hotspotRef=useRef(null);
  const labelRefs=useRef({});
  const pickerRef=useRef(null);
  const pickerButtonRef=useRef(null);
  const toolsRef=useRef(null);
  const toolsButtonRef=useRef(null);
  const entryTimer=useRef(null);
  const returnTimer=useRef(null);
  const entryTarget=useRef(null);
  const [active,setActive]=useState(0);
  const [ready,setReady]=useState(false);
  const [failed,setFailed]=useState(false);
  const [labelsOn,setLabelsOn]=useState(true);
  const [manual,setManual]=useState(false);
  const [flatView,setFlatView]=useState(null);
  const [enteringView,setEnteringView]=useState(null);
  const [returningView,setReturningView]=useState(false);
  const [pickerOpen,setPickerOpen]=useState(false);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [allLabels,setAllLabels]=useState(false);
  const reduced=useMotionPreference();
  const {scrollYProgress}=useScroll({target:container,offset:['start start','end end']});
  const fmt=n=>new Intl.NumberFormat('en-US').format(n);
  const datacenter=generation.category==='数据中心';
  const modern=generation.id==='blackwell';
  const m=generation;
  const presentation=generationPresentation[m.id];
  const tensorCount=['volta','turing'].includes(m.id)?8:4;
  const selectedIndex=generations.findIndex(g=>g.id===m.id);
  const scenes=[
    {eyebrow: `${m.card} · ${m.productYear}`,title:'进入计算深处',subtitle:presentation.subtitle,description:'从完整显卡，到一枚芯片，再到每一次计算。沿着滚动，逐层靠近。'},
    {eyebrow:'精密工程',title:'力量，\n层层展开。',subtitle:datacenter?'为系统级计算而设计。':'每一层，都为下一层服务。',description:presentation.cooling},
    {eyebrow: `${m.card} / PCB ASSEMBLY`,title:'一块板，\n连接所有力量。',subtitle:'GPU、显存与供电，协同于此。',description:datacenter?`移开散热结构，${m.chip} 与高带宽显存封装留在单板上。供电器件与 PCIe 接口，将计算接入系统。`:`移开散热结构，${m.chip}、${m.memoryType} 显存与供电器件清楚呈现。沿着电路板，找到计算的核心。`},
    {eyebrow: `${m.chip} / SILICON PACKAGE`,title:'所有的力量。\n汇于这一片硅。',subtitle:`${m.transistors}B 个晶体管`,description:`${m.process} 制程。${m.memory} ${m.memoryType} 显存。进一步靠近，进入芯片。`},
    {eyebrow:'进入并行计算',title:'微小之中。\n自有宏大。',subtitle:`${m.fullSm} 个 ${m.smLabel}，构成完整 ${m.chip}。`,description:presentation.structure},
    {eyebrow:`${m.name.toUpperCase()} / STREAMING MULTIPROCESSOR`,title:'在这里，\n计算发生。',subtitle:`${Math.round(m.cores/m.sm)} 个 ${m.coreLabel} / ${m.smLabel}`,description:m.tensorGeneration?`计算通路、Tensor Core 与片上存储紧密配合。${m.rtGeneration?'专用 RT Core 负责光线遍历和求交。':'数据中心计算单元没有专用 RT Core。'}`:'调度器将线程分配到算术通路，片上存储让协作发生在更近的地方。'}
  ];
  const labels=[
    {id:'fan',stage:1,title:datacenter?presentation.fan:'外壳与风扇',text:presentation.fanText,side:'left'},
    {id:'cooler',stage:1,title:modern?'鳍片与均热板':presentation.cooler,text:datacenter?'将封装热量传向服务器气流':'热传导与对流共同完成散热',side:'right'},
    {id:'board',stage:1,title:modern?'紧凑分体 PCB':'PCB 电路板',text:'供电、信号与存储器在这里相连',side:'left'},
    {id:'boardGpu',stage:2,title:`${m.chip} GPU 封装`,text:'保留在 PCB 上的计算核心',side:'right'},
    {id:'boardMemory',stage:2,title:`${m.memoryType} 显存`,text:`${m.memory} · ${datacenter?'与 GPU 同处封装区域':'围绕 GPU 排布'}`,side:'left'},
    {id:'boardPower',stage:2,title:'供电电路',text:'为 GPU 与显存提供稳定电源',side:'right'},
    {id:'die',stage:3,title:`${m.chip} 裸片`,text:`${m.transistors}B 晶体管 · ${m.process}`,side:'right'},
    {id:'memory',stage:3,title:`${m.memoryType} 显存`,text:`${m.memory} · ${fmt(m.bandwidth)} GB/s`,side:'left'},
    {id:'substrate',stage:3,title:'芯片封装基板',text:'密集互连，将硅片连接到 PCB',side:'right'},
    {id:'gpc',stage:4,title:m.id==='tesla'?'TPC 处理簇':'GPC 计算簇',text:modern?'12 个 GPC / 192 个 SM（完整 GB202）':`${m.fullSm} 个 ${m.smLabel}（完整芯片）`,side:'left'},
    {id:'l2',stage:4,title:m.id==='tesla'?'纹理缓存':'共享 L2 缓存',text:modern?'完整芯片 128 MB · RTX 5090 启用 96 MB':'在计算单元与显存之间复用数据',side:'right'},
    {id:'memoryController',stage:4,title:'显存控制器',text:modern?'512-bit GDDR7 接口':'负责芯片与外部存储的数据传输',side:'right'},
    {id:'cuda',stage:5,title:m.coreLabel,text:`${Math.round(m.cores/m.sm)} 核心 / ${m.smLabel} · 执行基础算术`,side:'left'},
    ...(m.tensorGeneration?[{id:'tensor',stage:5,title:'Tensor Core',text:`第 ${m.tensorGeneration} 代 · ${tensorCount} 个 / ${m.smLabel}`,side:'right'}]:[]),
    ...(m.rtGeneration?[{id:'rt',stage:5,title:'RT Core',text:`第 ${m.rtGeneration} 代 · 光线遍历与求交`,side:'right'}]:[]),
    ...(m.id==='hopper'?[{id:'tma',stage:5,title:'TMA 数据搬运',text:'异步搬运多维张量，减少线程参与',side:'right'}]:[]),
    {id:'cache',stage:5,title:'寄存器与共享存储',text:modern?'256 KB 寄存器 · 128 KB L1 / 共享存储':'为线程执行与协作提供片上数据',side:'left'}
  ];
  useEffect(()=>{
    const update=(p)=>{
      progressRef.current=p;
      const chapter=activeChapter(p);
      setActive(prev=>prev===chapter?prev:chapter);
      pin.current?.style.setProperty('--story-progress',p);
      if(!hudRef.current)return;
      hudRef.current.querySelectorAll('[data-scene]').forEach((el,i)=>{
        const start=i===0?null:STORY_BOUNDARIES[i-1];
        const end=i===chapters.length-1?null:STORY_BOUNDARIES[i];
        const alpha=(start===null?1:smooth(start-.025,start+.025,p))*(end===null?1:1-smooth(end-.025,end+.025,p));
        el.style.opacity=alpha;
        el.style.visibility=alpha>.01?'visible':'hidden';
        el.style.transform=`translate3d(0,${(1-alpha)*24}px,0)`;
        el.setAttribute('aria-hidden',i===chapter?'false':'true');
      });
    };
    update(scrollYProgress.get());
    return scrollYProgress.on('change',update);
  },[scrollYProgress,generation.id]);
  const jump=(p)=>{
    if(!container.current)return;
    const b=container.current.getBoundingClientRect();
    const start=window.scrollY+b.top;
    window.scrollTo({top:start+p*(container.current.offsetHeight-window.innerHeight),behavior:reduced?'instant':'smooth'});
  };
  const openWorkbench=(view)=>{
    if(entryTarget.current||flatView)return;
    setManual(false);setPickerOpen(false);setToolsOpen(false);
    if(reduced){setFlatView(view);return;}
    entryTarget.current=view;setEnteringView(view);
    entryTimer.current=window.setTimeout(()=>{
      setFlatView(view);entryTarget.current=null;entryTimer.current=null;
    },420);
  };
  const closeWorkbench=()=>{
    setFlatView(null);setEnteringView(null);
    if(reduced){setReturningView(false);return;}
    clearTimeout(returnTimer.current);
    setReturningView(true);
    returnTimer.current=window.setTimeout(()=>{setReturningView(false);returnTimer.current=null;},420);
  };
  useEffect(()=>()=>{clearTimeout(entryTimer.current);clearTimeout(returnTimer.current);},[]);
  useEffect(()=>{
    if(!enteringView||flatView)return;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=overflow;};
  },[enteringView,flatView]);
  const placeLabels=({points})=>{
    const width=window.innerWidth,height=window.innerHeight,mobile=width<768;
    const labelWidth=mobile?112:Math.min(174,width*.13);
    const docks={fan:['left',-.16],cooler:['right',-.11],board:['left',.08],boardGpu:['right',-.18],boardMemory:['left',-.03],boardPower:['right',.13],die:['right',-.14],memory:['left',-.06],substrate:['right',.09],gpc:['left',-.11],l2:['right',.11],memoryController:['right',-.14],cuda:['left',-.13],tensor:['right',-.1],rt:['right',.08],tma:['right',.08],cache:['left',.10]};
    const mobileY={fan:.43,cooler:.47,board:.70,boardGpu:.43,boardMemory:.64,boardPower:.73,die:.44,memory:.69,substrate:.71,gpc:.43,l2:.71,memoryController:.47,cuda:.45,tensor:.48,rt:.72,tma:.72,cache:.70};
    points.forEach(point=>{
      if(point.id==='entry'&&hotspotRef.current){
        const hotspot=hotspotRef.current;
        hotspot.style.left=`${point.x}%`;hotspot.style.top=`${point.y}%`;
        hotspot.style.visibility=point.visible?'visible':'hidden';
      }
      const el=labelRefs.current[point.id];if(!el||!point.visible)return;
      const [side,offset]=docks[point.id]||['right',-.1];
      const x=point.x/100*width,y=point.y/100*height;
      const left=mobile?(side==='left'?24:width-labelWidth-24):(side==='left'?width*.43:width-labelWidth-40);
      const top=clamp(mobile?height*mobileY[point.id]:y+height*offset,mobile?height*.40:180,height-(mobile?165:235));
      const copy=el.querySelector('.label-copy'),line=el.querySelector('.label-line');
      Object.assign(copy.style,{left:`${left-x}px`,top:`${top-y}px`,right:'auto',bottom:'auto',width:`${labelWidth}px`,textAlign:side==='left'?'left':'right'});
      const endX=left<x?left+labelWidth:left,endY=top+9;
      Object.assign(line.style,{left:'0',width:`${Math.hypot(endX-x,endY-y)}px`,transform:`rotate(${Math.atan2(endY-y,endX-x)}rad)`});
    });
  };
  useEffect(()=>{setManual(false)},[active,generation.id]);
  useEffect(()=>{
    setReady(false);setFailed(false);
    clearTimeout(entryTimer.current);entryTarget.current=null;setEnteringView(null);
  },[generation.id]);
  useEffect(()=>()=>clearTimeout(entryTimer.current),[]);
  useEffect(()=>{
    if(!pickerOpen&&!toolsOpen)return;
    const outside=event=>{
      if(pickerOpen&&!pickerRef.current?.contains(event.target))setPickerOpen(false);
      if(toolsOpen&&!toolsRef.current?.contains(event.target))setToolsOpen(false);
    };
    const escape=event=>{
      if(event.key!=='Escape')return;
      if(pickerOpen){setPickerOpen(false);pickerButtonRef.current?.focus();}
      if(toolsOpen){setToolsOpen(false);toolsButtonRef.current?.focus();}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[pickerOpen,toolsOpen]);
  const chooseGeneration=(id,close=true)=>{
    onSelect(id);
    if(close){setPickerOpen(false);pickerButtonRef.current?.focus();}
  };
  const essentialLabels=new Set(['fan','cooler','board','boardGpu','boardMemory','boardPower','die','memory','substrate','gpc','l2','cuda',m.tensorGeneration?'tensor':'cache']);
  useEffect(()=>{progressRef.current=scrollYProgress.get()},[generation.id,scrollYProgress]);
  return <section ref={container} id="explore" className={`cinematic-story ${reduced?'reduced-story':''} generation-${m.id}`} data-generation={m.id} aria-label={`${m.name} 从整卡到 SM 的滚动探索`}>
    <div ref={pin} className={`cinema-pin cinema-stage-${active} ${enteringView?'is-entering-workbench':''} ${returningView?'is-returning-workbench':''} ${flatView?'has-workbench':''}`} inert={flatView?true:undefined}>
      <div className="generation-selector" ref={pickerRef}>
        <div className="generation-current">
          <button className="generation-arrow" aria-label="上一代架构" disabled={selectedIndex===0} onClick={()=>chooseGeneration(generations[selectedIndex-1].id,false)}><CaretLeft size={15}/></button>
          <button ref={pickerButtonRef} className="generation-trigger" aria-expanded={pickerOpen} aria-controls="cinema-generation-options" onClick={()=>{setPickerOpen(v=>!v);setToolsOpen(false);}} onKeyDown={e=>{
            if(e.key==='ArrowDown'){e.preventDefault();setPickerOpen(true);requestAnimationFrame(()=>pickerRef.current?.querySelector('[aria-selected="true"]')?.focus());}
          }}><span className="generation-counter">{String(selectedIndex+1).padStart(2,'0')} / {generations.length}</span><strong>{m.name}</strong><CaretDown size={13}/></button>
          <button className="generation-arrow" aria-label="下一代架构" disabled={selectedIndex===generations.length-1} onClick={()=>chooseGeneration(generations[selectedIndex+1].id,false)}><CaretRight size={15}/></button>
        </div>
        {<div id="cinema-generation-options" className={`generation-menu ${pickerOpen?'is-open':''}`}>
          <div className="generation-menu-heading"><span>十一代，计算的演进。</span><span>2006 — 2025</span></div>
          <div className="generation-rail" role="tablist" aria-label="切换三维架构">{generations.map((g,i)=><button type="button" key={g.id} className={`generation-choice ${g.id===m.id?'selected':''}`} role="tab" aria-selected={g.id===m.id} tabIndex={g.id===m.id?0:-1} data-generation={g.id} onClick={()=>chooseGeneration(g.id)} onKeyDown={e=>{
            const next=e.key==='ArrowRight'||e.key==='ArrowDown'?Math.min(i+1,generations.length-1):e.key==='ArrowLeft'||e.key==='ArrowUp'?Math.max(i-1,0):e.key==='Home'?0:e.key==='End'?generations.length-1:null;
            if(next!==null){e.preventDefault();chooseGeneration(generations[next].id,false);pickerRef.current?.querySelector(`[data-generation="${generations[next].id}"]`)?.focus();}
          }}><span>{g.year}</span><strong>{g.id==='ada'?'Ada Lovelace':g.name}</strong>{g.id===m.id&&<Check size={14}/>}</button>)}</div>
        </div>}
      </div>
      <span className="cinema-location" aria-hidden="true">{String(active+1).padStart(2,'0')} <i/> {chapters[active].label}</span>
      <div className="cinema-atmosphere" aria-hidden="true"><div className="cinema-light-beam"/><div className="cinema-grain"/></div>
      <div className={`cinema-renderer ${ready?'is-ready':''}`} ref={sceneRef}>
        <CinematicScene progressRef={progressRef} labelRefs={labelRefs} generation={generation} labelsVisible={labelsOn} reducedMotion={reduced} inspectMode={manual} exploreTransition={false} onOpenExplore={openWorkbench} onFrame={placeLabels} onReady={()=>setReady(true)} onError={()=>setFailed(true)} />
      </div>
      {!ready&&!failed&&<div className="cinema-loading"><div className="loading-silhouette"/><span>正在准备三维场景</span></div>}
      {failed&&<div className="cinema-error"><strong>当前环境无法显示 WebGL 场景</strong><p>架构数据和芯片图仍可在下方浏览。</p><button onClick={onArchive}>前往架构档案 <ArrowRight size={17}/></button></div>}
      <div className="cinema-hud" ref={hudRef}>{scenes.map((s,i)=><div key={`${m.id}-${i}`} data-scene={i} className={`cinema-copy cinema-copy-${i}`} style={{opacity:i===0?1:0,visibility:i===0?'visible':'hidden'}}>
        <div className="cinema-eyebrow">{s.eyebrow}</div>
        {i===0?<><h1>{s.title.split('\n').map((t,j)=><span key={j}>{t}</span>)}</h1><h2>{s.subtitle}</h2><p>{s.description}</p><dl className="cinema-hero-specs"><div><dt>晶体管</dt><dd>{m.transistors}<small>B</small></dd></div><div><dt>显存</dt><dd>{m.memory}</dd></div><div><dt>核心</dt><dd>{fmt(m.cores)}</dd></div></dl><button className="cinema-scroll-cue" onClick={()=>jump(chapters[1].at)}><span><ArrowDown size={18}/><CaretDown size={12}/></span><span>向下滚动<small>探索更深的层次</small></span></button></>:<><h2>{s.title.split('\n').map((t,j)=><span key={j}>{t}</span>)}</h2><h3>{s.subtitle}</h3><p>{s.description}</p></>}
      </div>)}</div>
      <div className={`cinema-labels ${labelsOn?'':'labels-hidden'} ${allLabels?'labels-all':''}`} aria-label="模型部件标注">{labels.map(l=><div key={l.id} ref={el=>{labelRefs.current[l.id]=el}} data-label={l.id} data-stage={l.stage} data-essential={essentialLabels.has(l.id)} className={`cinema-label label-${l.side}`} style={{opacity:0}}><span className="label-anchor"/><span className="label-line"/><div className="label-copy"><strong>{l.title}</strong><span>{l.text}</span></div></div>)}</div>
      {!manual&&<div ref={hotspotRef} className={`cinema-chip-hotspot ${active===0?'overview-hotspot':''}`} style={{visibility:'hidden'}}><button className="chip-hotspot-point" aria-label="点击芯片进入详细俯视工作台" onClick={()=>openWorkbench(active===5?'sm':'chip')}><Plus size={16}/></button><span className="chip-hotspot-leader"/><button className="chip-hotspot-caption" onClick={()=>openWorkbench(active===5?'sm':'chip')}><i/>{active===5?'探索 SM 内部':'点击进入芯片细节'}<ArrowRight size={14}/></button></div>}
      <button className="cinema-scene-note" onClick={onSources}>{active<3?`${m.card} · 外观参考重建`:active===3?'封装与互连 · 结构可视化':'依据公开架构重建 · 非真实晶体管版图'}</button>
      {active>=3&&!manual&&<button className="cinema-click-hint" disabled={Boolean(enteringView)} onClick={()=>openWorkbench(active===5?'sm':'chip')}><span className="detail-orbit"><Plus size={17}/></span><span>点击{active===5?m.smLabel:'芯片'}，查看细节</span></button>}
      <div className="cinema-controls" ref={toolsRef}>
        {active>=4&&<button className="cinema-flat-open" onClick={()=>openWorkbench(active===4?'chip':'sm')}><ArrowsOut size={15}/>放大平铺</button>}
        <button ref={toolsButtonRef} className={`cinema-tools-trigger ${toolsOpen?'active':''}`} aria-label="观察选项" aria-expanded={toolsOpen} aria-controls="cinema-observe-options" onClick={()=>{setToolsOpen(v=>!v);setPickerOpen(false);}}><SlidersHorizontal size={18}/></button>
        {toolsOpen&&<div className="cinema-tools-menu" id="cinema-observe-options"><span className="cinema-tools-heading">观察选项</span><button aria-pressed={labelsOn} onClick={()=>setLabelsOn(v=>!v)}>{labelsOn?<Minus size={15}/>:<Plus size={15}/>}<span>{labelsOn?'隐藏标注':'显示标注'}</span>{labelsOn&&<Check size={14}/>}</button><button aria-pressed={allLabels} onClick={()=>{setLabelsOn(true);setAllLabels(v=>!v);}}><GridFour size={15}/><span>全部部件标注</span>{allLabels&&<Check size={14}/>}</button><button className={manual?'active':''} aria-pressed={manual} onClick={()=>{setManual(v=>!v);setToolsOpen(false);}}><ArrowsOut size={15}/><span>{manual?'继续滚动镜头':'自由观察'}</span>{manual&&<Check size={14}/>}</button></div>}
      </div>
      {manual&&<div className="cinema-inspect-status"><span>拖动模型，自由观察</span><button onClick={()=>setManual(false)}>完成</button></div>}
      <div className="cinema-breadcrumb"><button onClick={()=>jump(chapters[Math.max(0,active-1)].at)}><CaretLeft size={14}/> 返回</button><i/> <span>{m.name}</span><b>/</b><span>{m.chip}</span><b>/</b><span>{chapters[active].label}</span></div><div className="cinema-bottom"><nav className="cinema-chapters" aria-label="跳转到展示层级">{chapters.map((c,i)=><button key={c.id} onClick={()=>jump(c.at)} className={active===i?'active':''} aria-current={active===i?'step':undefined}><c.icon size={17} weight={active===i?'fill':'regular'}/><span>{c.label}</span></button>)}</nav><button className="cinema-next" onClick={()=>active<chapters.length-1?jump(chapters[active+1].at):onArchive()}><span>{active<chapters.length-1?'继续深入':'架构档案'}</span><ArrowDown size={16}/></button></div>
      <div className="cinema-workbench-transition" aria-hidden="true"/>
      <div className="cinema-stage-footer"><span>GPU ATLAS <i/> 让复杂的计算，看得见。</span><span>探索 · 学习 · 理解 · 更进一步</span></div><div className="cinema-progress"><i/></div>
    </div>
    {flatView&&<MicroWorkbench generation={generation} generations={generations} initialView={flatView} onSelectGeneration={onSelect} onClose={closeWorkbench}/>}
  </section>;
}
