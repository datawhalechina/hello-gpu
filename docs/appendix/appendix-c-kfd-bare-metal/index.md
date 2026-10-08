---
title: "附录 C · 裸金属视角：绕过 HIP 直接写 AQL"
description: "Hello GPU 附录 · KFD dispatch 实测、ISA 编码实战，理解 HIP 底下发生了什么"
---

# 附录 C · 裸金属视角：绕过 HIP 直接写 AQL

## 本附录导读

> 第 4.5 节讲了 dispatch 开销：一次 kernel launch 有 2.6 μs 左右的固定成本，其中 HIP 运行时只占约 13%。这篇附录把这层彻底掀开——直接绕过 HIP，通过 Linux 的 KFD 驱动把 dispatch packet 写进 GPU 队列，看看裸金属到底能省多少、以及「手写 ISA」是什么体验。它回答的问题是：**HIP 底下到底发生了什么，什么时候值得绕开它？**

本附录素材来自一次真实的裸金属 GPU 项目（t0-gpu，见延伸阅读）：纯 Rust 写的 GPU 内核编译器 + KFD 运行时，在 RX 7900 XTX（gfx1100）上实测。平台与书基线（RX 9070 XT）不同，但流程与结论通用。

::: warning 阅读前提
本附录是进阶内容：不需要动手复现，但需要你已经理解第 4.5 节的 dispatch 链路（HIP API → KFD → AQL packet → doorbell）。不熟悉的读者建议先回看第 4.5 节。
:::

## 为什么有人要「裸金属」

正常路径是 HIP → ROCm 运行时 → 驱动。但有些场景这条路走不通：

1. **生态缺口**：某些关键 kernel（比如 RDNA3 上的 FlashAttention-2）在消费级 ROCm 上长期没有可用实现，等上游更新可能以年计；
2. **调度开销敏感**：训练循环里每步有几百个小 kernel，20 μs 级的同步延迟会累积成可观的浪费；
3. **想真正理解硬件**：HIP 帮你隐藏了 dispatch 的所有细节，也挡住了你理解它们的路径。

t0-gpu 项目的路线图（原文）：

```text
从 import torch 到手写 GPU ISA 汇编：
PyTorch → Burn 框架 → CubeCL（unwrap 连环 panic）
→ 12KB FA-2 内核只有 2% WMMA 利用率
→ 自己写 KFD 运行时（/dev/kfd → AQL 队列）
→ 用 llvm-mc 一条条验证手写汇编编码
```

每一步都是被逼的——不是想跳过框架，是框架在 RDNA3 上跑不通。最终产物是一个 600 行 Rust 的参数化 GEMM 生成器 + 裸金属运行时，在多个矩阵尺寸上反超 AMD 官方 rocBLAS。

## KFD 的一次 dispatch：从 ioctl 到 doorbell

裸金属 dispatch 的完整流程（对照第 4.5.1 节的 HIP 版本）：

```text
Rust 程序
  → open("/dev/kfd")                       // 打开 KFD 设备
  → ioctl(KFD_IOC_CREATE_QUEUE)            // 在 GPU 上创建一条 AQL 队列
  → 向队列内存写一个 AQL packet：
       header（类型、屏障、完成信号）
       grid_size（grid X/Y/Z）
       workgroup_size（workgroup X/Y/Z）
       kernel_address（已编译 kernel 的入口地址）
       kernel_arguments（参数包）
  → 写 doorbell 寄存器（告诉 GPU「队列有新任务」）
  → GPU 硬件调度器取 packet，分配到 CU
```

和 HIP 版本唯一的区别在第一步之前：HIP 把「创建队列、管理 queue、打包参数」都封装在运行时里，裸金属版本自己完成全部。KFD 驱动本身（内核态）是共享的——两种路径都走它。

这个项目踩过的一个经典坑，非常能说明「直接和硬件对话」的代价：

::: warning doorbell 语义
AQL 队列的 doorbell 应该写 `write_ptr - 1`，而不是 `write_ptr`。写错会让 GPU 读到一个「空位」或者直接卡死队列。这个语义在 AMD 文档里并不显眼，项目作者是参考 tinygrad 的源码才修对的。
:::

## dispatch 延迟：裸金属省了多少

同一台 7900 XTX、同一套 AQL 流程，两个实现的实测对比：

| 路径 | async（不等结果） | sync（等结果） |
| ---- | ----: | ----: |
| 标准 HIP | 2.6 μs | 20.5 μs |
| 裸金属 KFD | 2.26 μs | 14.96 μs |

结论和第 4.5 节一致：**async 路径只省 13%，sync 路径的差距主要来自「等」而不是「发」**。裸金属的价值不在省这 0.3 μs，而在于：

1. **你能控制队列与调度的每个细节**——比如在单次 dispatch 里编码 split-K，省掉多次 launch；
2. **没有用户态运行时依赖**——对嵌入场景（驱动、模拟器、自定义 runtime）是硬需求。

