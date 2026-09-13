---
title: "第14章 Agent 入门"
description: "Hello GPU 第14章 · 参考 hello-agents、LLM Agent 基本范式、工具调用"
---

# 第14章 Agent 入门

## 本章目标、前置知识与产物

本章是 Agent 篇的入口。我们沿用 [hello-agents](https://github.com/datawhalechina/hello-agents) 的概念节奏——**Agent = LLM + 工具 + 循环**——但把场景收窄到「GPU 算子优化」：目标是延迟/带宽，反馈是可复现的 benchmark 数字，而不是开放域闲聊。

学完本章，你应该能够：

- 用一句话解释 Agent = LLM + 工具 + 循环；
- 说明为什么算子优化天然适合 Agent；
- 读懂 ReAct / Reflection 在本书主循环里的落点；
- 分清「权威工具」与「自由工具」，以及性能数字只认谁。

对应代码：

```text
code/part3-agent/
├── kernel_optimize/          # Reflection / ReAct Agent
│   ├── agent.py              # 主循环
│   ├── tools.py              # 工具注册与权威裁决
│   └── prompts.py            # 优化 SOP
└── chapter14/                # 评测器（下一章工具后端）
```

## 14.1 什么是 LLM Agent

最简模型：

```text
Agent ≈ 大模型（决策） + 工具（行动） + 循环（观察→再决策）
```

- **LLM**：读当前状态，决定下一步（调哪个工具、改哪段 kernel、是否收尾）。
- **工具**：确定性程序。编译、对答案、计时、测峰值——返回值就是事实。
- **循环**：把工具观察写回对话历史，再问模型，直到收敛或触达步数上限。

这和「一次性让模型吐出更快代码」的差别在于：**模型不掌握真假**。快不快、对不对，只认工具返回。

## 14.2 为什么 Agent 适合算子优化

算子优化有三个 Agent 友好的特征：

| 特征 | 在本书里的落点 |
|---|---|
| 目标可量化 | 延迟中位数、配对改进比例、距峰值空间 |
| 行动可封装 | `compile_kernel` / `bench_kernel` / `profile_kernel` / `accept_candidate` / `measure_peak` |
| 反馈可验证 | PyTorch reference 做 oracle；warmup + GPU event + median/MAD 做计时 |

因此闭环可以写成：

```text
理解任务 → 测峰值 → baseline → profiling 定方向
  → 生成候选 → compile → bench → profile → accept → 反思迭代 → 报告
```

缺任何一环都会出问题：没有峰值就不知道「算到头没有」；没有正确性门禁就会把「快但错」当成成果；没有配对裁决就会被噪声忽悠。

第 17 章会看到一次真实跑通：在 Radeon 8060S（`gfx1151`）上，Agent 把故意朴素的 `vector_add` 从约 **0.705 ms** 推到 **0.322 ms（≈2.19×）**——每一步改进都来自工具账本，不是模型口头宣布。

## 14.3 ReAct 范式简介

本书主循环是 **ReAct（Reason → Act → Observe）**，外层再套 **Reflection（根据评测结果改策略）**。`kernel_optimize/agent.py` 的骨架如下：

```python
for step in range(1, max_steps + 1):
    message = llm.chat(history, tools=schema)   # Reason：决定是否调工具
    if not message.tool_calls:                  # 不再行动 → 尝试收尾
        return message.content
    for call in message.tool_calls:             # Act：compile/bench/profile/accept…
        observation = executor.call(...)        # 工具给出 Observation
        history.append(observation)             # 观察回灌，进入下一轮
```

教学上刻意保持这段循环「能一眼看完」：复杂统计与裁决都下沉到工具里，主循环不堆业务。

另有一层**完成护栏**：模型若只用文本邀请用户、或把提问写进「最终回答」，会立刻结束运行——因此 Agent 必须用 `ask_user` 提问，用工具干活，而不是空谈收尾。

## 14.4 工具调用（Tool Use）

工具用「名字 + JSON 参数」描述，经 function calling 交给模型。注册方式是字典（hello-agents 范式）：描述给模型看，函数本体按名调用。

```text
ToolExecutor.register(name, description, func, parameters_schema)
→ litellm tools=[]
→ 模型返回 tool_calls[{name, arguments}]
→ executor.call(name, args) → 字符串观察（内容为 JSON）
```

本书把工具分成两类（自由度光谱）：

1. **权威工具**（结果即事实）：`compile_kernel`、`bench_kernel`、`profile_kernel`、`accept_candidate`、`measure_peak`
2. **自由工具**（允许发挥）：`ask_user`、`convert_kernel`、`run_code`、`read_reference`

纪律写进系统提示：**性能数字只认权威工具**；禁止用 `run_code` 自测出一个「加速比」写进报告。晋升由 `accept_candidate` 单独完成。

## 14.5 本书 Agent 的边界

做：

- 给定算子规格 / baseline kernel，在本机 ROCm GPU 上迭代优化；
- 正确性优先，失败留痕，搜索与结论分离。

不做：

- 通用 IDE Agent / 自动写业务服务；
- 让 LLM 口头宣布「快了 3×」而不经评测器；
- 把某张卡的峰值常数写死进教程当真理（峰值必须 `measure_peak` 实测）。

执行语言上，当前评测器跑 **Triton**；CUDA/HIP C++ 需先 `convert_kernel` 成等价 Triton，再进入优化闭环。

## 14.6 和 hello-agents 的关系

| | hello-agents | 本篇 hello-gpu |
|---|---|---|
| 教学目标 | 通用 Agent 范式 | 把「算子优化闭环」讲透并跑通 |
| 工具 | 示例级 | 可信计时 + 配对裁决 + Roofline |
| 真假来源 | 视任务而定 | **确定性评测器**（第 15 章） |

零基础建议先浏览 hello-agents 的 ReAct / Tool Use 章节；有 Agent 基础可直接进入第 15 章看工具如何「硬起来」。

## 本章小结

- Agent = LLM + 工具 + 循环；在算子优化里，工具返回值就是 ground truth。
- 本书主骨架是 ReAct，外加 Reflection；主循环保持短小可读。
- 「LLM 负责理解，代码负责相信什么」——后续三章都围着这句话展开。

## 延伸阅读

- [hello-agents](https://github.com/datawhalechina/hello-agents)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [第 16 章：算子优化 Agent 设计](../chapter16/index.md)
