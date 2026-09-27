import { expect, test } from "bun:test"
import { copyCommand } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})

test("write rejects instead of reporting a copy when no clipboard backend works", async () => {
  const script = `import { write } from ${JSON.stringify(new URL("../src/clipboard.ts", import.meta.url).href)}
await write("x").then(() => console.log("RESOLVED"), (e) => console.log("REJECTED " + e.message))`
  const env = { ...process.env, PATH: "", DISPLAY: "", WAYLAND_DISPLAY: "" }
  const proc = Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
  // clipboardy's bundled xsel fallback can leave a dangling child that keeps the
  // subprocess alive long after write() has rejected, so read the first line on a
  // bounded timer and kill the process rather than waiting for it to exit on its own.
  const firstLine = await new Promise<string>((resolve) => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const pump = async () => {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return resolve(buf)
        buf += decoder.decode(value)
        const nl = buf.indexOf("\n")
        if (nl >= 0) return resolve(buf.slice(0, nl))
      }
    }
    void pump()
    setTimeout(() => resolve(buf), 6000).unref()
  })
  proc.kill("SIGKILL")
  expect(firstLine).toContain("REJECTED Clipboard copy failed")
})
