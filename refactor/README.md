# Hello GPU 重构工作区

这里是 Hello GPU v2 重构的全部文档、规范和任务。工作方式：一位执行者用 Claude Code 按顺序做任务，每个会话只做一个任务，做完提交并推送到 `refactor/v2`；作者在关口处验收一次，其余任务最后统一验收。

## 文件导航

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md`、`CLAUDE.md` | 给 Claude Code 的入口说明（只在 `refactor/v2` 分支上提交） |
| `refactor/PLAN.md` | 重构方案：已确定的决定、完成后的样子、架构、阶段和风险 |
| `refactor/OUTLINE.md` | 课程大纲（由 `docs/course/outline.json` 生成，不要手改） |
| `refactor/specs/` | 九份规范：视觉、动效、交互、游戏化、语言、关卡模板、实验室、模拟器、工程 |
| `refactor/tasks/` | 任务文件，一个任务一个文件；`_TEMPLATE.md` 是模板 |
| `refactor/design/` | 设计稿源文件（`.dc.html`），里面的 SVG 和配色可以直接复制 |
| `refactor/pilot-test-protocol.md` | 试玩协议（作者验收关口用） |
| `refactor/archive/` | v1 方案存档，只读 |
| `docs/course/outline.json` | 课程结构的唯一数据源 |
| `.github/workflows/refactor-check.yml` | 每次推送到 `refactor/v2` 自动跑检查 |
| `/preview/board/` | 网页看板（`npm run docs:dev` 后打开 `http://localhost:5173/hello-gpu/preview/board/`，端口以终端输出为准） |

## 开始之前（执行者只需做一次）

1. 环境：Git；Node.js 22.18 或更高（单测直接导入 `.ts` 文件，需要 Node 自带的类型剥离）；Python 3.10 或更高（实验室相关任务）；Claude Code。
2. 克隆并切到重构分支：

   ```bash
   git clone https://github.com/datawhalechina/hello-gpu.git
   cd hello-gpu
   git switch refactor/v2
   npm install
   ```

3. 确认有推送权限：`git push --dry-run origin refactor/v2` 不报权限错误。
4. 确认基线是好的：`npm run refactor:check && npm test` 通过。
5. 在仓库根目录启动 Claude Code，粘贴下面的「开工」提示词。

截图巡检（F-03 之后）还需要 `npx playwright install chromium`。需要 AMD GPU 的任务（R 系列）只会在能运行 `rocminfo` 的机器上出现。

## 固定提示词

看板上也有这些提示词和复制按钮。

**开工：领取下一个任务**（日常只用这一句）

```text
按 refactor/README.md 的「会话流程」继续 Hello GPU 重构：领取下一个可开始的任务，完成后提交并推送到 refactor/v2 分支，最后告诉我做了什么、怎么验证的。
```

**做指定的任务**（把 `<编号>` 换成任务编号，例如 F-01）

```text
按 refactor/README.md 的「会话流程」完成重构任务 <编号>，完成后提交并推送到 refactor/v2 分支，最后告诉我做了什么、怎么验证的。
```

**验收**（作者使用，见「验收流程」）

```text
验收任务 <编号>：通过
```

```text
验收任务 <编号>：不通过（原因：……）
```

```text
验收阶段 <阶段号>：除下面列出的任务外全部通过。<编号>：不通过（原因：……）
```

## 会话流程

收到「开工」或「做指定的任务」提示词后，按顺序执行：

1. **同步并确认工作区**：`git switch refactor/v2`，`git pull --ff-only origin refactor/v2`；`git status --short` 必须干净。不干净时列出改动，问执行者怎么处理，不要自己丢弃。拉取失败（本地和远程分叉）时停下来说明情况，不要强推、不要重置。
2. **选任务**：
   - 「开工」：运行 `npm run tasks:next`。
     - 它给出任务时，领取第一个。
     - 它提示「有进行中的任务」时，先完成那个任务。
     - 它提示「到达作者验收关口」时，**不要开始任何任务**：确认改动都已推送（`git log origin/refactor/v2..HEAD` 为空），把命令输出里作者需要做的事转告执行者，请他找作者验收，然后结束会话。
   - 「做指定的任务」：运行 `npm run tasks -- show <编号>`，确认依赖都已完成（待验收也算完成）。这是执行者明确指定的，即使有关口等待验收也可以做。
