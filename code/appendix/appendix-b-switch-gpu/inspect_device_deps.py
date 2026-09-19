"""从当前环境的包元数据查询 device extra，不导入 GPU 库或修改环境。"""

import argparse
from importlib.metadata import PackageNotFoundError, distribution

from packaging.requirements import Requirement


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arch", nargs="?", help="目标 LLVM Target，例如 gfx1100")
    parser.add_argument("--list", action="store_true", help="列出三个包共同声明的设备架构")
    args = parser.parse_args()
    if args.list == bool(args.arch):
        parser.error("请选择 --list，或者提供一个架构代号，例如 gfx1100")

    try:
        packages = [distribution(name) for name in ("torch", "torchvision", "rocm")]
    except PackageNotFoundError as error:
        parser.exit(1, f"缺少已安装的包：{error.name}。请在已同步的 ROCm 环境中查询。\n")

    supported = [
        {extra for extra in package.metadata.get_all("Provides-Extra", [])
         if extra.startswith("device-gfx")}
        for package in packages
    ]
    if args.list:
        for package in packages:
            print(f"{package.metadata['Name']}=={package.version}")
        common = set.intersection(*supported)
        if not common:
            parser.exit(1, "这些包没有共同的 device-gfx extra，请核对当前环境的包版本。\n")
        print("共同声明的架构（不代表已通过硬件验证）：")
        for extra in sorted(common):
            print(extra.removeprefix("device-"))
        return

    extra = f"device-{args.arch}"
    missing = [package.metadata["Name"]
               for package, extras in zip(packages, supported) if extra not in extras]
    if missing:
        parser.exit(1, f"{', '.join(missing)} 未声明 {extra}；请先用 --list 查看当前版本。\n")

    print(f"目标 extra: {extra}")
    for package in packages:
        print(f"\n[{package.metadata['Name']}=={package.version}]")
        selected = []
        for raw in package.requires or []:
            requirement = Requirement(raw)
            marker = requirement.marker
            if (marker is not None
                    and marker.evaluate({"extra": extra})
                    and not marker.evaluate({"extra": ""})):
                selected.append(raw)
        if not selected:
            parser.exit(1, f"{extra} 在当前平台没有新增依赖，请核对平台条件和原始 METADATA。\n")
        for raw in selected:
            print(f"Requires-Dist: {raw}")


if __name__ == "__main__":
    main()
