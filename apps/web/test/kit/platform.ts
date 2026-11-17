/** 把运行环境伪装成 Android（Capacitor 原生壳）；返回还原函数。 */
export function installCapacitorPlatform(): () => void {
  const scope = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  const previous = scope.Capacitor;
  scope.Capacitor = { isNativePlatform: () => true };
  return () => {
    if (previous === undefined) delete scope.Capacitor;
    else scope.Capacitor = previous;
  };
}
