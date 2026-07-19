export const repoBaseUrl = 'https://github.com/datawhalechina/hello-gpu/blob/main'

export const parts = [
  {
    prefix: '/part0-intro/',
    navText: '入门',
    title: '入门与硬件速通',
    readmeTitle: '第 0 篇：入门与硬件速通',
    chapters: [
      {
        title: '写给读者的话',
        summary: '教程定位、为什么选 9070XT、和市面教程差异、学习路线',
        status: '🚧',
        lead: '本章是整本书的入口，先说明 hello-gpu 为什么存在、适合谁读，以及你最终会做出什么。读完后，你应该能判断自己是否适合继续学下去，并理解后续章节为什么围绕「算子从慢到快 + Agent 自动化」这条主线展开。',
        sections: [
          ['为什么写这本入门书', '从大模型推理和算子优化的真实痛点出发，说明只会调框架还不够，理解 GPU 底层对性能工作意味着什么。'],
          ['这本书适合谁', '说明读者需要的 Python、Linux、深度学习基础，以及什么样的读者收益最大。'],
          ['为什么选 AMD Radeon RX 9070 XT', '解释选消费卡 9070XT（RDNA4）作为主线的原因：易获得、成本低、Linux + ROCm 可跑；和数据中心卡的定位差异。'],
          ['这本书和市面教程有什么不同', '强调三条主线：Profiling-Driven（先会看数据再改代码）、刷题导向（每个算子都是从 naive 到优化的完整案例）、Agent-Driven（把优化流程交给 Agent 自动化）。'],
          ['你将完成的事', '预告全书闭环：学会几个经典算子的优化思路，最后亲手搭一个能自动做算子/模型优化的 Agent。'],
          ['学习路线图', '展示从环境 → profiling → 算子 → 刷题 → Agent 的学习路径，标出每篇大约需要的时间。'],
          ['和其他 datawhale 教程的边界', '说明本书聚焦单卡算子/Agent 优化；多卡通信、服务化、动态 batching 指向 hello-mlsys / hello-ai-infra。']
        ]
      },
      {
        title: '环境准备',
        summary: '9070XT + 原生 Ubuntu + ROCm 7.13 验证、Windows/WSL2 边界、uv 环境、最小 smoke test',
        status: '🚧',
        lead: '本章不深入讲 ROCm 软件栈原理，只用最短路径帮你确认实验环境能不能继续往后跑。读完后，你应该能通过 uv sync 复现本篇环境，确认 ROCm 能看到 GPU，并跑通最小 HIP 程序。',
        sections: [
          ['本教程的实验基线', '明确所有实验默认在 Radeon RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04 上验证，其他设备只参考方法。'],
          ['原生 Linux 优先，WSL2 可用但受限', '说明 9070XT 主线实验优先使用原生 Linux；WSL2 可用于学习计算路径，但 rocm-smi 和硬件性能计数器能力受限。'],
          ['同步本篇 uv 环境', '进入 code/part0-intro 后运行 uv sync，并用 activate-rocm.sh 激活 ROCm wheel 环境。'],
          ['验证 GPU 可见性', '用 rocminfo 检查 GPU、驱动和 ROCm 运行时；rocm-smi 作为原生 Linux 的可选状态监控工具。'],
          ['验证 PyTorch ROCm', '运行最小 PyTorch ROCm smoke test，确认框架能看到 GPU。'],
          ['验证最小 HIP 程序', '直接用 hipcc 编译并运行最小 vector add 程序。'],
          ['环境不通时先收集什么', '列出报错、版本、命令输出、硬件信息和日志，避免盲目排错。']
        ]
      },
      {
        title: 'GPU 体系结构速通',
        summary: 'CU/Wavefront/LDS/寄存器/显存层次，RDNA4 视角，不讲 MFMA/CDNA/HBM',
        status: '🚧',
        lead: '本章建立后续优化会反复用到的 GPU 硬件最小模型，但只讲 9070XT（RDNA4）用得到的部分。读完后，你应该能用自己的话讲清楚一个 kernel 从 launch 到执行经过哪些硬件单元，并知道 LDS、寄存器、wavefront 为什么是优化的核心资源。',
        sections: [
          ['GPU 为什么能并行', '用一张图说明 SIMT 执行模型，理解为什么 GPU 适合大规模数据并行。'],
          ['Compute Unit（CU）的内部结构', '逐层拆解 CU：SIMD 单元 / VALU / SALU / 标量与向量寄存器堆。'],
          ['Wavefront 与 SIMT 执行', '理解 32 或 64 线程一组的执行方式，以及分支收敛的代价。'],
          ['VGPR、SGPR 与 LDS 资源', '解释片上寄存器与共享内存为什么是 kernel 优化的核心资源。'],
          ['显存层次：寄存器 → LDS → L1/L2 → GDDR6', '说明 9070XT 的 16GB GDDR6（非 HBM）和各级缓存的容量、带宽、延迟分层。'],
          ['WMMA：RDNA4 的矩阵加速单元', '介绍 RDNA3+ 引入的 WMMA（不是 CDNA 的 MFMA），以及它在 GEMM/Attention 算子里的角色。'],
          ['Roofline 的硬件来源', '把硬件参数（峰值算力、带宽）翻译成 Roofline 上的两条线，建立「理论上限」直觉。']
        ]
      },
      {
        title: '第一个程序 + Roofline 心智模型',
        summary: 'vector add 跑通、建立性能上限直觉、benchmark 习惯',
        status: '🚧',
        lead: '本章在已经验证环境可用、且对硬件有基本心智模型的基础上，带你跑通第一个真正的 GPU 程序——vector add。重点不是算子本身，而是借此建立后续所有实验都会复用的计时习惯和 Roofline 心智模型。本章的 vector add 会贯穿整个 Part 1 profiling 篇。',
        sections: [
          ['从已经验证的环境开始', '复用第 1 章的环境验证结果，直接进入本章代码目录。'],
          ['跑通 vector add', '编写、编译并运行一个最小 HIP kernel，确认结果正确。'],
          ['建立 baseline benchmark', '用固定输入、热身、重复运行和 GPU event 建立可复查的计时 baseline。'],
          ['Roofline 心智模型', '用 vector add 的实测带宽和理论上限对比，建立「这个算子离极限有多远」的直觉。'],
          ['留下实验底稿', '说明源码、命令输出、benchmark 配置和 EXPERIMENT.md 应该如何对应。']
        ]
      }
    ]
  },
  {
    prefix: '/part1-profiling/',
    navText: 'Profiling',
    title: 'Profiling 实战',
    readmeTitle: '第 1 篇：Profiling 实战',
    chapters: [
      {
        title: 'benchmark 与可信计时',
        summary: '热身、重复、GPU event、避免测量陷阱',
        status: '🚧',
        lead: '本章继续用 vector add 做主线，但重点从「跑通」转向「量准」。读完后，你应该能解释为什么不能只跑一次就下结论，以及热身、重复、同步、日志记录这些「无聊」的细节如何决定数字是否可信。',
        sections: [
          ['为什么不能凭感觉优化', '用常见误区说明没有可信数据的优化为什么容易走偏。'],
          ['热身与缓存效应', '理解第一次运行为什么总是慢，以及为什么要丢掉前几次计时。'],
          ['重复运行与统计', '说明重复次数、取中位数还是最小值、如何报告方差。'],
          ['GPU event 计时', '用 HIP event 而不是 CPU wall clock 测量 kernel 真实耗时。'],
          ['避免测量陷阱', '识别数据拷贝遗漏、测量范围错误、缓存偶然命中导致的伪提升。'],
          ['可信 benchmark 的检查清单', '形成一份每次实验都该过一遍的检查清单。']
        ]
      },
      {
        title: '用 rocprof 找到慢在哪里',
        summary: '对照两个 vector add，只看 kernel 时间、工作划分和 stride 趋势',
        status: '🚧',
        lead: '本章先用 benchmark 比较两个 vector add 配置，再用 rocprof 查看每次 kernel dispatch。随后我们会检查 stride 实际同时改变了哪些底层变量，避免把一个有混杂的对照实验写成过早的性能结论。',
        sections: [
          ['先看懂两个实现', '看地址排布、每线程循环次数和 Grid Size 分别怎样变化。'],
          ['先跑一遍，确认谁更慢', '固定输入和计时方法，只比较两个 kernel 的延迟与有效带宽。'],
          ['用 rocprof 看每次 kernel dispatch', '第一次只看 kernel 名、起止时间、Grid Size 和寄存器用量。'],
          ['先列出一起变化的东西', '区分地址排布、每线程工作量和并行规模。'],
          ['看看静态资源有没有变', '比较同一个 kernel 在不同 stride 下的 VGPR、SGPR 和 LDS。'],
          ['用 stride 扫描观察趋势', '观察组合效果，并说明下一组公平对照应固定什么。']
        ]
      },
      {
        title: '读懂 Roofline 图',
        summary: '看懂参考线、生成工作点并选择排查方向',
        status: '🚧',
        lead: '本章把前两章得到的时间和带宽放到 Roofline 图上，并说明绘图脚本使用了哪些实测数据。重点不是推公式，而是学会看工作点靠近哪条线、下一步该查访存还是计算。',
        sections: [
          ['Roofline 只看三件事', '看横轴、纵轴和工作点离哪条上限更近。'],
          ['把 vector add 放到图上', '说明数据来源和绘图命令，再用算术强度、实测时间和有效带宽画出工作点。'],
          ['工作点离线很远怎么办', '从访存、计算和启动开销三个方向依次排查。'],
          ['写一页性能记录', '只记录环境、命令、结果、判断和下一步。'],
          ['Part 1 的四步闭环', '回顾「量准 → 找到慢点 → 解释 → 验证」并衔接 Part 2。']
        ]
      }
    ]
  },
  {
    prefix: '/part2-kernels/',
    navText: '算子优化',
    title: '经典算子与 Kernel 实战',
    readmeTitle: '第 2 篇：经典算子与 Kernel 实战',
    landing: '/part2-kernels/',
    landingSource: 'docs/part2-kernels/index.md',
    chapters: [
      {
        title: 'Element-Wise：逐元素算子',
        summary: '以 Vector Add 为例，分别用 HIP 深入理解访存，用 Triton 快速掌握 tile 编程',
        status: '🚧',
        lead: '本章从最容易看懂的 Vector Add 开始，先认识“逐元素”到底是什么意思，再把同一个问题拆成两条可以独立选择的路线：HIP 篇带你看清线程、地址和显存访问，Triton 篇带你用较少代码表达一整块数据。两条路线最后回到同一组正确性与性能问题，让你知道工具不同，判断方法为什么仍然相通。',
        sections: [
          ['先认识 Element-Wise', '从输出元素依赖关系出发，认识 Add、ReLU、Scale & Bias 等逐元素算子的共同结构。'],
          ['用 Vector Add 固定问题', '用手算、PyTorch 参考与输入边界建立同一份正确性标准。'],
          ['一次加法要搬多少数据', '数清一次加法背后的两次读取和一次写回，提出带宽受限假设。'],
          ['HIP 篇：看清线程与显存', '从一线程一元素出发，依次观察连续访存、Grid-Stride Loop、向量化与尾部处理。'],
          ['Triton 篇：用 Tile 快速表达', '从最小模板出发，理解 program、offset、mask、load/store，并用 Triton-Viz 查看数据访问。'],
          ['HIP 与 Triton 怎样对应', '把 thread 与 program、标量索引与 tile offsets、边界判断与 mask 放在同一张表中。'],
          ['复跑与练习', '统一运行正确性检查，尝试非整除长度、不同 block size 与简单逐元素变体。']
        ]
      },
      {
        title: 'Reduction：归约算子',
        summary: '以 Sum Reduction 为例，学习跨线程协作、LDS 与 Wave Shuffle',
        status: '🚧',
        lead: '本章撤掉 Element-Wise 中“每个输出彼此独立”的前提：很多输入要共同得到一个结果。公共部分先把串行求和画成并行树；HIP 篇深入 LDS、同步与 Wave Shuffle，Triton 篇用 program partial 和多阶段归约快速表达同一层次。',
        sections: [
          ['什么是归约算子', '从多输入到少输出的数据依赖出发，区分 sum、max 与 argmax。'],
          ['从串行求和到并行树', '手算一个小数组，对比线性依赖与树形依赖。'],
          ['固定正确性与测量口径', '明确浮点误差、非二次幂长度和完整多阶段计时。'],
          ['HIP v0：逐元素 atomic baseline', '用全局同地址争用建立最短的正确起点。'],
          ['HIP v1：LDS block 内归约', '协作加载、同步并逐轮收缩活动线程。'],
          ['HIP v2：寄存器局部累加', '先让每个线程得到局部和，再进入 LDS。'],
          ['HIP v3/v4：Wave Shuffle 与多阶段 partial', '减少同步，并把跨 block 合并拆成独立阶段。'],
          ['Triton t0：program partial', '说明一个 program 怎样覆盖一段输入并使用 tl.sum。'],
          ['Triton t1：多阶段归约', '用 partial buffer 与第二次 dispatch 完成跨 program 合并。'],
          ['HIP 与 Triton 的归约层次对照', '对齐局部和、组内归约与跨组合并。'],
          ['复跑与练习', '覆盖 max、非二次幂、累加 dtype 与负结果分析。']
        ]
      },
      {
        title: 'Normalization：归一化算子',
        summary: '以行级 Softmax 为例，学习数值稳定与逐元素/归约融合',
        status: '🚧',
        lead: '本章把 Element-Wise 与 Reduction 组合起来：Softmax 既要逐元素取指数，又要两次归约。公共部分先用大数反例理解“减最大值”；HIP 篇观察中间写回与数据驻留，Triton 篇学习一行对应一个 program 的融合表达。',
        sections: [
          ['归一化算子解决什么问题', '从 logits 到概率，先固定逐行 Softmax 语义。'],
          ['为什么直接指数会溢出', '用小例子推导减最大值，而不是只给公式。'],
          ['Softmax 由哪些基本模式组成', '拆成 max reduction、element-wise exp、sum reduction 与 normalize。'],
          ['HIP v0：稳定的多 kernel baseline', '先保证数值正确，并统计完整路径。'],
          ['HIP v1/v2：融合 dispatch 与寄存器驻留', '区分少一次 launch 与少一次全局写回。'],
          ['HIP v3：Wave32 收尾', '保持数据映射不变，只替换 block 内归约机制。'],
          ['Triton t0：一行对应一个 program', '讲清 mask、next power of 2 与行内 reduction。'],
          ['Triton t1：block size 与 num warps', '只做受控参数实验，并允许参数变大反而变慢。'],
          ['HIP 与 Triton 的融合边界', '比较显式寄存器/LDS 控制与编译器生成映射。'],
          ['稳定性压力测试与练习', '覆盖大正值、大负值、尾行、长行和不同 dtype。']
        ]
      },
      {
        title: 'GEMM-Like：矩阵乘类算子',
        summary: '以 Matmul 为例，学习分块、数据复用与寄存器累加',
        status: '🚧',
        lead: '本章第一次让同一份输入被多个输出反复使用。公共部分从点积和小矩阵开始画 tile；HIP 篇显式管理 LDS 与线程 fragment，Triton 篇用 program/tile 表达同一复用，并把 autotune 限制为可解释的受控实验。',
        sections: [
          ['从点积看矩阵乘', '用小矩阵说明输出元素、M/N/K 与 row-major 地址。'],
          ['为什么朴素实现重复读取', '区分算法级计算强度、源码请求字节和物理流量。'],
          ['Tile 为什么能带来复用', '先画块级数据生命周期，再进入代码。'],
          ['HIP v0：一线程一输出', '建立最短的正确点积 baseline。'],
          ['HIP v1：LDS 分块', '协作加载 A/B tile，处理同步、尾块与 bank 风险。'],
          ['HIP v2/v3：一维与二维寄存器分块', '让一个线程计算多个输出，同时跟踪 VGPR 压力。'],
          ['HIP 进阶实验', '只选择一项已实测的 K tile、双缓冲或 WMMA 机制。'],
          ['Triton t0：用 tl.dot 写 tiled Matmul', '解释 program id、M/N tile 与 K 循环。'],
          ['Triton t1：program 排序与受控 autotune', '限制搜索空间，并把选型结果落盘。'],
          ['HIP 与 Triton 的分块层次对照', '比较 block/thread fragment 与 program/tile。'],
          ['复跑与练习', '覆盖非方阵、非整除形状、转置布局与参数反例。']
        ]
      },
      {
        title: 'Fusion：融合算子',
        summary: '以 FlashAttention 为例，学习在线计算、减少中间写回与 IO-aware',
        status: '🚧',
        lead: '本章把前四章的模式组合起来：矩阵乘产生 Scores，Softmax 做归一化，再与 V 相乘。公共部分先比较物化与在线数据流；HIP/Triton 两条路线分别实现教学版前向 Attention，并为后续远端实验保留统一入口。',
        sections: [
          ['从普通 Attention 数据流开始', '只补本章需要的 Q/K/V、Scores、Softmax 与输出。'],
          ['物化中间矩阵的代价', '画出三段 kernel 与 Scores/P 的全局读写路径。'],
          ['在线 Softmax 怎样保持精确', '手算 running max、normalizer、历史重缩放与输出累加。'],
          ['固定语义、边界与测量口径', '先用单 batch、单 head、FP32 前向固定数学语义、尾块和完整时间，再把 causal 与低精度留作练习。'],
          ['HIP h0/h1：从物化基线到在线融合', '先消除完整中间矩阵，再验证正确性。'],
          ['HIP h2–h4：Wave、query/key 分块与 K/V 复用', '每轮只改变一个机制并跟踪资源代价。'],
          ['Triton t0：物化基线', '保持与 HIP 相同的数学语义与计时边界。'],
          ['Triton t1–t3：在线 query/key tile', '解释块级状态、mask 与寄存器/scratch 风险。'],
          ['完整证据与实现边界', '汇总时间、分配字节、dispatch、正确性与资源字段。'],
          ['从组合到融合的方法总结', '回收 Element-Wise、Reduction、Normalization 与 GEMM-Like。']
        ]
      },
      {
        title: '综合实战：Fused RMSNorm',
        summary: '综合逐元素、归约与融合，独立完成一次可复现的 Kernel 优化闭环',
        status: '🚧',
        lead: '本章是 Part 2 的综合终章：不再引入新的优化名词，而是用 Fused RMSNorm 把逐元素、归约、融合、正确性、benchmark 与 profiling 串成一次独立完成的优化记录。第一版已经提供 HIP/Triton 教学代码和复跑入口，性能数字仍等待统一远端复测。',
        sections: [
          ['从 LayerNorm 到 RMSNorm', '从公式和数据流解释 RMSNorm 保留了什么、移除了什么，以及它为什么适合作为综合题。'],
          ['固定数学语义、误差和目标 Shape', '先锁定 dtype、归约轴、epsilon、参考实现、误差标准和目标输入，再讨论优化。'],
          ['HIP：从分步 Baseline 到融合实现', '先建立分步正确版本，再逐次验证归约、数据驻留与融合边界。'],
          ['Triton：一行一个 Program', '用一个 program 覆盖一行，受控实验 block size、num warps 与长行边界。'],
          ['正确性、Benchmark 与 Profiling', '用统一矩阵、kernel-only 口径和可追溯证据比较各版本。'],
          ['独立优化记录与失败回退', '保留每轮假设、单变量改动、负结果和回退点，形成可复跑报告。'],
          ['从 RMSNorm 迁移到新题目', '把逐元素、归约和融合模式迁移到新的算子规格，而不是背最终代码。'],
          ['拓展练习：LeetGPU 与其他平台', '平台题目、运行环境与评分口径单独核对，平台成绩不替代本地实验。']
        ]
      }
    ]
  },
  {
    prefix: '/part3-agent/',
    navText: 'Agent',
    title: 'Agent（算子层）',
    readmeTitle: '第 3 篇：Agent（算子层）',
    chapters: [
      {
        title: 'Agent 入门',
        summary: '参考 hello-agents、LLM Agent 基本范式、工具调用',
        status: '🚧',
        lead: '本章是 Agent 篇的入口，参考 hello-agents 的概念铺垫节奏，讲清楚 LLM Agent 的基本范式。但本书的 Agent 场景是「算子/模型优化」，不是通用智能体——这是和 hello-agents 的关键区别。',
        sections: [
          ['什么是 LLM Agent', '用最简模型理解 Agent = LLM + 工具 + 循环，参考 hello-agents 第 1 章。'],
          ['为什么 Agent 适合算子优化', '说明算子优化天然适合 Agent：有明确目标（性能）、有可调用工具（编译/跑分/profiling）、有可验证反馈（benchmark 数字）。'],
          ['ReAct 范式简介', '理解 Reason-Act-Observe 循环，这是后续算子优化 Agent 的基本骨架。'],
          ['工具调用（Tool Use）', '理解 Agent 如何通过结构化接口调用外部工具。'],
          ['本书 Agent 的边界', '明确本书 Agent 聚焦算子/模型优化，不做通用代码生成或对话助手。'],
          ['和 hello-agents 的关系', '说明本书 Agent 篇假设你已了解 Agent 基本概念；零基础建议先读 hello-agents。']
        ]
      },
      {
        title: '工具封装',
        summary: 'benchmark/profiling/编译包成 Agent 可调用工具',
        status: '🚧',
        lead: '本章把 Part 1 学过的 benchmark、rocprof 以及编译流程，封装成 Agent 能调用的标准化工具。这是让 Agent「能动手」的前提——没有工具的 Agent 只会空谈。',
        sections: [
          ['为什么要封装工具', '说明 Agent 不能直接操作 shell，需要结构化、可解析的工具接口。'],
          ['封装 benchmark 工具', '把 Part 1 的计时脚本包成输入 kernel → 输出延迟/带宽的标准化工具。'],
          ['封装 profiling 工具', '把 rocprof 包成输入 kernel → 输出瓶颈信号的标准化工具。'],
          ['封装编译工具', '把 hipcc/triton 编译流程包成输入代码 → 输出编译成功/失败的标准化工具。'],
          ['工具的输入输出 schema', '用 JSON schema 定义每个工具的接口，让 Agent 能正确调用。'],
          ['错误处理与重试', '说明工具失败时如何把错误信息回传给 Agent 触发反思。']
        ]
      },
      {
        title: '算子优化 Agent 设计',
        summary: '读题→生成 kernel→跑分→反思迭代',
        status: '🚧',
        lead: '本章把前面封装的工具组装成一个完整的算子优化 Agent。读完后，你应该能理解 Agent 如何从一道算子题目出发，自动生成 kernel、跑 benchmark、根据结果反思改写。',
        sections: [
          ['Agent 的整体架构', '画出 读题 → 生成 → 编译 → 跑分 → 反思 的循环架构图。'],
          ['读题与问题理解', '让 Agent 解析题目规格（输入形状、数据类型、期望性能）。'],
          ['生成初始 kernel', '让 Agent 根据题目生成第一版 naive kernel 作为 baseline。'],
          ['跑分与性能反馈', '调用 benchmark 工具拿到延迟/带宽，转成 Agent 能理解的反馈。'],
          ['反思与改写', '让 Agent 根据 profiling 信号（访存瓶颈？计算瓶颈？）决定下一步优化方向。'],
          ['迭代终止条件', '说明什么时候停（达到目标性能、迭代轮次上限、连续无提升）。']
        ]
      },
      {
        title: '多轮优化实战',
        summary: 'Agent 把 naive kernel 优化 3-5x、失败回退、对比报告',
        status: '🚧',
        lead: '本章是 Agent 算子层篇的高潮：让 Agent 对一个 naive kernel 跑完整的多轮优化，观察它如何从慢版本一步步优化到 3-5 倍。重点是看 Agent 的行为轨迹，以及失败时如何回退。',
        sections: [
          ['选一个教学算子', '挑一个优化空间大的算子（如 reduction 或 matmul naive 版）作为 Agent 的优化对象。'],
          ['记录每轮优化的轨迹', '把 Agent 每轮的生成代码、benchmark 结果、反思内容完整落盘。'],
          ['观察性能提升曲线', '画出 Agent 多轮优化的性能变化，理解哪几轮提升最大、为什么。'],
          ['失败回退机制', '当某轮优化反而变慢或编译失败时，Agent 如何识别并回退到上一版。'],
          ['和人工优化的对比', '把 Agent 优化结果和人工优化的版本对比，讨论 Agent 的优势与局限。'],
          ['生成对比报告', '输出一份包含轨迹、性能曲线、关键决策的优化报告。']
        ]
      }
    ]
  },
  {
    prefix: '/part4-models-agent/',
    navText: '模型 + Agent',
    title: '真实模型 + Agent',
    readmeTitle: '第 4 篇：真实模型 + Agent',
    chapters: [
      {
        title: 'YOLO 部署 + Agent 自动优化',
        summary: 'ONNX/MIGraphX 部署、Agent profiling 找瓶颈、改配置/算子、对比',
        status: '🚧',
        lead: '本章把 Agent 的优化对象从单个教学算子升级为真实模型——YOLO。先快速部署 YOLO，再让 Agent 对它跑 profiling、识别瓶颈、给配置建议（batch/精度/算子融合）、改配置跑对比。注意：Agent 能改配置和换算子，但不能自动写新算子集成进 ONNX——这个边界在章首点明。',
        sections: [
          ['Agent 能力边界：算子层 vs 模型层', '明确本章 Agent 在模型层能做什么（profiling、改配置、换算子、出报告）、不能做什么（自动写新算子集成进 ONNX/MIGraphX）。'],
          ['YOLO 模型部署', '准备 YOLOv8 模型，导出 ONNX，用 MIGraphX 或 ONNX Runtime-ROCm 跑通推理。'],
          ['建立推理 baseline', '用第 4 章的 benchmark 习惯记录端到端延迟、吞吐和硬件上下文。'],
          ['Agent 跑推理 profiling', '让 Agent 自动 profiling，识别瓶颈在预处理、NMS、还是模型 kernel。'],
          ['Agent 给配置优化建议', '让 Agent 根据 profiling 信号给出 batch size、精度、算子融合等配置建议。'],
          ['改配置跑对比', '让 Agent 自动改配置、重跑 benchmark、对比优化前后性能。'],
          ['输出优化报告', '形成一份包含瓶颈判断、优化尝试、对比数据的 YOLO 优化报告。']
        ]
      },
      {
        title: '小模型 LLM 解码 + Agent 自动优化',
        summary: 'Qwen 0.5B/1.8B 量化、decode 算子视角、Agent 优化 KV cache/精度',
        status: '🚧',
        lead: '本章把 Agent 应用到 LLM 解码场景。受 9070XT 16GB 显存限制，只能量化小模型（Qwen 0.5B/1.8B）。重点是 decode 阶段的算子视角：Agent 如何优化 KV cache 访问、精度选择等。注意：PagedAttention、多卡 TP 等留给 hello-mlsys。',
        sections: [
          ['显存约束下的模型选型', '说明 9070XT 16GB 显存为什么选 Qwen 0.5B/1.8B 量化，跑不了 7B+。'],
          ['LLM 推理流程拆解', '拆解 prefill 和 decode 两个阶段，理解 decode 为什么是算子密集型。'],
          ['建立 decode baseline', '测量 TTFT、TPOT、KV cache 显存占用作为 baseline。'],
          ['decode 的算子视角', '把 decode 拆成 attention（KV cache 读取）+ matmul（投影）两个核心算子。'],
          ['Agent 优化 KV cache 访问', '让 Agent 分析 KV cache 的访存模式，给出精度/布局优化建议。'],
          ['Agent 优化精度选择', '让 Agent 对比 fp16/int8/int4 在 decode 性能和显存上的权衡。'],
          ['单卡边界与下一步', '明确 PagedAttention、多卡 TP、并发调度等留给 hello-mlsys。']
        ]
      }
    ]
  }
]

