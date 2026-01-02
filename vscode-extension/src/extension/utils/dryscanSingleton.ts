import { DryScan } from "@dryscan/core";

export class DryScanSingleton {
  private static instance: DryScan | null = null;

  static get(repoPath: string): DryScan {
    if (!this.instance || this.instance.repoPath !== repoPath) {
      this.instance = new DryScan(repoPath);
    }
    return this.instance;
  }

  static clear(): void {
    this.instance = null;
  }
}
