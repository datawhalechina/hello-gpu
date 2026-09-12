import { useId } from 'react';
import generations from '../data/generations.json';
import './ArchivePreviewArt.css';

const sequence = (length) => Array.from({ length }, (_, index) => index);

function Materials({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" y1="0" x2=".85" y2="1">
        <stop stopColor="#748382" /><stop offset=".14" stopColor="#283b3d" />
        <stop offset=".38" stopColor="#0d181c" /><stop offset=".65" stopColor="#18262a" />
        <stop offset=".89" stopColor="#0b1417" /><stop offset="1" stopColor="#4f6262" />
      </linearGradient>
      <linearGradient id={`${id}-tile`} x1=".05" y1="0" x2=".9" y2="1">
        <stop stopColor="#334347" /><stop offset=".34" stopColor="#203034" />
        <stop offset=".72" stopColor="#142226" /><stop offset="1" stopColor="#091518" />
      </linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2=".2">
        <stop stopColor="#6b8a83" /><stop offset=".35" stopColor="#253b3c" />
        <stop offset=".72" stopColor="#103133" /><stop offset="1" stopColor="#54716a" />
      </linearGradient>
      <linearGradient id={`${id}-silicon`} x1="0" y1="0" x2=".6" y2="1">
        <stop stopColor="#769447" /><stop offset=".45" stopColor="#3e643b" />
        <stop offset="1" stopColor="#243e2e" />
      </linearGradient>
      <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#1c2c31" /><stop offset=".27" stopColor="#18262b" />
        <stop offset=".7" stopColor="#101a1f" /><stop offset="1" stopColor="#080f13" />
      </linearGradient>
      <linearGradient id={`${id}-trace`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#587e7b" /><stop offset=".5" stopColor="#a0d2c2" />
        <stop offset="1" stopColor="#e0f4e9" />
      </linearGradient>
      <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#84c5ad" stopOpacity=".13" />
        <stop offset="1" stopColor="#84c5ad" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-aura`}>
        <stop stopColor="#96d8c0" stopOpacity=".22" />
        <stop offset="1" stopColor="#78c2b0" stopOpacity="0" />
      </radialGradient>
      <pattern id={`${id}-etch`} width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 1H8 M1 0V8" stroke="#d4ebcf" strokeWidth=".4" opacity=".26" />
        <path d="M3 3h3v3H3z" fill="none" stroke="#acc689" strokeWidth=".45" opacity=".48" />
      </pattern>
      <pattern id={`${id}-brushed`} width="3" height="5" patternUnits="userSpaceOnUse">
        <path d="M.5 0V5" stroke="#c6ded8" strokeWidth=".35" opacity=".12" />
      </pattern>
      <pattern id={`${id}-grid`} width="39" height="32" patternUnits="userSpaceOnUse">
        <path d="M39 0H0V32" fill="none" stroke="#668c8d" strokeWidth=".6" opacity=".2" />
        <circle cx="0" cy="0" r="1" fill="#70948f" opacity=".3" />
      </pattern>
      <filter id={`${id}-glow`} x="-150%" y="-150%" width="400%" height="400%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="12" />
      </filter>
    </defs>
  );
}

function TopologyArt({ id, gpu }) {
  // This is a decorative logical arrangement. Counts come from the complete
  // silicon data; neither positions nor areas claim to depict a physical die.
  const clusters = gpu.fullClusters || gpu.fullGpc || gpu.gpc || 1;
  const units = gpu.fullChipSm || gpu.fullSm || gpu.sm || 1;
  const columns = clusters >= 8 ? 4 : clusters === 6 ? 3 : 2;
  const rows = Math.ceil(clusters / columns);
  const cellWidth = 286 / columns;
  const cellHeight = 156 / rows;
  return (
    <>
      <ellipse cx="316" cy="181" rx="225" ry="53" fill="#000" opacity=".75" filter={`url(#${id}-soft)`} />
      <path d="M60 211 156 17 563 56" fill="none" stroke="#335258" strokeWidth="1" opacity=".6" />
      <path d="M25 221 140 1 588 52" fill="none" stroke="#456367" strokeWidth=".5" opacity=".35" />
      <g transform="matrix(.98 .11 -.47 .78 174 7)">
        <rect x="-5" y="12" width="405" height="269" rx="3" fill="#040b0e" stroke="#192a2e" strokeWidth="3" />
        <rect width="395" height="268" rx="3" fill={`url(#${id}-metal)`} stroke="#587377" strokeWidth="1.2" />
        <rect x="3" y="3" width="389" height="262" rx="2" fill={`url(#${id}-brushed)`} />
        <path d="M7 256V7H388 M18 251V17H376" fill="none" stroke="#a1b5ad" strokeWidth=".75" opacity=".5" />
        <rect x="29" y="20" width="337" height="232" fill="#070e11" stroke="#506955" strokeWidth="1.2" />
        <rect x="38" y="28" width="319" height="214" fill="#152720" stroke="#758459" strokeWidth=".7" />
        <path d="M43 31H350V237H43Z" fill="none" stroke="#bfd59a" strokeWidth=".5" opacity=".48" />
        {sequence(19).map((index) => (
          <g key={`contact-${index}`} opacity={index % 3 === 0 ? '.8' : '.4'}>
            <rect x={49 + index * 15.5} y="35" width="8" height="5" fill="#89976a" />
            <rect x={49 + index * 15.5} y="229" width="8" height="5" fill="#8b9b6b" />
          </g>
        ))}
        {sequence(clusters).map((cluster) => {
          const count = Math.floor(units / clusters) + (cluster < units % clusters ? 1 : 0);
          const tileColumns = Math.ceil(Math.sqrt(count * cellWidth / cellHeight));
          const tileRows = Math.ceil(count / tileColumns);
          const tileWidth = (cellWidth - 12) / tileColumns;
          const tileHeight = (cellHeight - 11) / tileRows;
          return (
            <g key={cluster} transform={`translate(${52 + (cluster % columns) * cellWidth} ${48 + Math.floor(cluster / columns) * cellHeight})`}>
              <rect width={cellWidth - 5} height={cellHeight - 5} fill="#1d3227" stroke="#7b965b" strokeWidth=".65" />
              {sequence(count).map((unit) => (
                <g key={unit}>
                  <rect x={3 + unit % tileColumns * tileWidth} y={3 + Math.floor(unit / tileColumns) * tileHeight} width={tileWidth - 1.4} height={tileHeight - 1.6} fill={`url(#${id}-silicon)`} stroke="#93ad65" strokeWidth=".35" />
                  <rect x={3 + unit % tileColumns * tileWidth} y={3 + Math.floor(unit / tileColumns) * tileHeight} width={tileWidth - 1.4} height={tileHeight - 1.6} fill={`url(#${id}-etch)`} />
                </g>
              ))}
            </g>
          );
        })}
        <rect x="52" y="207" width="281" height="14" fill="#273e34" stroke="#6f8b6d" strokeWidth=".5" />
        <path d="M56 211H329 M56 215H329 M56 218H329" stroke="#a8bc81" strokeWidth=".5" opacity=".5" />
        {sequence(4).map((index) => (
          <g key={index} transform={`translate(${index % 2 ? 383 : 12} ${index < 2 ? 12 : 254})`}>
            <circle r="3.2" fill="#081214" stroke="#859c83" strokeWidth=".8" />
            <path d="M-1.8 0h3.6" stroke="#b4c6a3" strokeWidth=".7" />
          </g>
        ))}
        <text x="194" y="16" fill="#9eb1a5" fontSize="6" letterSpacing="3" textAnchor="middle">{gpu.chip}</text>
      </g>
      <ellipse cx="293" cy="84" rx="170" ry="90" fill={`url(#${id}-aura)`} opacity=".33" />
    </>
  );
}

function ComputeArt({ id, gpu }) {
  const tiles = sequence(20).map((index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return { index, column, row, x: column * 88 + row * 81 - 191, y: row * 46 - column * 51 + 139 };
  }).sort((a, b) => a.y - b.y);
  return (
    <>
      <g opacity=".35" stroke="#345255" strokeWidth=".8" fill="none">
        {sequence(8).map((line) => <path key={line} d={`M${-170 + line * 93} 245l530 -306`} />)}
        {sequence(7).map((line) => <path key={line} d={`M${-205 + line * 83} -50l585 315`} />)}
      </g>
      {tiles.map(({ index, column, row, x, y }) => {
        const active = row === 2 && column > 0 && column < 4;
        return (
          <g key={index} transform={`translate(${x} ${y})`}>
            <path d="M-4 18 71-26 154 17 74 66Z" fill="#000" opacity=".72" />
            <path d="M0 0 70 37 70 51 0 14Z" fill="#0a1518" stroke="#223a3c" strokeWidth=".8" />
            <path d="M70 37 142-5 142 9 70 51Z" fill={active ? '#253f30' : '#0a1417'} stroke="#263e3e" strokeWidth=".8" />
            <path d="M0 0 72-42 142-5 70 37Z" fill={`url(#${id}-tile)`} stroke={`url(#${id}-edge)`} strokeWidth="1.15" />
            <path d="M8 0 73-36 132-5 69 31Z" fill="none" stroke="#7a9290" strokeOpacity=".3" strokeWidth=".7" />
            <path d="M9 1 69 32 M73-36 132-5" fill="none" stroke="#b1c9bd" strokeOpacity=".36" strokeWidth=".7" />
            <path d="M16 0 49-19 M21 3 54-16 M26 6 59-13" stroke="#81968e" strokeWidth=".6" opacity=".18" />
            <path d="M92-12 108-3 M94-8 104-2 M90-7 102 0" stroke="#8ca29c" strokeWidth=".8" opacity=".5" />
            <circle cx="68" cy="23" r="1.1" fill="#89a49b" opacity=".65" />
            {active && <>
              <path d="M76 36 133 3" stroke="#9fdbad" strokeWidth="5" opacity=".6" filter={`url(#${id}-glow)`} />
              <path d="M78 37 131 6" stroke="#a9d8ad" strokeWidth="2.4" />
              <path d="M80 38 128 10" stroke="#d8efbf" strokeWidth="1" />
              <path d="M117 17v24l-23 14" fill="none" stroke="#7ab997" strokeWidth="1.2" opacity=".8" />
              <path d="M121 15v28L98 57" fill="none" stroke="#548f82" strokeWidth=".55" opacity=".65" />
            </>}
            {index === 12 && <text transform="matrix(.87 .48 -.88 .5 54 1)" fill="#adbbb6" fontSize="8" letterSpacing="1.1">{gpu.smLabel || 'SM'}</text>}
          </g>
        );
      })}
      <ellipse cx="313" cy="178" rx="210" ry="60" fill={`url(#${id}-aura)`} opacity=".35" />
    </>
  );
}

function PerformanceArt({ id, gpu }) {
  const data = generations.filter((item) => Number.isFinite(item.transistors));
  const maximum = Math.ceil(Math.max(...data.map((item) => item.transistors)) / 20) * 20;
  const points = data.map((item, index) => ({ ...item, x: 53 + index * 49.7, y: 191 - item.transistors / maximum * 158 }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const selected = points.find((point) => point.id === gpu.id) || points.at(-1);
  return (
    <>
      <rect x="30" y="17" width="553" height="181" fill={`url(#${id}-grid)`} />
      <path d="M38 29V197H578" fill="none" stroke="#648784" strokeWidth=".7" opacity=".3" />
      <path d={`${path} L550,197 L53,197 Z`} fill={`url(#${id}-area)`} />
      <path d={path} fill="none" stroke={`url(#${id}-trace)`} strokeWidth="1.4" strokeLinejoin="round" />
      <path d={`M${selected.x} ${selected.y}V197`} fill="none" stroke="#8ac1ad" strokeWidth=".6" strokeDasharray="2 5" opacity=".36" />
      {points.map((point) => <circle key={point.id} cx={point.x} cy={point.y} r="3.3" fill={point.id === selected.id ? '#e5fff0' : '#9ebfb4'} />)}
      <circle cx={selected.x} cy={selected.y} r="16" fill="#87debb" opacity=".4" filter={`url(#${id}-glow)`} />
      <circle cx={selected.x} cy={selected.y} r="6.3" fill="#deffec" />
      <circle cx={selected.x} cy={selected.y} r="3" fill="#f5fff9" />
      <text x="52" y="34" fill="#8ea7a3" fontSize="8" letterSpacing="2.3">TRANSISTORS / B</text>
      <text x={Math.min(selected.x + 12, 510)} y={Math.max(selected.y - 12, 24)} fill="#b2cfc1" fontSize="9" letterSpacing=".8">{selected.transistors} B</text>
      <text x="52" y="214" fill="#64817c" fontSize="8" letterSpacing="1.5">{data[0].year}</text>
      <text x="552" y="214" fill="#64817c" fontSize="8" letterSpacing="1.5" textAnchor="end">{data.at(-1).year}</text>
    </>
  );
}

function DocumentsArt({ id, gpu }) {
  return (
    <>
      <path d="M525 159 620 56 M548 177 637 89" fill="none" stroke="#527071" strokeWidth="1" opacity=".23" />
      <ellipse cx="337" cy="199" rx="245" ry="46" fill="#000" opacity=".8" filter={`url(#${id}-soft)`} />
      <g transform="matrix(.93 -.12 .35 .87 24 81)">
        <rect x="0" y="0" width="430" height="264" fill="#0b1318" stroke="#294046" />
        <rect x="5" y="5" width="420" height="251" fill={`url(#${id}-paper)`} />
      </g>
      <g transform="matrix(.95 -.09 .3 .9 75 63)">
        <rect x="0" y="0" width="407" height="270" fill="#101b20" stroke="#385058" strokeWidth=".8" />
        <path d="M7 5H398V257" fill="none" stroke="#759089" opacity=".2" strokeWidth=".7" />
        <path d="M373 29H394 M380 34H394 M375 39H394" stroke="#547069" opacity=".3" />
      </g>
      <g transform="matrix(.93 -.115 .27 .91 87 42)">
        <rect x="2" y="6" width="358" height="268" fill="#040a0e" stroke="#101e23" strokeWidth="2" />
        <path d="M358 2v267l5 5V8Z" fill="#29363a" />
        <rect width="358" height="266" fill={`url(#${id}-paper)`} stroke="#637c7e" strokeWidth=".9" />
        <rect x="5" y="5" width="348" height="256" fill={`url(#${id}-brushed)`} opacity=".32" />
        <path d="M15 1v263 M16 1v263" stroke="#3f5459" strokeWidth=".8" opacity=".6" />
        <path d="M19 1H355V262" fill="none" stroke="#9db2af" strokeWidth=".4" opacity=".35" />
        <path d="M62 51v153" stroke="#69b3a4" strokeWidth="1.2" opacity=".65" />
        <text x="82" y="66" fill="#e0e9e4" fontSize="16" fontWeight="500" letterSpacing="1.7">GPU</text>
        <text x="82" y="88" fill="#e0e9e4" fontSize="16" fontWeight="500" letterSpacing="1.4">ARCHITECTURE</text>
        <text x="83" y="113" fill="#77918c" fontSize="7" letterSpacing="1.4">{gpu.name.toUpperCase()} / {gpu.chip}</text>
        {sequence(10).map((line) => <path key={line} d={`M83 ${130 + line * 8}h${line % 4 === 3 ? 129 : 197 - line % 3 * 11}`} stroke="#608079" strokeWidth=".65" opacity={line < 5 ? '.4' : '.24'} />)}
        <path d="M83 225h36" stroke="#98bda8" strokeWidth="1.4" opacity=".6" />
      </g>
      <ellipse cx="311" cy="69" rx="200" ry="68" fill={`url(#${id}-aura)`} opacity=".19" />
    </>
  );
}

/** Decorative covers; the containing archive link supplies the accessible name. */
export default function ArchivePreviewArt({ kind, generation }) {
  const uniqueId = useId();
  const id = `archive-art-${uniqueId.replaceAll(':', '')}`;
  const provided = typeof generation === 'object' && generation !== null ? generation : null;
  const catalogEntry = generations.find((item) => item.id === (provided?.id || generation)) || generations.at(-1);
  const gpu = provided ? { ...catalogEntry, ...provided } : catalogEntry;
  const Art = { topology: TopologyArt, compute: ComputeArt, performance: PerformanceArt, documents: DocumentsArt }[kind] || TopologyArt;
  return (
    <div className={`archive-preview-art archive-preview-art--${kind || 'topology'}`} aria-hidden="true">
      <svg viewBox="0 0 620 220" preserveAspectRatio="xMidYMid slice" focusable="false">
        <Materials id={id} />
        <Art id={id} gpu={gpu} />
      </svg>
      <span className="archive-preview-art__shade" />
    </div>
  );
}
