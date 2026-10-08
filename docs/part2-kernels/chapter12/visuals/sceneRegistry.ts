import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import { DURATION_MS } from '../attention-model'
import OnlineSyncScene from './scenes/OnlineSyncScene.vue'
import TritonTileScene from './scenes/TritonTileScene.vue'
export type AttentionScenario = 'materialize-flow' | 'online-sync' | 'triton-tile'
const steps = (rows: string[][]) => rows.map(([label, title, narration]) => ({ label, title, narration, duration: DURATION_MS }))
export const attentionScenes: Record<Exclude<AttentionScenario, 'materialize-flow'>, { meta: SceneMeta; component: Component }> = {
  'online-sync': { component: OnlineSyncScene, meta: {
    eyebrow: 'HIP · 固定 key 2 的共享依赖', title: '系数写好、取得副本、消费完成',
    viewBox: '0 0 720 810', mobileViewBox: '0 0 400 870',
    note: '只放大两个输出分量的消费者；其余线程仍参与协作。这里不统计全部屏障，也不表示执行耗时。',
    steps: steps([
      ['旧状态', '固定已经算完 score=4 的时刻', '旧最大值为 2、l≈1.3679、numerator≈[1,0.7358]，都保存在共享空间。本图不重演前面的点积归约。'],
      ['系数发布', '线程 0 更新共享状态与系数', '线程 0 写 m=4、l≈1.1851、α=exp(−2)、β=1。写好不等于其他线程已取得这些值，numerator 尚未改变。'],
      ['同步后读取', '全 block 到达屏障，消费者取得系数', '负责两个分量的线程现在可读取同一组 α/β，保留自己的副本。共享 numerator 仍是旧值。'],
      ['更新分量', '分别更新共享 numerator 的两项', '每个消费者读取自己的旧 a[d]，计算 α×旧 a[d]+β×V₂[d]，分别写成 3.1353 和 1.0996。'],
      ['消费完成', '读者完成使用后才允许覆盖', '全 block 再次同步，保护仍在消费当前系数的线程。只有消费完成后，后续迭代才可复用共享位置；本例 key 2 已是最后一项。'],
    ]),
  } },
  'triton-tile': { component: TritonTileScene, meta: {
    eyebrow: 'TRITON · 每块两个 key', title: '尾块中一个有效 key 与一个 mask',
    viewBox: '0 0 720 630', mobileViewBox: '0 0 400 830',
    note: '这里 D=2 的两个分量都有效，只演示 key 尾部。逻辑块不表示线程或 lane 的排布。',
    steps: steps([
      ['第一块', '读取 key 0、1 的数据副本', '原输入保持不变。逻辑块每行对应一个 key，V 的两列对应两个分量；第一块两项都有效。'],
      ['块内累计', '按 key 方向合并贡献', '基准为 2，两个指数是 1 和 exp(−1)。沿 key 方向相加，得到 l≈1.3679、a≈[1,0.7358]。'],
      ['第二块', 'key 2 有效，key 3 越界', '第二块仅 key 2 真实存在。无效位置不读取 V，score 设为 −∞；两个真实 V 分量均有效。'],
      ['历史换基准', '新最大值 4，历史 l/a 同乘 exp(−2)', '当前块出现 score=4。旧分母与两个旧累计一起重缩放，新 key 的贡献还没有加入。'],
      ['合入尾块', '有效项指数为 1，无效项为 0', '当前指数为 [1,0]。只加入 key 2 的 1 和 [3,1]；mask 位置对分母及两个分量的贡献都为 0。'],
      ['最后除法', '全部块处理完，得到 O', '最后将两个累计分量分别除以 l，得到与逐 key 在线处理和直接加权和相同的结果。'],
    ]),
  } },
}
