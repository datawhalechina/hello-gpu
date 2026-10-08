# 第 8 章终端操作验证

2026-09-20，在 **Radeon RX 9070 XT / gfx1201、ROCm SDK 10.0.0、HIP 7.15.26333、原生 Ubuntu 24.04.5、Linux 7.0.0-31-generic** 上，只验证读者新建与恢复实验目录的操作，没有重跑性能矩阵。

| 独立 shell | 已验证操作 |
| --- | --- |
| 01 | `uv sync --locked`、环境激活、`mktemp` 新建结果目录并打印路径 |
| 02 | 新 shell 中重新激活、恢复第一次打印的真实目录、`test -d`，首次编译 HIP |
| 03 | 同样恢复目录，编译判断跳过已有程序；binary 的 SHA-256 与修改时间不变 |
| 04 | 一个 N=17、warmup=0、repeat=1 的 HIP v0 正确性检查，precheck/postcheck/correct 均为 OK |
| 05 | 再次请求相同样本文件时明确提示并跳过；没有 `RESULT`，CSV 哈希与修改时间不变 |
| 06 | 新 shell 使用 `read -r -p '粘贴上次输出的结果目录：' RUN`，stdin 提供第一次打印的真实路径，目录和已有 binary 检查通过 |

六个 shell 均返回 0。第 04 次是本轮唯一启动测试程序的操作，保存了一个原始 event 样本；**它用于检查目录恢复和结果保护，不用于性能结论**。已有 benchmark、trace、PMC 和 ATT 工件没有修改。

`commands/` 保存确切执行的 shell 文件，`commands.jsonl` 保存 cwd、argv、时间、退出码及第 06 次交互输入，`logs/` 保存原始 stdout/stderr。Bash 在非终端 stdin 下不显示 `read -p` 提示，但记录的输入确实被读取，并恢复到了第一次输出的目录。学习者在终端中会看到提示后输入自己的路径，不需复制这里的随机目录名。

`identity.json` 记录当前源码、锁文件和激活入口身份，以及 binary / CSV 在重复请求前后的检查结果；`small-correctness.samples.csv` 是仅有的一个原始样本。维护者使用独立实验镜像，并将其中的 `.venv` 链接到既有本篇 ROCm 10.0 环境；`pyproject.toml`、`uv.lock`、`activate-rocm.sh` 与现有环境和本地仓库逐字节一致，`uv sync --locked` 未安装新包。这个镜像准备细节不属于读者操作要求，读者直接使用教程目录及自己的篇环境。

公开副本仅替换私有路径前缀：本次实验根目录 → `<operation-root>`，既有环境目录 → `<existing-part-environment>`，用户主目录 → `<home>`；命令、输出行、结果数值和随机目录后缀保持原样。`publication-files.json` 保存原件与公开副本的 SHA-256，`manifest.json` 绑定全部公开文件。完整本地原件位于 `results/operation-check-20260920/`。

读者继续未修改的实验时复用旧 `RUN`；修改 kernel 源码后应创建新 `RUN` 并重新编译。目录存在及 `-x` 检查不会自动判断源码是否变化。
