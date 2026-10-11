"""生成学校数据文件。

用法：
    python tools/import-schools.py <适配仓库根目录> [高校目录 json]

来源：
    https://github.com/ShiGuangSchedule/shiguang_warehouse （MIT，Copyright (c) 2025 星河欲转）
    https://github.com/vczero/serverless-colleage （全国普通高等学校名单，教育部公开名单）
生成物：
    packages/core/src/import/schools.ts

该文件里有两段：自动生成段由本脚本覆盖，手工维护段原样保留，
新增学校直接写进手工维护段即可，重新生成不会丢。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

OUT = Path("packages/core/src/import/schools.ts")
LEGACY_OUTPUTS = (
    Path("packages/core/src/import/schools-data.ts"),
    Path("packages/core/src/import/schools-directory.ts"),
)

MARK_BEGIN = "// >>> 自动生成：上游适配条目与高校名单（运行 tools/import-schools.py 覆盖本段）"
MARK_END = "// <<< 自动生成结束"
MANUAL_BEGIN = "// >>> 手工维护：新增学校写在这里，重新生成不会被覆盖"
MANUAL_END = "// <<< 手工维护结束"

SYSTEM_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("jwglxt", ("jwglxt", "xskb_list", "kbgrid_table")),
    ("qzdatasource", ("jsxsd", "qzdatasource", "xsxk")),
    ("urp", ("urp", "jwgl.urp")),
)

NAME_SUFFIXES = ("教务系统适配", "教务系统", "教务", "课表系统")

MANUAL_SEED = """export const MANUAL_SCHOOLS: readonly SchoolEntry[] = [
  {
    id: 'usts',
    name: '苏州科技大学',
    system: 'jwglxt',
    url: 'https://jwgl.usts.edu.cn/jwglxt/xtgl/login_slogin.html',
    aliases: ['苏科大', '苏州科技'],
    source: 'builtin',
  },
];"""

HEADER = '''/**
 * 学校数据唯一入口：教务入口条目与全国高校名单都在这一个文件里。
 *
 * 生成：python tools/import-schools.py <适配仓库根目录> [高校目录 json]
 * 来源与许可：ShiGuangSchedule/shiguang_warehouse（MIT，Copyright (c) 2025 星河欲转）、
 *             vczero/serverless-colleage（全国普通高等学校名单，教育部公开名单），详见 THIRD-PARTY.md
 *
 * 新增学校：写进下面的「手工维护」段，字段为
 *   id（唯一）、name（校名）、system（jwglxt | qzdatasource | urp | other）、
 *   url（教务入口完整地址，或只写域名）、aliases（检索简称，可选）、source: 'builtin'
 */
import type { SchoolEntry } from './school-list.ts';
'''


def clean_name(raw: str) -> str:
    name = raw.strip()
    for suffix in NAME_SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    return name or raw.strip()


def detect_system(folder: Path, url: str, asset: str) -> str:
    haystack = url.lower()
    asset_file = folder / asset
    if asset_file.is_file():
        try:
            haystack += "\n" + asset_file.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            pass
    for system, markers in SYSTEM_MARKERS:
        if any(marker in haystack for marker in markers):
            return system
    return "other"


def js_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def read_manual(existing: Path) -> str:
    if not existing.is_file():
        return MANUAL_SEED
    text = existing.read_text(encoding="utf-8")
    start = text.find(MANUAL_BEGIN)
    end = text.find(MANUAL_END)
    if start < 0 or end < 0:
        return MANUAL_SEED
    body = text[start + len(MANUAL_BEGIN) : end].strip("\n")
    return body if body.strip() else MANUAL_SEED


def collect_entries(resources: Path) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for folder in sorted(resources.iterdir()):
        manifest = folder / "adapters.yaml"
        if not manifest.is_file():
            continue
        try:
            data = yaml.safe_load(manifest.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            print(f"跳过 {manifest}: {error}", file=sys.stderr)
            continue
        adapters = (data or {}).get("adapters") or []
        for adapter in adapters:
            if not isinstance(adapter, dict):
                continue
            adapter_id = str(adapter.get("adapter_id") or "").strip()
            url = str(adapter.get("import_url") or "").strip()
            if not adapter_id or not url or adapter_id in seen:
                continue
            seen.add(adapter_id)
            entries.append(
                {
                    "id": adapter_id,
                    "code": folder.name,
                    "name": clean_name(str(adapter.get("adapter_name") or folder.name)),
                    "system": detect_system(folder, url, str(adapter.get("asset_js_path") or "")),
                    "url": url,
                    "maintainer": str(adapter.get("maintainer") or "").strip(),
                }
            )
    return entries


def main() -> int:
    if len(sys.argv) < 2:
        print("需要适配仓库根目录参数", file=sys.stderr)
        return 2
    resources = Path(sys.argv[1]) / "resources"
    if not resources.is_dir():
        print(f"未找到 {resources}", file=sys.stderr)
        return 2

    entries = collect_entries(resources)
    lines = [MARK_BEGIN, "export const WAREHOUSE_SCHOOLS = ["]
    for entry in entries:
        maintainer = f', maintainer: {js_string(entry["maintainer"])}' if entry["maintainer"] else ', maintainer: ""'
        lines.append(
            '  {{ id: {id}, code: {code}, name: {name}, system: {system}, url: {url}, '
            'aliases: [{alias}], source: "builtin"{maintainer} }},'.format(
                id=js_string(entry["id"]),
                code=js_string(entry["code"]),
                name=js_string(entry["name"]),
                system=js_string(entry["system"]),
                url=js_string(entry["url"]),
                alias=js_string(entry["code"]),
                maintainer=maintainer,
            )
        )
    lines.append("] as const satisfies readonly (SchoolEntry & { code: string; maintainer: string })[];")
    lines.append("")

    if len(sys.argv) >= 3:
        names = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        cleaned = sorted({str(name).strip() for name in names if str(name).strip()})
        lines.append("export const DIRECTORY_NAMES: readonly string[] = [")
        lines.extend(f"  {js_string(name)}," for name in cleaned)
        lines.append("];")
    else:
        lines.append("export const DIRECTORY_NAMES: readonly string[] = [];")
    lines.append(MARK_END)

    manual = read_manual(OUT)
    content = "\n".join([HEADER, "", *lines, "", MANUAL_BEGIN, manual, MANUAL_END, ""])
    OUT.write_text(content, encoding="utf-8")
    print(f"已生成 {OUT}：适配条目 {len(entries)} 条，手工段保留")

    for legacy in LEGACY_OUTPUTS:
        if legacy.is_file():
            legacy.unlink()
            print(f"已删除旧文件 {legacy}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
