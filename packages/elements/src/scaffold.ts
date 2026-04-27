import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execa } from "execa";
import { startListing } from "@agent-ix/ix-ui-cli";
import { resolveElementByType } from "./registry/resolver.js";

export interface ScaffoldOptions {
  org?: string;
  outputDir?: string;
  noGit?: boolean;
  noGithub?: boolean;
}

export async function runElementsInit(
  type: string,
  projectName: string,
  opts: ScaffoldOptions = {},
): Promise<void> {
  const list = startListing(`ix elements init ${type} ${projectName}`);
  try {
    const element = await resolveElementByType(type);
    const outputDir = opts.outputDir ?? process.cwd();
    const org = opts.org ?? "agent-ix";

    const cacheDir = path.join(
      os.homedir(),
      ".cache",
      "ix",
      "elements",
      "repos",
      element.name,
    );

    // Subprocesses inherit stdio — commit the header so their output lands as body.
    list.commit();

    await cloneOrUpdate(element.repoUrl, cacheDir);
    await runCookiecutter(cacheDir, outputDir, projectName, org);

    const projectDir = path.join(outputDir, toSlug(projectName));

    if (!opts.noGit) {
      await initGit(projectDir, type, element.name);
    }

    if (!opts.noGithub && !opts.noGit) {
      await createGithubRepo(projectDir, org, toSlug(projectName));
    }

    list.success(
      `Scaffolded ${type} project '${toSlug(projectName)}' in ${projectDir}`,
    );
  } catch (err) {
    list.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function cloneOrUpdate(repoUrl: string, dest: string): Promise<void> {
  if (fs.existsSync(path.join(dest, ".git"))) {
    await execa("git", ["pull", "--ff-only"], { cwd: dest });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await execa("git", ["clone", "--depth=1", repoUrl, dest]);
  }
}

async function runCookiecutter(
  templateDir: string,
  outputDir: string,
  projectName: string,
  org: string,
): Promise<void> {
  try {
    await execa(
      "cookiecutter",
      [
        templateDir,
        "--no-input",
        "--output-dir",
        outputDir,
        `project_name=${projectName}`,
        `org=${org}`,
      ],
      { stdio: "inherit" },
    );
  } catch (err) {
    throw new Error(
      `cookiecutter failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function initGit(
  projectDir: string,
  type: string,
  templateName: string,
): Promise<void> {
  if (fs.existsSync(path.join(projectDir, ".git"))) return;
  await execa("git", ["init", "-b", "main"], { cwd: projectDir });
  await execa("git", ["add", "-A"], { cwd: projectDir });
  await execa(
    "git",
    ["commit", "-m", `feat: scaffold from ${templateName} (${type})`],
    { cwd: projectDir },
  );
}

async function createGithubRepo(
  projectDir: string,
  org: string,
  slug: string,
): Promise<void> {
  await execa(
    "gh",
    [
      "repo",
      "create",
      `${org}/${slug}`,
      "--private",
      "--source=.",
      "--remote=origin",
      "--push",
    ],
    { cwd: projectDir, stdio: "inherit" },
  );
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
