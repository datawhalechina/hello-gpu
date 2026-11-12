---
layout: hg
title: 实验环境指南
description: 在 AMD Radeon Cloud、AUP Learning Cloud 或自己的机器上准备铸造城、试炼场的实验室，每种都从零走到在 Notebook 里打出自己的 GPU 卡片。
---

<script setup>
import { withBase } from 'vitepress'
import { stageById, stageHref } from '@course/outline.ts'
import { labTarget, notebookPath } from '@course/lab.ts'
import { platformById, platformFact, platformLink } from '@course/labPlatforms.ts'
import PlatformFacts from './PlatformFacts.vue'

// 关卡编号和名字从大纲取（04 第 1 节）；平台的 GPU 和软件版本从 lab-platforms.json 取，每项带出处（09 第 4 节）。
const YOUR_GPU = stageById('forge-your-gpu')
const PANORAMA = stageById('novice-gpu-panorama')
const CHECK_NB = notebookPath(labTarget('forge-your-gpu'), 'shared')
const AUP = platformById('aup-learning-cloud')
const AUP_LINK = platformLink(AUP.open)
const AUP_GPU = platformFact(AUP, 'gpu').text
const AUP_TORCH = platformFact(AUP, 'torch').text
const LOCAL_GFX = platformFact(platformById('local'), 'gfx').text
</script>

# 实验环境指南

铸造城和试炼场的实验室是 Notebook，要在一块 AMD GPU 上跑。下面三种环境任选一种，每一种都从零走到跑通 {{ YOUR_GPU.code }} 的环境检查：在 Notebook 里打出你这张卡的「GPU 卡片」。新手村全在浏览器里完成，不用准备环境。

