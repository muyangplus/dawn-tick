export type Platform = 'web' | 'tauri' | 'capacitor';

export function detectPlatform(): Platform {
  const scope = globalThis as {
    __TAURI_INTERNALS__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (scope.__TAURI_INTERNALS__ !== undefined) return 'tauri';
  if (scope.Capacitor?.isNativePlatform?.() === true) return 'capacitor';
  return 'web';
}
