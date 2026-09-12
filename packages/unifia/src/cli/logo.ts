export const brandColors = {
  purple: "#8700FF",
  blue: "#0068FF",
  orange: "#FF8000",
  white: "#FFFFFF",
} as const

const letters = {
  n: ["      ", "██████", "██  ██", "██  ██", "██  ██"],
  i: ["▀▀", "██", "██", "██", "██"],
  f: ["████", "██  ", "████", "██  ", "██  "],
  a: ["      ", "▄█████", "██  ██", "██  ██", "███ ██"],
} as const

const wordmark = letters.n.map((_, index) =>
  [letters.n[index], letters.i[index], letters.f[index], letters.i[index], letters.a[index]].join("  "),
)

export const logo = {
  symbol: [
    { text: "██    ██", colors: "PP    OO" },
    { text: "██    ██", colors: "PP    OO" },
    { text: "██    ██", colors: "PP    OO" },
    { text: "██    ██", colors: "PP    OO" },
    { text: "████████", colors: "PPPBBOOO" },
  ],
  wordmark,
  compact: { purple: "▌", blue: "▾", orange: "▐", wordmark: "nifia" },
} as const

// Below this width the full 38-column lockup no longer fits, so the TUI falls
// back to the compact mark. The value is the approved lockup's own
// `compactBelowColumns` -- see brand/unifia/cli/unifia-cli-lockup.json, which
// owns every number in this file.
export const compactBelowColumns = 42

export const plainWordmark = logo.symbol.map(
  (row, index) => `${row.text}  ${logo.wordmark[index] ?? ""}`,
)
