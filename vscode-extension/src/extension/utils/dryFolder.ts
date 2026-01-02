import * as path from "path";
import { stat } from "fs/promises";

const DRY_FOLDER_NAME = ".dry";

export async function dryFolderExists(repoPath: string): Promise<boolean> {
  const target = path.join(repoPath, DRY_FOLDER_NAME);
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}
