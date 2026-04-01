import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import fg from "fast-glob";

import type { AppConfig } from "./config.js";
import type { PreparedSource } from "./types.js";

const GITHUB_DOCS_REPO_URL = "https://github.com/github/docs.git";

export async function prepareSource(
  config: AppConfig,
  options?: { pull?: boolean | undefined },
): Promise<PreparedSource> {
  if (config.contentDirOverride) {
    const contentDir = path.resolve(config.contentDirOverride);
    if (!fs.existsSync(contentDir)) {
      throw new Error(`Content directory does not exist: ${contentDir}`);
    }

    return {
      repoRoot: path.dirname(contentDir),
      contentDir,
      sourceCommitSha: "local-dev",
    };
  }

  fs.mkdirSync(config.cacheDir, { recursive: true });

  if (!fs.existsSync(config.sourceDir)) {
    execFileSync("git", ["clone", "--depth", "1", GITHUB_DOCS_REPO_URL, config.sourceDir], {
      stdio: "inherit",
    });
  } else if (options?.pull) {
    execFileSync("git", ["-C", config.sourceDir, "pull", "--ff-only"], {
      stdio: "inherit",
    });
  }

  return {
    repoRoot: config.sourceDir,
    contentDir: path.join(config.sourceDir, "content"),
    sourceCommitSha: execFileSync("git", ["-C", config.sourceDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  };
}

export async function listMarkdownFiles(contentDir: string): Promise<string[]> {
  return fg("**/*.md", {
    cwd: contentDir,
    absolute: true,
  });
}
