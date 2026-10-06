import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import TiledLdsScene from './scenes/TiledLdsScene.vue'
import TritonEdgeScene from './scenes/TritonEdgeScene.vue'

export type MatmulScenario = 'tiled-lds' | 'group-order' | 'triton-edge'
interface RegisteredScene { meta: SceneMeta; component: Component }
export const matmulScenes: Record<Exclude<MatmulScenario, 'group-order'>, RegisteredScene> = {
  'tiled-lds': {
    component: TiledLdsScene,
    meta: {
      eyebrow: 'HIP · 协作与同步', title: '固定 C[0,1]：共享输入，保留自己的部分和',
      viewBox: '0 0 720 700', mobileViewBox: '0 0 360 1170',
      note: '手算 block=2×2、K tile=2；重要乘加与同步均可单步查看。原输入保留，LDS 中存副本。',
      steps: [
        { label: '分工', title: '线程 (ty=0,tx=1) 负责 C[0,1]', narration: '沿用 A 2×3、B 3×2。全 block 四个线程各有自己的部分和；这里固定其中一个，初始为 0。', duration: 3000 },
        { label: '装载', title: '先复制第一对 tile，再等全块写完', narration: '每个线程向 tile_a、tile_b 各写一格。第一道屏障完成后，消费者才能读取其他线程写入的副本。', duration: 3200 },
        { label: '乘加 0', title: 'inner=0：1×0 的贡献为 0', narration: '当前线程从 tile_a[0,0] 取 1，从 tile_b[0,1] 取 0。两值相乘加入自己的部分和，仍是 0。', duration: 3000 },
        { label: '乘加 1', title: 'inner=1：再加 2×1，部分和为 2', narration: '换成 tile_a[0,1]=2 与 tile_b[1,1]=1。第一轮后，全块四个部分和为 [[5,2],[14,5]]。', duration: 3200 },
        { label: '读完', title: '所有消费者读完，才允许覆盖 LDS', narration: '当前线程算完，并不能代替其他线程也读完。第二道屏障保护旧 tile 的所有消费者。', duration: 3000 },
        { label: '尾块', title: '装载 K=2；不存在的 K=3 补 0', narration: '下一对 tile 覆盖 LDS，原输入和各线程部分和保持不变。写后屏障照常完成；填 0 与输入中本来存在的 0 分开标记。', duration: 3200 },
        { label: '再加 6', title: 'inner=0：2 + 3×2 = 8', narration: '当前线程读取尾块中的 3 和 2，新增贡献为 6。部分和跨轮累计，不能在装载新 tile 时清零。', duration: 3000 },
        { label: '补零项', title: 'inner=1：8 + 0×0 = 8', narration: 'K=3 越界，A、B 都补 0；这一项不改变结果。全块部分和现在是 [[5,8],[14,17]]。', duration: 3000 },
        { label: '再同步', title: '最后一轮也执行读后屏障', narration: '当前源码每轮乘加后都有第二道屏障，包括尾轮；并未因填 0 而让线程提前退出。', duration: 2800 },
        { label: '写回', title: 'K 全部处理完，写回 C[0,1]=8', narration: '该线程把自己的累计值存到输出；其他三个线程分别写入5、14、17。写回不会搬走或清除输入。', duration: 3000 },
      ],
    },
  },
  'triton-edge': {
    component: TritonEdgeScene,
    meta: {
      eyebrow: 'Triton · 三处 mask', title: '边缘输出 tile：加载与写回分别检查',
      viewBox: '0 0 720 620', mobileViewBox: '0 0 360 970',
      note: '逻辑 tile=2×2、K tile=2 的手算；不代表真实 program 的线程数或本章实测参数。',
      steps: [
        { label: '定位', title: 'M=N=K=3，选择右下角输出 tile', narration: 'program 的逻辑输出行是2、3，列也是2、3。矩阵只有下标0、1、2，所以只有C[2,2]能写回。', duration: 3200 },
        { label: '加载 0', title: 'A 检查行与 K，B 检查 K 与列', narration: '先处理K=0、1。A不存在的第3行补0；B不存在的第3列补0。A[2,1]=0是有效输入，与越界补0不同。', duration: 3300 },
        { label: '部分和 2', title: '第一对 tile：1×2 + 0×0 = 2', narration: '有效位置C[2,2]的临时部分和成为2，其他逻辑输出位置保持0；此时尚未写回C。', duration: 3000 },
        { label: '加载 1', title: 'K=3 也越界，两边都要补 0', narration: 'A的加载mask同时检查输出行与K；B同时检查K与输出列。两者的边界轴不同，不能共用一张mask。', duration: 3300 },
        { label: '部分和 3', title: '第二对 tile：再加 1×1 + 0×0', narration: 'C[2,2]从2变成3。加载时补0让无效K位置不贡献点积，但并不自动保护最终写回。', duration: 3000 },
        { label: '写回', title: 'C 单独检查行与列，只写一个位置', narration: 'store的mask只允许C[2,2]=3。其余三个逻辑位置不对应真实输出，不能因为内部值是0就把它们写到数组外。', duration: 3300 },
      ],
    },
  },
}
