import type { ComponentProps } from "solid-js"
import unifiaLogotypeDark from "../assets/brand/unifia/unifia-logotype-dark.svg"
import unifiaLogotypeLight from "../assets/brand/unifia/unifia-logotype-light.svg"
import unifiaSymbol from "../assets/brand/unifia/unifia-symbol-color.svg"
import { useColorScheme } from "./color-scheme"

// The brand masters are drawn on a 400x400 canvas with the artwork centred, so
// the components below crop to the artwork's own bounding box (measured with
// getBBox on the master) instead of inheriting 400x400 of mostly-empty square.
const LOGOTYPE_VIEWBOX = "32 145 306 123"
// The symbol fills a little over half its canvas; `Mark` renders as small as
// 12px wide, where the surrounding empty margin would swallow the glyph.
const SYMBOL_VIEWBOX = "84 78 231 244"

/**
 * Compact product symbol, for spaces too small for the full signature.
 *
 * Was the upstream square glyph drawn in vector paths — see the note on `Logo`
 * for why brand artwork is referenced rather than redrawn here.
 */
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox={SYMBOL_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href={unifiaSymbol} x="0" y="0" width="400" height="400" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href={unifiaSymbol} x="0" y="0" width="400" height="400" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}

/**
 * Product signature: the Unifia symbol followed by the wordmark.
 *
 * WHY this is an <image> rather than paths: the previous implementation spelled
 * "opencode" out in hand-written vector paths, so the rebrand could not reach
 * it — the home screen kept showing the upstream wordmark long after every
 * other surface had moved. The wordmark is brand artwork with one owner
 * (brand/unifia/masters, mirrored here by scripts/brand/generate.py); redrawing
 * it as paths would recreate exactly the second owner that caused the drift.
 *
 * The light/dark pair exists because the wordmark is baked into the asset:
 * `-dark` is the white-on-dark cut, so on a light theme it would be invisible.
 *
 * `scheme` pins that choice for surfaces that paint their own background. The
 * mobile mode selector is one: it renders before `oc-theme-preload.js` has set
 * `data-color-scheme`, so auto-detection would read the default "light" and put
 * dark ink on its hardcoded dark canvas.
 */
export const Logo = (props: Pick<ComponentProps<"svg">, "class" | "style"> & { scheme?: "light" | "dark" }) => {
  const detected = useColorScheme()
  const scheme = () => props.scheme ?? detected()

  return (
    <svg
      data-component="logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGOTYPE_VIEWBOX}
      fill="none"
      style={props.style}
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <image
        href={scheme() === "dark" ? unifiaLogotypeDark : unifiaLogotypeLight}
        x="0"
        y="0"
        width="400"
        height="400"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}
