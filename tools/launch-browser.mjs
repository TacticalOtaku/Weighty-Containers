import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function findCachedHeadlessShell() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright")
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter(name => name.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const base = path.join(root, dir);
      for (const sub of readdirSync(base)) {
        const candidate = path.join(base, sub, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export async function launchChromium(chromium) {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    return chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  }
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  }
  try {
    return await chromium.launch({ headless: true });
  } catch {
    try {
      return await chromium.launch({ headless: true, channel: "msedge" });
    } catch (error) {
      const executablePath = findCachedHeadlessShell();
      if (!executablePath) throw error;
      return chromium.launch({ headless: true, executablePath });
    }
  }
}
