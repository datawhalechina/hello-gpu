import generations from '../data/generations.json';
import tesla from '../assets/performance/tesla.webp';
import fermi from '../assets/performance/fermi.webp';
import kepler from '../assets/performance/kepler.webp';
import maxwell from '../assets/performance/maxwell.webp';
import pascal from '../assets/performance/pascal.webp';
import volta from '../assets/performance/volta.webp';
import turing from '../assets/performance/turing.webp';
import ampere from '../assets/performance/ampere.webp';
import hopper from '../assets/performance/hopper.webp';
import ada from '../assets/performance/ada.webp';
import blackwell from '../assets/performance/blackwell.webp';
import unifiedArt from '../assets/performance/milestone-tesla.webp';
import matrixArt from '../assets/performance/milestone-volta.webp';
import rayArt from '../assets/performance/milestone-turing.webp';
import './PerformanceArtwork.css';

const productArt = { tesla, fermi, kepler, maxwell, pascal, volta, turing, ampere, hopper, ada, blackwell };
const milestoneArt = { tesla: unifiedArt, volta: matrixArt, turing: rayArt };

/** Static studio renders of the same assembled PCIe models as the 3D explorer. */
export function ProductArtwork({ generation }) {
  const id = typeof generation === 'string' ? generation : generation?.id;
  const gpu = generations.find(item => item.id === id) || generations.at(-1);
  return <div className="performance-product-art" data-generation={gpu.id}>
    <span className="performance-product-art__light" aria-hidden="true" />
    <img key={gpu.id} src={productArt[gpu.id]} alt={`${gpu.card}${gpu.card.includes('PCIe') ? '' : ' PCIe'} 显卡外观参考重建`} draggable="false" decoding="async" />
  </div>;
}

/** Decorative motifs, not a physical die map or an architectural unit count. */
export function MilestoneArtwork({ kind }) {
  return <div className={`performance-milestone-art performance-milestone-art--${kind}`} aria-hidden="true">
    <img src={milestoneArt[kind] || unifiedArt} alt="" draggable="false" decoding="async" />
  </div>;
}

export default ProductArtwork;
