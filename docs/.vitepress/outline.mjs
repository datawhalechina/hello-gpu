export const repoBaseUrl = 'https://github.com/datawhalechina/hello-gpu/blob/dev'

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
        summary: '9070XT + 原生 Ubuntu + ROCm 10.0 验证、Windows/WSL2 边界、uv 环境、最小 smoke test',
        status: '🚧',
        lead: '本章不深入讲 ROCm 软件栈原理，只用最短路径帮你确认实验环境能不能继续往后跑。读完后，你应该能通过 uv sync 复现本篇环境，确认 ROCm 能看到 GPU，并跑通最小 HIP 程序。',
        sections: [
          ['本教程的实验基线', '说明当前 RX 9070 XT / ROCm 10.0 环境，历史性能结果保留各自的采集版本'],
          ['平台边界：原生 Linux 优先，WSL2 需单独验证', '原生 Linux 是当前验证平台；WSL2 的驱动与功能需单独验证'],
          ['同步本篇 uv 环境', 'uv sync 拉取 ROCm wheel 并激活 venv'],
          ['验证 GPU 可见性', 'rocminfo 确认 gfx1201 与驱动状态'],
          ['验证 PyTorch ROCm', 'torch 版本与 HIP 后端的 smoke test'],
          ['验证最小 HIP 程序', 'hipcc 编译并跑通最小 kernel'],
          ['环境不通时先收集什么', '报错信息、驱动版本、uv 缓存等诊断素材清单'],
        ]
      },
      {
        title: 'GPU 体系结构（上）：编程模型与 wavefront 执行',
        summary: '从数组加法出发，理解计算流程、线程层级、数据索引与硬件执行',
        status: '✅',
        lead: '从数组加法出发，先理解 CPU 与 GPU 的分工、核函数与线程，再用动画认识 Grid、Block、Wavefront 与 Thread 的关系，最后学习数据索引与硬件执行。读完后，你应该能说清线程怎样组织、怎样找到数据，并区分线程分组与硬件单元。',
        sections: [
          ['GPU 计算的基本流程', '解释 CPU 与 GPU 的任务分工，以及一份核函数与多个线程的关系。'],
          ['线程的组织与执行', '先认识线程块与网格，再用动画理解 wavefront、thread 与 lane 的关系。'],
          ['线程编号与数据索引', '从线程块和块内编号推导数组下标，理解边界检查与 lane 编号。'],
          ['线程分组与硬件执行单元', '区分线程的逻辑组织和承接计算的硬件，CU/WGP 模式与设备字段作为选读。']
        ]
      },
      {
        title: 'GPU 体系结构（下）：数据存储与访问',
        summary: '从一次加法理解数据位置、成组访问、共享同步与访存等待',
        status: '✅',
        lead: '沿用数组加法，先定位数组、临时值和执行运算的部件，再观察一个线程的读写与一个 wavefront 的地址排列。随后用数组求和引出局部结果交接、LDS 与同步，最后理解等待时的指令调度。',
        sections: [
          ['数据位置与读写过程', '先用位置图区分数组、临时值和运算部件，再跟踪输入读入、执行加法与结果写回。'],
          ['Wavefront 的访存组织', '沿用数组任务，比较同一 wavefront 的地址排列，解释合并访存与缓存的用途。'],
          ['Block 内的数据共享与同步', '从完整求和任务产生两个局部和，再安排共享写入、block 同步与合并读取。'],
          ['访存等待与指令调度', '观察调度器怎样选择就绪指令，理解等待中的工作仍保留状态；资源细节进入补充材料。']
        ]
      },
      {
        title: '第一个程序 + 性能分析',
        summary: '从向量加法出发，编写 HIP 程序、验证结果并学习 GPU 计时',
        status: '✅',
        lead: '把数组加法写成完整 HIP 程序，逐步理解主机数据、设备存储、核函数启动与结果检查。再用 PyTorch 实现学习 GPU event 计时，明确测量范围，并从算法数据量解释有效带宽。',
        sections: [
          ['准备环境', '进入已经验证过的篇内环境，明确命令目录和本次实测配置。'],
          ['从向量加法到 HIP 程序', '从固定输入逐步展开分配、复制、线程索引、启动、等待与校验。'],
          ['测量 PyTorch 向量加法', '区分手写 HIP 与 PyTorch 实现，用预分配、预热、重复和 event 建立基准。'],
          ['解释测量结果', '读清 CPU 与 GPU 计时范围，用中位数和算法字节数计算有效带宽。'],
          ['从算子时间到程序时间', '区分设备 event、主机等待和包含数据拷贝的完整流程。'],
          ['记录与练习', '比较三个实际输入规模，手算线程覆盖和有效带宽，并记录测量条件。']
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
        summary: '从两种 event 计时方式理解预热、统计和有效带宽',
        status: '✅',
        lead: '沿用向量加法并加入数组复制，从一次真实输出逐步解释计时范围、预热、样本统计与字节换算，建立可以重复比较的基准。',
        sections: [
          ['先确定计时的起点和终点', '区分设备 event、批量时间和正确同步的端到端计时。'],
          ['运行一次完整的基准测试', '进入篇内环境，运行已验证的脚本并读懂输出字段。'],
          ['从准备数据到记录一个样本', '逐段解释预分配、预热、正确性检查与 event 采样。'],
          ['单次样本与批量平均值', '用计时图区分 min、median 与批量平均值。'],
          ['从时间算出有效带宽', '手算算法字节数与单位，说明有效带宽的证据边界。'],
          ['复测、记录与练习', '改变测量设置、保留实验记录，用手算题检查理解。']
        ]
      },
      {
        title: '用 rocprof 找到慢在哪里',
        summary: '运行向量加法、读懂 kernel trace，并设计公平对照',
        status: '✅',
        lead: '先运行两个向量加法并画出线程分工，再用 rocprofv3 采集 kernel trace，逐字段计算时间与线程数，结合源码提出下一步受控实验。',
        sections: [
          ['先运行两个向量加法', '解释编译、运行参数、计时口径和现有正确性抽查范围。'],
          ['把线程分工画出来', '用 lane 与数组下标示意解释两个 kernel 的索引。'],
          ['让 rocprofv3 记录 kernel 的执行', '从原命令逐步加入 profiler，并解释输出文件。'],
          ['从 CSV 中读懂一次启动', '按名字筛选并排除预热，再计算时间和 block 数。'],
          ['这些证据还不能说明什么', '区分静态资源、实际利用率和不可用的计数器。'],
          ['用 stride 扫描提出下一步实验', '保留非单调结果，区分地址映射、线程工作量与 grid 的共同变化。'],
          ['练习', '通过手算索引、读取 trace 和设计对照检查理解。']
        ]
      },
      {
        title: '读懂 Roofline 图',
        summary: '从一次加法计算工作点，理解带宽与算力参考线',
        status: '✅',
        lead: '先数清一次向量加法的运算与数据，再推导算术强度、屋顶形状和工作点。结合可追溯的历史实测，说明参考线的用途并提出可检验的假设。',
        sections: [
          ['一次加法包含多少工作', '从两个输入和一个输出推导计算量、数据量与算术强度。'],
          ['为什么图上的线像屋顶', '分别推导带宽与计算约束，交代实测参考值和单位。'],
          ['把一次测量变成一个点', '代入第 6 章的原始时间，算出工作点和有效带宽。'],
          ['生成图，并沿着坐标读一遍', '运行绘图脚本，解释对数坐标、工作点与参考线。'],
          ['从读图走到下一轮实验', '把图中观察变成受控实验，而不直接宣判瓶颈。'],
          ['练习', '用输入规模、数据类型与 copy 示例检验公式及解释边界。']
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
        summary: '从正确基线出发，实测地址排列、grid、float4 与 Triton tile，用逐轮比较决定下一步',
        status: '✅',
        lead: '保持同一份数组加法，分别建立 HIP 与 Triton 基线。每轮先提出问题，再修改一个设计选择，以 ROCm 10.0 实测与比较图决定保留或撤回；没有收益的改动同样记录。',
        sections: [
          ["逐元素算子的数据依赖", "用独立输出理解逐元素算子的共同分工。"],
          ["固定数学语义与正确性标准", "固定数学语义与正确性标准。"],
          ["建立成本模型和瓶颈假设", "建立成本模型和瓶颈假设。"],
          ["实现向量加法", "实现向量加法。"],
          ["正确性、Benchmark 与 Profiling", "正确性、Benchmark 与 Profiling。"],
          ["HIP 与 Triton 对照", "HIP 与 Triton 对照。"],
          ["负结果、适用边界与下一步", "负结果、适用边界与下一步。"],
          ["复跑与练习", "复跑与练习。"],
        ]
      },
      {
        title: 'Reduction：归约算子',
        summary: '从块内求和到完整归约，逐轮比较 HIP 合并方案与 Triton program 分工',
        status: '✅',
        lead: '先用八个数理解求和树，再建立 HIP 与 Triton 的完整归约基线。固定对照条件，分别研究跨块合并、局部累加和 program 数，以逐轮图与独立复测决定是否采用改动。',
        sections: [
          ['归约的数据依赖 {#reduction-dependency}', '从多个输入求一个和，理解归约与逐元素计算的区别。'],
          ['串行求和与并行求和树 {#reduction-tree}', '用八个数观察树状合并与线程间的数据依赖。'],
          ['正确性与计时约定 {#reduction-contract}', '区分输入、校验、计时区间及历史证据。'],
          ['HIP 与 Triton 优化路线 {#reduction-implementation}', '分别比较最终合并、局部工作量和块内协作；保留线程映射的负结果。'],
          ['比较结果与优化决策 {#reduction-results}', '用首次扫描与独立确认检验是否值得替换基线。'],
          ['实验复现与诊断 {#reduction-rerun}', '复跑冻结配置与完整计时，再分开读取目标阶段的 trace。'],
          ['练习：分工、测量与取舍 {#reduction-exercises}', '改变一个条件，记录结果并核对解释。'],
        ]
      },
      {
        title: 'Normalization：归一化算子',
        summary: '从稳定 Softmax 出发，分别验证行内协作、融合与 Triton 执行配置',
        status: '✅',
        lead: '先用一行数理解稳定 Softmax，再建立每行一个 block 的 HIP 基线、验证融合收益；Triton 分别比较 warps 与逻辑宽度，用不同形状和独立复测决定保留方案。',
        sections: [
          ["从一行分数到一行概率 {#softmax-semantics}", "从一行分数到一行概率 {#softmax-semantics}。"],
          ["平移输入，避免指数溢出 {#softmax-stability}", "平移输入，避免指数溢出 {#softmax-stability}。"],
          ["中间结果与计算边界 {#softmax-dataflow}", "中间结果与计算边界 {#softmax-dataflow}。"],
          ["正确性参考与计时范围 {#softmax-contract}", "正确性参考与计时范围 {#softmax-contract}。"],
          ["HIP 与 Triton 优化路线 {#softmax-implementation}", "HIP 与 Triton 优化路线 {#softmax-implementation}。"],
          ["比较结果与保留方案 {#softmax-results}", "比较结果与保留方案 {#softmax-results}。"],
          ["运行与诊断 {#softmax-rerun}", "运行与诊断 {#softmax-rerun}。"],
          ["练习：预测成本并验证 {#softmax-exercises}", "练习：预测成本并验证 {#softmax-exercises}。"],
        ]
      },
      {
        title: 'GEMM-Like：矩阵乘类算子',
        summary: '从点积与复用出发，逐轮验证 HIP LDS、Triton tile 与 program 分组',
        status: '✅',
        lead: '先用小矩阵理解输入复用，再建立 HIP/Triton 基线，逐轮比较分块和分组。通过尾部、矩形输入与独立复测决定采用哪些改动。',
        sections: [
          ["点积与矩阵布局 {#matmul-semantics}", "点积与矩阵布局 {#matmul-semantics}。"],
          ["分块与输入复用 {#matmul-reuse}", "分块与输入复用 {#matmul-reuse}。"],
          ["正确性与计时约定 {#matmul-contract}", "正确性与计时约定 {#matmul-contract}。"],
          ["HIP 与 Triton 优化路线 {#matmul-implementation}", "HIP 与 Triton 优化路线 {#matmul-implementation}。"],
          ["尾部与形状迁移 {#matmul-boundaries}", "尾部与形状迁移 {#matmul-boundaries}。"],
          ["结果与参数选择 {#matmul-results}", "结果与参数选择 {#matmul-results}。"],
          ["实验复现与练习 {#matmul-rerun}", "实验复现与练习 {#matmul-rerun}。"],
        ]
      },
      {
        title: 'Fusion：融合算子',
        summary: '从 Attention 物化基线出发，验证在线融合与 key 分块的收益和代价',
        status: '✅',
        lead: '先计算一个 query 行的加权和，再逐个 key 更新最大值、指数和与加权累计。比较物化和在线数据流，区分少写中间量、实际分配容量与最终运行时间。',
        sections: [
          ["Attention 的一行加权和 {#attention-semantics}", "Attention 的一行加权和 {#attention-semantics}。"],
          ["中间矩阵与物化成本 {#attention-materialization}", "中间矩阵与物化成本 {#attention-materialization}。"],
          ["在线 Softmax 与历史贡献 {#attention-online}", "在线 Softmax 与历史贡献 {#attention-online}。"],
          ["正确性参考与计时范围 {#attention-contract}", "正确性参考与计时范围 {#attention-contract}。"],
          ["HIP 与 Triton 优化路线 {#attention-implementation}", "HIP 与 Triton 优化路线 {#attention-implementation}。"],
          ["完整路径比较与方案选择 {#attention-results}", "完整路径比较与方案选择 {#attention-results}。"],
          ["运行与诊断 {#attention-reproduce}", "运行与诊断 {#attention-reproduce}。"],
          ["练习与下一轮实验 {#attention-exercises}", "练习与下一轮实验 {#attention-exercises}。"],
        ]
      },
      {
        title: '综合实战：Fused RMSNorm',
        summary: '从平方和与广播出发，逐轮验证行内线程数、warps 与多行 program',
        status: '✅',
        lead: '先确定行尺度与权重的依赖，再分别比较 HIP block、Triton warps 与短行 program 配置。用形状迁移、独立复测及 event/trace 的差异约束优化结论。',
        sections: [
          ["行统计量与逐列权重 {#rmsnorm-semantics}", "行统计量与逐列权重 {#rmsnorm-semantics}。"],
          ["归约依赖与融合范围 {#rmsnorm-dataflow}", "归约依赖与融合范围 {#rmsnorm-dataflow}。"],
          ["正确性参考与计时范围 {#rmsnorm-contract}", "正确性参考与计时范围 {#rmsnorm-contract}。"],
          ["HIP 与 Triton 优化路线 {#rmsnorm-implementation}", "HIP 与 Triton 优化路线 {#rmsnorm-implementation}。"],
          ["边界输入与形状迁移 {#rmsnorm-boundaries}", "边界输入与形状迁移 {#rmsnorm-boundaries}。"],
          ["实测结果与配置选择 {#rmsnorm-results}", "实测结果与配置选择 {#rmsnorm-results}。"],
          ["实验复现与练习 {#rmsnorm-rerun}", "实验复现与练习 {#rmsnorm-rerun}。"],
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
        summary: "从一次手动优化理解模型、工具与反馈循环",
        status: "✅",
        lead: "从向量加法的一次手动优化出发，讲清模型怎样提议、工具怎样提供反馈，以及基线、当前版本和候选的区别。",
        sections: [
          ["从一次手动优化说起", "从修改、检查与计时中区分模型判断和工具执行。"],
          ["把算子优化拆成一个闭环", "把任务、基线、候选评测与结果分析组织成完整实验。"],
          ["理解 ReAct 与反思", "根据可检查的工具反馈修正下一轮假设。"],
          ["模型怎样调用工具", "理解工具名、JSON 参数和结果回传。"],
          ["明确这套 Agent 能做什么", "明确固定任务中的搜索范围，以及结果可以推广到什么条件。"],
          ["练习：判断一份报告是否可信", "检查提议、观察和结论各自需要的证据。"]
        ]
      },
      {
        title: '工具封装',
        summary: "用结构化接口连接正确性、计时、瓶颈分析与接受判定",
        status: "✅",
        lead: "以固定任务为共同前提，逐层解释编译、正确性、计时、Roofline 估算与候选接受，区分测量和推算。",
        sections: [
          ["先固定任务，再设计工具", "分开候选源码和不可随意改变的实验条件。"],
          ["编译通过之后，还要对答案", "按失败阶段解释 compile_kernel 的结果。"],
          ["计时工具回答“这份源码有多快”", "说明测量边界、统计量与有效吞吐的来源。"],
          ["用 Roofline 建立假设", "说明当前估算字段与硬件计数器的区别。"],
          ["接受候选需要重新配对比较", "以配对样本、阈值和正改进比例决定是否替换。"],
          ["根据失败阶段决定下一步", "把错误映射到具体检查，并说明记录范围。"],
          ["练习：为结果找对解释", "练习读取结果和辨别证据。"]
        ]
      },
      {
        title: '算子优化 Agent 设计',
        summary: "连接工具、管理候选状态并判断何时结束",
        status: "✅",
        lead: "沿候选的生命周期阅读模型、工具和工作区，区分提示词建议、程序约束及完成状态。",
        sections: [
          ["把系统分成三个部分", "区分模型、工具和工作区的职责。"],
          ["先把问题整理成可检查的任务", "理解交互式输入与预置任务的共同约束。"],
          ["让一项假设对应一份候选", "每次只改变一个主要因素，并核对实际源码。"],
          ["管理已经测过、尚未裁决的候选", "解释 pending_candidate 状态和源码一致性检查。"],
          ["用反馈调整下一次尝试", "由错误、配对结果和估算信号提出下一步。"],
          ["区分停止、完成与加速", "检查模型步数、完成状态与真实证据。"],
          ["练习：沿着状态检查程序", "跟踪候选从测量到裁决的状态变化。"]
        ]
      },
      {
        title: '多轮优化实战',
        summary: "用向量加法学习运行、读图、独立复测与报告",
        status: "✅",
        lead: "有了评测工具和 Agent 循环，我们可以尝试优化一个具体的算子。从向量加法出发，运行搜索、观察候选的变化，再比较优化前后的执行时间。",
        sections: [
          ["选择一个能读懂结果的任务", "固定向量加法的语义、输入和基线。"],
          ["运行之前固定基线与记录范围", "集中说明现有入口、环境前提与配置。"],
          ["先检查产物，再读性能数字", "区分运行状态、裁决摘要和完整实验档案。"],
          ["分清搜索曲线里的三种量", "读懂候选延迟、当前版本记录与配对改进。"],
          ["独立复测回答整体收益", "重新比较原始基线与最终版本。"],
          ["写一份读者能核对的报告", "将结论逐项连接到证据和限制。"],
          ["练习：完成一次可复盘的优化", "检查完成、接受与加速的不同证据。"]
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
        summary: 'LFM2.5-8B-A1B 量化（GGUF）、decode 算子视角、Agent 优化 KV cache/精度',
        status: '🚧',
        lead: '本章把 Agent 应用到 LLM 解码场景。受书基线 16GB 显存限制，选型 MoE 小模型 LFM2.5-8B-A1B（A1B：每 token 只激活 1 个专家）的 GGUF 量化版本（Q4_K_M，4.79 GiB），用 llama.cpp ROCm 后端实测。decode 基线、RPB/nwarps 扫描与 Q4 vs Q8 精度对比均来自真实实验（RX 7900 XTX，数字以标注平台为准）。PagedAttention、多卡 TP 等留给 hello-mlsys。',
        sections: [
          ['显存约束下的模型选型', '16GB 显存与 AMD 量化生态决定选型：fp16 8B 放不下，选 MoE A1B + GGUF 量化（4.79 GiB 全驻留）；vLLM 量化路径在 RDNA3 消费卡上几乎全灭，走 llama.cpp。'],
          ['LLM 推理流程拆解', '拆解 prefill 和 decode 两个阶段，理解 decode 为什么是算子密集型。'],
          ['建立 decode baseline', '用固定生成长度、重复多次的方式测量 TPOT，建立可归因的 decode 基线。'],
          ['decode 的算子视角', '把 decode 拆成 attention（KV cache 读取）+ matmul（投影）两个核心算子，推导吞吐上限并与实测对照。'],
          ['Agent 优化 KV cache 访问', 'KV cache 访存模式与 decode 固定开销；KV 优化杠杆是结构改变而非配置搜索，完整轨迹见第 17 章。'],
          ['Agent 优化精度选择', 'Q4_K_M vs Q8_0 真实扫描：默认配置 Q4 快 11%，统一 nw=1 后 Q8 反超 34%（与 NVIDIA 相反）——精度 × 调度是组合实验，微基准不可外推。'],
          ['单卡边界与下一步', '显存/生态/计算三重边界：FP8 路径在消费卡不可用；PagedAttention、多卡 TP、并发调度留给 hello-mlsys。']
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
    summary: '本篇环境文件是怎么来的、ROCm 10.0 设备 extras 与依赖源、rocm-sdk init 的坑',
    lead: '主线内容只要求你会跑 uv sync 和几个验证命令。但很多读者还会想知道——这套环境文件到底是怎么来的？本附录从这个问题出发，按步骤拆开本篇环境的生成过程，顺便把几个反复出现的坑提前指出来。',
    slug: 'appendix-a',
    dir: 'appendix-a-env-install',
    path: '/appendix/appendix-a-env-install/',
    source: 'docs/appendix/appendix-a-env-install/index.md',
  },
  {
    title: '附录 B · 换一张卡：切换 ROCm 10.0 的 GPU 架构',
    summary: '从 GPU 型号查到设备标签，修改三处配置，再安装并验证 ROCm 10.0 环境',
    lead: '从尚未创建 Python 虚拟环境开始，沿架构表找到自己 GPU 的 LLVM Target 和设备标签，在完整配置中修改三个 extra，再进入配置所在目录运行 uv sync。设备依赖由 uv 自动选择，安装后核对实际 GPU 并完成一次张量运算。',
    slug: 'appendix-b',
    dir: 'appendix-b-switch-gpu',
    path: '/appendix/appendix-b-switch-gpu/',
    source: 'docs/appendix/appendix-b-switch-gpu/index.md',
  },
  {
    title: '附录 C · 裸金属视角：绕过 HIP 直接写 AQL',
    summary: 'KFD dispatch 实测、ISA 编码实战，理解 HIP 底下发生了什么',
    lead: '第 4.5 节讲了 dispatch 开销。本附录把这层彻底掀开：直接绕过 HIP，通过 Linux 的 KFD 驱动把 dispatch packet 写进 GPU 队列，看看裸金属到底能省多少、以及「手写 ISA」是什么体验。素材来自 t0-gpu 项目在 RX 7900 XTX 上的真实实验：KFD async 2.26μs vs HIP 2.6μs、v_perm_b32 的 4 个 ISA 编码 bug、以及 600 行 Rust GEMM 反超 rocBLAS 的实测。',
    slug: 'appendix-c',
    dir: 'appendix-c-kfd-bare-metal',
    path: '/appendix/appendix-c-kfd-bare-metal/',
    source: 'docs/appendix/appendix-c-kfd-bare-metal/index.md',
  },,
  {
    title: '附录 D · HIP 与 Triton 的编程范式',
    summary: '用同一个向量加法理解 thread、block、program、tile 与 mask',
    lead: '从一个带尾部的小数组出发，对应主机启动、设备工作和边界处理，作为第 8–13 章的可选入门。',
    slug: 'appendix-d',
    dir: 'programming-models',
    path: '/appendix/programming-models/',
    source: 'docs/appendix/programming-models/index.md',
  }
]

export const chapters = numberedChapters()
export const chapterCount = chapters.length
export const appendixCount = appendices.length

export const navItems = [
  { text: '全书目录', link: '/curriculum/' },
  { text: 'GPU 图谱', link: '/atlas/', activeMatch: '^/atlas/' },
  { text: '实验环境', link: '/part0-intro/chapter1/' },
  { text: 'AMD 云算力', link: '/cloud/' },
  { text: 'GitHub', link: 'https://github.com/datawhalechina/hello-gpu' },
]

export const sidebar = [
  ...parts.map((part) => ({
    text: part.readmeTitle,
    ...(part.landing ? { link: part.landing } : {}),
    collapsed: true,
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
          collapsed: true,
          items: appendices.map((a) => ({
            text: a.title,
            link: a.path,
          })),
        },
      ]
    : []),
  {
    text: 'AMD 云算力资源',
    link: '/cloud/',
    collapsed: true,
    items: [
      { text: 'AMD Radeon Cloud', link: '/cloud/amd-radeon-cloud/' },
      { text: 'AUP Learning Cloud', link: '/cloud/aup-learning-cloud/' },
    ],
  },
]
