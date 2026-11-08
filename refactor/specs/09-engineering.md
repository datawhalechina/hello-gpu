# 09 工程规范

## 1. 目录约定

| 内容 | 位置 |
| --- | --- |
| 课程结构、术语表、徽章定义 | `docs/course/` |
| 新版关卡 | `docs/novice/<slug>/`、`docs/forge/<slug>/`、`docs/trial/<slug>/` |
| 冒险者手册 | `docs/handbook/` |
| 实验档案馆数据 | `docs/lab/data/` |
| 模拟器（纯 TS） | `docs/sim/` |
| 内容组件（关卡里用的） | `docs/components/kit/`，在主题里全局注册，Markdown 里不用 import |
| 站点外壳（布局、状态栏、地图、奖励） | `docs/.vitepress/theme/` |
| 预览页（组件预览、看板等内部页面） | `docs/preview/` |
| 实验室 Notebook | `notebooks/src/`（源）、`notebooks/<zone>/<slug>/`（生成） |
| 重构文档、规范、任务 | `refactor/` |
| 脚本 | `scripts/refactor/`；测试在 `scripts/tests/` |
| 旧版内容 | `docs/part*`、`docs/appendix`（只读；只有迁移任务可以动） |

新版页面直接写在最终路径下。上线切换（任务 M-02）之前，旧导航不链接它们；新页面统一带 `head: [[meta, {name: robots, content: noindex}]]`。

## 2. 分支、提交与 PR

- `refactor/v2` 是集成分支，只通过合并 PR 改动（GitHub Actions 自动提交的状态更新除外）。
- 每段工作在 `work/<下一个作者关口编号>` 分支上进行（`npm run tasks -- sync` 自动切换或创建），一段对应一个到 `refactor/v2` 的 PR。作者合并 PR 即验收通过。
- 一个任务一个提交，提交信息 `refactor(<任务编号>): <任务标题>`；PR 意见引起的小修改用 `fix(<任务编号>): <改了什么>`。
- 开始前工作区必须干净；不干净时先列出改动，问执行者怎么处理。
- 只推送当前工作分支；不强推，不改写已推送的历史，不直接推送 `refactor/v2` 和 main，不提交与任务无关的文件。
- `.github/workflows/refactor-check.yml` 在 PR 和推送到 `refactor/v2` 时运行 refactor:check、单测和构建；`refactor-accept.yml` 在 PR 合并后把任务标为「已完成」。

## 3. 技术约定

- 站点：VitePress（当前 2.0.0-alpha.18）+ Vue 3.5。组件用 `<script setup lang="ts">`。
- 服务端渲染安全：模块顶层不访问 `window`、`document`、`localStorage`；需要时在 `onMounted` 里调用（沿用试点的 `ensureLoaded()`）。
- `docs/sim/` 和其他会被 `node --test` 导入的 TS 文件：import 带 `.ts` 扩展名，只用可擦除的 TS 语法。
- 样式：只用 `01-visual.md` 的 token；组件样式用 scoped CSS。
- 依赖：新增依赖必须写明理由、固定精确版本，并评估包体积。预计会用到的依赖：`@fontsource/space-grotesk`、`@fontsource/jetbrains-mono`（F-01）、CodeMirror 6（S-05，按需加载）、Pyodide（A-02，文件自托管，不依赖海外 CDN）。
- 不使用 Google Fonts 和其他在国内不稳定的 CDN。

## 4. 数据与事实

- 正文里的实测数字只能来自 `docs/lab/data/` 里的档案条目，并用 `EvidenceCard` 标出条目。
- 硬件参数集中放在 `docs/course/hardware.json`（首次需要时建立），每条附官方来源链接或实测记录；正文引用这个文件，不手写参数。
- AI 不得写入任何没有出处的数字、版本号或硬件参数。确实需要但找不到出处时，写成「[待实测]」并在任务完成记录里列出。

## 5. 验证命令

| 命令 | 作用 |
| --- | --- |
| `npm run refactor:check` | 任务文件格式、大纲同步、关卡规范检查（F-14 之后包含关卡检查） |
| `npm test` | 全部单测（`scripts/tests/*.test.mjs`） |
| `npm run docs:build` | 完整构建（含旧版章节检查） |
| `npm run docs:dev` | 本地预览，看板在 `/preview/board` |
| `npm run outline:md` | 从 `outline.json` 重新生成 `refactor/OUTLINE.md` |
| `npm run tasks -- <命令>` | 任务状态管理，见 `refactor/README.md` |
| `npm run shot -- <页面路径>` | 截图巡检（F-03 之后可用） |
| `npm run nb:build` / `nb:check` | 生成和检查实验室 Notebook（L-03 之后可用） |

UI 类任务完成后，除了构建通过，还要用截图巡检检查桌面、375px、亮色、暗色四种情况，并亲自看一遍截图。

## 6. 性能与可访问性预算

- 首屏 JavaScript 压缩后不超过 200 KB；模拟器、代码编辑器、Pyodide 按需加载。
- 单个页面的图片总量不超过 500 KB（插画优先用 SVG）。
- 所有交互键盘可达；`prefers-reduced-motion` 生效；375px 无横向滚动；对比度 AA。

## 7. 新增任务

范围太大的任务可以拆分：复制 `refactor/tasks/_TEMPLATE.md`，编号用原编号加字母（如 `F-05a`），写清目标、依赖和验收标准，并在原任务里注明拆分。新增任务和拆分说明随当前任务一起提交。
