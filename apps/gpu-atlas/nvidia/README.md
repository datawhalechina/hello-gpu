# NVIDIA GPU 图谱（Hello GPU 集成）

本目录保留用户提供的 GPU Atlas 独立 React + Three.js 源码、图片来源记录与依赖锁文件，作为教程的 NVIDIA 子应用。构建产物是可独立访问的 HTML，不使用 iframe。

## 来源

- 输入归档：`GPU-Atlas-source.zip`，用户于本次 UI / 图谱集成任务中提供。
- 归档 SHA-256：`d5ba8f8c53783d7bc5b484c560cc3a54ae74d68afb53894fb2461e9f1ab1fc00`。
- 归档内部根目录：`nvidia-atlas/`。
- 导入日期：2026-09-13。
- 保留：`src/`、`tests/`、`package.json`、原始 `package-lock.json` 与 Vite 单文件构建方式。
- 未导入：预编译 `dist/`、`verification-results.json` 和原归档的审查/研究工作记录。归档里的验证结论未作为本仓库的测试结果复用。

硬件代际数据、逻辑结构、理论峰值与源链接沿用输入源码，本次集成没有新增实验数据。资料库持续保留代表产品、完整芯片与启用配置、理论峰值与应用实测的区别。图片来源与归属见 [`src/assets/sources.json`](src/assets/sources.json)，程序化插画说明见各资产子目录的 README。NVIDIA 官方图片与商标保持原有归属说明，不能因随本教程分发而视为本教程自行创作或改为 CC 授权。

## 与教程的衔接

- 公开路径：相对教程部署根目录的 `/atlas/nvidia/`。
- 顶部 GPU ATLAS 标志返回 `../` 图谱总入口；Hello GPU 链接返回 `../../` 教程首页。
- `?architecture=hopper#architecture` 等架构参数与章节锚点保持可分享、可直接刷新。
- 共享 `localStorage` 的 `vitepress-theme-appearance`，支持 `dark` / `light` / `auto`。没有偏好时默认深色；页面绘制前应用偏好，跨标签页修改与自动主题的系统变化同步生效。
- `src/integration.css` 定义日间主题与教程导航。原有组件 CSS 使用 `--atlas-day-*` 语义变量，未定义时回退到归档原深色颜色。物理硬件材质、纹理、结构示意图的配色独立于界面底色。
- 原生滚动、键盘代际导航、减少动态效果、资料库对话框与微架构工作台保留。

## 开发与验证

推荐从仓库根目录运行站点脚本，以便同时构建教程与图谱。单独调试本子应用时可在此目录使用：

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Vite 使用 `base: './'`。`dist/index.html` 包含所需脚本、样式、字体和运行时图片，可部署到 `/hello-gpu/atlas/nvidia/` 或 `/atlas/nvidia/`。

浏览器验证脚本接收可选的页面 URL；原归档测试默认使用本地构建文件。`tests/theme-integration.mjs` 使用 HTTP 预览测试跨标签页主题同步、系统主题切换、入口、移动端和深链接。测试环境需要 Playwright 与 Chrome。
