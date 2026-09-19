"""从实际网页截图裁出查表区域，用红框标出型号、LLVM Target 和 extra。

运行：python3 annotate-screenshots.py（需要 Pillow）。
原图和 DOM 坐标保存在 source/，截图内容不重绘、不替换。
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
def rect(item, scale, padding=0):
    return (
        round((item["x"] - padding) * scale),
        round((item["y"] - padding) * scale),
        round((item["x"] + item["width"] + padding) * scale),
        round((item["y"] + item["height"] + padding) * scale),
    )


def capture(name, heading, filename, row_matches, last_row=None, cell_columns=None):
    source = Image.open(ROOT / "source" / f"{name}.png").convert("RGB")
    geometry = json.loads((ROOT / "source" / f"{name}.json").read_text())
    scale = source.width / geometry["viewport"]["width"]
    sections = geometry["sections"]
    index = next(i for i, item in enumerate(sections) if item["tag"] == "H3" and item["text"].startswith(heading))
    title = sections[index]
    table = next(item for item in sections[index + 1:] if item["tag"] == "TABLE")
    bottom = table["y"] + table["height"]
    if last_row is not None:
        row = table["rows"][last_row]
        bottom = row["y"] + row["height"]
    crop = rect({"x": table["x"] - 16, "y": title["y"] - 18,
                 "width": table["width"] + 32, "height": bottom - title["y"] + 36}, scale)
    result = source.crop(crop)
    draw = ImageDraw.Draw(result)
    for row in table["rows"]:
        if not any(match in row["text"] for match in row_matches):
            continue
        targets = [row["cells"][column] for column in cell_columns] if cell_columns else [row]
        for target in targets:
            left, top, right, bottom = rect(target, scale, -4)
            draw.rectangle((left - crop[0], top - crop[1], right - crop[0], bottom - crop[1]),
                           outline="#ff5252", width=3)
    result.save(ROOT / filename, optimize=True)
    print(filename, result.size)


capture("radeon", "Radeon RX", "architecture-radeon.png", ["RX 9070 XT"], cell_columns=[1, 2])
capture("apu", "Ryzen APU", "architecture-apu.png", ["AI Max+ 395"], last_row=3, cell_columns=[1, 2])
capture("extras", "pip 安装", "device-extras.png", ["gfx1201\t", "gfx1151\t"], last_row=9)
