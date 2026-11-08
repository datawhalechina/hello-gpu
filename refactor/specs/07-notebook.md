# 07 实验室（Notebook）规范

铸造城和试炼场需要真卡，动手部分放在 Notebook 里。网页是「关卡」：任务、先猜、原理、可视化和成绩；Notebook 是「实验室」：在真卡上写代码、校验、计时、交成绩。两边用同一个关卡 id、同一套小节名、同一份星级规则对应起来。

## 1. 参考 d2l 的地方

- **一个教学包，每关导入一次**：`import hello_gpu as hg`。编译、启动、计时、校验、画图、交成绩全部藏在包里，Notebook 里只留当前要学的东西。
- **正文和 Notebook 同构**：Notebook 的小节和网页关卡的小节同名、同序。
- **一份源文件，多个版本**：像 d2l 用一份源生成多个框架的 Notebook 一样，我们用一份源生成 HIP 版和 Triton 版。
- **练习在最后**：每个 Notebook 末尾有 1–3 道延伸练习。

## 2. 哪些关卡有实验室

`outline.json` 里 `gpu: true` 的关卡都有实验室（铸造城全部，试炼场除 3-1、3-10 外）。新手村全部在浏览器模拟器里完成，没有 Notebook。

## 3. 文件与命名

```text
notebooks/
  src/<zone>/<slug>.md                 源文件（人和 AI 编辑这里）
  <zone>/<slug>/<slug>-hip.ipynb       生成的 HIP 版（routes: split）
  <zone>/<slug>/<slug>-triton.ipynb    生成的 Triton 版
  <zone>/<slug>/<slug>.ipynb           生成的共用版（routes: shared）
  common/                              hello_gpu 教学包与 bootstrap.py（已有，L-01 扩展）
```

- 生成的 `.ipynb` 提交到仓库，读者在云平台上不需要任何构建步骤。
- 旧版 Notebook 留在 `notebooks/part*/` 原处不动，旧版章节的链接继续有效。
- 文件名用 `slug`，不用关卡编号；编号变化不影响路径。
- 每个 Notebook 的 metadata 写 `"hello_gpu": {"stage": "<关卡 id>", "route": "hip|triton|shared"}`。

## 4. 源文件格式

普通 Markdown，代码单元用带标记的代码围栏表示（任务 L-03 实现转换脚本，不依赖 jupytext）：

````markdown
# 2-9 Softmax（实验室）

<!-- lab:header -->

## 准备

```python
import torch
import hello_gpu as hg
hg.device_card()
```

## 动手

先在一行数据上看指数为什么会溢出。

```python
x = torch.tensor([1000.0, 1001.0, 1002.0], device="cuda")
torch.exp(x)
```

```hip route=hip
__global__ void softmax_row(const float* x, float* y, int n) {
    // ……
}
```

```python route=triton
@triton.jit
def softmax_row(x_ptr, y_ptr, n, BLOCK: tl.constexpr):
    ...
```

## 交成绩

<!-- lab:submit -->
````

- 围栏信息串：`python`（所有版本）、`python route=hip`、`python route=triton`、`hip route=hip`（生成 `%%hip` 魔法单元）。
- 围栏之外的 Markdown 生成 Markdown 单元；遇到二级标题时切分单元。
- `<!-- lab:header -->` 展开成标准标题单元：关卡编号与名称、路线、配套网页链接、预计时长、硬件要求、`%run ../../common/bootstrap.py`。
- `<!-- lab:submit -->` 展开成标准交成绩单元（见第 7 节）。

## 5. 小节结构（必须和网页对应）

| Notebook 小节 | 对应网页 | 内容 |
| --- | --- | --- |
| 标题（自动） | 关卡头 | 编号、名称、路线、网页链接 |
| `## 准备` | — | 导入、`hg.device_card()` 检查环境 |
| `## 动手` | 「探索」各段 | 1–3 段，每段：一两句说明 + 一个短代码单元 + 一句「看输出里的……」 |
| `## 挑战` | 「挑战」 | 读者补全标了 `TODO` 的 kernel；`hg.check` 多形状校验；`hg.bench` 可信计时；`hg.compare` 和 torch、峰值对比 |
| `## 交成绩` | `LabCard` | `hg.submit(...)` 打印通关链接和通关码 |
| `## 练习` | 「深入一点」 | 1–3 道延伸练习，不计星 |

先猜、原理讲解、概念卡只在网页上，Notebook 里用一句话加链接指回网页，不重复写。

## 6. 简单为先

- 每个代码单元不超过 15 行；超过就拆，或者把样板代码挪进 `hello_gpu`。
- 不出现编译命令、计时循环、画图样板；这些都由 `hg` 提供。
- 「Restart Kernel and Run All」必须能从头跑通；不依赖隐藏状态；随机数固定种子。
- 在 RX 9070 XT 上整本跑完不超过 10 分钟，云平台不超过 20 分钟。
- 仓库里的 Notebook 不保留输出（生成脚本清空）；参考输出放在网页的「观摩模式」和档案馆里。
- 不在 Notebook 里安装依赖；环境由云平台或附录里的安装步骤准备。

