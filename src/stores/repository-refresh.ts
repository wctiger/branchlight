/** Mounted parent/child repository views refresh after either context changes. */
const listeners = new Map<string, Set<() => void>>();
function normalized(path: string) {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(path);
  const value = windows ? path.replace(/\\/g, "/") : path;
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
export function subscribeRelatedRepositoryRefresh(
  path: string,
  listener: () => void,
) {
  const key = normalized(path);
  const callbacks = listeners.get(key) ?? new Set<() => void>();
  callbacks.add(listener);
  listeners.set(key, callbacks);
  return () => {
    callbacks.delete(listener);
    if (!callbacks.size) listeners.delete(key);
  };
}
export function notifyRepositoryMutation(path: string) {
  const changed = normalized(path);
  for (const [key, callbacks] of listeners) {
    if (
      key !== changed &&
      (key.startsWith(`${changed}/`) || changed.startsWith(`${key}/`))
    ) {
      for (const callback of callbacks) callback();
    }
  }
}
