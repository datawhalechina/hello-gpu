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
        summary: '9070XT + 原生 Ubuntu + ROCm 7.13 验证、Windows/WSL2 边界、uv 环境、最小 smoke test',
        status: '🚧',
        lead: '本章不深入讲 ROCm 软件栈原理，只用最短路径帮你确认实验环境能不能继续往后跑。读完后，你应该能通过 uv sync 复现本篇环境，确认 ROCm 能看到 GPU，并跑通最小 HIP 程序。',
        sections: [
          ['本教程的实验基线', '锚定书基线 RX 9070 XT / ROCm 7.13，全书实验数字都挂在这套组合上'],
          ['平台边界：原生 Linux 优先，WSL2 可用', '原生 Linux 是唯一实验平台；WSL2 可跑通但不作性能结论'],
          ['同步本篇 uv 环境', 'uv sync 拉取 ROCm wheel 并激活 venv'],
          ['验证 GPU 可见性', 'rocminfo 确认 gfx1201 与驱动状态'],
          ['验证 PyTorch ROCm', 'torch 版本与 HIP 后端的 smoke test'],
          ['验证最小 HIP 程序', 'hipcc 编译并跑通最小 kernel'],
          ['环境不通时先收集什么', '报错信息、驱动版本、uv 缓存等诊断素材清单'],
        ]
      },
      {
        title: 'GPU 体系结构（上）：编程模型与 wavefront 执行',
        summary: '从数组加法出发，理解线程编号、工作分组、wavefront 执行与分支掩码',
        status: '✅',
        lead: '从已经见过的数组加法出发，先看一个线程负责哪份工作，再用手算推导编号、放大 wavefront 的执行过程，最后用参与状态解释分支与 EXEC。读完后，你应该能算出线程下标，并区分软件分工与硬件执行。',
        sections: [
          ['从一份数组加法到多个线程', '用同下标相加建立一线程一元素的分工，解释 kernel 与启动。'],
          ['线程怎样编号和分块', '先手算块编号与局部偏移，再回到索引公式和越界判断。'],
          ['一个线程块怎样组成 wavefront', '区分块内线程编号与 wave 内 lane 编号，解释同指令与不同数据。'],
          ['分支、EXEC 与有效 lane', '用固定 lane 的分镜理解参与状态，区分 wavefront 内部与 wavefront 之间的分支差异。'],
          ['wavefront 在哪里执行：软件分工与硬件单元', '把逻辑工作放到硬件上理解，CU/WGP 模式与设备字段作为选读。'],
          ['选做实验：比较两种分支排列', '保留已有受控对照、复跑命令与证据，不从示意图计算固定罚时。']
        ]
      },
      {
        title: 'GPU 体系结构（下）：片上资源与数据通路',
        summary: '跟着一次加法认识寄存器、缓存与 LDS，再理解合并访存和延迟隐藏',
        status: '✅',
        lead: '继续追踪数组加法的输入、临时值与结果，先解释数据存放在哪里，再比较地址排列、共享协作和等待时的执行机会。占用率在资源用途之后介绍，bank 冲突与 WMMA 留作选读。',
        sections: [
          ['跟着一个元素完成一次加法', '用读入、计算、写回建立数据过程和寄存器用途。'],
          ['同样是存数据，谁在使用和管理', '区分 VGPR、SGPR、LDS、缓存与全局内存的职责和范围。'],
          ['相邻线程怎样读取数据：合并访存', '展开 lane 到元素的映射，再读已有步长实验与逻辑有效带宽。'],
          ['线程怎样通过 LDS 协作', '先讲显式写入、同步和读取，再回到现有源码中的协作片段。'],
          ['等数据时做什么：延迟隐藏与占用率', '先区分驻留、就绪、执行，再讨论资源约束与性能权衡。'],
          ['选读：LDS 里的 bank 冲突', '用服务入口理解不同地址的竞争，保留实测与机制证据的边界。'],
          ['选读：认识矩阵专用指令 WMMA', '建立 wavefront 协作的矩阵块视角，具体接口和已有实验放入折叠区。']
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
        summary: '从数组加法和下标动画出发，理解连续访存、线程循环、向量化尾部与 Triton mask',
        status: '✅',
        lead: '先用数组加法认识输出依赖和访存成本，再选择 HIP 或 Triton 标签阅读实现。下标与尾部动画帮助连接源码和数据，公共实验解释当前测量支持了哪些判断。',
        sections: [
          ["先认识 Element-Wise", "先认识 Element-Wise。"],
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
        summary: '用求和树与实际部分和理解 LDS 协作、全局竞争和多阶段归约',
        status: '✅',
        lead: '先把八个数的顺序求和改写成求和树，再把层次映射到线程、block partial 和第二次归约。结合实际输入与计时差异理解证据的适用范围。',
        sections: [
          ["多个输入怎样合成一个输出 {#reduction-dependency}", "多个输入怎样合成一个输出 {#reduction-dependency}。"],
          ["把串行依赖改成求和树 {#reduction-tree}", "把串行依赖改成求和树 {#reduction-tree}。"],
          ["怎样确认答案和时间都可信 {#reduction-contract}", "怎样确认答案和时间都可信 {#reduction-contract}。"],
          ["用 HIP 或 Triton 实现同一层次 {#reduction-implementation}", "用 HIP 或 Triton 实现同一层次 {#reduction-implementation}。"],
          ["用实测结果检查归约层次 {#reduction-results}", "用实测结果检查归约层次 {#reduction-results}。"],
          ["复跑时先检查结果，再读 trace {#reduction-rerun}", "复跑时先检查结果，再读 trace {#reduction-rerun}。"],
          ["练习：改变一个条件再解释 {#reduction-exercises}", "练习：改变一个条件再解释 {#reduction-exercises}。"],
        ]
      },
      {
        title: 'Normalization：归一化算子',
        summary: '用一行大分数理解稳定 Softmax、行内归约与中间数据融合',
        status: '✅',
        lead: '先把一行大分数变成稳定的概率，再观察整行数据怎样在归约与逐元素计算间流动。两条语言路线共用数值解释，历史结果与同步修正版验证分别记录。',
        sections: [
          ["从一行分数到一行概率 {#softmax-semantics}", "从一行分数到一行概率 {#softmax-semantics}。"],
          ["平移输入，避免指数溢出 {#softmax-stability}", "平移输入，避免指数溢出 {#softmax-stability}。"],
          ["中间结果需要放在哪里 {#softmax-dataflow}", "中间结果需要放在哪里 {#softmax-dataflow}。"],
          ["固定正确性和完整计时 {#softmax-contract}", "固定正确性和完整计时 {#softmax-contract}。"],
          ["用 HIP 或 Triton 完成整行 {#softmax-implementation}", "用 HIP 或 Triton 完成整行 {#softmax-implementation}。"],
          ["先读测量，再解释融合收益 {#softmax-results}", "先读测量，再解释融合收益 {#softmax-results}。"],
          ["运行、筛选 trace 与检查边界 {#softmax-rerun}", "运行、筛选 trace 与检查边界 {#softmax-rerun}。"],
          ["练习：预测数值与成本 {#softmax-exercises}", "练习：预测数值与成本 {#softmax-exercises}。"],
        ]
      },
      {
        title: 'GEMM-Like：矩阵乘类算子',
        summary: '从小矩阵点积与复用动画出发，学习 HIP/Triton 分块、尾部和资源取舍',
        status: '✅',
        lead: '沿用一个小矩阵解释点积、部分和与输入复用，再分别阅读 HIP LDS 和 Triton tile 实现。用尾块、精度与当前固定形状的结果约束参数选择。',
        sections: [
          ["从一个输出看矩阵乘", "从一个输出看矩阵乘。"],
          ["把重复使用的数据放在一起", "把重复使用的数据放在一起。"],
          ["用两种方式表达分块", "用两种方式表达分块。"],
          ["尾块和精度都属于正确性", "尾块和精度都属于正确性。"],
          ["实测支持了哪些判断", "实测支持了哪些判断。"],
          ["选择 tile 时，先提出可验证的问题", "选择 tile 时，先提出可验证的问题。"],
          ["复跑与练习", "复跑与练习。"],
        ]
      },
      {
        title: 'Fusion：融合算子',
        summary: '从 Attention 加权和推导在线 Softmax，用具体数值理解历史状态重缩放',
        status: '✅',
        lead: '先计算一个 query 行的加权和，再逐个 key 更新最大值、指数和与加权累计。比较物化和在线数据流，区分少写中间量、实际分配容量与最终运行时间。',
        sections: [
          ["一行 Attention 输出依赖什么", "一行 Attention 输出依赖什么。"],
          ["把中间结果存下来会发生什么", "把中间结果存下来会发生什么。"],
          ["边读 key，边更新 Softmax", "边读 key，边更新 Softmax。"],
          ["用 HIP 或 Triton 表达这段数据流", "用 HIP 或 Triton 表达这段数据流。"],
          ["怎样检查结果和计时", "怎样检查结果和计时。"],
          ["少写回，为什么仍可能更慢", "少写回，为什么仍可能更慢。"],
          ["复跑并提出下一轮问题", "复跑并提出下一轮问题。"],
          ["练习：先预测，再改变一个条件", "练习：先预测，再改变一个条件。"],
        ]
      },
      {
        title: '综合实战：Fused RMSNorm',
        summary: '从平方和、行尺度与广播出发，综合归约、融合和可解释的参数实验',
        status: '✅',
        lead: '先为一行输入求均方根尺度，再广播回各位置并乘权重。把逐元素、归约和融合连起来，比较行内协作与配置，并用现有证据练习提出下一轮问题。',
        sections: [
          ["先为一行数据算出尺度", "先为一行数据算出尺度。"],
          ["找到归约与融合的边界", "找到归约与融合的边界。"],
          ["选择 HIP 或 Triton 实现", "选择 HIP 或 Triton 实现。"],
          ["用边界输入检验公式与下标", "用边界输入检验公式与下标。"],
          ["从实测看行内协作", "从实测看行内协作。"],
          ["运行后，先筛选目标 kernel", "运行后，先筛选目标 kernel。"],
          ["把这一章变成自己的实验", "把这一章变成自己的实验。"],
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
        status: '✅',
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
        summary: 'compile/bench/profile 三件套 + accept_candidate',
        status: '✅',
        lead: '本章把 Part 1 学过的 benchmark、rocprof 以及编译流程，封装成 Agent 能调用的标准化工具。这是让 Agent「能动手」的前提——没有工具的 Agent 只会空谈。',
        sections: [
          ['为什么要封装工具', '说明 Agent 不能直接操作 shell，需要结构化、可解析、分层的工具接口。'],
          ['封装 benchmark 工具', '把 Part 1 的计时脚本包成 bench_kernel：输入 kernel → 输出 mean/median/p95/带宽。'],
          ['封装 profiling 工具', '把 Roofline/rocprof 包成 profile_kernel：输入 kernel → 输出瓶颈信号。'],
          ['封装编译工具', '把 Triton JIT/正确性包成 compile_kernel：输入代码 → 按行错误列表。'],
          ['工具的输入输出 schema', '用 JSON schema 定义三件套与 accept_candidate，共享 task contract。'],
          ['错误处理与重试', '工具失败不算任务失败：结构化错误回流，拒绝时不覆盖 best。']
        ]
      },
      {
        title: '算子优化 Agent 设计',
        summary: '读题→compile/bench/profile→accept 迭代',
        status: '✅',
        lead: '本章把前面封装的工具组装成一个完整的算子优化 Agent。读完后，你应该能理解 Agent 如何从一道算子题目出发，自动生成 kernel、跑 benchmark、根据结果反思改写。',
        sections: [
          ['Agent 的整体架构', '画出 读题 → 生成 → compile → bench → profile → accept → 反思 的循环架构图。'],
          ['读题与问题理解', '让 Agent 解析题目规格（输入形状、数据类型、期望性能）并建成 task contract。'],
          ['生成初始 kernel', '让 Agent 根据题目生成第一版 naive kernel 作为 baseline。'],
          ['跑分与性能反馈', '调用三件套拿到延迟/带宽/瓶颈，再经 accept_candidate 配对裁决。'],
          ['反思与改写', '让 Agent 根据 profiling 信号（访存瓶颈？计算瓶颈？）决定下一步优化方向。'],
          ['迭代终止条件', '说明什么时候停（达到目标性能、迭代轮次上限、连续无提升）。']
        ]
      },
      {
        title: '多轮优化实战',
        summary: 'vector_add 真实轨迹 ≈2.19×、失败回退、对比报告',
        status: '✅',
        lead: '本章是 Agent 算子层篇的高潮：在本机跑通完整多轮优化，用真实轨迹与可视化观察提升曲线与失败回退。教程 3–5× 叙事留给高头寸算子；vector_add 用来证明闭环可信。',
        sections: [
          ['选一个教学算子', '默认 vector_add fixtures 验收闭环；高头寸算子冲击 3–5×。'],
          ['记录每轮优化的轨迹', '把 Agent 每轮的生成代码、benchmark 结果、反思内容完整落盘到 trajectory.jsonl。'],
          ['观察性能提升曲线', '嵌入真实跑数与可视化：0.705→0.322 ms（≈2.19×）。'],
          ['失败回退机制', '当某轮优化反而变慢或编译失败时，不更新 best，失败照样留痕。'],
          ['和人工优化的对比', '讨论 Agent 擅长执行与留痕、关键结构洞察仍常需人机协作。'],
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
