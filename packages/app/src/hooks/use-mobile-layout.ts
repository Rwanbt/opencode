import { createSignal, onCleanup, onMount } from "solid-js"
import { usePlatform } from "../context/platform"

export interface MobileLayout {
  isMobile: boolean
  isTablet: boolean
  orientation: "portrait" | "landscape"
  safeAreaTop: number
  safeAreaBottom: number
}

/**
 * Hook providing mobile layout information.
 * Returns reactive signals for responsive design.
 */
export function useMobileLayout(): () => MobileLayout {
  const platform = usePlatform()
  const isMobilePlatform = platform.platform === "mobile"

  const [layout, setLayout] = createSignal<MobileLayout>({
    isMobile: isMobilePlatform || window.innerWidth < 768,
    isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
    orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait",
    safeAreaTop: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top") || "0"),
    safeAreaBottom: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom") || "0"),
  })

  onMount(() => {
    const update = () => {
      setLayout({
        isMobile: isMobilePlatform || window.innerWidth < 768,
        isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
        orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait",
        safeAreaTop: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top") || "0"),
        safeAreaBottom: parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom") || "0",
        ),
      })
    }

    window.addEventListener("resize", update)
    // Also listen for orientation change (mobile)
    window.addEventListener("orientationchange", update)

    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    })
  })

  return layout
}