3. **读上下文**：读任务文件全文；读任务 `specs` 字段列出的每份规范（`refactor/specs/<名字>.md`）；关卡任务还要读 `docs/course/outline.json` 里对应的条目和上一关的页面。规范和任务冲突时，以规范为准，并在完成记录里指出冲突。
4. **开始**：`npm run tasks -- start <编号>`（状态变为「进行中」）。
5. **实现**：按「要做的事」逐条完成。范围控制：
   - 只做本任务的事。发现别的问题，记进完成记录的「遗留问题」。
   - 需要作者决定的事（新组件、偏离规范、超出预算），不要停下等待：选一个最稳妥的做法继续，并写进「待确认」。作者最后验收时统一处理。
   - 任务明显太大，一次会话做不完：完成一个可以独立验收的部分，把剩余部分拆成新任务（见「新增与拆分任务」）。
   - 不编造事实：没有出处的数字、版本号和硬件参数写成「[待实测]」。
6. **验证**：运行「验证方式」里的每条命令，至少包括 `npm run refactor:check`、`npm test`、`npm run docs:build`；UI 任务还要运行截图巡检并亲自看截图。命令失败就修，修不好如实记录。
7. **填写任务文件**：
   - 在「验收标准」里把做到的项改成 `- [x]`；没做到的保持 `- [ ]`，并在完成记录里说明原因。
   - 把「完成记录」的占位文字替换成下面的格式。
   - 运行 `npm run tasks -- review <编号>`（状态变为「待验收」）。有未勾选的项时命令会拒绝；确实做不到的，说明原因后加 `--force`。
8. **提交并推送**：
   - `git add` 本任务改动的文件（包括任务文件本身），提交信息为 `refactor(<编号>): <任务标题>`，结尾加上 Co-Authored-By 行。
   - `git push origin refactor/v2`。被拒绝时先 `git pull --rebase origin refactor/v2`，解决冲突后重新运行第 6 步的检查，再推送。
   - 只推送 `refactor/v2`；不强推，不改写已推送的历史，不推送其他分支，不合并到 main。
   - 推送失败（没有权限、网络问题）时如实告诉执行者，提交留在本地。
9. **汇报**：用中文告诉执行者做了什么、怎么验证的（命令和结果）、截图在哪、有哪些「待确认」和「遗留问题」、是否已推送。最后运行一次 `npm run tasks:next`：如果下一步是作者验收关口，明确提醒执行者「请找作者验收 G-xx」。

完成记录的格式：

```markdown
- 日期：2026-11-08
- 做了什么：……
- 改动文件：……
- 验证：`npm test`（xx 个通过）；`npm run docs:build` 通过；截图在 refactor/shots/2026-11-08/
- 遗留问题：……（没有就写「无」）
- 待确认：……（需要作者决定的事；没有就写「无」）
```

## 验收流程

验收分两种：

- **作者验收关口**（编号 `G-xx`，共 6 个）：执行者的会话到达关口后会停下，执行者找作者。作者按关口任务里「要做的事」查看后给出结论，关口通过后执行者才继续。
- **普通任务**：做完是「待验收」，不挡后续任务。作者最后统一验收，可以逐个，也可以按阶段批量。

不论在谁的电脑上验收，会话都要先 `git pull --ff-only origin refactor/v2`，处理完再提交并推送。

作者说「验收任务 <编号>：通过」时：

1. `npm run tasks -- done <编号>`（可以一次写多个编号）。
2. 关卡任务：把 `docs/course/outline.json` 里该关的 `status` 从 `draft` 改为 `ready`，运行 `npm run outline:md`。
3. 提交 `refactor(<编号>): 验收通过` 并推送。

作者说「验收阶段 <阶段号>：除下面列出的任务外全部通过……」时：

1. 对列出的每个不通过任务，执行下面「不通过」的第 1 步。
2. `npm run tasks -- done --phase <阶段号> --except <不通过的编号，用逗号分隔>`。
3. 通过的关卡任务按上面第 2 步改 `status`。
4. 提交 `refactor: 验收阶段 <阶段号>` 并推送。

作者说「验收任务 <编号>：不通过（原因：……）」时：

1. `npm run tasks -- reopen <编号> --note "<原因>"`（状态退回「进行中」，原因记入「验收记录」）。
2. 在同一个会话里按原因修改，然后从「会话流程」第 6 步继续：验证、更新完成记录（追加一条，不删旧记录）、`review`、提交并推送。
3. 一次退回多个任务时，逐个修改、逐个提交；修改范围很大时，拆成新任务。

作者验收关口时：

- 通过：会话运行 `npm run tasks -- done G-xx`，提交 `refactor(G-xx): 验收通过` 并推送。之后执行者继续用「开工」提示词。
- 不通过：会话把作者的意见整理成修复任务（新任务文件，编号如 `F-15a`，`order` 排在关口之前，关口的 `deps` 加上这些新任务），关口保持「待开始」，提交并推送。执行者继续开工时会先做这些修复任务，做完再次到达关口。

## 状态与更新规则

