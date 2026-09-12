import { createSignal, onCleanup, onMount } from "solid-js"
import { usePlatform } from "../context/platform"
import { classify, side } from "@/tokens/viewport"

export interface MobileLayout {
  isMobile: boolean
  isTablet: boolean
  orientation: "portrait" | "landscape"
  safeAreaTop: number
  safeAreaBottom: number
}

export function resolveMobileLayout(width: number, height: number, isMobilePlatform: boolean): Pick<MobileLayout, "isMobile" | "isTablet" | "orientation"> {
  const viewport = classify(width, height)
  return {
    // Native mobile keeps its dedicated compact controls. Desktop/web follows
    // the same overlay authority as the shell, including tablet portrait and
    // compact landscape, rather than its old independent 768px breakpoint.
    isMobile: isMobilePlatform || side(viewport) === "overlay",
    isTablet: viewport === "tablet-portrait",
    orientation: width > height ? "landscape" : "portrait",
  }
}

/**
 * Hook providing mobile layout information.
 * Returns reactive signals for responsive design.
 */
export function useMobileLayout(): () => MobileLayout {
  const platform = usePlatform()
  const isMobilePlatform = platform.platform === "mobile"
  const readLayout = (): MobileLayout => ({
    ...resolveMobileLayout(window.innerWidth, window.innerHeight, isMobilePlatform),
    safeAreaTop: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top") || "0"),
    safeAreaBottom: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom") || "0"),
  })

  const [layout, setLayout] = createSignal<MobileLayout>(readLayout())

  onMount(() => {
    const update = () => setLayout(readLayout())

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
