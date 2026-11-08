# Hello GPU 仓库说明（给 AI 编码助手）

本仓库是 Datawhale 的 Hello GPU 教程：VitePress 站点（`docs/`）、配套 Notebook（`notebooks/`）和示例代码（`code/`），面向 AMD GPU（RX 9070 XT、ROCm）上的算子优化。和执行者交流一律用中文。

## refactor/v2 与 work/G-xx 分支：v2 重构

这些分支把教程重构成闯关式（新手村 → 铸造城 → 试炼场）。所有重构工作都按 `refactor/README.md` 执行，要点：

- 开工前运行 `npm run tasks -- sync`：它会拉取 `refactor/v2` 并切到当前工作分支 `work/<下一个作者关口>`。
- 一个任务一个提交。任务在 `refactor/tasks/`，用 `npm run tasks:next` 领取；动手前读任务 `specs` 字段列出的规范（`refactor/specs/`），规范和任务冲突时以规范为准。
- 做完运行检查、填写任务文件、提交，并推送到当前工作分支。每段工作对应一个到 `refactor/v2` 的 PR，第一个任务推送后创建草稿 PR。
- `tasks:next` 提示「到达作者验收关口」（G-xx）时，不开始任何任务：按 README「到达作者验收关口」把 PR 转为待审查，请执行者找作者。作者合并 PR 就是验收通过。
- 不强推，不改写已推送的历史，不直接推送 `refactor/v2` 和 main；不要自己把任务标为「已完成」。

执行者要求「连续模式」时按 README「连续模式」做；要求处理 PR 意见时按「处理 PR 意见」做。执行者只是随口提问、没有使用固定提示词时，同样遵守以上规则；不确定要不要开工就先问。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run tasks -- sync` | 同步并切到当前工作分支 |
| `npm run tasks:next` | 下一个可以开始的任务 |
| `npm run -s tasks -- pr-body` | 生成本段 PR 的说明 |
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
