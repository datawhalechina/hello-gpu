# 贡献指南

> 欢迎参与 hello-gpu！本文讲清楚**分支模型、命名约定、PR 流程和 commit 规范**。
> 项目定位与写作规范见 [README.md](./README.md) 与 [`.docs-rules/`](./.docs-rules/)，本文只管协作流程。

---

## 一、分支模型

采用 **`main` 发布 / `dev` 集成** 的双分支模型：

```
                 ┌──────────────────────────────────────────┐
                 │  datawhalechina/hello-gpu  (协作中心)     │
                 │                                          │
   部署/发布 ◀──  │  main  (受保护 · 默认分支 · 只收 PR)      │
                 │   ▲                                      │
                 │   │ release PR：dev → main（需 1 review） │
                 │   │                                      │
   日常集成 ◀──  │  dev   (受保护 · 开发主干 · 只收 PR)      │
                 │   ▲                                      │
                 │   │ feature PR：feat/* → dev             │
                 │   │                                      │
                 │  feat/*  fix/*  docs/*  ←─ 从 dev 切出   │
                 └──────────────────────────────────────────┘
                          ▲  pull / fork 同步
                          │
                 ┌────────┴───────────────┐
                 │  你的 fork（个人草稿）   │
                 └─────────────────────────┘
```

| 分支 | 角色 | 保护规则 | 谁能直接 push |
|---|---|---|---|
| `main` | 发布与部署基线（触发 Pages 部署） | 禁直推 · 需 PR · 需 1 个 approving review | 无人 |
| `dev` | 开发集成分支 | 禁直推 · 需 PR（review 宽松，作者可自 merge） | 无人 |
| `feat/*` `fix/*` `docs/*` `chore/*` | 功能分支 | 无保护 | 任意协作者 |

> **关键**：`main` 是稳定版，永远从 `dev` 合过来；`dev` 是日常工作的落点；功能分支一律从 `dev` 切出。

---

## 二、分支与命名约定

功能分支命名用 **Conventional Commits 前缀 + 简短描述**：

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 / 新章节 / 新实验 | `feat/part2-ch7-attention` |
| `fix/` | 修 bug | `fix/sidebar-toggle` |
| `docs/` | 纯文档改动 | `docs/typo-part1-ch3` |
| `chore/` | 构建、依赖、脚本 | `chore/bump-vitepress` |
| `refactor/` | 重构（不改行为） | `refactor/build-pipeline` |

规则：
- 一律小写，单词用 `-` 分隔，**不带中文**、不带空格。
- 尽量让分支名能对应到一张 PR 的主题：一个分支 = 一个 PR。

---

## 三、工作流（从 fork 提 PR）

> 假设你已 fork 仓库，并把上游加为 `datawhale` 远程。

### 0. 首次配置

```bash
git clone <your-fork-url>          # clone 你自己的 fork
cd hello-gpu
git remote add datawhale https://github.com/datawhalechina/hello-gpu.git
git fetch datawhale
git checkout -b dev --track datawhale/dev   # 建立本地 dev 跟踪上游
```

### 1. 开始一个功能

```bash
git checkout dev
git pull datawhale dev             # 永远先同步上游 dev
git checkout -b feat/part2-ch7-attention   # 从 dev 切功能分支
```

### 2. 本地开发 → 远程实验

实验代码、命令、性能数字必须先在 **Radeon RX 9070 XT + ROCm 10.0 + 原生 Ubuntu 24.04** 实测。
Mac 只做 git，实验机只跑实验，文件 scp 双向流转，详见 [AGENTS.md](./AGENTS.md)「远程实验速查」。

### 3. 提交

```bash
git add ...
git commit -m "feat(part2): add chapter 7 attention benchmark"
git push origin feat/part2-ch7-attention   # 推到你自己的 fork
```

### 4. 发 PR

在 GitHub 上发起 **`base: dev` ← `head: 你的fork:feat/...`** 的 PR。
PR 标题也用 Conventional Commits 格式（见第四节）。

### 5. Review & Merge

- `dev` 的 PR：review 宽松，作者可自行 merge（CI 目前不强制）。
- merge 前确认分支已基于最新 `dev`（避免冲突）。

### 6. 发布到 main（攒一批到 release 节点）

```bash
# 在 GitHub 上发 PR：base: main ← base: dev
# 需要 1 个 approving review，merge 后会自动触发 Pages 部署
```

---

## 四、Commit 规范

采用 **Conventional Commits**，和仓库历史保持一致：

```
<type>(<scope>): <subject>
```

| type | 含义 |
|---|---|
| `feat` | 新功能 / 新章节 / 新实验 |
| `fix` | 修 bug |
| `docs` | 文档改动 |
| `build` | 构建系统、依赖、部署 |
| `chore` | 杂项（重命名、清理等） |
| `refactor` | 重构，不改行为 |
| `perf` | 性能优化 |

约定：
- **subject 用英文或中文都行**，但保持简洁、祈使句（"add …" / "修复 …"）。
- `scope` 可选，常用 part/chapter 名：`feat(part1):`、`docs(ch3):`、`fix(deploy):`。
- 一个 commit 只做一件事；大改动拆成多个小 commit。

示例（来自本仓库真实历史）：

```
feat: add collapsible sidebar toggle to docs
fix: switch deploy base path and repo URLs to datawhalechina/hello-gpu
build: auto-convert PNG to WebP at build time for faster site loading
docs: rewrite part1-hardware-rocm with examples, illustrations, and clearer flow
```

---

## 五、PR Checklist

发 PR 前自查：

- [ ] 功能分支是从**最新 `dev`** 切出的
- [ ] 涉及命令/输出/性能数字的内容，已在 **Radeon RX 9070 XT + ROCm 10.0 + 原生 Ubuntu 24.04** 实测
- [ ] 图片已入仓库（不要外链），性能数字带硬件上下文
- [ ] commit message 符合 Conventional Commits
- [ ] PR 标题与主要 commit 一致
- [ ] 目标分支正确：日常 `→ dev`，发布 `dev → main`

---

## 六、常见问题

**Q：我能不能直接 push 到 dev / main？**
不能。两个分支都受保护，只收 PR。

**Q：我从 main 切分支行不行？**
不行。功能分支一律从 `dev` 切，避免把未发布的改动漏掉。

**Q：实验机上要不要 git？**
不要。实验机只跑实验，git 操作一律在本地 Mac 上做。详见 [AGENTS.md](./AGENTS.md)。

**Q：怎么同步上游最新的 dev？**
```bash
git checkout dev && git pull datawhale dev
```

**Q：我的 fork 要不要也设保护规则？**
不需要。fork 是个人草稿本，保护规则只设在上游 `datawhalechina/hello-gpu`。
