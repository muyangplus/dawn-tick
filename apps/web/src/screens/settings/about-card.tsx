import { ExternalLink } from '../../components/ui/external-link.tsx';
import { HelpHint } from '../../components/ui/help-hint.tsx';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
/** 关于卡片列出的运行时依赖与许可证：由 tools/legal/collect-licenses.mjs 生成。 */
import { RUNTIME_CREDITS } from '../../legal/credits.generated.ts';

/**
 * 关于卡：帮助与反馈、应用与版本、致谢与第三方声明。
 *
 * 零状态、零回调：版本与渠道来自构建常量，依赖清单来自生成文件，卡内不需要设置读写。
 */
export function AboutCard() {
  return (
    <>
      <div className="flex flex-col gap-1" data-role="about-help">
        <span className="text-sm font-medium text-ink">帮助与反馈</span>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>问题与建议</span>
          <ExternalLink
            dataRole="issues-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/issues"
            ariaLabel="打开发布仓库的 Issues（GitHub）"
          >
            Issues
          </ExternalLink>
          <span>使用说明</span>
          <ExternalLink
            dataRole="readme-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick#readme"
            ariaLabel="打开使用说明（GitHub）"
          >
            README
          </ExternalLink>
        </span>
        <span className="flex min-h-tap flex-wrap items-center gap-1 text-xs text-muted">
          <span>缺少学校适配？</span>
          <ExternalLink
            dataRole="preset-issue-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick-presets/issues"
            ariaLabel="提交学校信息（预设仓库 Issues）"
          >
            提交学校信息
          </ExternalLink>
          <HelpHint label="学校适配">学校适配与作息在独立的预设仓库维护</HelpHint>
        </span>
      </div>

      <div className="flex flex-col gap-1" data-role="about-app">
        <span className="text-sm font-medium text-ink">应用与版本</span>
        <span className="text-xs text-muted">晓刻 DawnTick · 课表与日程提醒工具</span>
        <span className="tabular text-xs text-muted">
          版本 {appVersion()} · {CHANNEL_LABEL[CHANNEL]}
        </span>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>许可证 Apache-2.0</span>
          <ExternalLink
            dataRole="license-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/blob/main/LICENSE"
            ariaLabel="打开许可证原文（GitHub）"
          >
            许可证原文
          </ExternalLink>
        </span>
        <ExternalLink
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick"
        >
          https://github.com/muyangplus/dawn-tick
        </ExternalLink>
      </div>

      <div className="flex flex-col gap-1" data-role="about-credits">
        <span className="text-sm font-medium text-ink">致谢与第三方声明</span>
        <span className="text-xs text-muted">
          运行时依赖共 {RUNTIME_CREDITS.length} 项；许可证全文见仓库根目录 THIRD-PARTY-LICENSES.md。
        </span>
        <ExternalLink
          dataRole="licenses-link"
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick/blob/main/THIRD-PARTY-LICENSES.md"
          ariaLabel="打开第三方许可证声明（GitHub）"
        >
          第三方许可证声明
        </ExternalLink>
        <details className="flex flex-col gap-1">
          <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-xs text-ink">
            展开依赖与许可证（{RUNTIME_CREDITS.length} 项）
          </summary>
          <ul className="flex flex-col gap-0.5 pt-1 text-xs text-muted">
            {RUNTIME_CREDITS.map((item) => (
              <li key={`${item.component}-${item.name}`} data-role="credit-row">
                {item.component} · {item.name} {item.version} · {item.license}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}
