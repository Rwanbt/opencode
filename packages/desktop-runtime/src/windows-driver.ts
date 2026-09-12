/* SPDX-License-Identifier: MIT */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { DesktopAutomationBroker, type DesktopDriver, type DesktopTarget } from "@unifia/contracts"

const execFileAsync = promisify(execFile)
const WINDOWS_SCRIPT = `param([string]$operation,[string]$appId,[string]$windowId,[string]$payload)
$ErrorActionPreference = "Stop"
if ($operation -eq "observe") {
  $processes = @(Get-Process -Name $appId -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle)
  @{ appId = $appId; windows = $processes } | ConvertTo-Json -Compress
  exit 0
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
$input = $payload | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
if ($windowId) { [void]$shell.AppActivate($windowId) } else { [void]$shell.AppActivate($appId) }
if ($operation -eq "keyboard") { $shell.SendKeys([string]$input.keys); exit 0 }
if ($operation -eq "mouse") {
  [void][NativeInput]::SetCursorPos([int]$input.x, [int]$input.y)
  if ($input.button -eq "left") { [NativeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
  elseif ($input.button -eq "right") { [NativeInput]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero) }
  else { throw "unsupported mouse button" }
  exit 0
}
throw "unsupported desktop operation"`

type CommandRunner = (operation: string, target: DesktopTarget, payload?: unknown) => Promise<string>
export class WindowsDesktopDriver implements DesktopDriver {
  readonly #run: CommandRunner
  constructor(run: CommandRunner = WindowsDesktopDriver.#runPowerShell) { this.#run = run }
  async observe(target: DesktopTarget): Promise<unknown> { return JSON.parse(await this.#run("observe", target)) }
  async control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> { await this.#run(action, target, payload) }
  static async #runPowerShell(operation: string, target: DesktopTarget, payload?: unknown): Promise<string> {
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-Command", WINDOWS_SCRIPT, operation, target.appId, target.windowId ?? "", JSON.stringify(payload ?? {})], { timeout: 15_000, windowsHide: true, maxBuffer: 1_000_000 })
    return result.stdout.trim()
  }
}

export function createWindowsDesktopBroker(allowedApps: readonly string[], switches?: { isEngaged(surface: "computer-use"): boolean }): DesktopAutomationBroker {
  return new DesktopAutomationBroker(new WindowsDesktopDriver(), allowedApps, switches)
}