| 环境 | 要准备什么 | 怎么打开 Notebook |
| --- | --- | --- |
| [AMD Radeon Cloud](#radeon-cloud) | AMD AI 开发者计划的账号，开发者积分换算力 | 模板库里的「Hello GPU」一键启动，自带本教程仓库 |
| [AUP Learning Cloud](#aup-learning-cloud) | GitHub 账号，或者管理员发的账号 | 一条链接打开启动页，启动时克隆本教程仓库 |
| [本地](#local) | 一块 ROCm 支持的 AMD GPU 和 Linux | 仓库里的脚本装好环境、启动 JupyterLab |

## 终点：环境检查 {#check}

每种环境的最后一步都一样：在 Notebook 里运行 `hg.device_card()`。它打印这张卡的「GPU 卡片」：名称、gfx 架构、CU 数、wave 大小、显存，以及 ROCm、PyTorch、Triton 的版本，最后是一串 `HGCARD1.` 开头的导入码。打出导入码，这个环境就能做实验了。

{{ YOUR_GPU.code }}「{{ YOUR_GPU.title }}」的实验室 Notebook <code translate="no">{{ CHECK_NB }}</code> 第一节「准备」做的就是这件事。这本 Notebook 还没有上线，在那之前，在仓库的 `notebooks/` 目录里新建一个 Notebook，运行这三行：

```python
%run common/bootstrap.py
import hello_gpu as hg
hg.device_card()
```

第一行从仓库里加载教学包 `hello_gpu`，所以 Notebook 要建在仓库的 `notebooks/` 目录里。

输出里看三处：

- 「架构」一行是这张卡的 gfx 代号，例如本书的 RX 9070 XT 是 {{ LOCAL_GFX }}。
- 「软件」一行是 ROCm、PyTorch、Triton 的版本。Triton 写着「未找到」，说明这个环境没有 Triton，Triton 路线的实验跑不了。
- 最后一行的导入码贴进「我的成长」的<a :href="withBase('/me/#gpu-card')">我的 GPU 卡片</a>，<a :href="withBase(stageHref(PANORAMA))">{{ PANORAMA.code }} 的全景图</a>就换成你的卡。

报错了，看[跑不通时](#troubleshooting)。

## AMD Radeon Cloud {#radeon-cloud}

AMD 的 GPU 云。中国站用 AMD AI 开发者计划的账号登录，开发者积分换成平台积分，实例运行时每块 GPU 每小时扣 1 积分。模板库里的「Hello GPU」模板在启动时克隆本教程仓库，环境不用自己装。

<PlatformFacts id="radeon-cloud" />

平台文档没写 GPU 型号和 PyTorch 版本，以你在第 3 步打印的卡片为准。

### 1. 注册，换好积分

1. 打开 [developer.amd.com.cn](https://developer.amd.com.cn/) 注册或登录。可以用手机号或邮箱收验证码，也可以用魔搭、CSDN、GitHub 账号。部分新账号要先通过审核。
2. 在开发者计划的「兑取算力」里，用开发者积分换一串优惠码：1 个开发者积分换 1 小时，每天最多换 20 个。
3. 打开 [Radeon Cloud 控制台](https://developer.amd.com.cn/radeon/)，在右上角账号菜单的「积分与用量」里点「兑换积分」，粘贴整串优惠码。

新成员默认有多少开发者积分、优惠码多久过期，以[开发者计划的说明](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/developer-program/)为准。

### 2. 启动「Hello GPU」模板

1. 在控制台打开「模板库」，搜 Hello GPU，点「启动」。每个账号同时只能运行一个实例，有旧实例先销毁。
2. 实例就绪后点「打开 Notebook」，JupyterLab 在新标签页打开。

这个模板用 rocm10-pytorch 镜像，启动时克隆仓库的 main 分支，先打开旧版第 0 章 `notebooks/part0-intro/chapter0/chapter0.ipynb`。出处：[从模板库启动](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/gallery/)、[选择镜像](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/images/)和平台公开的[模板列表](https://developer.amd.com.cn/radeon/api/templates)（2026-11-10 查看）。

### 3. 跑环境检查

在左边的文件浏览器里，从 `chapter0` 往上退到 `notebooks/`，新建一个 Notebook，运行[环境检查的三行](#check)。

### 4. 用完销毁实例

实例只要还在，就按 GPU 小时扣积分，闲置也扣。做完在控制台的实例卡片上点「销毁实例」。临时工作区里的文件随实例删除，要留的文件先下载（在文件上右键，选 Download）。规则见[积分](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/credits/)和[保存数据](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/storage/)。

## AUP Learning Cloud {#aup-learning-cloud}

AMD Research 开源的 JupyterHub 学习平台，GPU 是 APU 里的核显 {{ AUP_GPU }}。下面的链接打开填好本教程仓库的启动页，服务器启动时把仓库克隆到你的主目录。

<PlatformFacts id="aup-learning-cloud" />

表里的 ROCm 和 PyTorch 是开源仓库里 GPU 基础镜像的定义，托管平台实际装的版本以第 3 步打印的卡片为准。教学包 `hello_gpu` 声明要 PyTorch 2.11 或更新（`notebooks/common/pyproject.toml`），在 {{ AUP_TORCH }} 上能不能跑通 [待实测]。

### 1. 用链接启动服务器

1. 打开<a :href="AUP_LINK" target="_blank" rel="noopener">填好仓库的启动页</a>。没登录会先到登录页：用 GitHub 账号，或者管理员发的本地账号。登录以后回到启动页，「Git Repository」一栏已经填好本教程仓库。
2. 选「Basic GPU Environment」（在 CUSTOM REPOS 一组里）和 {{ AUP_GPU }}，设好运行时长（默认 20 分钟），点「Launch Server」。
3. 服务器起来以后，JupyterLab 打开克隆好的仓库 `~/hello-gpu`。

这条链接用的是平台自带的「启动时克隆 Git 仓库」，见[源码](https://github.com/AMDResearch/aup-learning-cloud/blob/main/runtime/hub/core/handlers.py)里的 `GitSpawnHandler`。没登录时打开它会跳到登录页（2026-11-10 试过）；登录以后的界面和资源名取自开源仓库，托管平台上 [待实测]。

### 2. 更新仓库

仓库只在第一次启动时克隆，以后不会自动更新。要拿到新内容，在 JupyterLab 的终端里运行：

```bash
cd ~/hello-gpu && git pull
```

### 3. 跑环境检查

在 `hello-gpu/notebooks/` 里新建一个 Notebook，运行[环境检查的三行](#check)。

### 4. 用完停掉服务器

运行时长到了，服务器自动停止。提前做完就在菜单里点 File → Hub Control Panel → Stop My Server。积分按「运行分钟 × 硬件倍率」扣，克隆的仓库默认在服务器停止后保留，见[部署配置](https://github.com/AMDResearch/aup-learning-cloud/blob/main/runtime/values.yaml)。

## 本地 {#local}

本书的实验机是 RX 9070 XT + 原生 Ubuntu 24.04。驱动按 AMD 官方文档装；ROCm、PyTorch、Triton 和 JupyterLab 用仓库里的配置装进一个虚拟环境，不动系统的 Python。

<PlatformFacts id="local" />

表里的版本是[旧版第 1 章](/part0-intro/chapter1/)在实验机上复测的结果（2026-09-19）。下面第 3 步装的实验室环境 `notebooks/part0-intro` 锁定的是同一组版本，见它的 `uv.lock`。

### 1. 装驱动

按 [AMD 官方安装说明（ROCm 10.0.0）](https://rocm.docs.amd.com/en/docs-10.0.0/install/rocm.html)装好驱动，给当前用户访问 GPU 的权限；支持哪些卡和系统也在这一页。本书只在原生 Ubuntu 24.04 上验证过。Windows 的 WSL2 按同一页的 WSL 部分装，本书没有验证过。

### 2. 装 uv，克隆仓库

uv 按[官方安装说明](https://docs.astral.sh/uv/getting-started/installation/)装。然后：

```bash
git clone https://github.com/datawhalechina/hello-gpu.git
cd hello-gpu
```

### 3. 装实验室环境

```bash
python3 notebooks/tools/configure_env.py --part part0-intro --arch gfx1201 --sync
```

这条命令把 `notebooks/part0-intro/pyproject.toml` 里的设备标签改成 `gfx1201`，再运行 `uv sync`，在 `notebooks/part0-intro/.venv` 里装好 ROCm、PyTorch、Triton、JupyterLab 和教学包的依赖。第一次要下载很大的 GPU 依赖包。别的卡把 `gfx1201` 换成自己的 gfx 代号，查法见[附录 B](/appendix/appendix-b-switch-gpu/)。

### 4. 确认 ROCm 和 PyTorch 看得到 GPU

```bash
source notebooks/part0-intro/activate-rocm.sh
rocminfo | grep -E "^[[:space:]]*(Name|Device Type):"
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

`rocminfo` 的输出里要有 `Device Type: GPU`，同一段的 `Name` 是 `gfx1201`；第二条打印 `True` 和显卡的名字。这和旧版第 1 章 1.4、1.5 节是同一组检查。`rocminfo` 看不到 GPU 时，回到第 1 步查驱动和权限，先别往下走。

### 5. 启动 JupyterLab，跑环境检查

```bash
bash notebooks/tools/serve.sh
```

它在 `127.0.0.1:8895` 启动 JupyterLab，根目录是 `notebooks/`，并注册「Hello GPU · part0-intro (ROCm)」内核。浏览器打开终端里打印的地址，在根目录新建一个 Notebook，内核选「Hello GPU · part0-intro (ROCm)」，运行[环境检查的三行](#check)。

第 3–5 步用的是 Notebook 的维护者工具（`notebooks/README.md`），用它们在真卡上跑新版实验室的整套流程 [待实测]。

## 交成绩和导入卡片 {#import}

实验室 Notebook 的最后一节「交成绩」运行 `hg.submit(...)`，打印一条通关链接和一串 `HGPU1.` 开头的通关码。点链接回到关卡页，成绩自动导入；链接打不开，就把通关码贴进关卡页「实验室」卡片的「导入成绩」。星级由网页按这一关的规则重新算。

环境检查打出来的 `HGCARD1.` 导入码贴进<a :href="withBase('/me/#gpu-card')">我的 GPU 卡片</a>。两种码贴错了地方，网页会说明该贴到哪里。成绩和卡片只存在这个浏览器里，换设备时从「我的成长」导出存档带过去。

## 跑不通时 {#troubleshooting}

按报错的原文找，每条依次是现象、原因、怎么改：

- ``File `'common/bootstrap.py'` not found``：Notebook 不在仓库的 `notebooks/` 目录里。在 `notebooks/` 里新建 Notebook 再运行。
- `No module named 'hello_gpu'`：第一行 `%run common/bootstrap.py` 没有运行。从第一行开始运行。
- `No module named 'pandas'`：镜像里没装教学包用到的 pandas。在终端运行 `pip install pandas`，重启内核再运行。不要 `pip install torch`：它会把镜像自带的 ROCm 版 PyTorch 换成 CUDA 版，见 [Radeon Cloud 文档](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/guides/images/)。
- `需要 AMD GPU：当前 Python 环境里的 PyTorch（…）不是 ROCm 版`：内核里的 PyTorch 不是 ROCm 版。本地选「Hello GPU · part0-intro (ROCm)」内核；云平台上重新启动一个实例。
- `需要 AMD GPU：PyTorch 看不到 GPU`：服务器没有挂 GPU，或者当前用户不能访问 `/dev/kfd`、`/dev/dri`。AUP 上确认选的是 GPU 环境；本地运行 `rocminfo`，按官方安装说明配好权限。
- 「软件」一行的 Triton 写着「未找到」：环境里没有 Triton。Triton 路线的实验换一个装了 Triton 的环境。

## 别的 Jupyter 环境 {#other}

有 ROCm 版 PyTorch 和终端的平台都能这样准备：在终端里克隆仓库，再在 `hello-gpu/notebooks/` 里跑[环境检查](#check)。

```bash
git clone https://github.com/datawhalechina/hello-gpu.git
```

## 为什么没有 git-pull 一键链接 {#nbgitpuller}

很多 JupyterHub 用 [nbgitpuller](https://nbgitpuller.readthedocs.io/en/latest/use.html) 的 git-pull 链接一键拉取仓库，这两个平台都用不上：

- AUP Learning Cloud 的开源镜像没有装 nbgitpuller（见 [Dockerfile.rocm](https://github.com/AMDResearch/aup-learning-cloud/blob/main/dockerfiles/Base/Dockerfile.rocm)）。平台自带的「启动时克隆 Git 仓库」做的是同一件事，上面的启动链接用的就是它。
- AMD Radeon Cloud 每次启动的是一台新的 JupyterLab 实例，网页没法预先知道它的地址，给不出固定的 git-pull 链接。模板库的模板在启动时克隆仓库，作用相同。

<style scoped>
/* 正文段落限制行长（同前言）；表格、代码和平台卡片照样占满版心。 */
p:not([class]) {
  max-width: 44em;
}

/* 路径和报错信息很长：手机上在任意位置折行，不把页面撑出横向滚动。 */
:not(pre) > code {
  overflow-wrap: anywhere;
}
</style>
