# 08 GPU 模拟器规范

浏览器里的教学模拟器，服务新手村的全部关卡。它回答「线程做了什么、数据去了哪、为什么慢」，不模拟真实耗时。按关卡需要分层建设，每层只为具体关卡服务。

## 1. 位置与结构

```text
docs/sim/
  syntax/        HIP Lite 与 Py Lite 两个解析器 → 同一棵语法树（S-01）
  expr.ts        下标表达式（L1，已有，试点在 docs/preview/sim/）
  launch.ts      一维启动的逻辑模拟（L1，已有）
  lockstep.ts    锁步解释器（L2，S-02）
  memory.ts      访存模型（L3，S-03）
  timing.ts      示意计时与占用率模型（L4，S-04）
  worker.ts      Web Worker 封装
  progress.ts    试点进度存储（F-04 建立 docs/course/progress.ts 后由 NV-04 删除）
```

任务 S-01 把 `docs/preview/sim/` 移到 `docs/sim/`，并更新试点关卡的引用。所有文件是纯 TypeScript：不依赖 Vue，import 带 `.ts` 扩展名，只用可擦除的 TS 语法（不用 enum、namespace、参数属性），这样 `node --test` 可以直接导入。

## 2. 分层

| 层 | 回答的问题 | 服务关卡 | 状态 |
| --- | --- | --- | --- |
| L1 逻辑层 | 每个线程算哪个下标，越界、重复、没人算 | 1-3、1-4 | 已完成（试点） |
| L2 锁步执行 | 一个 wave 怎样同时走一行；分支掩码；barrier；数据竞争 | 1-5、1-6、1-9、1-10 | S-02 |
| L3 访存 | 一个 wave 的一次访存要搬几「车」（cache line） | 1-7、1-8 | S-03 |
| L4 示意计时 | 哪种写法更好；等待怎样被别的 wave 藏住 | 1-11、1-12 | S-04 |

## 3. 语言子集

两种写法共用同一棵语法树，内建名字一致。

| 能力 | HIP Lite | Py Lite |
| --- | --- | --- |
| kernel 定义 | `__global__ void f(float* a, int n) { … }` | `@kernel` + `def f(a, n):` |
| 内建变量 | `blockIdx.x` `blockDim.x` `threadIdx.x` `gridDim.x` | 同名 |
| 变量 | `int i = …;` `float s = 0;` | `i = …`（类型自动推断） |
| 表达式 | `+ - * / %`、比较、`&& \|\| !`、三元 | `+ - * // %`、比较、`and or not` |
| 控制流 | `if/else`、`for (int k = 0; k < m; k++)`、`while` | `if/elif/else`、`for k in range(m)`、`while` |
| 数组 | `a[i]` 读写 | 同 |
| 共享内存 | `__shared__ float s[64];` | `s = shared(64)` |
| 同步 | `__syncthreads();` | `syncthreads()` |
| 原子操作 | `atomicAdd(&a[i], v);` | `atomic_add(a, i, v)` |

- 除法：HIP Lite 的 `/` 对整数截断；Py Lite 的 `/` 永远得到小数类型，当下标会报错，整除用 `//`（试点已实现，保持一致）。
- 只支持一维的 `.x`；`.y`、`.z` 给出「后面的关卡再讲」的提示。
- 错误信息用中文，带行列号；分四类：语法、类型、运行时（如除以 0）、超出限制。

## 4. 执行模型（L2）

- 一个 block 内的线程按 `threadIdx.x` 顺序切成 wave，默认 wave32，可切换 wave64。
- wave 内锁步执行：每条语句对所有活跃 lane 同时执行。
- `if`：每个 lane 求条件 → 用掩码执行 then 分支 → 用补集掩码执行 else 分支；两段都记录事件。
- 循环：每个 lane 单独判断条件，掩码逐步收缩，直到所有 lane 退出。
- barrier：一个 block 的所有 wave 都到达才继续；在分支里遇到 barrier 且只有部分 lane 到达时，报「在分支里同步」的错误。
- 数据竞争：两个 barrier 之间，不同线程对同一地址「写-写」或「读-写」，记录诊断（包括涉及的线程和代码行）。不同 block 之间的全局内存冲突同样记录。
- 越界读返回 0 并记录 `oob-read`；越界写不落到数组里，记录到「越界区」（和试点一致）。
- block 默认按编号顺序执行；可以传随机种子打乱顺序，用来演示「block 的执行顺序不确定」。
- 上限：默认最多 200,000 步；可视化场景的线程数不超过 1024。超出时报「超出限制」，不卡死页面。

## 5. 事件流

模拟器只输出事件，动画、星级判定、测试都从事件读取：

```ts
type SimEvent = {
  step: number
  block: number
  wave: number
  line: number
  op: 'exec' | 'branch' | 'load' | 'store' | 'barrier' | 'atomic'
  mask: string                 // 例如 '11110000…'，长度 = wave 大小
  space?: 'global' | 'lds'
  addrs?: number[]             // 每个活跃 lane 访问的元素下标
}
```

L3 `analyzeMemory(events, { lineBytes, elemBytes })` 给出每次访存的事务数、理想事务数和效率；L4 `estimateTime(events, params)` 给出示意周期数和计算 / 访存 / 同步的拆分。L3、L4 的所有参数都是示意值，集中放在一个参数表里，界面上标注「模拟」。

## 6. 运行方式

- 在 Web Worker 里运行（`worker.ts`），主线程只接收事件；测试环境直接调用同步接口。
- 同样的程序、参数、种子，一定得到同样的事件流（确定性）。
- 性能目标：1024 线程 × 100 步在 50 ms 内完成。

## 7. 借鉴 mlsys-simulator 的工程方法

- 确定性，方便判星和测试。
- 事件时间线是唯一输出，动画、判星、测试共用。
- 每层先准备能手算的小例子，当回归测试的标准答案。
- 模拟数据和实测数据分开标注，模拟永远不冒充实测。
- L4 计时模型以后用真机数据校准时，保留一部分数据做独立验证。

## 8. 测试要求

- 两种写法的同一个程序：语法树相同、事件流相同、结果相同。
- 每层至少 5 个手算标准例（输入、期望的结果和关键事件）。
- 错误信息测试：每类常见写错都有可读的提示。
- 星级判定（各关的 `challenge.ts`）基于事件流写单测。
