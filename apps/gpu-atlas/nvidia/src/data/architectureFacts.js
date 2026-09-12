/** NVIDIA public logical architecture facts, audited 2026-09-11.
 * l2 is the selected card; fullL2 is the complete chip. int32 distinguishes shared and independent resources.
 * This is functional organization, not physical placement or mask data. */
export const ARCHITECTURE_FACTS = {
  "tesla": {
    "fullClusters": 8,
    "smPerCluster": 2,
    "l2": "无统一 L2",
    "fullL2": "无统一 L2",
    "memoryInterface": "384-bit GDDR3 · 6 × 64-bit",
    "clusterLabel": "TPC",
    "fullSm": 16,
    "activeSm": 16,
    "sm": {
      "cores": 8,
      "partitions": 1,
      "schedulers": 1,
      "dispatch": 1,
      "registers": "32 KB · 8,192 × 32-bit",
      "shared": "16 KB 独立共享存储",
      "l1": "无通用 L1；另有纹理与常量缓存",
      "tensor": 0,
      "rt": 0,
      "int32": "SP 支持整数指令；不设 Volta 式独立 INT32 阵列",
      "fp64": 0,
      "sfu": 2,
      "loadStore": "公开框图未列独立单元数量",
      "notes": [
        "8 个 TPC，每 TPC 有 2 个 SM；TPC 不是后来的 GPC。",
        "无通用 L1 / L2 不代表完全没有缓存；纹理与常量缓存仍存在。"
      ]
    },
    "sources": [
      {
        "title": "GeForce 8800 技术简报 · 图 12、18、26",
        "url": "https://www.nvidia.com/content/PDF/Geforce_8800/GeForce_8800_GPU_Architecture_Technical_Brief.pdf"
      },
      {
        "title": "Fermi 白皮书 · 印刷页 11，G80 对照",
        "url": "https://www.nvidia.com/content/pdf/fermi_white_papers/nvidia_fermi_compute_architecture_whitepaper.pdf"
      },
      {
        "title": "NVIDIA OpenCL Best Practices · 3.2，8,192 寄存器",
        "url": "https://www.nvidia.com/content/cudazone/cudabrowser/downloads/papers/nvidia_opencl_bestpracticesguide.pdf"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "8 个 TPC，每 TPC 有 2 个 SM；TPC 不是后来的 GPC。",
      "无通用 L1 / L2 不代表完全没有缓存；纹理与常量缓存仍存在。"
    ]
  },
  "fermi": {
    "fullClusters": 4,
    "smPerCluster": 4,
    "l2": "768 KB",
    "fullL2": "768 KB",
    "memoryInterface": "384-bit GDDR5 · 6 × 64-bit",
    "clusterLabel": "GPC",
    "fullSm": 16,
    "activeSm": 15,
    "sm": {
      "cores": 32,
      "partitions": 2,
      "schedulers": 2,
      "dispatch": 2,
      "registers": "128 KB · 32,768 × 32-bit",
      "shared": "16 / 48 KB 可配置",
      "l1": "与共享存储合计 64 KB；L1 为 48 / 16 KB",
      "tensor": 0,
      "rt": 0,
      "int32": "32 个 CUDA Core 内含整数 ALU；与浮点共用调度资源",
      "fp64": "支持 FP64；与 CUDA 执行资源配合，非额外独立阵列",
      "sfu": 4,
      "loadStore": 16,
      "notes": [
        "完整 GF100 有 16 个 SM，GTX 480 启用 15 个。",
        "双调度器服务两组 16 核执行单元；共享 128 KB 寄存器文件，不画成 Maxwell 式四分区。"
      ]
    },
    "sources": [
      {
        "title": "Fermi 白皮书 · 印刷页 8–11，SM 与缓存",
        "url": "https://www.nvidia.com/content/pdf/fermi_white_papers/nvidia_fermi_compute_architecture_whitepaper.pdf"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "完整 GF100 有 16 个 SM，GTX 480 启用 15 个。",
      "双调度器服务两组 16 核执行单元；共享 128 KB 寄存器文件，不画成 Maxwell 式四分区。"
    ]
  },
  "kepler": {
    "fullClusters": 4,
    "smPerCluster": 2,
    "l2": "512 KB",
    "fullL2": "512 KB",
    "memoryInterface": "256-bit GDDR5 · 4 × 64-bit",
    "clusterLabel": "GPC",
    "fullSm": 8,
    "activeSm": 8,
    "sm": {
      "cores": 192,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 8,
      "registers": "256 KB · 65,536 × 32-bit",
      "shared": "16 / 32 / 48 KB 可配置",
      "l1": "与共享存储合计 64 KB；另设纹理缓存",
      "tensor": 0,
      "rt": 0,
      "int32": "整数与 FP32 使用 SMX 的执行资源，不能按两套并行阵列相加",
      "fp64": "支持 FP64，GK104 吞吐较低；不套用 GK110 的 64 核",
      "sfu": 32,
      "loadStore": 32,
      "notes": [
        "四个调度器通过八个 dispatch 为宽 SMX 发射；192 核并非六个独立调度分区。",
        "Hyper-Q 与动态并行属于 GK110，不能套到 GTX 680 的 GK104。"
      ]
    },
    "sources": [
      {
        "title": "GTX 680 白皮书 · 图 1、2，印刷页 5–12",
        "url": "https://www.nvidia.com/content/pdf/product-specifications/geforce_gtx_680_whitepaper_final.pdf"
      },
      {
        "title": "Kepler Tuning Guide · 1.4.3 / 1.4.5",
        "url": "https://docs.nvidia.com/cuda/archive/11.8.0/kepler-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "四个调度器通过八个 dispatch 为宽 SMX 发射；192 核并非六个独立调度分区。",
      "Hyper-Q 与动态并行属于 GK110，不能套到 GTX 680 的 GK104。"
    ]
  },
  "maxwell": {
    "fullClusters": 4,
    "smPerCluster": 4,
    "l2": "2 MB",
    "fullL2": "2 MB",
    "memoryInterface": "256-bit GDDR5 · 4 × 64-bit",
    "clusterLabel": "GPC",
    "fullSm": 16,
    "activeSm": 16,
    "sm": {
      "cores": 128,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 8,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "96 KB 独立共享存储",
      "l1": "48 KB 纹理 / L1，与共享存储分离",
      "tensor": 0,
      "rt": 0,
      "int32": "整数与浮点共用 CUDA 通路；无独立 128 INT32 阵列",
      "fp64": 4,
      "sfu": 32,
      "loadStore": 32,
      "notes": [
        "代表芯片为第二代 Maxwell GM204；96 KB 共享存储不能混成 GM107 的 64 KB。",
        "四个执行分区分别归属四个调度器；纹理 / L1 缓存成对组织。"
      ]
    },
    "sources": [
      {
        "title": "NVIDIA GTX 980 白皮书 · 图 2、3，大学镜像",
        "url": "https://compas.cs.stonybrook.edu/~nhonarmand/courses/fa15/cse610/res/GeForce_GTX_980_Whitepaper.pdf"
      },
      {
        "title": "Maxwell Tuning Guide · 1.4.1–1.4.3，GM204",
        "url": "https://docs.nvidia.com/cuda/maxwell-tuning-guide/index.html"
      },
      {
        "title": "Pascal 白皮书 · 图 5 与 GTX 980 对照",
        "url": "https://international.download.nvidia.com/geforce-com/international/pdfs/GeForce_GTX_1080_Whitepaper_FINAL.pdf"
      },
      {
        "title": "Pascal Tuning Guide · 1.4.1.1，Maxwell 对照",
        "url": "https://docs.nvidia.com/cuda/pascal-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "代表芯片为第二代 Maxwell GM204；96 KB 共享存储不能混成 GM107 的 64 KB。",
      "四个执行分区分别归属四个调度器；纹理 / L1 缓存成对组织。"
    ]
  },
  "pascal": {
    "fullClusters": 6,
    "smPerCluster": 5,
    "l2": "2,816 KB",
    "fullL2": "3,072 KB",
    "memoryInterface": "352-bit GDDR5X · 启用 11 × 32-bit",
    "clusterLabel": "GPC",
    "fullSm": 30,
    "activeSm": 28,
    "sm": {
      "cores": 128,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 8,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "96 KB 独立共享存储",
      "l1": "48 KB 纹理 / L1，与共享存储分离",
      "tensor": 0,
      "rt": 0,
      "int32": "整数与浮点共享执行通路；支持 DP4A",
      "fp64": 4,
      "sfu": 32,
      "loadStore": 32,
      "notes": [
        "GP102 是消费级 Pascal；不能套用 GP100 的 64 核 / 32 FP64 双分区。",
        "完整芯片 30 个 SM / 384-bit；本卡 28 个 SM / 352-bit。"
      ]
    },
    "sources": [
      {
        "title": "Pascal Tuning Guide · 1.4.1，GP102 / GP104",
        "url": "https://docs.nvidia.com/cuda/pascal-tuning-guide/index.html"
      },
      {
        "title": "GTX 1080 白皮书 · 图 5，GP10x SM",
        "url": "https://international.download.nvidia.com/geforce-com/international/pdfs/GeForce_GTX_1080_Whitepaper_FINAL.pdf"
      },
      {
        "title": "Turing 白皮书 · 表 1，GTX 1080 Ti 对照",
        "url": "https://www.nvidia.com/content/dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "GP102 是消费级 Pascal；不能套用 GP100 的 64 核 / 32 FP64 双分区。",
      "完整芯片 30 个 SM / 384-bit；本卡 28 个 SM / 352-bit。"
    ]
  },
  "volta": {
    "fullClusters": 6,
    "smPerCluster": 14,
    "l2": "6 MB",
    "fullL2": "6 MB",
    "memoryInterface": "4,096-bit HBM2 · 4 堆栈 / 8 × 512-bit",
    "clusterLabel": "GPC",
    "fullSm": 84,
    "activeSm": 80,
    "sm": {
      "cores": 64,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "最高 96 KB",
      "l1": "128 KB L1 / 纹理 / 共享存储统一池",
      "tensor": 8,
      "rt": 0,
      "int32": "64 个独立 INT32 核心，可与 FP32 并发",
      "fp64": 32,
      "sfu": 16,
      "loadStore": 32,
      "notes": [
        "本页 V100 PCIe 启用 80 / 84 SM；芯片逻辑图展示完整 GV100。",
        "独立线程调度不改变 Warp 为 32 线程的编程模型。"
      ]
    },
    "sources": [
      {
        "title": "Volta 白皮书 · 图 4、5，印刷页 9、13",
        "url": "https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/tesla-product-literature/volta-architecture-whitepaper.pdf"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "本页 V100 PCIe 启用 80 / 84 SM；芯片逻辑图展示完整 GV100。",
      "独立线程调度不改变 Warp 为 32 线程的编程模型。"
    ]
  },
  "turing": {
    "fullClusters": 6,
    "smPerCluster": 12,
    "l2": "5,632 KB",
    "fullL2": "6,144 KB",
    "memoryInterface": "352-bit GDDR6 · 启用 11 × 32-bit",
    "clusterLabel": "GPC",
    "fullSm": 72,
    "activeSm": 68,
    "sm": {
      "cores": 64,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "32 / 64 KB 可配置",
      "l1": "96 KB L1 / 共享池；L1 为 64 / 32 KB",
      "tensor": 8,
      "rt": 1,
      "int32": "64 个独立 INT32 核心，可与 FP32 并发",
      "fp64": 2,
      "sfu": 16,
      "loadStore": 16,
      "notes": [
        "本卡启用 68 / 72 SM；完整 TU102 的 6 MB L2 与本卡 5.5 MB 分开标示。",
        "每 SM 仍有 2 个低吞吐 FP64 核心；白皮书主 SM 图省略不代表不存在。"
      ]
    },
    "sources": [
      {
        "title": "Turing 白皮书 · 图 2–4，表 1",
        "url": "https://www.nvidia.com/content/dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf"
      },
      {
        "title": "Turing Tuning Guide · 1.4.1.1，2 个 FP64",
        "url": "https://docs.nvidia.com/cuda/archive/11.6.2/turing-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "本卡启用 68 / 72 SM；完整 TU102 的 6 MB L2 与本卡 5.5 MB 分开标示。",
      "每 SM 仍有 2 个低吞吐 FP64 核心；白皮书主 SM 图省略不代表不存在。"
    ]
  },
  "ampere": {
    "fullClusters": 8,
    "smPerCluster": 16,
    "l2": "40 MB",
    "fullL2": "官方资料未单列完整芯片容量",
    "memoryInterface": "5,120-bit HBM2e · 5 活动堆栈 / 10 × 512-bit",
    "clusterLabel": "GPC",
    "fullSm": 128,
    "activeSm": 108,
    "sm": {
      "cores": 64,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "最高 164 KB",
      "l1": "192 KB L1 / 共享存储统一池",
      "tensor": 4,
      "rt": 0,
      "int32": "64 个独立 INT32 核心，可与 FP32 并发",
      "fp64": 32,
      "sfu": 16,
      "loadStore": 32,
      "notes": [
        "本页为 GA100 A100 PCIe 80GB，不是带 RT Core 的 GA10x 游戏 GPU。",
        "完整 GA100 为 8 GPC / 128 SM；A100 为 7 GPC / 108 SM / 40 MB L2。"
      ]
    },
    "sources": [
      {
        "title": "NVIDIA A100 架构白皮书 · 图 3、4",
        "url": "https://images.nvidia.com/aem-dam/en-zz/Solutions/data-center/nvidia-ampere-architecture-whitepaper.pdf"
      },
      {
        "title": "NVIDIA Ampere 深入介绍 · 图 3、4，GA100",
        "url": "https://developer.nvidia.com/blog/nvidia-ampere-architecture-in-depth/"
      },
      {
        "title": "Ampere Tuning Guide · 1.4.1 / 1.4.2",
        "url": "https://docs.nvidia.com/cuda/ampere-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "本页为 GA100 A100 PCIe 80GB，不是带 RT Core 的 GA10x 游戏 GPU。",
      "完整 GA100 为 8 GPC / 128 SM；A100 为 7 GPC / 108 SM / 40 MB L2。",
      "完整芯片 L2 容量未在已核对的 NVIDIA 正文中单列，因此不将第三方 48 MB 数值冒充已核实官方数值。"
    ]
  },
  "hopper": {
    "fullClusters": 8,
    "smPerCluster": 18,
    "l2": "50 MB",
    "fullL2": "60 MB",
    "memoryInterface": "5,120-bit HBM2e · 5 活动堆栈 / 10 × 512-bit",
    "clusterLabel": "GPC",
    "fullSm": 144,
    "activeSm": 114,
    "sm": {
      "cores": 128,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "最高 228 KB",
      "l1": "256 KB L1 / 共享存储统一池",
      "tensor": 4,
      "rt": 0,
      "int32": "64 个独立 INT32 核心，可与 FP32 并发",
      "fp64": 64,
      "sfu": 16,
      "loadStore": 32,
      "notes": [
        "H100 PCIe 为 114 SM / 80GB HBM2e；完整 GH100 为 144 SM / 60 MB L2。",
        "官方给出启用 7 或 8 个 GPC；不宣称禁用单元的物理位置。"
      ]
    },
    "sources": [
      {
        "title": "NVIDIA Hopper 深入介绍 · 图 3、4，PCIe 配置",
        "url": "https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/"
      },
      {
        "title": "Hopper Tuning Guide · 1.4.1 / 1.4.2",
        "url": "https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "H100 PCIe 为 114 SM / 80GB HBM2e；完整 GH100 为 144 SM / 60 MB L2。",
      "官方给出启用 7 或 8 个 GPC；不宣称禁用单元的物理位置。"
    ]
  },
  "ada": {
    "fullClusters": 12,
    "smPerCluster": 12,
    "l2": "72 MB",
    "fullL2": "96 MB",
    "memoryInterface": "384-bit GDDR6X · 12 × 32-bit",
    "clusterLabel": "GPC",
    "fullSm": 144,
    "activeSm": 128,
    "sm": {
      "cores": 128,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "最高 100 KB",
      "l1": "128 KB L1 / 共享存储统一池",
      "tensor": 4,
      "rt": 1,
      "int32": "64 条 FP32 专用 + 64 条 FP32 / INT32 共用通路",
      "fp64": 2,
      "sfu": "4 个 SFU 逻辑模块（每分区 1 个）",
      "loadStore": 16,
      "notes": [
        "RTX 4090 启用 128 / 144 SM 和 72 / 96 MB L2。",
        "64 条共用路径不能同时计作 64 个 FP32 加 64 个 INT32 的峰值。"
      ]
    },
    "sources": [
      {
        "title": "Ada 白皮书 · 图 1、2、5 与表 1",
        "url": "https://images.nvidia.com/aem-dam/Solutions/Data-Center/l4/nvidia-ada-gpu-architecture-whitepaper-V2.02.pdf"
      },
      {
        "title": "Ada Tuning Guide · 1.4.1 / 1.4.2，100 KB 共享存储",
        "url": "https://docs.nvidia.com/cuda/ada-tuning-guide/index.html"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "RTX 4090 启用 128 / 144 SM 和 72 / 96 MB L2。",
      "64 条共用路径不能同时计作 64 个 FP32 加 64 个 INT32 的峰值。"
    ]
  },
  "blackwell": {
    "fullClusters": 12,
    "smPerCluster": 16,
    "l2": "96 MB",
    "fullL2": "128 MB",
    "memoryInterface": "512-bit GDDR7 · 16 × 32-bit",
    "clusterLabel": "GPC",
    "fullSm": 192,
    "activeSm": 170,
    "sm": {
      "cores": 128,
      "partitions": 4,
      "schedulers": 4,
      "dispatch": 4,
      "registers": "256 KB · 每分区 64 KB",
      "shared": "最高 100 KB",
      "l1": "128 KB L1 / 共享存储统一池",
      "tensor": 4,
      "rt": 1,
      "int32": "128 条 FP32 / INT32 统一通路；同一周期二选一",
      "fp64": 2,
      "sfu": "4 个 SFU 逻辑模块（每分区 1 个）",
      "loadStore": 16,
      "notes": [
        "RTX 5090 为单芯片 GB202，与数据中心双芯粒 B200 不同。",
        "白皮书 v1.1 更正为全部 FP32 / INT32 统一；不是 Ada 的半数共用布局。",
        "这里是 RTX GB202（CC 12.0），不套用 B200 的 228 KB 共享存储或 Tensor Memory。"
      ]
    },
    "sources": [
      {
        "title": "RTX Blackwell 白皮书 v1.1 · 图 3–6 与附录 A",
        "url": "https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf"
      },
      {
        "title": "CUDA 12.9.1 Programming Guide · CC 12.0 共享存储配置",
        "url": "https://docs.nvidia.com/cuda/archive/12.9.1/cuda-c-programming-guide/index.html#compute-capability-12-0"
      }
    ],
    "notes": [
      "功能模块面积、位置与连线是逻辑重排，不是显微照片或晶体管物理版图。",
      "RTX 5090 为单芯片 GB202，与数据中心双芯粒 B200 不同。",
      "白皮书 v1.1 更正为全部 FP32 / INT32 统一；不是 Ada 的半数共用布局。"
    ]
  }
};
