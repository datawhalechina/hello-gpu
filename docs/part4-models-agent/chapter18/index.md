---
title: "第18章 YOLO 部署 + Agent 自动优化"
description: "Hello GPU 第18章 · ONNX/MIGraphX 部署、Agent profiling 找瓶颈、改配置/算子、对比"
---

# 第18章 YOLO 部署 + Agent 自动优化

## 本章导读

> 本章把 Agent 的优化对象从单个教学算子升级为真实模型——YOLO。先快速部署 YOLO，再让 Agent 对它跑 profiling、识别瓶颈、给配置建议（batch/精度/算子融合）、改配置跑对比。注意：Agent 能改配置和换算子，但不能自动写新算子集成进 ONNX——这个边界在章首点明。

## 18.1 Agent 能力边界：算子层 vs 模型层

明确本章 Agent 在模型层能做什么（profiling、改配置、换算子、出报告）、不能做什么（自动写新算子集成进 ONNX/MIGraphX）。

## 18.2 YOLO 模型部署

准备 YOLOv8 模型，导出 ONNX，用 MIGraphX 或 ONNX Runtime-ROCm 跑通推理。

## 18.3 建立推理 baseline

用第 5 章的 benchmark 习惯记录端到端延迟、吞吐和硬件上下文。

## 18.4 Agent 跑推理 profiling

让 Agent 自动 profiling，识别瓶颈在预处理、NMS、还是模型 kernel。

## 18.5 Agent 给配置优化建议

让 Agent 根据 profiling 信号给出 batch size、精度、算子融合等配置建议。

## 18.6 改配置跑对比

让 Agent 自动改配置、重跑 benchmark、对比优化前后性能。

## 18.7 输出优化报告

形成一份包含瓶颈判断、优化尝试、对比数据的 YOLO 优化报告。

## 本章小结

- 本章目前是 Alpha 阶段的大纲骨架，正式正文会在对应实验跑通后补齐。
- 涉及命令、输出或性能数字的内容，后续必须在 Radeon RX 9070 XT + ROCm 10.0 / 原生 Ubuntu 24.04 上实测。
- 与本章相关的代码、日志和实验底稿会放在 `code/part4-models-agent/chapter18/`。

## 延伸阅读

- 待补：正式正文完成时补充对应官方文档、论文或工具链接。