## 7. hello_gpu v2 接口（任务 L-01）

| 接口 | 作用 |
| --- | --- |
| `hg.device_card()` | 打印并返回 GPU 卡片：名称、gfx 架构、CU 数、wave 大小、显存、ROCm / PyTorch / Triton 版本；2-1 用它生成「我的 GPU 卡片」导入码 |
| `hg.check(fn, ref, shapes, *, dtype, atol, rtol)` | 多形状正确性校验，返回每个形状的通过情况 |
| `hg.bench(fn, *, warmup, repeat)` | 可信计时（GPU 事件、预热、多次统计），返回中位数、p10、p90 和样本；沿用现有 `measurement.py` 的协议 |
| `hg.peak()` | 读取或测量这张卡的峰值带宽与 FMA 吞吐（2-4 测出后缓存到本地） |
| `hg.compare(candidates, *, bytes_moved, flops)` | 多个实现的对比表：耗时、有效带宽、占峰值比例、相对基线倍数 |
| `hg.submit(stage, route, *, checks, metrics)` | 生成通关凭证，打印通关链接和通关码，同时把 JSON 存到本地 artifact 目录 |
| `%%hip`（已有） | 在单元里写 HIP kernel 并直接用 PyTorch Tensor 调用 |

## 8. 通关凭证

```json
{
  "v": 1,
  "stage": "forge-softmax",
  "route": "hip",
  "at": "2026-11-08T10:00:00Z",
  "device": { "name": "AMD Radeon RX 9070 XT", "gfx": "gfx1201", "cus": 64 },
  "env": { "rocm": "10.0", "torch": "…", "triton": "…" },
  "checks": { "passed": 5, "total": 5 },
  "metrics": { "median_ms": 0.123, "gbps": 512.3, "peak_gbps": 610.0, "torch_ms": 0.150 }
}
```

（数字仅为格式示例，不是实测值。）

- 编码：JSON → UTF-8 → raw deflate → base64url，前缀 `HGPU1.`。通关链接为 `<站点>/<zone>/<slug>#lab=HGPU1.…`；通关码就是同一串字符。
- 网页解码后校验：版本、关卡 id 与当前页一致、数字有限且为正。校验失败时用中文说明原因。
- **星级由网页按本关规则重新计算**，不信任凭证里自带的结论。没有后端也就没有排行榜，作弊只影响读者自己的本地进度。
- 凭证不含任何个人信息。

## 9. 星级规则格式

写在 `outline.json` 对应关卡的 `lab` 字段，网页（TypeScript）和 `hello_gpu`（Python）各实现一个求值器，用同一组测试样例保证结果一致：

```json
"lab": {
  "stars": [
    { "text": "多种形状都通过校验", "rule": { "checksAll": true } },
    { "text": "达到你这张卡实测峰值带宽的 60%", "rule": { "ratio": ["gbps", "peak_gbps"], "gte": 0.6 } },
    { "text": "比同一张卡上的 torch 快", "rule": { "ratio": ["torch_ms", "median_ms"], "gte": 1.0 } }
  ]
}
```

规则只用相对值，见 `04-gamification.md` 第 3 节。

## 10. 网页端的实验室入口（任务 L-02）

`LabCard` 提供：

1. **打开实验室**：云平台链接（平台支持 nbgitpuller 时用 git-pull 链接，否则给出操作说明）、下载 `.ipynb`、在 GitHub 查看。是否支持 nbgitpuller 需要在 AUP Learning Cloud 和 AMD Radeon Cloud 上确认。
2. **导入成绩**：自动读取地址里的 `#lab=`，或手动粘贴通关码；导入后显示读者的数字、参考数据（档案馆）和星级。
3. **观摩模式**：没有 GPU 时，回放档案馆里的真实运行记录（代码、输出、图表），完成关卡但不得星。

## 11. 一致性检查（`npm run nb:check`）

- 每个 `gpu: true` 的关卡都有源文件和生成的 Notebook，且生成结果是最新的。
- Notebook metadata 的关卡 id 存在于 `outline.json`。
- 必备小节齐全：准备、动手、挑战、交成绩。
- 代码单元不超过 15 行，Python 单元能通过语法编译。
- 分路线关卡的两个版本小节标题一致。

## 12. 真机验证

带 `gpu: true` 的任务只能在装有 AMD GPU 和 ROCm 的机器上完成验证（`rocminfo` 能运行）。在没有 GPU 的机器上，会话只做源文件编写、生成和静态检查，并在任务完成记录里写明「待真机验证」，状态停在 `review`。
