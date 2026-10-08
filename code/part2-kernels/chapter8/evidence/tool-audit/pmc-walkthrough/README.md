# 教程当前 binary 的 PMC 补充采集

2026-09-20，在同一台 Radeon RX 9070 XT / gfx1201、ROCm SDK 10.0.0、HIP 7.15.26333、原生 Ubuntu 24.04.5 上，按正文 8.5.4 的三组命令各执行一次。没有重跑 benchmark、重编译程序、改动环境或功耗模式。本目录对应正文当前的 `$RUN/build/vector_add_hip`。

- binary SHA-256：`9fc283682aed5da6cdffe2479c70f78399eda3861ae20ccf1796fd8c7c02a71c`。
- HIP 源码 SHA-256：`73e1af89d25a91fb35ee78198ce74c93d617a9ac5a0852ff74d20abd2184aa80`。
- `capture-manifest.json` 绑定本次二进制、源码、父 walkthrough manifest 和全部本地补充文件；`manifest.json` 绑定这里的公开副本。

三组均使用 v0、N=16777216、block=256、warmup=5、repeat=10、seed=20260920，设置 `--kernel-include-regex vector_add_v0 --kernel-iteration-range 7-16`。全部命令退出码为 0，precheck/postcheck/correct 均为 OK；每项计数器恰有 10 个记录，对应 dispatch 8–17。

| 计数器 | 最小值 | 中位数 | 最大值 |
| --- | ---: | ---: | ---: |
| `SQ_WAVES_sum` | 524288 | 524288 | 524288 |
| `GRBM_GUI_ACTIVE` | 527469 | 529299 | 587211 |
| `GL2C_HIT_sum` | 0 | 0 | 0 |
| `GL2C_MISS_sum` | 0 | 0 | 0 |
| `FetchSize` | 0 | 0 | 0 |

wave 计数与启动规模一致。活动计数非零，但不能直接解释为实际频率或 occupancy。缓存与流量计数器仍全部为零，不能据此计算命中率或带宽；这与初次工具盘点的有效性判断一致。

`commands.jsonl` 保存正文三组 PMC 的确切 argv。`pmc/pmc-{waves,l2,fetch}.stdout.log`、对应 stderr 和 `{waves,l2,fetch}_counter_collection.csv` 为本次原始输出的公开副本；路径规范化规则沿用上级目录，仅替换私有绝对路径前缀，不改变数字或删除行。`counter-summary.json` 为完整记录的归纳，`publication-files.json` 记录原件与公开副本的哈希。

组合检查仍引用上级 `pmc/pmc-check-global-device-{waves,l2,fetch}.stdout.log`：此前已用相同公共包装器、`rocprofv3-avail -d 0 pmc-check ...` 正确执行，全部返回 0。本轮没有重复这些不依赖应用 binary 的检查。

上级 `pmc/` 保留的是初次工具盘点数据；正文采集结果应引用本目录。原 walkthrough 的 `manifest.json`、完成时间和 331 个已绑定工件逐一核对后保持不变。本地新增结果位于 `results/walkthrough-20260920/pmc-{waves,l2,fetch}/`，补充 manifest 独立记录；没有将 PMC 下的 event 时间混入 benchmark。
