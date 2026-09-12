import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, CaretDown, CaretLeft, CaretRight, Check, EyeSlash, ListBullets, SidebarSimple, SquaresFour } from '@phosphor-icons/react';
import { ARCHITECTURE_FACTS } from '../data/architectureFacts.js';
import { MICRO_PALETTE, microRegion } from './cinematic/microPalette.js';

const regionStyle = (id, view) => ({ '--region-accent': MICRO_PALETTE[microRegion(id, view)].accent });

export default function MicroInspector({ generation, view, items, active, currentRegion, hidden, onFocus, onToggleHidden, onDrill, collapsed, onToggleCollapsed }) {
  const [expanded, setExpanded] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const index = Math.max(0, items.findIndex(item => item.id === active.id));
  const viewLabel = view === 'chip' ? '芯片架构' : `${generation.smLabel} 内部`;
  const scope = currentRegion?.localScope || (view === 'sm' ? `当前 ${generation.smLabel}` : '当前芯片区域');
  useEffect(() => setExpanded(false), [active.id, generation.id, view]);

  if (collapsed) return <button className="micro-inspector-restore" onClick={onToggleCollapsed} aria-label="显示结构说明" aria-expanded="false"><SidebarSimple size={18}/><span>结构说明</span></button>;

  const move = direction => onFocus(items[(index + direction + items.length) % items.length].id);
  return <aside className="micro-inspector" aria-label="所选结构与目录">
    <article className={`micro-explanation ${expanded ? 'is-expanded' : ''}`} data-region={active.id} data-region-key={currentRegion?.key || ''} style={regionStyle(active.id, view)}>
      <div className="micro-inspector-topbar">
        <span className="micro-explanation-icon" aria-hidden="true"><SquaresFour size={28} weight="duotone"/></span>
        <span className="micro-inspector-level">{viewLabel}</span>
        <div className="micro-inspector-pager">
          <span aria-label={`第 ${index + 1} 项，共 ${items.length} 项`}>{index + 1} <i>/</i> {items.length}</span>
          <button onClick={() => move(-1)} aria-label="上一个结构"><CaretLeft size={17}/></button>
          <button onClick={() => move(1)} aria-label="下一个结构"><CaretRight size={17}/></button>
        </div>
        <button className="micro-inspector-collapse" onClick={onToggleCollapsed} aria-label="收起结构说明" aria-expanded="true" title="收起结构说明"><SidebarSimple size={17}/></button>
      </div>

      <div className="micro-explanation-heading" aria-live="polite"><h3>{active.name}</h3></div>
      <p id="micro-active-description" className="micro-module-description">{active.text}</p>
      <button className="micro-info-toggle" aria-expanded={expanded} aria-controls="micro-active-description" onClick={() => setExpanded(value => !value)}>{expanded ? '收起说明' : '查看完整说明'}{expanded ? <CaretDown size={16}/> : <ArrowRight size={17}/>}</button>

      <dl className="micro-inspector-facts" aria-live="polite">
        <div className="micro-parameter-row"><dt>所属架构</dt><dd>{generation.name} <span>({generation.chip})</span></dd></div>
        <div className="micro-parameter-row"><dt>当前选区</dt><dd><span className="micro-explanation-value">{currentRegion?.localValue || active.value}</span></dd></div>
        {currentRegion && <div className="micro-parameter-row"><dt>所在位置</dt><dd className="micro-selection-context"><span>{scope}{currentRegion.partition ? ` · 分区 ${currentRegion.partition}` : ''}</span><code>{currentRegion.label}</code></dd></div>}
        {view === 'sm' && <div className="micro-parameter-row micro-total-value"><dt><span>整个 {generation.smLabel}</span></dt><dd><strong>{active.value}</strong></dd></div>}
      </dl>

      {view === 'chip' && <button className="micro-drill-button" onClick={() => onDrill({ cluster: 1, unit: 1 })}>进入 {generation.smLabel} 内部 <ArrowUpRight size={17}/></button>}

      <details className="micro-directory" open={directoryOpen} onToggle={event => setDirectoryOpen(event.currentTarget.open)}>
        <summary><span><ListBullets size={18}/>结构目录与标签</span><small>{items.length} 项</small><CaretDown size={15}/></summary>
        <div className="micro-inspector-heading"><span>选择区域以放大查看</span><small>标签独立开关</small></div>
        <div className="micro-label-list">{items.map((item, itemIndex) => <div className={`micro-label-row ${active.id === item.id ? 'selected' : ''}`} key={item.id} style={regionStyle(item.id, view)}>
          <button className="micro-detail-select" onClick={() => onFocus(item.id)} aria-pressed={active.id === item.id}><span>{String(itemIndex + 1).padStart(2, '0')}</span><strong>{item.name}<small>{item.value}</small></strong></button>
          <button className="micro-visibility" aria-label={`${hidden.has(item.id) ? '显示' : '隐藏'}${item.name}标签`} aria-pressed={!hidden.has(item.id)} onClick={() => onToggleHidden(item.id)}>{hidden.has(item.id) ? <EyeSlash size={18}/> : <Check size={18}/>}</button>
        </div>)}</div>
      </details>
      <details className="micro-evidence"><summary>对应白皮书与资料<CaretDown size={14}/></summary>{ARCHITECTURE_FACTS[generation.id].sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={15}/></a>)}</details>
    </article>
  </aside>;
}
