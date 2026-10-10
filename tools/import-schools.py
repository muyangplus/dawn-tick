"""依据 shiguang_warehouse 生成内置高校列表。

用法：
    python tools/import-schools.py <仓库根目录>

来源：https://github.com/ShiGuangSchedule/shiguang_warehouse （MIT，Copyright (c) 2025 星河欲转）
生成物：packages/core/src/import/schools-data.ts
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REPO_URL = "https://github.com/ShiGuangSchedule/shiguang_warehouse"
OUT = Path("packages/core/src/import/schools-data.ts")

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
