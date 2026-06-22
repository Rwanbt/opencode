import { cmd } from "./cmd"
import { GithubInstallCommand } from "./github-install"
import { GithubRunCommand } from "./github-run"

// Pure helpers re-exported for tests (test/cli/github-*.test.ts) and any
// external consumer that imported them from "./github" before the split.
export { parseGitHubRemote, extractResponseText, formatPromptTooLargeError } from "./github-shared"

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
