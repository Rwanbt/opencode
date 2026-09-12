export const unifiaTheme = {
  color: {
    brand: {
      code: "#4885F3",
      indigo: "#424BD5",
      design: "#9068E9",
      bridge: "#BD5852",
      work: "#EC7C39",
      amber: "#FAAB52",
    },
    surface: {
      canvas: "#070A13",
      panel: "#111422",
      card: "#1D202F",
      elevated: "#2C2E3E",
    },
    text: {
      primary: "#F2EFED",
      secondary: "#B6B3C2",
      tertiary: "#73707E",
    },
  },
  typography: {
    wordmarkReference: "ITC Bauhaus",
    ui: '"Manrope", "Inter", "Noto Sans", sans-serif',
    mono: '"Roboto Mono", "Cascadia Mono", "SFMono-Regular", monospace',
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, xxl: 28, pill: 999 },
  motionMs: { instant: 80, fast: 160, normal: 240, slow: 420 },
} as const
