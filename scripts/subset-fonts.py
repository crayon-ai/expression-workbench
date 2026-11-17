#!/usr/bin/env python3
"""把字体子集化，让整个前端能内嵌进一个 Worker（脚本大小有上限）。
- 无衬线 400/500：GB2312 一级常用字（3755 个）+ 源码里出现的所有字 + ASCII 与常用标点。
  逐字稿里偶尔出现的生僻字会按字回落到系统字体（PingFang / 微软雅黑）。
- 衬线 600（只用于标题、材料名等固定文字）：只保留源码里出现的字。
用法：python3 scripts/subset-fonts.py <原始字体目录>   （原始 GB2312 子集字体在 Demo v2 的 src/fonts/）
"""
import pathlib, sys
from fontTools import subset

src_dir = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parent.parent
out_dir = root / "src" / "fonts"

static = set()
for folder in ("src", "shared"):
    for p in (root / folder).rglob("*"):
        if p.suffix in (".ts", ".tsx", ".css", ".html"):
            static.update(p.read_text(encoding="utf-8"))
static.update((root / "index.html").read_text(encoding="utf-8"))

level1 = set()
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        try:
            level1.add(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass
basic = {chr(c) for c in range(0x20, 0x7F)} | set("，。、；：？！“”‘’「」『』（）《》〈〉…—·～【】％＋－×÷")

def run(name, chars):
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    font = subset.load_font(str(src_dir / name), options)
    sub = subset.Subsetter(options)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    subset.save_font(font, str(out_dir / name), options)
    print(name, (out_dir / name).stat().st_size)

run("noto-sans-sc-400.woff2", level1 | static | basic)
run("noto-sans-sc-500.woff2", level1 | static | basic)
run("noto-serif-sc-600.woff2", static | basic)
