#!/usr/bin/env bash
# Run from code/part2-kernels after source ./activate-rocm.sh.
set -euo pipefail
if [[ $# != 1 || -z "$1" ]]; then
  echo 'Usage: bash chapter8/profile_att.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 2
fi
att_dir=$1
if [[ -e "$att_dir" ]]; then
  echo "Output already exists: $att_dir" >&2
  exit 2
fi
[[ -f chapter8/vector_add_hip.hip ]] || { echo 'Run from code/part2-kernels.' >&2; exit 2; }
mapfile -t sdk_libs < <(python - <<'PY'
from pathlib import Path
import sysconfig
site = Path(sysconfig.get_path('purelib'))
for package in ('_rocm_sdk_devel', '_rocm_sdk_core'):
    print(site / package / 'lib')
PY
)
[[ ${#sdk_libs[@]} == 2 && -d "${sdk_libs[0]}" && -d "${sdk_libs[1]}" ]] || {
  echo 'Activate the ROCm 10.0 environment first.' >&2; exit 2;
}
mkdir -p "$att_dir/build" "$att_dir/trace"
export LD_LIBRARY_PATH="${sdk_libs[0]}:${sdk_libs[1]}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec 3>"$att_dir/commands.log"
export BASH_XTRACEFD=3
set -x
hipcc --offload-arch=gfx1201 -O3 -std=c++17 -gline-tables-only \
  chapter8/vector_add_hip.hip -o "$att_dir/build/vector_add_hip_debug" \
  >"$att_dir/compile.stdout.log" 2>"$att_dir/compile.stderr.log"
rocprofv3 --att --att-library-path "${sdk_libs[@]}" \
  --att-simd-select 0 --att-shader-engine-mask 0x1 \
  --att-buffer-size 67108864 --kernel-include-regex vector_add_v0 \
  --kernel-iteration-range 7 --output-format csv \
  --output-directory "$att_dir/trace" --output-file baseline -- \
  "$att_dir/build/vector_add_hip_debug" --version v0 --size 16777216 \
  --block 256 --warmup 5 --repeat 1 --seed 20260920 \
  >"$att_dir/profile.stdout.log" 2>"$att_dir/profile.stderr.log"
python chapter8/validate_att.py "$att_dir/trace" \
  >"$att_dir/validation.stdout.log" 2>"$att_dir/validation.stderr.log" || {
    cat "$att_dir/validation.stderr.log" >&2; exit 1;
  }
set +x
cat "$att_dir/validation.stdout.log"
echo "ATT captured and decoded: $att_dir/trace"
echo 'One selected dispatch / shader engine / SIMD; not whole-GPU counters.'