| 状态 | 含义 | 谁来改 | 命令 |
| --- | --- | --- | --- |
| 待开始 `todo` | 还没开始 | 新建任务时的默认值 | — |
| 进行中 `doing` | 会话正在做；同一时间只能有一个 | 会话开始任务时 | `tasks -- start <编号>` |
| 待验收 `review` | 会话做完了，等作者看 | 会话完成任务时 | `tasks -- review <编号>` |
| 已完成 `done` | 作者验收通过 | 作者给出结论后，由会话执行 | `tasks -- done <编号>` |
| 受阻 `blocked` | 缺少外部条件（例如需要作者提供账号、需要真卡） | 会话发现受阻时 | `tasks -- block <编号> --note "原因"` |

- 只能用命令改状态，不要手改 frontmatter 里的 `status` 和 `updated`。
- 普通任务的依赖处于「待验收」或「已完成」都算满足；作者验收关口必须「已完成」，后面的任务才能开始。
- 一个会话中途中断：下次运行 `tasks:next` 会提示有进行中的任务，接着做即可；要放弃就 `tasks -- reset <编号>`。
- 作者想看进度：`git pull` 后运行 `npm run docs:dev` 打开看板；也可以直接在 GitHub 上看 `refactor/tasks/` 和提交记录，每次推送的自动检查结果在 Actions 页面。

## 任务文件格式

```markdown
---
id: NV-05                  # 编号，与文件名一致
title: 1-5 一起行动的小队（wavefront 与 SIMD）
phase: 1                   # 0 基建 / 1 新手村 / 2 铸造城 / 3 试炼场 / 4 收尾
order: 280                 # 全局顺序，tasks:next 按它从小到大挑
area: novice               # 领域，见 scripts/refactor/task-lib.mjs 的 AREAS
status: todo               # 只用命令修改
deps: [NV-04, S-07]        # 依赖的任务编号
size: M                    # S（1 小时内）/ M（半天）/ L（一个完整会话）
gpu: false                 # 是否需要 AMD GPU
owner: ai                  # ai = 会话执行；author = 作者验收关口
specs: [05-writing, 06-stage-template]   # 必读规范
outputs: [docs/novice/wavefront/]        # 主要产出
updated: 2026-11-08        # 只用命令修改
---
```

正文固定七个小节：目标、背景、要做的事、验收标准、验证方式、完成记录、验收记录。`npm run tasks:check` 会检查格式、依赖是否存在、有没有循环依赖。

## 新增与拆分任务

- 复制 `refactor/tasks/_TEMPLATE.md` 为 `refactor/tasks/<编号>.md`。
- 拆分的任务用原编号加小写字母：`F-05a`、`F-05b`。全新的任务在同一领域里顺延编号。
- `order` 取相邻任务之间的数（例如插在 280 和 290 之间就用 285）。
- 在原任务的完成记录里写明拆出了哪些任务。新任务和原任务一起提交。
- 运行 `npm run tasks:check` 确认格式正确。

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run tasks:next` | 下一个可以开始的任务；到达作者验收关口时停下 |
| `npm run tasks -- list [--status todo] [--phase 1] [--area novice]` | 列出任务 |
| `npm run tasks -- show <编号>` | 任务概要和依赖状态 |
| `npm run tasks -- start / review / reset / unblock <编号>` | 改状态 |
| `npm run tasks -- done <编号...>` | 验收通过（可以多个编号） |
| `npm run tasks -- done --phase <N> [--except A,B]` | 批量验收某阶段的待验收任务 |
| `npm run tasks -- reopen / block <编号> --note "原因"` | 退回或标记受阻 |
| `npm run tasks -- stats` | 统计 |
| `npm run tasks:check` | 检查全部任务文件 |
| `npm run refactor:check` | 任务、大纲以及后续加入的各项检查 |
| `npm test` | 全部单测 |
| `npm run docs:build` | 完整构建 |
| `npm run docs:dev` | 本地预览，看板在 `/preview/board/` |
| `npm run outline:md` | 从 `outline.json` 重新生成 `OUTLINE.md` |
| `npm run shot -- <页面路径...>` | 截图巡检（F-03 完成后可用） |
| `npm run nb:build` / `npm run nb:check` | 生成和检查实验室 Notebook（L-03 完成后可用） |

## 硬性规则

1. 一个会话只做一个任务；做完就提交并推送，不顺手做下一个。
2. 只在 `refactor/v2` 分支工作，只推送这个分支；不强推，不改写已推送的历史，不合并到 main，不提交与任务无关的文件。
3. 到达作者验收关口时停下，等作者验收后再继续。
4. 旧版内容（`docs/part*`、`docs/appendix`、`notebooks/part*`）只读，只有任务明确要求时才能改。
5. 不做需要后端的功能；不涉及推理框架；LeetGPU 等外部题库只链接，不翻译或改编题面。
6. 不编造数字、版本号和硬件参数；实测数字只能来自实验档案馆。
7. 规范是共同约定。想改规范，在完成记录的「待确认」里提出，作者同意后再改。
