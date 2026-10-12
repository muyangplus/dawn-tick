# -*- coding: utf-8 -*-
"""生成 `pinyin-table.json`（**作者期**工具，不参与日常导入与测试）。

为什么需要一个生成器而不是一份手抄表
------------------------------------
本仓库零第三方依赖，Node 侧没有任何汉字转拼音的能力；而学校目录需要
「全拼」与「首字母缩写」两种检索键（`qinghuadaxue` / `qhdx`）。
做法是：用一次性工具把「汉字 → 拼音」固化成一份纯数据表
`tools/schools/pinyin-table.json` 提交进仓库，
再用零依赖的 `import-directory.mjs` 读这张表来生成目录。
这样导入脚本在**任何**机器上都不需要 Python，也不需要联网。

依赖与运行
----------
需要 `pypinyin`（仅此脚本需要，不是本仓库的依赖）：

    python -m pip install pypinyin
    python tools/schools/gen-pinyin-table.py

用法（默认数据源 `out-local/colleage`）：

    python tools/schools/gen-pinyin-table.py [--source <数据源目录>] [--out <输出文件>]

生成结果
--------
- `chars`：`汉字 -> 无声调拼音`，取自全部校名里出现过的汉字，
  多音字取「在校名中出现次数最多的读音」。
- `phrases`：`词组 -> [音节, ...]`，用于修正 8 个会改变首字母的多音字
  （厦 sha/xia、长 chang/zhang、会 hui/kuai、六 lu/liu、番 pan/fan、
  藏 zang/cang、都 du/dou、乐 yue/le）。导入脚本按「最长匹配优先」套用。
- 脚本最后会**逐条回放全部校名**并与 pypinyin 的结果比对，
  只有在 100% 一致时才会写出文件。
"""

import argparse
import collections
import json
import os
import sys

try:
    from pypinyin import Style, pinyin
except ImportError:  # pragma: no cover - 仅作者期工具
    sys.stderr.write("需要 pypinyin：python -m pip install pypinyin\n")
    raise

DEFAULT_SOURCE = os.path.join("out-local", "colleage")
DEFAULT_OUT = os.path.join("tools", "schools", "pinyin-table.json")

# 多音字修正：词组 -> 音节序列。键会被按长度倒序、最长匹配优先套用。
# 只有「会影响拼音首字母」的多音字才需要写进来（声调差异在本表里不存在）。
PHRASES: "dict[str, list[str]]" = {
    "海都": ["hai", "dou"],      # 青岛农业大学海都学院
    "会计": ["kuai", "ji"],      # 上海立信会计金融学院
    "财会": ["cai", "kuai"],     # 江苏财会职业学院
    "长治": ["zhang", "zhi"],    # 长治学院 / 长治医学院
    "长垣": ["zhang", "yuan"],   # 长垣烹饪职业技术学院
    "广厦": ["guang", "sha"],    # 哈尔滨广厦学院
    "华厦": ["hua", "sha"],      # 厦门华厦学院
    "乐山": ["le", "shan"],      # 乐山师范学院
    "六安": ["lu", "an"],        # 六安职业技术学院
    "番禺": ["pan", "yu"],       # 广州番禺职业技术学院
    "藏医": ["cang", "yi"],      # 西藏藏医学院
}


def read_names(source_root: str) -> "list[str]":
    """按 目录索引 -> 详情文件 -> 行政区名单 的顺序取全部校名（去重、保序）。"""
    names: "list[str]" = []
    index_path = os.path.join(source_root, "大学目录.json")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as handle:
            names += list(json.load(handle))
    detail_dir = os.path.join(source_root, "大学详情")
    if os.path.isdir(detail_dir):
        names += [f[:-5] for f in sorted(os.listdir(detail_dir)) if f.endswith(".json")]
    region_dir = os.path.join(source_root, "各行政区大学列表")
    if os.path.isdir(region_dir):
        for name in sorted(os.listdir(region_dir)):
            if not name.endswith(".json"):
                continue
            with open(os.path.join(region_dir, name), encoding="utf-8") as handle:
                payload = json.load(handle)
            names += [item["name"] for item in payload.get("datas", []) if item.get("name")]
    return list(dict.fromkeys(names))


def is_han(char: str) -> bool:
    code = ord(char)
    return 0x3400 <= code <= 0x4DBF or 0x4E00 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF


def syllables_of(name: str) -> "list[str]":
    """按字对齐的无声调音节。

    整名一起交给 pypinyin，让它用内置词组词典消歧（如「会计」kuai ji、
    「六安」lu an、「番禺」pan yu）；非汉字原样保留，导入脚本会跳过它们。
    pypinyin 保证返回的条目数与输入字数一致（本脚本会断言这一点）。
    """
    result = [item[0] for item in pinyin(name, style=Style.NORMAL, heteronym=False)]
    if len(result) != len(name):
        raise ValueError("音节数与原字数不一致：%s -> %s" % (name, result))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    names = read_names(args.source)
    if not names:
        sys.stderr.write("没有读到任何校名，检查 --source\n")
        return 1

    counter: "collections.defaultdict[str, collections.Counter]" = collections.defaultdict(collections.Counter)
    per_name: "dict[str, list[str]]" = {}
    for name in names:
        syllables = syllables_of(name)
        per_name[name] = syllables
        for char, syllable in zip(name, syllables):
            if is_han(char) and syllable != char:
                counter[char][syllable] += 1

    chars = {char: readings.most_common(1)[0][0] for char, readings in counter.items()}
    # 平局时固定取字典序最小者，保证同一数据源多次运行结果一致
    for char, readings in counter.items():
        best = max(readings.values())
        chars[char] = sorted(syllable for syllable, count in readings.items() if count == best)[0]
    phrases = {key: value for key, value in PHRASES.items()}

    # 回放校验：最长匹配优先套用 phrases，其余逐字查表，必须与 pypinyin 完全一致。
    keys = sorted(phrases, key=len, reverse=True)
    mismatches: "list[str]" = []
    for name in names:
        expected = per_name[name]
        produced: "list[str]" = []
        position = 0
        while position < len(name):
            matched = None
            for key in keys:
                if name.startswith(key, position):
                    matched = key
                    break
            if matched is not None:
                produced += phrases[matched]
                position += len(matched)
                continue
            char = name[position]
            produced.append(chars[char] if is_han(char) and char in chars else char)
            position += 1
        if produced != expected:
            mismatches.append("%s | 期望 %s | 实得 %s" % (name, expected, produced))
    if mismatches:
        sys.stderr.write("回放校验失败 %d 条：\n%s\n" % (len(mismatches), "\n".join(mismatches[:20])))
        return 1

    payload = {
        "_generated": True,
        "_source": "pypinyin %s（Style.NORMAL，heteronym=False）逐字读音 + 校名回放校验"
        % getattr(__import__("pypinyin"), "__version__", "?"),
        "_generatedBy": "tools/schools/gen-pinyin-table.py",
        "_note": "纯数据表；导入脚本零依赖读取。数据源新增生僻字后需重跑本脚本补表。",
        "_coverage": {"names": len(names), "chars": len(chars), "phrases": len(phrases)},
        "chars": dict(sorted(chars.items(), key=lambda item: item[0])),
        "phrases": dict(sorted(phrases.items(), key=lambda item: item[0])),
    }
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=False)
        handle.write("\n")
    print("写出 %s：校名 %d 条，汉字 %d 个，词组修正 %d 条，回放校验 100%% 一致"
          % (args.out, len(names), len(chars), len(phrases)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
