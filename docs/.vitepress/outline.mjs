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
        summary: 'vector add 跑通、baseline benchmark、CPU vs GPU 与带宽利用率分析',
        status: '🚧',
        lead: '本章在已经验证环境可用、且对硬件有基本心智模型的基础上，带你跑通第一个真正的 GPU 程序——vector add。重点不是算子本身，而是借此建立后续所有实验都会复用的计时习惯，并读懂量出来的数字：用算术强度和带宽利用率，建立「这个算子离硬件极限有多远」的直觉。本章的 vector add 会贯穿整个 Part 1 profiling 篇。',
        sections: [
          ['从已经验证的环境开始', '复用第 1 章的环境验证结果，直接进入本章代码目录。'],
          ['跑通 vector add', '编写、编译并运行一个最小 HIP kernel，确认结果正确。'],
          ['建立 baseline benchmark', '用固定输入、热身、重复运行和 GPU event 建立可复查的计时 baseline。'],
          ['性能分析：CPU vs GPU 与带宽利用率', '对比 CPU/GPU 实测耗时，算算术强度判断 memory-bound，再用实测带宽对标称带宽估算利用率。'],
          ['dispatch 开销：launch 本身要多久', '从 HIP API 到 AQL packet 的 dispatch 链路、async/sync 实测对比，以及 launch 开销对短 kernel 的意义。'],
          ['留下实验底稿', '说明源码、命令输出、benchmark 配置应该如何对应到一份可复查的实验记录。']
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
        status: '✅',
        lead: '本章从最容易看懂的 Vector Add 开始，先认识“逐元素”到底是什么意思，再把同一个问题拆成两条可以独立选择的路线：HIP 篇带你看清线程、地址和显存访问，Triton 篇带你用较少代码表达一整块数据。两条路线最后回到同一组正确性与性能问题，让你知道工具不同，判断方法为什么仍然相通。',
        sections: [
          ['先认识 Element-Wise', '逐元素算子的形态与典型例子'],
          ['固定数学语义与正确性标准', '先定义对/错再谈快慢：precheck/postcheck 口径'],
          ['建立成本模型和瓶颈假设', '算术强度 1/12，访存受限的预期'],
          ['HIP：从标量线程到受控访存实验', 'v0→v3 ladder：地址顺序、grid、向量化与尾部'],
          ['Triton：从最小 Tile 到参数实验', 't0/t1：BLOCK_SIZE 与 num_warps 扫描'],
          ['正确性、Benchmark 与 Profiling', '统一验收：正确性矩阵 + 可信计时 + trace'],
          ['HIP 与 Triton 对照', '两条路线同一数学语义、不同抽象层次'],
          ['负结果、适用边界与下一步', '哪些没优化成功、结论能迁移到什么范围'],
          ['复跑、练习与验收', '复跑命令、练习与验收清单'],
        ]
      },
      {
        title: 'Reduction：归约算子',
        summary: '以 Sum Reduction 为例，学习跨线程协作、LDS 与 Wave Shuffle',
        status: '✅',
        lead: '本章撤掉 Element-Wise 中“每个输出彼此独立”的前提：很多输入要共同得到一个结果。公共部分先把串行求和画成并行树；HIP 篇深入 LDS、同步与 Wave Shuffle，Triton 篇用 program partial 和多阶段归约快速表达同一层次。',
        sections: [
          ['从“每个输出独立”到“大家合成一个结果”', '归约的数学语义：多输入合成单输出'],
          ['手算一棵归约树', '串行求和与并行树，树高与精度'],
          ['先固定正确性和测量口径', '语义、误差与计时口径先行'],
          ['HIP atomic baseline：先得到最短的正确版本', 'atomic 直接相加的最短正确实现'],
          ['HIP LDS：把全局竞争缩小到每个 block 一次', 'LDS 块内归约，全局只剩一次竞争'],
          ['HIP 局部累加、Wave Shuffle 与二阶段 partial', 'warp 内 shuffle 与二阶段 partial'],
          ['Triton：program partial + second reduction', 'Triton 的 partial 与第二次归约'],
          ['把 HIP 与 Triton 放回同一棵树', '两条路线对照同一棵归约树'],
          ['一键运行与 `rocprofv3` Profiling', '复跑与 profiling 入口'],
          ['练习与验收', '练习与验收清单'],
        ]
      },
      {
        title: 'Normalization：归一化算子',
        summary: '以行级 Softmax 为例，学习数值稳定与逐元素/归约融合',
        status: '✅',
        lead: '本章把 Element-Wise 与 Reduction 组合起来：Softmax 既要逐元素取指数，又要两次归约。公共部分先用大数反例理解“减最大值”；HIP 篇观察中间写回与数据驻留，Triton 篇学习一行对应一个 program 的融合表达。',
        sections: [
          ['逐行 Softmax 到底算什么', 'softmax 的数学语义：按行归一化'],
          ['为什么直接取指数会溢出', 'exp 溢出与数值稳定性的动机'],
          ['拆成四种基本模式', '读整行、减 max、取指数、归一化四步'],
          ['先固定正确性与计时口径', '语义、误差与计时口径先行'],
          ['HIP baseline：把三次 dispatch 看清楚', 'max/sum/div 三次 kernel 的代价'],
          ['HIP 行融合：一个 block 完成一行', 'LDS 行缓存与单 kernel 融合'],
          ['wave32、LDS 与融合边界', 'wave32 与 LDS 容量决定的融合边界'],
          ['Triton：一行对应一个 program', 'Triton 的行映射与在线归一化'],
          ['稳定性与边界测试矩阵', '边界形状与数值稳定性测试'],
          ['HIP 与 Triton 对照', '两条路线的层次对照'],
          ['运行与读取结果', '运行输出与结果解读'],
          ['用 rocprofv3 看融合发生在哪里', 'trace 验证 kernel 是否真的融合'],
          ['练习', '练习与验收'],
        ]
      },
      {
        title: 'GEMM-Like：矩阵乘类算子',
        summary: '以 Matmul 为例，学习分块、数据复用与寄存器累加',
        status: '✅',
        lead: '本章第一次让同一份输入被多个输出反复使用。公共部分从点积和小矩阵开始画 tile；HIP 篇显式管理 LDS 与线程 fragment，Triton 篇用 program/tile 表达同一复用，并把 autotune 限制为可解释的受控实验。',
        sections: [
          ['从点积看矩阵乘', '矩阵乘的数学语义与逐点积视角'],
          ['为什么朴素实现重复读取', '朴素实现的访存放大'],
          ['Tile 为什么能带来复用', '分块后的数据复用与算术强度'],
          ['HIP v0：一线程一输出', '最短正确版本'],
          ['HIP v1：LDS 分块', 'LDS 分块与协同加载'],
          ['寄存器分块：为什么一个 thread 会计算多个输出', '寄存器分块与输出复用'],
          ['HIP 进阶实验怎样保持单变量', '进阶实验的单变量控制'],
          ['Triton t0：用 `tl.dot` 表达同一分块', 'Triton 的 tiled matmul'],
          ['Triton t1：Grouped ordering 改变什么', 'program 排序对访存的影响'],
          ['非方阵与三种尾块', '非方阵形状与尾块处理'],
          ['HIP 与 Triton 的分块层次对照', '两条路线的分块层次对照'],
          ['tile 形状怎么选', '访存受限 shape 的配置选择规则'],
          ['运行、输出与 Profiling', '运行输出与 profiling 入口'],
          ['练习', '练习与验收'],
        ]
      },
      {
        title: 'Fusion：融合算子',
        summary: '用 FlashAttention-style 在线 Attention 学习减少中间写回与 IO-aware',
        status: '✅',
        lead: '本章把前四章的模式组合起来：矩阵乘产生 Scores，Softmax 做归一化，再与 V 相乘。公共部分先比较物化与在线数据流；HIP/Triton 两条路线分别实现教学版前向 Attention，并已完成三进程正式测量与逐实现 trace。',
        sections: [
          ['先固定 Attention 的语义', 'attention 的数学语义与记号'],
          ['物化版本的数据流', '物化中间矩阵的代价'],
          ['在线 Softmax 的四个状态', 'running max/sum 的四个状态'],
          ['HIP materialized：三段式基线', '物化三 kernel 基线'],
          ['HIP online：一行一个 block', '在线融合的单 kernel 实现'],
          ['Triton：一个 program 处理一行', 'Triton 的行映射实现'],
          ['正确性矩阵', '正确性验证矩阵'],
          ['计时和 Profiling 看什么', '计时口径与 profiling 信号'],
          ['HIP 与 Triton 的层次对照', '两条路线的对照'],
          ['练习：逐步接近真实 Attention', '练习与延伸方向'],
        ]
      },
      {
        title: '综合实战：Fused RMSNorm',
        summary: '综合逐元素、归约与融合，独立完成一次可复现的 Kernel 优化闭环',
        status: '✅',
        lead: '本章是 Part 2 的综合终章：不再引入新的优化名词，而是用 Fused RMSNorm 把逐元素、归约、融合、正确性、benchmark 与 profiling 串成一次独立完成的优化记录。HIP/Triton、边界正确性、三进程测量与逐实现 trace 已完成。',
        sections: [
          ['从 LayerNorm 到 RMSNorm', 'RMSNorm 的数学语义与为什么省略均值'],
          ['先锁定实验契约', '固定语义、误差与目标 shape'],
          ['HIP serial：最短正确基线', '最短正确基线'],
          ['HIP block：协作归约并融合写回', '块内协作归约与融合写回'],
          ['Triton：一行一个 program', 'Triton 的行映射实现'],
          ['融合到底省掉了什么', '融合省掉的 dispatch 与中间读写'],
          ['一次完整的运行与检查', '完整运行与 evidence 检查'],
          ['Profiling 与单变量实验', 'profiling 信号与单变量实验'],
          ['HIP 与 Triton 对照', '两条路线的对照'],
          ['独立优化记录模板', '可复用的优化记录模板'],
          ['迁移到新题目', '从 RMSNorm 迁移到新题目的方法'],
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
  },
]

export const chapters = numberedChapters()
export const chapterCount = chapters.length
export const appendixCount = appendices.length

export const navItems = [
  { text: '首页', link: '/' },
  { text: '全书目录', link: '/part0-intro/chapter0/' },
  { text: '实验环境', link: '/part0-intro/chapter1/' },
  { text: 'AMD 云算力', link: '/cloud/' },
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
  {
    text: 'AMD 云算力资源',
    link: '/cloud/',
    collapsed: false,
    items: [
      { text: 'AMD Radeon Cloud', link: '/cloud/amd-radeon-cloud/' },
      { text: 'AUP Learning Cloud', link: '/cloud/aup-learning-cloud/' },
    ],
  },
]
