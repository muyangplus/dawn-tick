"""依据 shiguang_warehouse 与 serverless-colleage 生成内置学校数据。

用法：
    python tools/import-schools.py <适配仓库根目录> [高校目录 json]

来源：
    https://github.com/ShiGuangSchedule/shiguang_warehouse （MIT，Copyright (c) 2025 星河欲转）
    https://github.com/vczero/serverless-colleage （全国普通高等学校名单，教育部公开名单）
生成物：
    packages/core/src/import/schools-data.ts       适配条目（含教务入口）
    packages/core/src/import/schools-directory.ts  高校名单（仅校名，用于检索）
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

REPO_URL = "https://github.com/ShiGuangSchedule/shiguang_warehouse"
DIRECTORY_REPO_URL = "https://github.com/vczero/serverless-colleage"
OUT = Path("packages/core/src/import/schools-data.ts")
OUT_DIRECTORY = Path("packages/core/src/import/schools-directory.ts")

SYSTEM_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("jwglxt", ("jwglxt", "xskb_list", "kbgrid_table")),
    ("qzdatasource", ("jsxsd", "qzdatasource", "xsxk")),
    ("urp", ("urp", "jwgl.urp")),
)

NAME_SUFFIXES = ("教务系统适配", "教务系统", "教务", "课表系统")


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


def main() -> int:
    if len(sys.argv) < 2:
        print("需要仓库根目录参数", file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    resources = root / "resources"
    if not resources.is_dir():
        print(f"未找到 {resources}", file=sys.stderr)
        return 2

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
            asset = str(adapter.get("asset_js_path") or "")
            entries.append(
                {
                    "id": adapter_id,
                    "code": folder.name,
                    "name": clean_name(str(adapter.get("adapter_name") or folder.name)),
                    "system": detect_system(folder, url, asset),
                    "url": url,
                    "maintainer": str(adapter.get("maintainer") or "").strip(),
                }
            )

    lines = [
        "/**",
        " * 内置高校与教务入口，由 tools/import-schools.py 生成，请勿手改。",
        f" * 来源：{REPO_URL}",
        " * 许可：MIT License，Copyright (c) 2025 星河欲转，完整许可见 THIRD-PARTY.md",
        " */",
        "import type { SchoolEntry } from './school-list.ts';",
        "",
        "export interface WarehouseSchool extends SchoolEntry {",
        "  code: string;",
        "  maintainer: string;",
        "}",
        "",
        "export const WAREHOUSE_SCHOOLS = [",
    ]
    for entry in entries:
        maintainer = f', maintainer: {js_string(entry["maintainer"])}' if entry["maintainer"] else ', maintainer: ""'
        lines.append(
            '  {{ id: {id}, code: {code}, name: {name}, system: {system}, url: {url}, '
            'aliases: [{code_alias}], source: "builtin"{maintainer} }},'.format(
                id=js_string(entry["id"]),
                code=js_string(entry["code"]),
                name=js_string(entry["name"]),
                system=js_string(entry["system"]),
                url=js_string(entry["url"]),
                code_alias=js_string(entry["code"]),
                maintainer=maintainer,
            )
        )
    lines.append("] as const satisfies readonly WarehouseSchool[];")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"已生成 {OUT}：{len(entries)} 条")

    if len(sys.argv) >= 3:
        directory_path = Path(sys.argv[2])
        names = json.loads(directory_path.read_text(encoding="utf-8"))
        cleaned = sorted({str(name).strip() for name in names if str(name).strip()})
        out_lines = [
            "/**",
            " * 全国普通高等学校名单，由 tools/import-schools.py 生成，请勿手改。",
            f" * 来源：{DIRECTORY_REPO_URL}（名单出自教育部公开的全国普通高等学校名单）",
            " * 用途：仅取校名用于检索；带教务入口的条目见 schools-data.ts。",
            " */",
            "export const DIRECTORY_NAMES: readonly string[] = [",
        ]
        out_lines.extend(f"  {js_string(name)}," for name in cleaned)
        out_lines.append("];")
        out_lines.append("")
        OUT_DIRECTORY.write_text("\n".join(out_lines), encoding="utf-8")
        print(f"已生成 {OUT_DIRECTORY}：{len(cleaned)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
