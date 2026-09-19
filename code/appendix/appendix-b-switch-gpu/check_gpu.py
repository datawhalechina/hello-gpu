"""检查当前 Python 环境的 ROCm 包、GPU 架构和一次真实 GPU 运算。"""

from importlib.metadata import version

import torch
import torchvision
import torchaudio
import triton

print("ROCm SDK:", version("rocm"))
print("torch:", torch.__version__)
print("torchvision:", torchvision.__version__)
print("torchaudio:", torchaudio.__version__)
print("triton package:", version("triton"))
print("triton module:", triton.__version__)
print("HIP:", torch.version.hip)
print("GPU available:", torch.cuda.is_available())

if not torch.cuda.is_available():
    raise SystemExit("未发现可用 GPU：检查驱动、设备权限和所选 device extra。")

print("GPU:", torch.cuda.get_device_name(0))
print("Architecture:", torch.cuda.get_device_properties(0).gcnArchName)
x = torch.arange(4, dtype=torch.float32, device="cuda")
result = (x * 2).cpu()
torch.testing.assert_close(result, torch.tensor([0.0, 2.0, 4.0, 6.0]))
print("GPU calculation:", result)
