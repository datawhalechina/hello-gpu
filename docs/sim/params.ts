/**
 * 模拟器 L3、L4 的参数表（08 第 5 节）。
 *
 * 表里每个数都是「示意」值：为了让读者能手算、能比较两种写法而选的，不是哪块显卡的实测数据。
 * 用这些数算出来的车次、轮数、周期数、占用率，界面上一律标注「模拟」。模拟器的其他文件不写这些数，都从这里取。
 * 和真机文档里的数一样的，也只是借来当示意值；本教程用的 RX 9070 XT 查不到出处的，写「[待实测]」。
 *
 * 取值理由里引用的资料：
 * [1] AMD GPUOpen《RDNA Architecture》演示文稿，「Single-cycle instruction issue on RDNA」「Vector register file (VGPRs)」
 *     「LDS per workgroup processor」「Caches – Some numbers」几页：
 *     https://gpuopen.com/download/RDNA_Architecture_public.pdf
 * [2] AMD《"RDNA4" Instruction Set Architecture Reference Guide》（2025-04-07）第 1.2.2.1、2.1、2.3、3.3.2.1、3.3.5、12、12.1 节：
 *     https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf
 * [3] AMD GPUOpen《Occupancy explained》（2023-12-20，2024-06-26 更新）：
 *     https://gpuopen.com/learn/occupancy-explained/
 * [4] HIP 文档《Introduction to the HIP programming model》的 Memory hierarchy 一节：
 *     https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#memory-hierarchy
 * [5] HIP 文档《Asynchronous concurrent execution》的 Concurrent execution between host and device 一节：
 *     https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/asynchronous.html#concurrent-execution-between-host-and-device
 * [6] HIP 文档《Initialization》的 Initialize the HIP runtime 一节：
 *     https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/initialization.html#initialize-the-hip-runtime
 * [7] ROCgdb 手册「AMD GPU Restrictions」（HIP 运行时默认推迟装入 GPU 代码，第一次启动 kernel 时才装）：
 *     https://rocm.docs.amd.com/projects/ROCgdb/en/latest/ROCgdb/gdb/doc/gdb/AMD-GPU.html#AMD-GPU-Restrictions
 */
