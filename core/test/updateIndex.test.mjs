import sinon from "sinon";
import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { DryScan } from "../src/DryScan.ts";
import { DryScanDatabase } from "../src/db/DryScanDatabase.ts";
import { detectFileChanges, performIncrementalUpdate } from "../src/DryScanUpdater.ts";
import { IndexUnitExtractor } from "../src/IndexUnitExtractor.ts";
import { DEFAULT_CONFIG } from "../src/config/dryconfig.ts";
import { IndexUnitType } from "../src/types.ts";
import { configStore } from "../src/config/configStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseConfig = () => ({ ...DEFAULT_CONFIG, minLines: 0 });
const writeConfig = async (repoPath, config) => {
  await fs.writeFile(path.join(repoPath, ".dryconfig.json"), JSON.stringify(config, null, 2), "utf8");
};

/**
 * Test suite for updateIndex functionality.
 * Tests incremental updates via file change detection.
 */
describe("updateIndex", () => {
  const testRepoPath = path.join(__dirname, "temp-test-repo");
  const dryDir = path.join(testRepoPath, ".dry");
  let dryScan;
  let db;

  after(() => {
    sinon.restore();
  });

  beforeEach(async () => {
    // Create test repository
    await fs.mkdir(testRepoPath, { recursive: true });
    
    // Create initial test file
    await fs.writeFile(
      path.join(testRepoPath, "Test.java"),
      `package temp;\n\npublic class Test {\n  public String hello() { return "world"; }\n  public String goodbye() { return "farewell"; }\n}`
    );

    await writeConfig(testRepoPath, baseConfig());
    await configStore.init(testRepoPath);
    dryScan = new DryScan(testRepoPath);
    db = new DryScanDatabase();
  });

  afterEach(async () => {
    // Cleanup
    if (db?.isInitialized()) {
      await db.close();
    }
    await fs.rm(testRepoPath, { recursive: true, force: true });
  });

  it("should detect and process new files", async () => {
    // Initialize with one file
    await dryScan.init({ skipEmbeddings: true });
    
    // Initialize db to check initial state
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    assert.strictEqual(functions.length, 2, "Should have 2 initial functions");

    // Add a new file
    await fs.writeFile(
      path.join(testRepoPath, "NewFile.java"),
      `package temp;\n\npublic class NewFile {\n  public String newFunc() { return "new"; }\n}`
    );

    // Update index
    await dryScan.updateIndex();

    // Verify new function added
    functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    assert.strictEqual(functions.length, 3, "Should have 3 functions after adding new file");
    
    const newFunc = functions.find(f => f.name.endsWith("newFunc"));
    assert.ok(newFunc, "Should find newFunc");
    assert.strictEqual(newFunc.filePath, "NewFile.java");
  });

  it("should detect and process changed files", async () => {
    // Initialize
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    const originalCount = functions.length;
    assert.strictEqual(originalCount, 2, "Should have 2 initial functions");

    // Modify file - add a new function
    await fs.writeFile(
      path.join(testRepoPath, "Test.java"),
      `package temp;\n\npublic class Test {\n  public String hello() { return "world"; }\n  public String goodbye() { return "farewell"; }\n  public String added() { return "added"; }\n}`
    );

    // Small delay to ensure mtime changes
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify function added
    functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    assert.strictEqual(functions.length, 3, "Should have 3 functions after change");
    
    const addedFunc = functions.find(f => f.name.endsWith("added"));
    assert.ok(addedFunc, "Should find added function");
  });

  it("should detect and remove deleted files", async () => {
    // Initialize with two files
    await fs.writeFile(
      path.join(testRepoPath, "Temp.java"),
      `package temp;\n\npublic class Temp {\n  public String temp() { return "temporary"; }\n}`
    );
    
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    assert.strictEqual(functions.length, 3, "Should have 3 initial functions");

    // Delete one file
    await fs.unlink(path.join(testRepoPath, "Temp.java"));

    // Update index
    await dryScan.updateIndex();

    // Verify function removed
    functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    assert.strictEqual(functions.length, 2, "Should have 2 functions after deletion");
    
    const tempFunc = functions.find(f => f.name.endsWith("temp"));
    assert.strictEqual(tempFunc, undefined, "temp function should be removed");
  });

  it("should track files with checksum and mtime", async () => {
    // Initialize
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    // Verify file tracking
    const files = await db.getAllFiles();
    assert.strictEqual(files.length, 1, "Should track 1 file");
    
    const trackedFile = files[0];
    assert.strictEqual(trackedFile.filePath, "Test.java");
    assert.ok(trackedFile.checksum, "Should have checksum");
    assert.ok(trackedFile.mtime > 0, "Should have mtime");
  });

  it("should not reprocess unchanged files", async () => {
    // Initialize
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    const filesBefore = await db.getAllFiles();
    const checksumBefore = filesBefore[0].checksum;

    // Update without changes
    await dryScan.updateIndex();

    // Verify checksum unchanged
    const filesAfter = await db.getAllFiles();
    assert.strictEqual(filesAfter[0].checksum, checksumBefore, "Checksum should not change");
  });

  it("should recompute dependencies for changed functions", async () => {
    // Create file with function calling another
    await fs.writeFile(
      path.join(testRepoPath, "Caller.java"),
      `package temp;\n\npublic class Caller {\n  public String caller() { return callee(); }\n  public String callee() { return "result"; }\n}`
    );

    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    let caller = functions.find(f => f.name.endsWith("caller"));
    
    // Verify initial dependency
    assert.ok(caller.callDependencies, "Should have internal functions");
    assert.ok(
      caller.callDependencies.some(f => f.name.endsWith("callee")),
      "Should call callee"
    );

    // Modify file - change called function name
    await fs.writeFile(
      path.join(testRepoPath, "Caller.java"),
      `package temp;\n\npublic class Caller {\n  public String caller() { return newCallee(); }\n  public String newCallee() { return "result"; }\n}`
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify dependency updated
    functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    caller = functions.find(f => f.name.endsWith("caller"));
    
    assert.ok(
      caller.callDependencies.some(f => f.name.endsWith("newCallee")),
      "Should now call newCallee"
    );
    assert.ok(
      !caller.callDependencies.some(f => f.name.endsWith("callee")),
      "Should not call callee anymore"
    );
  });

  it("should recompute embeddings for changed functions", async () => {
    // Initialize
    await dryScan.init();
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    let hello = functions.find(f => f.name.endsWith("hello"));
    const originalEmbedding = hello.embedding;
    
    assert.ok(originalEmbedding, "Should have embedding");
    assert.ok(originalEmbedding.length > 0, "Embedding should not be empty");

    // Modify function code significantly
    await fs.writeFile(
      path.join(testRepoPath, "Test.java"),
      `package temp;\n\npublic class Test {\n  public String hello() { return "completely different implementation with more code"; }\n  public String goodbye() { return "farewell"; }\n}`
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify embedding changed
    functions = (await db.getAllUnits()).filter(u => u.unitType === IndexUnitType.FUNCTION);
    hello = functions.find(f => f.name.endsWith("hello"));
    
    assert.ok(hello.embedding, "Should have new embedding");
    assert.notDeepStrictEqual(
      hello.embedding,
      originalEmbedding,
      "Embedding should be different"
    );
  });
});

describe("DryScanUpdater edge cases and errors", () => {
  let tempDir;
  let extractor;
  let db;
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dryscan-test-"));
    await writeConfig(tempDir, baseConfig());
    await configStore.init(tempDir);
    extractor = new IndexUnitExtractor(tempDir);
    db = {
      getAllFiles: async () => [],
      getAllUnits: async () => [],
      removeUnitsByFilePaths: async () => {},
      saveUnits: async () => {},
      updateUnits: async () => {},
      saveFiles: async () => {},
      removeFiles: async () => {},
    };
  });
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detectFileChanges handles missing tracked file", async () => {
    // Create a.js, b.js, c.js in tempDir
    await fs.writeFile(path.join(tempDir, "a.java"), "class A {}\n");
    await fs.writeFile(path.join(tempDir, "b.java"), "class B {}\n");
    await fs.writeFile(path.join(tempDir, "c.java"), "class C {}\n");
    // Only a.java and b.java are tracked
    const trackedFiles = [
      { filePath: "a.java", checksum: "old", mtime: 1 },
      { filePath: "b.java", checksum: "checksum", mtime: 2 },
    ];
    const result = await detectFileChanges(tempDir, extractor, { getAllFiles: async () => trackedFiles });
    assert.ok(result.added.includes("c.java"));
  });

  it("detectFileChanges handles changed and unchanged files", async () => {
    // Create a.js and b.js in tempDir
    await fs.writeFile(path.join(tempDir, "a.java"), "class A {}\n");
    await fs.writeFile(path.join(tempDir, "b.java"), "class B {}\n");
    // Tracked files: a.java (old checksum/mtime), b.java (current)
    const statA = await fs.stat(path.join(tempDir, "a.java"));
    const statB = await fs.stat(path.join(tempDir, "b.java"));
    const trackedFiles = [
      { filePath: "a.java", checksum: "old", mtime: statA.mtimeMs - 1000 },
      { filePath: "b.java", checksum: "checksum", mtime: statB.mtimeMs },
    ];
    const result = await detectFileChanges(tempDir, extractor, { getAllFiles: async () => trackedFiles });
    assert.ok(result.changed.includes("a.java"));
    assert.ok(result.unchanged.includes("b.java"));
  });

  it("performIncrementalUpdate propagates errors from extractor", async () => {
    const errorExtractor = { ...extractor, listSourceFiles: async () => { throw new Error("fail"); } };
    await assert.rejects(() => performIncrementalUpdate(tempDir, errorExtractor, db), /fail/);
  });

  it("performIncrementalUpdate handles no changes gracefully", async () => {
    // Create a.java in tempDir
    await fs.writeFile(path.join(tempDir, "a.java"), "class A {}\n");
    const statA = await fs.stat(path.join(tempDir, "a.java"));
    const dbWithTracked = { ...db, getAllFiles: async () => [{ filePath: "a.java", checksum: "checksum", mtime: statA.mtimeMs }] };
    await performIncrementalUpdate(tempDir, extractor, dbWithTracked); // Should not throw
  });
});
