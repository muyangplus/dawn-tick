/**
 * toast 的唯一出口：sonner 的薄封装。
 *
 * 单独放在 `.ts` 模块里，让非 JSX 的 `lib/action.ts` 也能引用，
 * 同时保证 `components/ui/toaster.tsx` 与测试都能从同一处取到 `toast`。
 */
export { toast } from 'sonner';
