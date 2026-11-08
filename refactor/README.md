# Hello GPU 重构工作区

这里是 Hello GPU v2 重构的全部文档、规范和任务。

工作方式：一位执行者用 AI 编码助手（Claude Code、Codex、Cursor 等都可以，也可以手工）按顺序做任务。每段工作在一个工作分支上进行，每个任务做完提交并推送；到达作者验收关口时，这一段的 PR 交给作者审查，问题在 PR 里沟通，**作者合并 PR 就是验收通过**。

## 文件导航

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md` | 给 AI 编码助手的入口说明（多数工具会自动读取；`CLAUDE.md` 只是引用它） |
| `refactor/PLAN.md` | 重构方案：已确定的决定、完成后的样子、架构、阶段和风险 |
| `refactor/OUTLINE.md` | 课程大纲（由 `docs/course/outline.json` 生成，不要手改） |
| `refactor/specs/` | 九份规范：视觉、动效、交互、游戏化、语言、关卡模板、实验室、模拟器、工程 |
| `refactor/tasks/` | 任务文件，一个任务一个文件；`_TEMPLATE.md` 是模板 |
| `refactor/design/` | 设计稿源文件（`.dc.html`），里面的 SVG 和配色可以直接复制 |
| `refactor/pilot-test-protocol.md` | 试玩协议（作者验收关口用） |
| `refactor/archive/` | v1 方案存档，只读 |
| `docs/course/outline.json` | 课程结构的唯一数据源 |
| `.github/workflows/refactor-check.yml` | PR 和推送到 `refactor/v2` 时自动检查 |
| `.github/workflows/refactor-accept.yml` | PR 合并到 `refactor/v2` 后，自动把任务标为「已完成」 |
| `/preview/board/` | 网页看板（`npm run docs:dev` 后打开 `http://localhost:5173/hello-gpu/preview/board/`，端口以终端输出为准） |

## 开始之前（执行者只需做一次）

1. 环境：Git；Node.js 22.18 或更高（单测直接导入 `.ts` 文件，需要 Node 自带的类型剥离）；Python 3.10 或更高（实验室相关任务）；你常用的 AI 编码助手。
2. 克隆并安装：

   ```bash
   git clone https://github.com/datawhalechina/hello-gpu.git
   cd hello-gpu
   git switch refactor/v2
   npm install
   ```

3. 确认有推送权限：`git push --dry-run origin refactor/v2` 不报权限错误。建议装好 GitHub CLI（`gh`）并登录，创建和更新 PR 会方便很多；没有也可以在网页上操作。
4. 确认基线是好的：`npm run refactor:check && npm test` 通过。
5. 在仓库根目录启动 AI 编码助手，粘贴下面的「连续模式」提示词。助手会运行很多 `npm`、`node`、`git`、`npx` 命令，建议提前放行这些命令和仓库内的文件编辑，否则会频繁停下来询问。

截图巡检（F-03 之后）还需要 `npx playwright install chromium`。需要 AMD GPU 的任务（R 系列）只会在能运行 `rocminfo` 的机器上出现。

## 分支与 PR

```text
refactor/v2 ──●─────────────────────●(合并 = 验收 G-01)─────────────────●(合并 = 验收 G-02)──
               \                   /  \                                 /
work/G-01       ●─F-01─F-02─…─F-15─●   work/G-02 ●─S-01─NV-01─…─NV-06─●
               （草稿 PR，作者随时可看；到达 G-01 后转为待审查）
```

- `refactor/v2` 是集成分支，只通过合并 PR 改动（以及 Actions 自动提交的状态更新）。
- 每段工作在 `work/<下一个作者关口编号>` 分支上进行，例如 `work/G-01`。`npm run tasks -- sync` 会自动切到当前该用的分支，没有就从最新的 `refactor/v2` 创建。
- 一段工作对应一个 PR：`work/G-xx → refactor/v2`。推送第一个任务后就创建**草稿 PR**，作者可以随时查看、评论；到达关口时转为 Ready for review。
- 创建 PR：标题用 `npm run -s tasks -- pr-body --title` 的输出，说明用 `npm run -s tasks -- pr-body` 的输出。有 `gh` 时：

  ```bash
  npm run -s tasks -- pr-body > /tmp/pr-body.md
  gh pr create --draft --base refactor/v2 --title "$(npm run -s tasks -- pr-body --title)" --body-file /tmp/pr-body.md
  ```

  没有 `gh` 时，打开 `https://github.com/datawhalechina/hello-gpu/compare/refactor/v2...work/G-xx`，把标题和说明粘贴进去，选「Create draft pull request」。
