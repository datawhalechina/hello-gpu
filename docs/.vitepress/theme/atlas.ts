export const atlasVendors = [
  {
    id: 'nvidia',
    name: 'NVIDIA',
    status: '已开放',
    title: '从整卡，到计算单元。',
    description: '沿着架构演进，探索整卡、封装与芯片内部，连接硬件结构与计算方式。',
    detail: '沉浸探索 · 架构档案 · 性能演进',
    href: '/atlas/nvidia/',
    action: '开始探索',
    standalone: true,
  },
  {
    id: 'amd',
    name: 'AMD',
    status: '交互图谱筹备中',
    title: '从熟悉的 GPU，继续深入。',
    description: '从教程主线的 RDNA 出发，逐步扩展到 CDNA。先读懂执行模型与片上资源。',
    detail: 'RDNA 优先建设 · CDNA 后续扩展',
    href: '/atlas/amd/',
    action: '查看 AMD 专区',
    standalone: false,
  },
] as const
