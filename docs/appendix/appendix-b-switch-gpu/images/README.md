# 架构表截图与红框标注

来源：[Hello ROCm · AMD GPU / APU 架构对照表](https://datawhalechina.github.io/hello-rocm/zh/00-environment/rocm-gpu-architecture-table)。网页内容由 [datawhalechina/hello-rocm](https://github.com/datawhalechina/hello-rocm) 维护。

截图日期：2026-09-19。截取的是当时页面显示的 ROCm 10.0.0 版本，通过浏览器实际打开页面取得，不重绘网页、不修改表格内容。

| 成品 | 教学用途 |
| ---- | ---- |
| `architecture-radeon.png` | 红框标出 RX 9070 XT 型号与同一行的 gfx1201 |
| `architecture-apu.png` | 红框标出 AI Max+ 395 型号所在单元格与 gfx1151 |
| `device-extras.png` | 红框标出 gfx1201、gfx1151 对应的 device extras |

`source/` 保存三张未标注的浏览器截图及抓取时的 DOM 坐标。`annotate-screenshots.py` 根据坐标裁切、添加红框，依赖 Pillow；从本目录运行即可重新生成三张成品。

截图仅用于演示查表方法。设备、驱动和操作系统的支持状态以源页面及 AMD 官方兼容性说明为准。
