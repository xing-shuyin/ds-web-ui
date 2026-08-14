#!/usr/bin/env node
/**
 * release.mjs — one-command publish for ds-web-ui.
 *
 *   npm run release          # patch bump
 *   npm run release -- minor # or major
 *
 * Steps: bump version (commit + tag) → npm publish (auto-builds web) →
 * push master + tags → create a GitHub release with the changelog since
 * the previous tag.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bump = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`usage: npm run release -- [patch|minor|major] (got "${bump}")`);
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

// 1. Bump version (creates a commit and an annotated-less vX.Y.Z tag).
run(`npm version ${bump}`);

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const ver = pkg.version;
console.log(`\n==> releasing ds-web-ui@${ver}`);

// 2. Publish to npm (prepublishOnly runs the web build).
run("npm publish");

// 3. Push code and tags to GitHub.
run("git push origin master --tags");

// 4. GitHub release with a changelog since the previous tag.
let prevTag = "";
try {
  prevTag = execSync("git describe --tags --abbrev=0 HEAD~1", {
    encoding: "utf8",
  }).trim();
} catch {
  prevTag = "";
}
const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
const log = execSync(`git log --oneline --no-merges ${range}`, {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => `- ${l}`)
  .join("\n");
const notes = `**ds-web-ui v${ver}**\n\n## 变更\n\n${log || "- (无)"}\n\n## 安装\n\n\`\`\`bash\nnpm i -g ds-web-ui\n\`\`\``;
const tag = `v${ver}`;
const notesFile = new URL(`../.release-notes-${ver}.md`, import.meta.url);
const { writeFileSync } = await import("node:fs");
writeFileSync(notesFile, notes);
try {
	run(`gh release create ${tag} --title "ds-web-ui ${tag}" --notes-file "${notesFile.pathname.replace(/^\//, "").replace(/%/g, "%%")}"`);
} finally {
	try {
		const { rmSync } = await import("node:fs");
		rmSync(notesFile);
	} catch { /* ignore */ }
}

console.log(`\n✅ 发布完成: npm ds-web-ui@${ver} + github.com/xing-shuyin/ds-web-ui/releases/tag/${tag}`);