- 作者合并 PR 后，`refactor-accept.yml` 会自动把这段的待验收任务和关口标为「已完成」，关卡任务对应的大纲状态从 `draft` 改为 `ready`。

## 固定提示词

看板上也有这些提示词和复制按钮。

**连续模式：连续做到下一个关口**（推荐，日常只用这一句）

```text
按 refactor/README.md 的「连续模式」推进 Hello GPU 重构：按顺序逐个完成任务（工具支持子代理时，每个任务交给一个新的子代理），每个任务都按「会话流程」完成并推送到当前工作分支；到达作者验收关口时按「到达作者验收关口」提交 PR 并停下，没有可做的任务或同一任务失败两次也停下，最后汇总这次完成的任务、待确认事项和下一步。
```

想限制数量时在末尾加一句，例如「这次最多做 5 个任务」。

**只做一个指定的任务**（把 `<编号>` 换成任务编号，例如 F-01）

```text
按 refactor/README.md 的「会话流程」完成重构任务 <编号>，完成后提交并推送到当前工作分支，最后告诉我做了什么、怎么验证的。
```

**处理作者在 PR 里的意见**

```text
按 refactor/README.md 的「处理 PR 意见」处理当前 PR 里作者的评论：逐条修改、验证并推送，再在 PR 里逐条回复。
```

## 会话流程

一个任务的完整流程。「只做一个指定的任务」直接按这里执行；「连续模式」对每个任务重复这里的流程。

1. **同步**：`npm run tasks -- sync`（它会检查工作区是否干净、拉取 `refactor/v2`、切到当前工作分支），然后 `npm install`（依赖没变时很快）。sync 报错时按它的提示处理，不要强推、不要重置、不要丢弃改动。
2. **选任务**：
   - 指定了编号：运行 `npm run tasks -- show <编号>`，确认依赖都已完成（待验收也算完成）。执行者明确指定的任务，即使关口在等待验收也可以做。
   - 没指定编号：运行 `npm run tasks:next`。
     - 它给出任务时，领取第一个。
     - 它提示「有进行中的任务」时，先完成那个任务。
     - 它提示「到达作者验收关口」时，不要开始任何任务，按下面的「到达作者验收关口」处理。
3. **读上下文**：读任务文件全文；读任务 `specs` 字段列出的每份规范（`refactor/specs/<名字>.md`）；关卡任务还要读 `docs/course/outline.json` 里对应的条目和上一关的页面。规范和任务冲突时，以规范为准，并在完成记录里指出冲突。
4. **开始**：`npm run tasks -- start <编号>`（状态变为「进行中」）。
5. **实现**：按「要做的事」逐条完成。范围控制：
   - 只做本任务的事。发现别的问题，记进完成记录的「遗留问题」。
   - 需要作者决定的事（新组件、偏离规范、超出预算），不要停下等待：选一个最稳妥的做法继续，并写进「待确认」。这些会汇总到 PR 说明里，由作者审查时决定。
   - 任务明显太大，一次做不完：完成一个可以独立验收的部分，把剩余部分拆成新任务（见「新增与拆分任务」）。
   - 不编造事实：没有出处的数字、版本号和硬件参数写成「[待实测]」。
6. **验证**：运行「验证方式」里的每条命令，至少包括 `npm run refactor:check`、`npm test`、`npm run docs:build`；UI 任务还要运行截图巡检并亲自看截图。命令失败就修，修不好如实记录。
7. **填写任务文件**：
   - 在「验收标准」里把做到的项改成 `- [x]`；没做到的保持 `- [ ]`，并在完成记录里说明原因。
   - 把「完成记录」的占位文字替换成下面的格式。
   - 运行 `npm run tasks -- review <编号>`（状态变为「待验收」）。有未勾选的项时命令会拒绝；确实做不到的，说明原因后加 `--force`。
8. **提交并推送**：
   - `git add` 本任务改动的文件（包括任务文件本身），提交信息为 `refactor(<编号>): <任务标题>`。
   - `git push origin <当前工作分支>`（第一次推送用 `git push -u`）。不强推，不改写已推送的历史，不直接推送 `refactor/v2` 和 main。
   - 这一段还没有 PR 时，按「分支与 PR」创建草稿 PR；已有 PR 时可以顺手用 `pr-body` 更新说明。
   - 推送失败（没有权限、网络问题）时如实报告，提交留在本地。
