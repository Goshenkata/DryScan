import { strict as assert } from "assert";
import { describe, it, afterEach } from "mocha";
import { mkdtemp, mkdir } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { handleInitCommand, InitCommandDeps } from "../extension/commands/initCommand.js";
import { DryScanSingleton } from "../extension/utils/dryscanSingleton.js";
import { dryFolderExists } from "../extension/utils/dryFolder.js";

function createDeps(overrides: Partial<InitCommandDeps> = {}): { deps: InitCommandDeps; calls: Record<string, number> } {
	const calls: Record<string, number> = {};
	const bump = (key: string) => (calls[key] = (calls[key] ?? 0) + 1);

	const deps: InitCommandDeps = {
		repoPath: "/repo",
		checkDryFolder: async () => false,
		initDryScan: async () => {
			bump("init");
		},
		refreshView: () => bump("refresh"),
		withProgress: async <T>(_message: string, task: () => Promise<T>) => task(),
		showInfo: () => bump("info"),
		showError: () => bump("error"),
	};

	Object.assign(deps, overrides);
	return { deps, calls };
}

describe("handleInitCommand", () => {
	it("prompts for workspace when none is open", async () => {
		const { deps, calls } = createDeps({ repoPath: null });

		await handleInitCommand(deps);

		assert.equal(calls.error, 1);
		assert.equal(calls.init ?? 0, 0);
		assert.equal(calls.refresh ?? 0, 0);
	});

	it("reports already initialised when .dry exists", async () => {
		const { deps, calls } = createDeps({ checkDryFolder: async () => true });

		await handleInitCommand(deps);

		assert.equal(calls.info, 1);
		assert.equal(calls.init ?? 0, 0);
		assert.equal(calls.refresh, 1);
	});

	it("runs initialisation when needed", async () => {
		const { deps, calls } = createDeps();

		await handleInitCommand(deps);

		assert.equal(calls.init, 1);
		assert.equal(calls.info, 1);
		assert.equal(calls.refresh, 1);
	});
});

describe("DryScanSingleton", () => {
	afterEach(() => DryScanSingleton.clear());

	it("returns the same instance for the same path", () => {
		const first = DryScanSingleton.get("/repo/a");
		const second = DryScanSingleton.get("/repo/a");
		assert.equal(first, second);
	});

	it("returns different instances for different paths", () => {
		const first = DryScanSingleton.get("/repo/a");
		const second = DryScanSingleton.get("/repo/b");
		assert.notEqual(first, second);
	});
});

describe("workspaceContext", () => {
	it("detects presence of .dry directory", async () => {
		const tmp = await mkdtemp(path.join(tmpdir(), "dryscan-test-"));
		const hasBefore = await dryFolderExists(tmp);
		await mkdir(path.join(tmp, ".dry"));
		const hasAfter = await dryFolderExists(tmp);

		assert.equal(hasBefore, false);
		assert.equal(hasAfter, true);
	});
});
