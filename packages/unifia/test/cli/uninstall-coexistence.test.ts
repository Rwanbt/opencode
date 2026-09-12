import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanShellConfig } from "../../src/cli/cmd/uninstall"

// Uninstalling must remove this product's PATH entry and nothing else.
//
// It matched any line mentioning .opencode/bin, which is the directory the
// official OpenCode installer owns — so `unifia uninstall` on a machine with
// both products deleted OpenCode's PATH entry and left its binary unreachable.

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function withConfig(contents: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "unifia-uninstall-coex-"))
  dirs.push(dir)
  const file = path.join(dir, ".zshrc")
  await writeFile(file, contents)
  return file
}

test("removes the Unifia PATH entry and its marker", async () => {
  const file = await withConfig(
    ["export EDITOR=vim", "", "# unifia", 'export PATH=$HOME/.unifia/bin:$PATH', ""].join("\n"),
  )

  await cleanShellConfig(file)

  const after = await readFile(file, "utf8")
  expect(after).toContain("export EDITOR=vim")
  expect(after).not.toContain("# unifia")
  expect(after).not.toContain(".unifia/bin")
})

test("leaves a coexisting OpenCode PATH entry alone", async () => {
  const file = await withConfig(
    [
      "export EDITOR=vim",
      "",
      "# opencode",
      'export PATH=$HOME/.opencode/bin:$PATH',
      "",
      "# unifia",
      'export PATH=$HOME/.unifia/bin:$PATH',
      "",
    ].join("\n"),
  )

  await cleanShellConfig(file)

  const after = await readFile(file, "utf8")
  expect(after).toContain("# opencode")
  expect(after).toContain('export PATH=$HOME/.opencode/bin:$PATH')
  expect(after).not.toContain(".unifia/bin")
})

test("leaves an OpenCode fish_add_path alone", async () => {
  const file = await withConfig(
    ["fish_add_path $HOME/.opencode/bin", "# unifia", "fish_add_path $HOME/.unifia/bin", ""].join("\n"),
  )

  await cleanShellConfig(file)

  const after = await readFile(file, "utf8")
  expect(after).toContain("fish_add_path $HOME/.opencode/bin")
  expect(after).not.toContain(".unifia/bin")
})

test("a config with only an OpenCode entry is returned unchanged", async () => {
  const original = ["# opencode", 'export PATH=$HOME/.opencode/bin:$PATH', ""].join("\n")
  const file = await withConfig(original)

  await cleanShellConfig(file)

  expect(await readFile(file, "utf8")).toBe(original)
})