9. **汇报**：告诉执行者做了什么、怎么验证的（命令和结果）、截图在哪、有哪些「待确认」和「遗留问题」、是否已推送、PR 链接。

完成记录的格式（「待确认」和「遗留问题」两行会被 `pr-body` 汇总到 PR 说明里，请保持这个写法）：

```markdown
- 日期：2026-11-08
- 做了什么：……
- 改动文件：……
- 验证：`npm test`（xx 个通过）；`npm run docs:build` 通过；截图在 refactor/shots/2026-11-08/
- 遗留问题：……（没有就写「无」）
- 待确认：……（需要作者决定的事；没有就写「无」）
```

## 到达作者验收关口

`tasks:next` 提示「到达作者验收关口 G-xx」时：

1. 确认改动都已提交并推送：`git status` 干净，`git log origin/work/G-xx..HEAD` 为空。
2. 更新 PR：用 `npm run -s tasks -- pr-body` 重新生成说明，更新到本段 PR（还没有就创建），并从草稿转为 Ready for review（`gh pr ready`，或在网页上点「Ready for review」）。
3. 停下，告诉执行者：「已到达作者验收关口 G-xx，PR 链接是……，请作者审查」，附上关口任务里作者要看的内容。
4. 之后：
   - 作者在 PR 里提意见 → 用「处理 PR 意见」的提示词处理。
   - 作者合并了 PR → 运行 `npm run tasks -- sync`，开始下一段（会自动切到 `work/<下一个关口>`）。

## 处理 PR 意见

1. `npm run tasks -- sync`，确认在本段的工作分支上。
2. 读 PR 里作者的全部评论和审查意见（`gh pr view --comments`，或在网页上看），列出要改的点。
3. 逐条处理：
   - 针对某个任务的问题：`npm run tasks -- reopen <编号> --note "<作者的意见摘要>"`，修改，按「会话流程」第 6–8 步验证、更新完成记录（追加一条，不删旧记录）、`review`、提交并推送。
   - 不针对具体任务的小问题：直接修改，提交信息写 `fix(<相关编号>): <改了什么>`。
   - 需要新做的工作：拆成新任务（见「新增与拆分任务」，`order` 排在关口之前，并把编号加进关口的 `deps`），然后按会话流程完成。
   - 不同意或需要作者再决定的：不要改，在 PR 里说明理由，请作者确认。
4. 全部处理完后，在 PR 里逐条回复（改了什么、对应哪个提交），并用 `pr-body` 更新 PR 说明。
5. 告诉执行者：意见已处理，请作者再看。

## 连续模式

收到「连续模式」提示词时：

1. **准备**：`npm run tasks -- sync`，`npm install`。
2. **取任务**：运行 `npm run tasks:next`。
   - 到达作者验收关口：按「到达作者验收关口」处理，然后转到第 5 步。
   - 有进行中的任务：先完成它。
   - 没有可以开始的任务（例如只剩需要 GPU 的任务）：转到第 5 步。
   - 否则取它给出的第一个任务编号。
3. **完成任务**：
   - **工具支持子代理时**（例如 Claude Code 的 Agent 工具）：当前会话只做调度，不写代码。每个任务启动一个新的通用子代理（不要指定更小的模型），一次只派一个，等它结束再继续。子代理的提示词：

     ```text
     按 refactor/README.md 的「会话流程」完成重构任务 <编号>，完成后提交并推送到当前工作分支。你是调度者派出的子代理：只做这一个任务，不要再派子代理，不要领取其他任务，不要创建或修改 PR。结束时用不超过 15 行汇报：任务编号；结果（完成 / 部分完成 / 受阻）；提交哈希；验证命令和结果；待确认；遗留问题。
     ```

     子代理结束后，调度者自己核对：`git status --short` 为空；`git log origin/<当前工作分支>..HEAD` 为空；`npm run tasks -- show <编号>` 显示「待验收」；`npm run tasks:check` 通过。有一项不满足，再派一个子代理接着做，提示词写明上一次的问题。
   - **工具不支持子代理时**：自己按「会话流程」完成这个任务。每个任务开始前重新读一遍任务文件和规范，不要凭前面任务的印象做；连续做了 5 个左右任务后，建议执行者开一个新会话再继续，避免上下文过长。
   - 同一任务两次都没完成，或者任务受阻：转到第 5 步。
