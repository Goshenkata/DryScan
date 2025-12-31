import path from "path";
import fs from "fs/promises";
import upath from "upath";
import { glob } from "glob-gitignore";
import ignore, { Ignore } from "ignore";
import { DryConfig } from "./types";

/**
 * Gitignore helper that builds ignore matchers by combining default rules,
 * repo .gitignore files, and config-driven exclusions.
 */
export class Gitignore {
  private readonly defaultIgnores = [".git/**", ".dry/**"];

  constructor(private readonly root: string) {}

  async buildMatcher(config: DryConfig): Promise<Ignore> {
    const rules = await this.resolveRules(config);
    return ignore({ allowRelativePaths: true }).add(rules);
  }

  private async resolveRules(config: DryConfig): Promise<string[]> {
    const gitignoreRules = await this.loadGitignoreRules();
    const configRules = config.excludedPaths || [];
    return [...this.defaultIgnores, ...gitignoreRules, ...configRules];
  }

  private async loadGitignoreRules(): Promise<string[]> {
    const gitignoreFiles = await glob("**/.gitignore", {
      cwd: this.root,
      dot: true,
      nodir: true,
      ignore: this.defaultIgnores,
    });

    const rules: string[] = [];

    for (const file of gitignoreFiles) {
      const absPath = path.join(this.root, file);
      const dir = upath.normalizeTrim(upath.dirname(file));
      const content = await fs.readFile(absPath, "utf8").catch(() => "");
      const lines = content.split(/\r?\n/);

      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const negated = trimmed.startsWith("!");
        const body = negated ? trimmed.slice(1) : trimmed;

        const scoped = this.scopeRule(body, dir);
        if (!scoped) continue;

        rules.push(negated ? `!${scoped}` : scoped);
      }
    }

    return rules;
  }

  private scopeRule(rule: string, gitignoreDir: string): string | null {
    const cleaned = rule.replace(/^\//, "");
    if (!cleaned) return null;

    if (!gitignoreDir || gitignoreDir === ".") {
      return cleaned;
    }

    return upath.normalizeTrim(upath.join(gitignoreDir, cleaned));
  }
}
