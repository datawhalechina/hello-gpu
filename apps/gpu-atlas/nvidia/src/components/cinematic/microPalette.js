// Functional colors are explanatory, not the measured color of silicon.
// Shared by the surface artwork, workbench legend, and linked callouts.
export const MICRO_PALETTE = {
  control: { label: '调度与指令', accent: '#72a7f3', base: '#192f50' },
  compute: { label: '算术通路', accent: '#59cbd3', base: '#173c45' },
  memory: { label: '寄存器与缓存', accent: '#dfbc6f', base: '#4b391c' },
  tensor: { label: 'Tensor', accent: '#b2a0ed', base: '#362849' },
  ray: { label: 'RT', accent: '#e29980', base: '#4b2e26' },
  io: { label: '接口与访存', accent: '#8dbba0', base: '#253e31' },
};

export function microRegion(id) {
  if (['scheduler', 'instructionCache', 'l0InstructionCache', 'instructionBuffer', 'frontend'].includes(id)) return 'control';
  if (['registers', 'cache', 'l2', 'textureL1', 'textureCache'].includes(id)) return 'memory';
  if (id === 'tensor') return 'tensor';
  if (id === 'rt') return 'ray';
  if (['memoryController', 'sfu', 'tma', 'textureInterface', 'textureUnits'].includes(id)) return 'io';
  return 'compute';
}
