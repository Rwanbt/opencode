import { describe, test, expect } from "bun:test"
import * as DockerSandbox from "../../src/sandbox/docker"

describe("Docker Sandbox", () => {
  test("isDockerAvailable returns boolean", () => {
    const result = DockerSandbox.isDockerAvailable()
    expect(typeof result).toBe("boolean")
  })

  test("toContainerPath converts host path to container path", () => {
    expect(DockerSandbox.toContainerPath("/home/user/project", "/home/user/project/src/index.ts")).toBe(
      "/workspace/src/index.ts",
    )
  })

  test("toContainerPath handles Windows paths", () => {
    expect(DockerSandbox.toContainerPath("D:\\App\\Project", "D:\\App\\Project\\src\\index.ts")).toBe(
      "/workspace/src/index.ts",
    )
  })

  // Integration tests - only run if Docker is available
  const dockerAvailable = DockerSandbox.isDockerAvailable()

  test.skipIf(!dockerAvailable)("ensureContainer creates and starts a container", async () => {
    const container = await DockerSandbox.ensureContainer("/tmp/test-sandbox", "alpine:latest")
    expect(container.id).toBeTruthy()
    expect(container.image).toBe("alpine:latest")
    await DockerSandbox.cleanup()
  })

  test.skipIf(!dockerAvailable)("exec runs command in container", async () => {
    const container = await DockerSandbox.ensureContainer("/tmp/test-sandbox", "alpine:latest")
    const result = await DockerSandbox.exec(container, "echo hello world")
    expect(result.output.trim()).toBe("hello world")
    expect(result.exitCode).toBe(0)
    await DockerSandbox.cleanup()
  })

  test.skipIf(!dockerAvailable)("exec returns non-zero exit code on failure", async () => {
    const container = await DockerSandbox.ensureContainer("/tmp/test-sandbox", "alpine:latest")
    const result = await DockerSandbox.exec(container, "exit 42")
    expect(result.exitCode).toBe(42)
    await DockerSandbox.cleanup()
  })

  test.skipIf(!dockerAvailable)("cleanup removes container", async () => {
    await DockerSandbox.ensureContainer("/tmp/test-sandbox", "alpine:latest")
    await DockerSandbox.cleanup()
    // Second cleanup should be no-op
    await DockerSandbox.cleanup()
  })
})
