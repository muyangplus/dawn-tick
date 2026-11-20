import { ExternalLink } from '../../components/ui/external-link.tsx';
import { HelpHint } from '../../components/ui/help-hint.tsx';
import { CHANNEL, CHANNEL_LABEL, appVersion } from '../../channel.ts';
import { RecentUpdatesDialog } from './recent-updates-dialog.tsx';
/** 关于卡片列出的运行时依赖与许可证：由 tools/legal/collect-licenses.mjs 生成。 */
import { RUNTIME_CREDITS } from '../../legal/credits.generated.ts';
import { aboutCopy } from '../../copy/settings-about.ts';

/**
 * 关于卡：帮助与反馈、应用与版本、致谢与第三方声明。
 *
 * 零状态、零回调：版本与渠道来自构建常量，依赖清单来自生成文件，卡内不需要设置读写。
 */
export function AboutCard() {
  return (
    <>
      <div className="flex flex-col gap-1" data-role="about-help">
        <span className="text-sm font-medium text-ink">{aboutCopy.helpTitle}</span>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>{aboutCopy.issuesLabel}</span>
          <ExternalLink
            dataRole="issues-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/issues"
            ariaLabel={aboutCopy.issuesAria}
          >
            Issues
          </ExternalLink>
          <span>{aboutCopy.readmeLabel}</span>
          <ExternalLink
            dataRole="readme-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick#readme"
            ariaLabel={aboutCopy.readmeAria}
          >
            README
          </ExternalLink>
        </span>
        <span className="flex min-h-tap flex-wrap items-center gap-1 text-xs text-muted">
          <span>{aboutCopy.missingSchool}</span>
          <ExternalLink
            dataRole="preset-issue-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick-presets/issues"
            ariaLabel={aboutCopy.presetIssueAria}
          >
            {aboutCopy.presetIssueLink}
          </ExternalLink>
          <HelpHint label={aboutCopy.presetHelpLabel}>{aboutCopy.presetHelp}</HelpHint>
        </span>
      </div>

      <div className="flex flex-col gap-1" data-role="about-app">
        <span className="text-sm font-medium text-ink">{aboutCopy.appTitle}</span>
        <span className="text-xs text-muted">{aboutCopy.appTagline}</span>
        <span className="tabular text-xs text-muted">
          {aboutCopy.version(appVersion(), CHANNEL_LABEL[CHANNEL])}
        </span>
        <span className="flex min-h-tap flex-wrap items-center gap-2 text-xs text-muted">
          <span>{aboutCopy.license}</span>
          <ExternalLink
            dataRole="license-link"
            className="text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/blob/main/LICENSE"
            ariaLabel={aboutCopy.licenseAria}
          >
            {aboutCopy.licenseLink}
          </ExternalLink>
        </span>
        <ExternalLink
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick"
        >
          https://github.com/muyangplus/dawn-tick
        </ExternalLink>
        <span className="flex flex-wrap items-center gap-2">
          <RecentUpdatesDialog />
          <ExternalLink
            dataRole="release-notes-link"
            className="text-xs text-primary-strong underline"
            href="https://github.com/muyangplus/dawn-tick/releases"
            ariaLabel={aboutCopy.releaseNotesAria}
          >
            {aboutCopy.releaseNotesLink}
          </ExternalLink>
        </span>
      </div>

      <div className="flex flex-col gap-1" data-role="about-credits">
        <span className="text-sm font-medium text-ink">{aboutCopy.creditsTitle}</span>
        <span className="text-xs text-muted">
          {aboutCopy.creditsCount(RUNTIME_CREDITS.length)}
        </span>
        <ExternalLink
          dataRole="licenses-link"
          className="text-xs text-primary-strong underline"
          href="https://github.com/muyangplus/dawn-tick/blob/main/THIRD-PARTY-LICENSES.md"
          ariaLabel={aboutCopy.thirdPartyAria}
        >
          {aboutCopy.thirdPartyLink}
        </ExternalLink>
        <details className="flex flex-col gap-1">
          <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-xs text-ink">
            {aboutCopy.expandCredits(RUNTIME_CREDITS.length)}
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
