"""校验 GitHub Actions 工作流语法与必需的触发条件。

缺少 PyYAML 时跳过（退出码 0），不阻断验证流程。
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - 取决于本地环境
    print('PyYAML 未安装，跳过工作流校验')
    sys.exit(0)

REQUIRED_TRIGGERS = {
    'ci.yml': {'push', 'pull_request', 'workflow_dispatch'},
    'publish.yml': {'push', 'schedule', 'workflow_dispatch'},
}
REQUIRED_JOBS = {
    'ci.yml': {'node', 'schema', 'rust'},
    'publish.yml': {'plan', 'gate', 'windows', 'android', 'web', 'publish'},
}
# 发布说明的比较基准：滚动标签会移动，不能进已发版正文
PUBLISH_NOTES_REQUIRED = ['*-latest) PREV=""', '--notes-start-tag "$PREV"']
# 标签已存在时不传 --target：附注标签对象不是有效目标
PUBLISH_TARGET_REQUIRED = ['TAG_EXISTS=false', 'args+=(--target "$TARGET")']
# 便携包说明：数据在程序所在目录，不是 %LOCALAPPDATA%
PUBLISH_PORTABLE_README_REQUIRED = ['数据与日志都在本目录']
PUBLISH_PORTABLE_README_FORBIDDEN = ['数据与日志目录：%LOCALAPPDATA%']
# 更新兜底：发布产物必须带 version.json（渠道 / 版本 / 标签 / 发布说明 / 产物名）
PUBLISH_VERSION_JSON_REQUIRED = [
    'node tools/release/version-json.mjs',
    '--channel="$CHANNEL"',
    '--version="$MANIFEST_VERSION"',
    '--tag="$TAG"',
    '--out=out',
    "-name 'version.json'",
]


def check_publish_notes(text: str) -> list[str]:
    problems = [f'publish.yml 缺少发布说明比较基准的约束: {item}' for item in PUBLISH_NOTES_REQUIRED if item not in text]
    problems += [f'publish.yml 缺少发布目标的约束: {item}' for item in PUBLISH_TARGET_REQUIRED if item not in text]
    problems += [f'publish.yml 便携包说明缺少: {item}' for item in PUBLISH_PORTABLE_README_REQUIRED if item not in text]
    problems += [f'publish.yml 便携包说明写错数据目录: {item}' for item in PUBLISH_PORTABLE_README_FORBIDDEN if item in text]
    problems += [f'publish.yml 缺少更新兜底清单的约束: {item}' for item in PUBLISH_VERSION_JSON_REQUIRED if item not in text]
    return problems


def main() -> int:
    failures = []
    for name, expected_triggers in REQUIRED_TRIGGERS.items():
        path = Path('.github/workflows') / name
        if not path.exists():
            failures.append(f'{name} 不存在')
            continue
        text = path.read_text(encoding='utf-8')
        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError as error:
            failures.append(f'{name} 语法错误: {error}')
            continue

        triggers = data.get(True) or data.get('on') or {}
        trigger_names = set(triggers if isinstance(triggers, list) else triggers.keys())
        missing = expected_triggers - trigger_names
        if missing:
            failures.append(f'{name} 缺少触发: {sorted(missing)}')

        jobs = set((data.get('jobs') or {}).keys())
        missing_jobs = REQUIRED_JOBS[name] - jobs
        if missing_jobs:
            failures.append(f'{name} 缺少任务: {sorted(missing_jobs)}')

        if name == 'publish.yml':
            failures.extend(check_publish_notes(text))

    if failures:
        for failure in failures:
            print(failure)
        return 1
    print(f'工作流语法与触发正常（{len(REQUIRED_TRIGGERS)} 个）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
