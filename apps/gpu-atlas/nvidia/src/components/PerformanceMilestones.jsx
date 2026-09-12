import { useId } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, BookOpen, CirclesFour, Cpu, Cube } from '@phosphor-icons/react';
import generations from '../data/generations.json';
import { useMotionPreference } from '../hooks/useMotionPreference.js';
import researchChip from '../assets/milestones/library-chip-macro.webp';
import './PerformanceMilestones.css';

const milestones = [
  { id: 'tesla', year: 2006, name: '统一着色', architecture: 'Tesla', Icon: CirclesFour, description: '让顶点与像素着色共享计算资源，CUDA 随后打开 GPU 通用计算的大门，开启了可编程计算的新时代。', tags: ['统一架构', '可编程渲染', 'CUDA'] },
  { id: 'volta', year: 2017, name: '矩阵计算', architecture: 'Volta', Icon: Cpu, description: '第一代 Tensor Core 将矩阵乘加交给专用硬件，成为深度学习的重要转折，大幅提升 AI 训练与推理的效率。', tags: ['Tensor Core', '混合精度', 'AI 加速'] },
  { id: 'turing', year: 2018, name: '实时光追', architecture: 'Turing', Icon: Cube, description: 'RT Core 加速光线遍历与求交，专用硬件让实时光线追踪成为新的渲染路径，带来更真实的虚拟世界。', tags: ['RT Core', '实时渲染', '沉浸式体验'] },
];
const firstYear = Math.min(...generations.map(g => g.year));
const lastYear = Math.max(...generations.map(g => g.productYear));

function Horizon() {
  const id=useId().replace(/:/g,'');
  return <svg className="mc-horizon" viewBox="0 0 760 260" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#18282b"/><stop offset=".48" stopColor="#0a1418"/><stop offset="1" stopColor="#080f12" stopOpacity="0"/></linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" x2="1"><stop stopColor="#7da5ad" stopOpacity="0"/><stop offset=".34" stopColor="#b7e5de" stopOpacity=".55"/><stop offset=".58" stopColor="#d2f4ea"/><stop offset=".81" stopColor="#86b2bc" stopOpacity=".45"/><stop offset="1" stopColor="#6e949f" stopOpacity="0"/></linearGradient>
      <radialGradient id={`${id}-aura`}><stop stopColor="#a9dedb" stopOpacity=".25"/><stop offset=".43" stopColor="#78aebc" stopOpacity=".11"/><stop offset="1" stopColor="#52747d" stopOpacity="0"/></radialGradient>
      <filter id={`${id}-glow`} x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>
      <pattern id={`${id}-traces`} width="41" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(7)"><path d="M1 1h25m-11 4h24M6 8h17" stroke="#9ab4b3" strokeWidth=".45" opacity=".09"/></pattern>
      <clipPath id={`${id}-clip`}><path d="M-40 113Q345 40 790 298H-40Z"/></clipPath>
    </defs>
    <ellipse cx="306" cy="99" rx="344" ry="80" fill={`url(#${id}-aura)`}/>
    <path d="M-40 113Q345 40 790 298H-40Z" fill={`url(#${id}-surface)`}/>
    <rect x="-20" y="90" width="800" height="170" fill={`url(#${id}-traces)`} clipPath={`url(#${id}-clip)`}/>
    {[0,1,2,3,4,5,6].map(i=><path key={i} d={`M-40 ${116+i*3.7}Q345 ${46+i*3.2} 790 ${299+i*2.5}`} fill="none" stroke="#8cb3bb" strokeWidth=".5" opacity={.09-i*.009}/>)}
    <path d="M-40 113Q345 40 790 298" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="11" opacity=".55" filter={`url(#${id}-glow)`}/>
    <path d="M-40 113Q345 40 790 298" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1.55"/>
  </svg>;
}

export default function PerformanceMilestones({ onSources, onArchive }) {
  const reduced=useMotionPreference();
  return <section id="milestones" className="milestone-chapter" aria-labelledby="milestones-title">
    <div className="mc-layout">
      <div className="mc-introduction">
        <span className="mc-eyebrow">MORE THAN MOORE’S LAW</span>
        <h2 id="milestones-title">改变的，<br/>不只是晶体管数量。</h2>
        <p className="mc-lead">三次范式转变，让 GPU 从图形处理器，演进为通用的加速计算引擎。每一代架构都在重新定义可能，推动计算的边界不断向前。</p>
        <button className="mc-source-link" onClick={onSources}>阅读架构原始资料<ArrowUpRight size={17}/></button>
        <dl className="mc-stats"><div><dt>次架构范式转变</dt><dd>3</dd></div><div title={`${firstYear}–${lastYear}`}><dt>年的持续进化</dt><dd>{lastYear-firstYear}</dd></div></dl>
        <p className="mc-outlook">从图形，到 AI，再到更广阔的计算未来。<br/>这是一段关于加速的故事，也是一段关于想象力的旅程。</p>
        <Horizon/>
        <span className="mc-horizon-caption">ACCELERATING A BRIGHTER TOMORROW.</span>
      </div>
      <ol className="mc-timeline" aria-label="GPU 架构的三次范式转变">
        {milestones.map(({id,year,name,architecture,Icon,description,tags},index)=><li key={id} className="mc-stop">
          <time className="mc-year" dateTime={String(year)}>{year}</time><span className="mc-node" aria-hidden="true"/>
          <motion.button type="button" className="mc-event" initial={reduced?false:{opacity:0,y:18}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.2}} transition={{duration:.65,delay:index*.06,ease:[.16,1,.3,1]}} onClick={()=>onArchive(id)} aria-label={`探索 ${architecture}：${name}`}>
            <div className="mc-event-heading"><span className="mc-event-icon"><Icon size={29} weight="regular" aria-hidden="true"/></span><div><h3>{name}</h3><span>{architecture}</span></div><ArrowRight className="mc-event-arrow" size={20} aria-hidden="true"/></div>
            <p>{description}</p><div className="mc-tags" aria-label="关键能力">{tags.map(tag=><span key={tag}>{tag}</span>)}</div>
          </motion.button>
        </li>)}
      </ol>
    </div>
    <div className="mc-resource" aria-labelledby="mc-resource-title">
      <img className="mc-resource-image" src={researchChip} alt="" aria-hidden="true" draggable="false"/>
      <div className="mc-resource-copy"><span className="mc-eyebrow">GO DEEPER</span><h3 id="mc-resource-title"><span>好奇心，</span><span>值得深入一层。</span></h3><p>从 Tesla 到 Blackwell，继续阅读 NVIDIA 官方架构白皮书。</p><button onClick={onSources}><BookOpen size={26} weight="light" aria-hidden="true"/>打开资料库<ArrowRight size={20} aria-hidden="true"/></button></div>
    </div>
  </section>;
}
