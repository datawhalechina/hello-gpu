# GPU Atlas 子应用

图谱入口和 AMD 筹备页由教程的 VitePress 站点提供，NVIDIA 展馆保留为独立的 React + Three.js 页面。入口链接直接打开同站的完整页面，没有 iframe，也不参与教程正文的章节编号。

## 源码与目录

NVIDIA 初始源码来自用户提供的 `GPU-Atlas-source.zip`，于 2026-09-13 接入。保留原应用的架构数据、三维模型、交互组件和素材；接入改动负责教程返回入口、部署路径与主题衔接。

| 目录 | 用途 |
| --- | --- |
| `apps/gpu-atlas/nvidia/` | NVIDIA 应用源码、依赖清单及锁文件 |
| `docs/atlas/` | 图谱总入口及 AMD 筹备页 |
| `docs/public/atlas/nvidia/` | 构建脚本生成的 NVIDIA 静态文件，不提交 |

未来 AMD 应用可放到 `apps/gpu-atlas/amd/`，按自己的硬件结构、数据与模型维护。现阶段 AMD 入口提供筹备说明和已有教程链接，不复用 NVIDIA 数据冒充 AMD 内容。

## 构建与本地预览

使用 Node.js **20.19+（20 系列）或 22.12+**，与 NVIDIA 应用的 Vite 7 要求保持一致。在仓库根目录执行：

```bash
npm install
npm run docs:dev
```

`docs:dev` 和 `docs:build` 都会先调用 `scripts/build-atlas.mjs`。脚本按照子应用的 `package-lock.json` 自动运行 `npm ci`，并在依赖清单、锁文件、Node 主版本或运行平台变化后重新安装。随后执行 NVIDIA 构建，将完整 `dist/` 复制到 VitePress 的 public 目录。原有 Pages 工作流的 `npm install` → `npm run docs:build` 因此包含图谱，无须单独发布子应用。

```bash
npm run docs:build
npm run docs:preview
```

默认图谱地址为 `/hello-gpu/atlas/nvidia/`。运行 `EDGEONE=1 npm run docs:build` 时，图谱地址为 `/atlas/nvidia/`。NVIDIA 静态资源使用相对路径，两种部署共享同一份子应用构建。

修改 NVIDIA 源码后，可以在另一个终端执行 `npm run docs:build-atlas`，再刷新正在运行的教程开发站点。需要 React 热更新时，可在 `apps/gpu-atlas/nvidia/` 内执行 `npm run dev`；集成导航仍以教程站点内的构建结果为准。

## 主题与版本控制

子应用默认深色，并读取、写入与教程相同的 `localStorage` 键 `vitepress-theme-appearance`。从日间教程进入图谱或返回时保持用户已选的主题；主题选择由各页面初始化处理。

提交应用源码与 `apps/gpu-atlas/nvidia/package-lock.json`，不要提交 `node_modules/`、子应用 `dist/` 或 `docs/public/atlas/nvidia/`。构建产物应由源码重建。修改依赖时在 NVIDIA 应用目录运行 npm 命令并同步更新它的锁文件。