4. **继续**：记一行（编号、结果、提交哈希）。本段还没有 PR 就创建草稿 PR。回到第 2 步。达到执行者给出的数量上限时转到第 5 步。
5. **汇总**：列出这次完成的任务（编号、标题、提交哈希）、所有「待确认」和「遗留问题」、PR 链接、停下的原因。停在作者验收关口时，写明「请作者审查 PR」。

一次只做一个任务，不要并行：大家共用同一个工作目录和分支，并行会互相冲突。

## 作者怎么验收

- 本段 PR 一直是可见的：草稿阶段可以随时看提交、留评论；到达关口时执行者会把 PR 转为 Ready for review 并通知你。
- PR 说明里列出了本段完成的任务、关口要看的内容、执行者汇总的「待确认」和「遗留问题」。每次推送的自动检查结果在 PR 下方。
- 想在本地看效果：`git fetch origin && git switch work/G-xx && npm install && npm run docs:dev`。
- 有问题：在 PR 里评论或 Request changes，可以针对具体文件和行；执行者会修改并回复。
- 没问题：合并 PR（建议用「Create a merge commit」，保留每个任务的提交）。合并就是验收通过，任务状态由 Actions 自动更新，执行者随后继续下一段。

## 状态与更新规则

| 状态 | 含义 | 谁来改 | 命令 |
| --- | --- | --- | --- |
| 待开始 `todo` | 还没开始 | 新建任务时的默认值 | — |
| 进行中 `doing` | 正在做；同一时间只能有一个 | 开始任务时 | `tasks -- start <编号>` |
| 待验收 `review` | 做完了，在本段 PR 里等作者审查 | 完成任务时 | `tasks -- review <编号>` |
| 已完成 `done` | 作者验收通过 | PR 合并后由 Actions 自动执行 | `tasks -- accept` |
| 受阻 `blocked` | 缺少外部条件（例如需要作者提供账号、需要真卡） | 发现受阻时 | `tasks -- block <编号> --note "原因"` |

- 只能用命令改状态，不要手改 frontmatter 里的 `status` 和 `updated`。执行者不要自己把任务标为「已完成」。
- 普通任务的依赖处于「待验收」或「已完成」都算满足；作者验收关口必须「已完成」（即本段 PR 已合并），后面的任务才能开始。
- 中途中断：下次运行 `tasks:next` 会提示有进行中的任务，接着做即可；要放弃就 `tasks -- reset <编号>`。
- 看进度：GitHub 上的 PR 和提交记录；或在本地切到工作分支后打开看板。

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
owner: ai                  # ai = 执行者完成；author = 作者验收关口
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
| `npm run tasks -- sync` | 同步并切到当前工作分支（开工前运行） |
| `npm run tasks:next` | 下一个可以开始的任务；到达作者验收关口时停下 |
| `npm run tasks -- list [--status todo] [--phase 1] [--area novice]` | 列出任务 |
| `npm run tasks -- show <编号>` | 任务概要和依赖状态 |
| `npm run tasks -- start / review / reset / unblock <编号>` | 改状态 |
| `npm run tasks -- reopen / block <编号> --note "原因"` | 退回或标记受阻 |
| `npm run -s tasks -- pr-body [--title]` | 生成本段 PR 的说明 / 标题 |
| `npm run tasks -- branch` | 打印当前工作分支名 |
| `npm run tasks -- accept` | PR 合并后标记验收通过（通常由 Actions 执行） |
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

1. 一个任务一个提交；做完就推送，不顺手做下一个任务的事。
2. 只在当前工作分支 `work/G-xx` 上提交和推送；不强推，不改写已推送的历史，不直接推送 `refactor/v2` 和 main，不提交与任务无关的文件。
3. 到达作者验收关口时，提交 PR 并停下，等作者合并后再继续。
4. 旧版内容（`docs/part*`、`docs/appendix`、`notebooks/part*`）只读，只有任务明确要求时才能改。
5. 不做需要后端的功能；不涉及推理框架；LeetGPU 等外部题库只链接，不翻译或改编题面。
6. 不编造数字、版本号和硬件参数；实测数字只能来自实验档案馆。
7. 规范是共同约定。想改规范，在完成记录的「待确认」里提出，作者同意后再改。