如果你只是写应用，2.6 μs 与 2.26 μs 的差别不值得裸金属。如果你在写系统软件，HIP 的封装反而是你要绕开的东西。

## ISA 编码实战：v_perm_b32 的四个坑

裸金属的另一半是「自己生成指令」。项目里手写了一个 bf16 butterfly 转置（WMMA 加载前把 bf16 数据重排成指令要求的布局），修了 **4 个 ISA 编码 bug**，全部靠 `llvm-mc` 逐条验证：

| # | bug | 说明 |
| ---- | ---- | ---- |
| 1 | literal marker 缺失 | `v_perm_b32` 的 selector 字段需要 literal marker，漏写会让解码器把常量当寄存器 |
| 2 | cross-VGPR routing | perm 可以在两个源 VGPR 之间路由，路由字段编码错误会导致拿到错误的 lane 数据 |
| 3 | XOR distance | RDNA 的 `v_perm_b32` 用 XOR 距离编码 lane 交换模式，距离算错整个转置就是乱的 |
| 4 | selector byte order | selector 字节序与直觉相反，写反则转置结果整体错位 |

这里想传达的不是「这 4 个 bug 的细节」（你的指令集版本可能不同），而是**方法论**：

::: tip 手写 ISA 的验证方法
每写一条指令，先用 `llvm-mc` 汇编成机器码、再反汇编回文本，对照是否一致。手写指令的正确性不能靠「看起来对」，要靠工具链来回验证。
:::

这也是验证硬件相关假设的基本要求：指令编码写错，后续结果就无法作为有效证据。

## 裸金属 GEMM 能到多快

600 行 Rust 参数化生成器（64×64 tile、64 线程 workgroup、LDS + 双缓冲、单次 dispatch split-K）在 7900XTX 上 vs rocBLAS（PyTorch `torch.mm` bf16 基线）：

| 矩阵 | 裸金属 T0 | rocBLAS | 比值 |
| ---- | ----: | ----: | ----: |
| 1024³ | 34.5 TFLOPS | 27.9 TFLOPS | 124% |
| 2048³ | 44.1 TFLOPS | 36.7 TFLOPS | 120% |
| 512×1024×4096 | 44.3 TFLOPS | 45.9 TFLOPS | 97% |
| 1024×1024×4096 | 42.5 TFLOPS | 29.9 TFLOPS | 142% |

关键优化（按收益排序）：

1. **合并加载地址计算**：`row = (tid×16) / row_stride; col = (tid×16) % row_stride` 让相邻线程命中相邻 16 字节块——2048³ 从 28 → 38 TFLOPS（+35%）；
2. **单次 dispatch split-K**：把小矩阵的 tile 数不足、填不满 96 个 CU 的问题，通过把 `tile_col` 和 `split_k_id` 编码进 `TGID.y` 解决——512³ 从 6.2 → 10.1 TFLOPS（+63%）；
3. **参数化生成**：`generate()` 函数按 config 生成内核，免去复制粘贴。

注意第 2 条：**split-K 用「单次 dispatch 内编码」实现，而不是多次 launch**——这正好呼应第 17.4 节 split-KV 的教训（多次 launch 在小题上有启动开销），裸金属通过一次 launch 解决了它。

## 什么时候该考虑裸金属

诚实地说：**绝大多数读者不需要裸金属**。它的代价——手写 ISA、没有生态、调试地狱——远超多数应用场景的收益。真正值得考虑的场景只有：

1. 写系统软件（runtime、驱动、模拟器），HIP 的封装是负担；
2. 某个 kernel 在 ROCm 上长期不可用，而你自己有能力和时间去实现；
3. 想彻底理解 dispatch 与指令编码——本附录的全部内容就是一次「教学性裸金属」的收获。

对第 3 类读者，最便宜的入门方式是：读一遍 t0-gpu 的代码（600 行），在理解层面走完一次「HIP 底下发生了什么」，而不用真的去写。理解 KFD 的 dispatch 流程和 ISA 验证方法，会反过来让你用 HIP/Triton 时更清楚它们替你做了什么、省了什么。

## 延伸阅读

- [t0-gpu：纯 Rust 裸金属 GPU 编译器](https://github.com/GeisYaO/t0-gpu) — 本附录数据来源（Rust + KFD + llvm-mc，7900XTX 实测）
- [KFD 内核文档（amdgpu）](https://docs.kernel.org/gpu/amdgpu/amdgpu-kfd.html) — `/dev/kfd` ioctl 与 AQL 队列的权威说明
- [tinygrad 的 AMD 后端](https://github.com/tinygrad/tinygrad) — 开源 KFD dispatch 实现参考
- [第 4.5 节 dispatch 开销](../../part0-intro/chapter4/index.md) — HIP 视角的 dispatch 链路与实测
- [第 17.4 节 失败回退](../../part3-agent/chapter17/index.md) — split-KV 多次 launch 开销的反例
