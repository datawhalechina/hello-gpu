# Hello GPU 仓库说明（给 AI 编码助手）

本仓库是 Datawhale 的 Hello GPU 教程：VitePress 站点（`docs/`）、配套 Notebook（`notebooks/`）和示例代码（`code/`），面向 AMD GPU（RX 9070 XT、ROCm）上的算子优化。和执行者交流一律用中文。

## 当前分支：refactor/v2（v2 重构）

本分支把教程重构成闯关式（新手村 → 铸造城 → 试炼场）。所有重构工作都按 `refactor/README.md` 的「会话流程」执行：

- 开工前 `git pull --ff-only origin refactor/v2`，工作区必须干净。
- 一个任务由一个会话（或连续模式里的一个子代理）完成。任务在 `refactor/tasks/`，用 `npm run tasks:next` 领取。
- 动手前读任务 `specs` 字段列出的规范（`refactor/specs/`）。规范和任务冲突时以规范为准。
- `tasks:next` 提示「到达作者验收关口」（G-xx）时，不开始任何任务：确认改动已推送，请执行者找作者验收。
- 做完运行检查、填写任务文件、提交，并推送到 `origin/refactor/v2`。不强推，不合并到 main，不推送其他分支。

执行者要求「连续模式」时，按 `refactor/README.md` 的「连续模式」当调度者：每个任务派一个新的子代理完成，自己只核对。

执行者只是随口提问、没有使用固定提示词时，同样遵守以上规则；不确定要不要开工就先问。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run tasks:next` | 下一个可以开始的任务 |
| `npm run tasks -- help` | 任务命令的完整用法 |
| `npm run refactor:check` | 任务、大纲等一致性检查 |
| `npm test` | 单测（需要 Node 22.18 或更高） |
| `npm run docs:build` | 完整构建 |
| `npm run docs:dev` | 本地预览；重构看板在 `/preview/board/` |

## 必须遵守

1. 旧版内容（`docs/part*`、`docs/appendix`、`notebooks/part*`、`code/`）只读，只有任务明确要求时才能改。
2. 不编造数字、版本号和硬件参数；查不到出处就写「[待实测]」。
3. 不做需要后端的功能；不涉及推理框架；LeetGPU 等外部题库只链接，不翻译或改编题面。
4. 新增依赖固定精确版本（`package-lock.json` 不进仓库）。