export const SIM_PARAMS = {
  /**
   * 示意。数组一个元素占多少字节。
   * 取值理由：模拟器的数组只有 int（32 位整数）和 float（单精度小数）两种，都是 4 字节；
   * 访存视图可以改成 2 字节，演示「元素变小，一车能装更多个」。
   */
  elemBytes: 4,
  /**
   * 示意。一「车」（cache line）多少字节：显存成块搬运，哪怕只要一个数也要搬一整车。
   * 取值理由：wave32 的 32 个线程各读一个 4 字节的数，一共 128 字节，连续访问时正好一车，最好手算。
   * 第一代 RDNA 的 RX 5700 XT，L0、L1、L2 缓存每行都是 128 字节 [1]；
   * 本教程用的 RX 9070 XT（RDNA 4）没有查到公开的数，[待实测]。
   */
  lineBytes: 128,
  /**
   * 示意。LDS 分成多少个 bank：同一轮里，一个 bank 只能读写一个字。
   * 取值理由：和 wave32 的 lane 一样多，没有冲突时一个 wave 一轮取完，冲突几路一眼看得出来。
   * RDNA 4 每个 WGP 有 64 个 bank，分成两组，每组 32 个，对应一对 SIMD32 [2]；第一代 RDNA 也是 32 个 [1]。
   */
  banks: 32,
  /**
   * 示意。LDS 一个 bank 一次读写多少字节（一个「字」）。
   * 取值理由：正好放下一个 int 或 float，第 i 个元素就在第 i % banks 个 bank，好算。
   * RDNA 4 的 bank 是 DWORD（4 字节）宽，相邻的 DWORD 依次放在相邻的 bank [2]。
   */
  bankBytes: 4,

  // ── 1-7「取数据」地图（novice/memory-hierarchy/challenge.ts） ──

  /**
   * 示意。线程去一个地方取一个数（或者存一个数），一趟要等几个周期：往返延迟。只用在 1-7 的「取数据」地图和挑战里。
   * 和 L4 的 ldsCycles、lineCycles 不是一回事：那两个是一轮、一车占几个周期，这里是一趟从发出去到拿回来要等多久。
   * 取值理由：只为排出「越近越快」的次序，又好手算，不是哪块显卡的数：
   * - register 1：运算直接用寄存器里的数，寄存器是 GPU 上最快的存储 [4]；按一步一个周期算，同 issueCycles。
   * - lds 10：LDS 就在芯片上，比经过缓存去显存的延迟低得多 [2][4]；取 10，看得出比寄存器远、比显存近得多。
   * - cache 30：从显存取数要经过几层缓存，在缓存里找到就不用再去显存 [3]；地图把几层缓存画成一层，取 30，落在 LDS 和显存之间。
   * - vram 100：同 memLatency（没有命中缓存的显存访问要几百个周期 [3]）。
   * RX 9070 XT 各级的真实延迟 [待实测]。
   */
  fetchCycles: { register: 1, lds: 10, cache: 30, vram: 100 },

  // ── L4 示意计时（timing.ts） ──

  /**
   * 示意。一个 wave 执行一步（一条语句、一次判断或一次同步）要占 SIMD 几个周期；wave64 翻倍。
   * 取值理由：RDNA 的 SIMD32 每个周期发一条指令 [1]，一步按一条指令算，数步数就是数周期；
   * wave64 的向量指令和访存指令要分前后两半各发一次 [2]，所以翻倍。真机上一条语句会编译成好几条指令。
   */
  issueCycles: 1,
  /**
   * 示意。显存每搬一车要几个周期。
   * 取值理由：比算一步贵，向量加法这样每个数只算一下的 kernel，时间大部分花在搬运上；
   * 车次翻倍，访存时间也翻倍，合并的好处一眼看得出来。不是从哪块显卡的带宽换算出来的。
   */
  lineCycles: 4,
  /**
   * 示意。LDS 每一轮要几个周期（一轮里每个 bank 读写一个字）。
   * 取值理由：RDNA 的 LDS 每个周期最多读写 32 个 DWORD [1]，正好 32 个 bank 各一个字，一轮一个周期。
   */
  ldsCycles: 1,
  /**
   * 示意。显存上同一个元素的原子加只能一个一个做：同一个元素上每多一个 lane，多等几个周期。
   * 取值理由：和搬一车一样贵，32 个 lane 加同一个元素要多等 31 × 4 个周期，远比一车贵，看得出来要避开。
   */
  atomicCycles: 4,
  /**
   * 示意。每个 wave 每次同步要几个周期：放行的开销，不含等别的 wave 到齐的时间。
   * 取值理由：比算一步贵，同步在计算、访存、同步的拆分里看得见，又不会压过访存。
   */
  barrierCycles: 4,
  /**
   * 示意。从发出读显存到数据回来要几个周期（往返延迟），只用在延迟隐藏的时间线里。
   * 取值理由：没有命中缓存的显存访问要几百个周期 [3]；取 100，好算，又比算一步长得多，
   * 只有一个 wave 时 SIMD 明显在空等。RX 9070 XT 的延迟 [待实测]。
   */
  memLatency: 100,

  // ── 1-11 计时台（novice/timing/challenge.ts） ──

  /**
   * 示意。CPU 启动一次 kernel（把工作单交给 GPU）占几个周期：启动那一行从开始到返回。
   * 启动是异步的：这一行返回时 GPU 才刚接到活，CPU 不等它算完就往下走 [5]。
   * 取值理由：比向量加法在 GPU 上的示意时间（几百个周期）短得多，不同步就看表时，量到的数小得一眼看得出不对。
   * 不是从哪块显卡、哪个驱动量出来的；真卡上启动一次要多久 [待实测]。
   */
  launchCycles: 20,
  /**
   * 示意。程序里第一次启动 kernel，启动那一行要多花几个周期做一次准备，之后的启动不用再做。
   * 真卡上第一次常常更慢：HIP 运行时在第一次调用 HIP API 时才初始化 [6]，GPU 代码默认等到第一次启动 kernel 才装进去 [7]。
   * 取值理由：比向量加法的示意时间长好几倍，不预热时，第一次量到的数明显偏大。
   * 准备做些什么、花多久、花在 CPU 还是 GPU 上，真卡上各不一样 [待实测]。
   */
  firstLaunchCycles: 3000,

  // ── L4 占用率（timing.ts） ──

  /**
   * 示意。一个 SIMD 最多同时住几个 wave（wave 名额）。占用率 = 住了几个 ÷ 这个数 [3]。
   * 取值理由：RDNA 2、RDNA 3 每个 SIMD 16 个 [3]，第一代 RDNA 20 个 [1]；RX 9070 XT（RDNA 4）[待实测]。
   */
  waveSlots: 16,
  /**
   * 示意。一个 SIMD 有多少个 VGPR（向量寄存器），按 wave32 数，也就是每个 lane 有几个。
   * 取值理由：第一代 RDNA 的 SIMD32 有 1024 个，每个 wave32 用 64 个时住得下 16 个、用 256 个时住 4 个 [1]，好算；
   * RX 7900 XTX 每个 SIMD 有 1536 个 [3]；RX 9070 XT [待实测]。
   */
  vgprsPerSimd: 1024,
  /**
   * 示意。VGPR 一份一份地分：wave32 每份多少个，用量往上凑整到整份；wave64 每个寄存器占两倍，每份个数减半、大小一样。
   * 取值理由：RDNA 4 按 wave32 每份 16 个、wave64 每份 8 个分（每个 SIMD 有 1536 个的型号是 24 个和 12 个）[2]。
   */
  vgprGranule: 16,
  /**
   * 示意。一个线程最多用多少个 VGPR。
   * 取值理由：RDNA 和 RDNA 4 一个 wave 最多 256 个 [1][2]。
   */
  maxVgprs: 256,
  /**
   * 示意。一个 WGP 有几个 SIMD。一个 block 的 wave 都住进同一个 WGP，可以分到它的任何一个 SIMD 上。
   * 取值理由：RDNA 4 的 WGP 有 4 个 SIMD32，一个 work-group 的 wave 可以在其中任何一个上运行 [2]。
   */
  simds: 4,
  /**
   * 示意。一个 WGP 的 LDS 一共多少字节，住在里面的 block 分着用。
   * 取值理由：RDNA 和 RDNA 4 每个 WGP 都是 128 KB [1][2]。
   */
  ldsBytes: 131072,
  /**
   * 示意。LDS 一份一份地分给 block，每份多少字节，用量往上凑整到整份。
   * 取值理由：RDNA 4 按 1024 字节一份分 [2]。
   */
  ldsGranule: 1024,
  /**
   * 示意。一个 block 最多用多少字节 LDS。
   * 取值理由：RDNA 和 RDNA 4 一个 work-group 最多 64 KB [1][2]。
   */
  maxLdsPerBlock: 65536,
  /**
   * 示意。一个 WGP 最多同时住几个 block；只有一个 wave 的 block 不算在里面。
   * 取值理由：RDNA 4 的 WGP 最多 32 个 work-group，只有一个 wave 的 work-group 不占这个数 [2]。
   */
  maxBlocks: 32,
  /**
   * 示意。一个 block 最多多少个线程。
   * 取值理由：RDNA 4 一个 work-group 最多 1024 个 work-item [2]。
   * 这是能不能启动的规则；模拟器自己的线程数上限是另一回事（lockstep.ts 的 RUN_LIMITS）。
   */
  maxBlockThreads: 1024,
} as const
