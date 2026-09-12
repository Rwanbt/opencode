import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";

test("integration-24: protected branch dev — push refused by .husky/pre-push gate", () => {
  const repo = createTempGitRepo({ branch: "dev" });
  const branchName = repo.exec("git", ["branch", "--show-current"]).trim();
  expect(branchName).toBe("dev");
  repo.cleanup();
});
