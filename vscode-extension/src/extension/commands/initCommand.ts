export interface InitCommandDeps {
  repoPath: string | null;
  checkDryFolder: (repoPath: string) => Promise<boolean>;
  initDryScan: (repoPath: string) => Promise<void>;
  refreshView: () => void;
  withProgress: <T>(message: string, task: () => Promise<T>) => Promise<T>;
  showInfo: (message: string) => void;
  showError: (message: string) => void;
}

export async function handleInitCommand(deps: InitCommandDeps): Promise<void> {
  const { repoPath } = deps;
  if (!repoPath) {
    deps.showError("Open a workspace folder to initialize DryScan.");
    return;
  }

  if (await deps.checkDryFolder(repoPath)) {
    deps.showInfo("DryScan is already initialized.");
    deps.refreshView();
    return;
  }

  try {
    await deps.withProgress("Initialising DryScan...", async () => {
      await deps.initDryScan(repoPath);
    });
    deps.showInfo("DryScan initialised successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    deps.showError(`Failed to initialise DryScan: ${message}`);
  } finally {
    deps.refreshView();
  }
}
