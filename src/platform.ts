// Things a page inside an itch.io iframe (or a phone) needs: fullscreen, audio that waits for the first touch or key, and a callback when the visible size changes (resize, rotate,
// fullscreen, the phone's address bar sliding away). Nothing here throws when the browser lacks a feature.
export const fullscreenAvailable = (): boolean => typeof document !== 'undefined' && !!(document.fullscreenEnabled || (document as any).webkitFullscreenEnabled);
export const isFullscreen = (): boolean => !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
export function toggleFullscreen(): void {
  try {
    if (isFullscreen()) (document.exitFullscreen ?? (document as any).webkitExitFullscreen)?.call(document);
    else { const el = document.documentElement as any; (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)?.catch?.(() => { /* refused (an iframe without allow-fullscreen): the itch.io button still works */ }); }
  } catch (e) { /* no fullscreen here */ }
}
/** leaves fullscreen when it is on (the only kind of exit a page has: it cannot close its own tab) */
export function leaveFullscreen(): void { try { if (isFullscreen()) (document.exitFullscreen ?? (document as any).webkitExitFullscreen)?.call(document); } catch (e) { /* nothing to leave */ } }
/** runs `callback` once, on the first pointer press or key press (browsers keep audio locked until then) */
export function onFirstGesture(callback: () => void): void {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const fire = (): void => { for (const n of events) removeEventListener(n, fire, true); try { callback(); } catch (e) { /* ignore */ } };
  for (const n of events) addEventListener(n, fire, true);
}
/** `callback` after the window resizes, the phone rotates, fullscreen changes, or the visual viewport moves */
export function watchViewport(callback: () => void): void {
  addEventListener('resize', callback); addEventListener('orientationchange', callback); document.addEventListener('fullscreenchange', callback); document.addEventListener('webkitfullscreenchange', callback);
  window.visualViewport?.addEventListener('resize', callback);
}
