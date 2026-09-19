#!/usr/bin/env python3
"""Write the tutorial's ROCm 10.0 dependencies without installing anything.

Uses only Python's standard library, so it also works before the first uv sync.
Unrelated project settings and dependency groups are retained.
"""

import argparse
import json
from pathlib import Path
import re
import tomllib


ARCHITECTURES = (
    "gfx950", "gfx942", "gfx90a", "gfx908", "gfx1201", "gfx1200",
    "gfx1100", "gfx1101", "gfx1102", "gfx1030", "gfx1151", "gfx1150",
    "gfx1152", "gfx1153", "gfx1103",
)
AMD_INDEX = "https://stable.repo.amd.com/rocm/whl-next/"
FRAMEWORKS = ("torch", "torchvision", "torchaudio", "rocm")


def is_rocm_package(requirement):
    name = re.match(r"[A-Za-z0-9_.-]+", requirement.strip()).group().lower()
    name = re.sub(r"[-_.]+", "-", name)
    return (
        name in (*FRAMEWORKS, "triton", "rocm-core", "rocm-smi-lib")
        or name.startswith(("rocm-sdk-", "amd-torch-"))
    )


def set_value(section, key, value):
    """Replace one TOML assignment, including a multiline array/inline table."""
    lines = section.splitlines(keepends=True)
    for start, line in enumerate(lines):
        if not re.match(rf"^{re.escape(key)}\s*=", line):
            continue
        for end in range(start + 1, len(lines) + 1):
            try:
                tomllib.loads("".join(lines[start:end]))
            except tomllib.TOMLDecodeError:
                continue
            lines[start:end] = [f"{key} = {value}\n"]
            return "".join(lines)
        raise ValueError(f"Could not read assignment: {key}")
    return section.rstrip() + f"\n{key} = {value}\n\n"


def configure(text, arch, mode="full", mirror=None):
    if arch not in ARCHITECTURES:
        raise ValueError(f"Unsupported device extra: {arch}")
    original = tomllib.loads(text)
    deps = original["project"].get("dependencies", [])
    keep = [dep for dep in deps if not is_rocm_package(dep)]
    extra = f"devel,device-{arch}" if mode == "full" else f"device-{arch}"
    keep.extend([
        f"torch[device-{arch}]==2.13.0+rocm10.0.0",
        f"torchvision[device-{arch}]==0.28.0+rocm10.0.0",
        "torchaudio==2.11.0.2+rocm10.0.0",
        f"rocm[{extra}]==10.0.0",
    ])
    dependencies = "[\n" + "".join(f"    {json.dumps(dep)},\n" for dep in keep) + "]"
    sections = re.split(r"(?m)(?=^\[)", text)
    output = []
    have_uv = False
    have_sources = False
    # Put AMD first; uv must also find the transitive rocm-sdk/device packages there.
    indexes = (f'[[tool.uv.index]]\nname = "rocm-amd"\nurl = "{AMD_INDEX}"\n\n')
    for section in sections:
        if section.startswith("[project]\n"):
            section = set_value(section, "requires-python", '">=3.12,<3.13"')
            section = set_value(section, "dependencies", dependencies)
        elif section.startswith("[tool.uv]\n"):
            have_uv = True
            section = set_value(section, "environments", '["sys_platform == \'linux\' and platform_machine == \'x86_64\'"]')
        elif section.startswith("[[tool.uv.index]]\n"):
            index = tomllib.loads(section)["tool"]["uv"]["index"][0]
            if index.get("name") == "rocm-amd":
                continue
            if mirror and index.get("name") == "pypi-mirror":
                section = set_value(section, "url", json.dumps(mirror))
            indexes += section.rstrip() + "\n\n"
            continue
        elif section.startswith("[tool.uv.sources]\n"):
            have_sources = True
            sources = tomllib.loads(section)["tool"]["uv"]["sources"]
            # Remove whole assignments, not just their first line.
            for name in sources:
                if is_rocm_package(name):
                    section = set_value(section, name, '"__remove__"')
                    section = re.sub(rf'(?m)^{re.escape(name)} = "__remove__"\n', "", section)
            section = section.rstrip() + "\n"
            for name in FRAMEWORKS:
                section += f'{name} = {{ index = "rocm-amd" }}\n'
        output.append(section)
    if not have_uv:
        output.append('[tool.uv]\nenvironments = ["sys_platform == \'linux\' and platform_machine == \'x86_64\'"]\n')
    if mirror and not any(i.get("name") == "pypi-mirror" for i in original.get("tool", {}).get("uv", {}).get("index", [])):
        indexes += f'[[tool.uv.index]]\nname = "pypi-mirror"\nurl = {json.dumps(mirror)}\ndefault = true\n'
    if not have_sources:
        output.append("[tool.uv.sources]\n" + "".join(f'{name} = {{ index = "rocm-amd" }}\n' for name in FRAMEWORKS))
    output.append(indexes)
    result = "\n\n".join(section.strip() for section in output if section.strip()) + "\n"
    tomllib.loads(result)  # Refuse to overwrite the file with invalid TOML.
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pyproject", type=Path)
    parser.add_argument("--arch", choices=ARCHITECTURES, required=True)
    parser.add_argument("--mode", choices=("full", "minimal"), default="full")
    parser.add_argument("--pypi-mirror")
    args = parser.parse_args()
    text = configure(args.pyproject.read_text(), args.arch, args.mode, args.pypi_mirror)
    args.pyproject.write_text(text)


if __name__ == "__main__":
    main()
