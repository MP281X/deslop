import * as React from "react"

const MOBILE_QUERY = "(max-width: 767px)"

// The shell's first client render already knows the device, so a phone never paints the desktop panes first.
export function useIsMobile() {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(MOBILE_QUERY)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  )
}
