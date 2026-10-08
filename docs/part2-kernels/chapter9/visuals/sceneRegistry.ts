import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import Pipeline from '../reduction-pipeline-scene.vue'
import Shuffle from '../reduction-shuffle-scene.vue'
export type ReductionScenario='two-stage'|'shuffle'|'triton'
export const reductionScenes:Record<ReductionScenario,{meta:SceneMeta;component:Component}>={
 'two-stage':{component:Pipeline,meta:{eyebrow:'HIP · local-lds 分工示意',title:'一个线程的局部和，怎样交给下一阶段？',viewBox:'0 0 720 480',mobileViewBox:'0 0 400 650',steps:[
 {label:'准备',title:'先跟踪线程 0',narration:'16 项输入由两个 block、每块四个线程处理。这里只放大 block 0 的线程 0，它的 local 从 0 开始。'},
 {label:'第一次读',title:'读取下标 0',narration:'input[0] = 3。读到的副本加入 local，得到 3；数组中的原值仍然保留。'},
 {label:'再次累加',title:'下标加 8，读取下一个位置',narration:'两个 block 共八个线程，所以同一线程下一次读取 input[8] = 3。它把两个不同位置的值合成 local = 6。'},
 {label:'全部局部和',title:'其他线程也按同一规则处理',narration:'两个 block 分别得到 [6,2,14,0] 和 [8,2,12,4]。现在只得到各线程的 local，还没有跨线程合并。'},
 {label:'块内合并',title:'每块使用 LDS 求和',narration:'按前面的求和树合并，每轮完成写入与同步后继续，得到 22 和 26。此时这两个和仍属于各自 block。'},
 {label:'写 partial',title:'写入独占的全局位置',narration:'block 0 写 partials[0] = 22，block 1 写 partials[1] = 26。独占位置让它们不必争着更新同一个数。'},
 {label:'最终合并',title:'第二个 kernel 读取完整 partial',narration:'同一 stream 中第一阶段结束后，第二阶段读取 22、26 并得到 48。普通 block 屏障不能代替这项跨 block 的交接。'}
 ]}},
 shuffle:{component:Shuffle,meta:{eyebrow:'HIP · shuffle 依赖特写',title:'按距离读取，在原位置合并',viewBox:'0 0 720 535',mobileViewBox:'0 0 400 535',note:'缩成八项的手算示意，历史层留作核对。实际 wave32 的 offset 为 16、8、4、2、1；图的层数不表示同时存放的寄存器组。',steps:[
 {label:'源值',title:'先保留各位置的值',narration:'顶部 0–7 是固定的位置编号。每一层的结果都留在对应列，先沿竖线看自己的值，再沿斜线找读来的值。这里只展开八项手算依赖。'},
 {label:'距离 4',title:'读取另一位置的副本',narration:'位置 0 读取位置 4，合成 3+4=7，写在下一层的位置 0；位置 1、2、3 同理，分别得到 2、13、2。上层保留本轮开始时的值，便于追溯。'},
 {label:'距离 2',title:'继续合并四个局部结果',narration:'位置 0 读取位置 2 的 13，与自己的 7 合成 20；位置 1 读取位置 3 的 2，合成 4。前两层继续保留，下一层只展开最终结果仍需的依赖。'},
 {label:'距离 1',title:'lane 0 持有这个局部和',narration:'20 + 4 = 24。真实代码由各 wave 的 lane 0 写 wave_sums，经 block 屏障，再由第一个 wave 合并并写 partial。'}
 ]}},
 triton:{component:Pipeline,meta:{eyebrow:'Triton · 逻辑宽度 4、两个 program 的手算',title:'片段读完了，一个 program 的工作就结束了吗？',viewBox:'0 0 720 480',mobileViewBox:'0 0 400 650',note:'N=10、宽度4用于逻辑手算；本章实际 kernel 固定宽度1024。逻辑位置不等于物理线程。',steps:[
 {label:'分配',title:'两个 program 领取不同片段',narration:'program 0 从下标 0 开始，program 1 从下标 4 开始。每个 program 保留自己的四项累计向量。'},
 {label:'第一片段',title:'先逐位置累加第一片段',narration:'program 0 得到 [3,1,7,0]，program 1 得到 [4,1,6,2]。向量位置仍彼此独立，还没有做 tl.sum。'},
 {label:'尾片段',title:'program 0 继续到下标 8',narration:'下标 8、9 有效，10、11 被 mask 挡住，只提供零贡献；累计成为 [6,2,7,0]。program 1 下一起点为 12，循环已经结束。'},
 {label:'局部归约',title:'tl.sum 只合并本 program 的向量',narration:'program 0 交出 15，program 1 交出 13，各写自己的 partial。tl.sum 不会自动读取另一个 program 的结果。'},
 {label:'读取 partial',title:'下一阶段读取两个有效值',narration:'第一阶段结束后，一个 program 读取 [15,13]。教学逻辑宽度仍是 4，另两个位置由 mask 提供 0。'},
 {label:'最终结果',title:'再归约一次得到 28',narration:'15 + 13 + 0 + 0 = 28，等于前十项输入之和。两阶段完整执行后，最终标量才写入输出。'}
 ]}}
}
