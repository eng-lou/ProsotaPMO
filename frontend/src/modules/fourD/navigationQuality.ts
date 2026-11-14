// Navigation may simplify effects, but never the captured/exported result.
export function shouldSimplifyNavigation(enabled: boolean, moving: boolean, capturing: boolean) {
  return enabled && moving && !capturing
}