export function numberedChapters() {
  let number = 0
  return parts.flatMap((part) =>
    part.chapters.map((chapter) => {
      const chapterNumber = number++
      const partSlug = part.prefix.replace(/^\/|\/$/g, '')
      const chapterDir = `chapter${chapterNumber}`

      return {
        ...chapter,
        part,
        number: chapterNumber,
        path: `${part.prefix}${chapterDir}/`,
        source: `docs/${partSlug}/${chapterDir}/index.md`,
        code: `code/${partSlug}/${chapterDir}`,
      }
    }),
  )
}

// 附录：独立成篇，不进 numberedChapters 的连续正文编号。
// 附录编号用 appendix-A / appendix-B 这样的形式，避免和正文章号冲突。
export const appendices = [
  {
    title: '附录 A · 环境安装细节与常见坑',
    summary: '本篇环境文件是怎么来的、为什么 AMD wheel 源要 explicit、rocm-sdk init 的坑',
    lead: '主线内容只要求你会跑 uv sync 和几个验证命令。但很多读者还会想知道——这套环境文件到底是怎么来的？本附录从这个问题出发，按步骤拆开本篇环境的生成过程，顺便把几个反复出现的坑提前指出来。',
    slug: 'appendix-a',
    dir: 'appendix-a-env-install',
    path: '/appendix/appendix-a-env-install/',
    source: 'docs/appendix/appendix-a-env-install/index.md',
  },
  {
    title: '附录 B · 换一张卡：从 gfx120X-all 迁移到 gfx1151',
    summary: 'AMD wheel 源按架构分开打包，换卡时需要改哪些地方、为什么这么改',
    lead: '本教程的实验基线是 gfx120X-all（RX 9070 XT / gfx1201）+ ROCm 7.13.0。但如果你手上的是其它架构（比如 RDNA 3.5 的 gfx1151 / AI MAX 395），照着本教程的 pyproject.toml 抄下来，uv sync 很可能直接报错。本附录只回答一个问题：换一张卡，环境文件到底要动哪几行？',
    slug: 'appendix-b',
    dir: 'appendix-b-switch-gpu',
    path: '/appendix/appendix-b-switch-gpu/',
    source: 'docs/appendix/appendix-b-switch-gpu/index.md',
  },
]

export const chapters = numberedChapters()
export const chapterCount = chapters.length
export const appendixCount = appendices.length
export const bodyPartCount = parts.length - 1

export const navItems = [
  { text: '首页', link: '/' },
  { text: '全书目录', link: '/part0-intro/chapter0/' },
  { text: '实验环境', link: '/part0-intro/chapter1/' },
  { text: 'GitHub', link: 'https://github.com/datawhalechina/hello-gpu' },
]

export const sidebar = [
  ...parts.map((part) => ({
    text: part.readmeTitle,
    ...(part.landing ? { link: part.landing } : {}),
    collapsed: false,
    items: chapters
      .filter((chapter) => chapter.part.prefix === part.prefix)
      .map((chapter) => ({
        text: `第 ${chapter.number} 章 ${chapter.title}`,
        link: chapter.path,
      })),
  })),
  ...(appendixCount > 0
    ? [
        {
          text: '附录',
          collapsed: false,
          items: appendices.map((a) => ({
            text: a.title,
            link: a.path,
          })),
        },
      ]
    : []),
]
