/* SPDX-License-Identifier: MIT */
declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; deepLinks?: string[]; wsl?: boolean }
  }
}
export {}
