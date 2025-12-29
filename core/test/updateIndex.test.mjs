import sinon from "sinon";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { DryScan, DryScanDatabase, detectFileChanges, performIncrementalUpdate, IndexUnitExtractor, DEFAULT_CONFIG } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseConfig = () => ({ ...DEFAULT_CONFIG });

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
      path.join(testRepoPath, "test.js"),
      `function hello() { return "world"; }\nfunction goodbye() { return "farewell"; }`
    );

    dryScan = new DryScan(testRepoPath, baseConfig());
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
    
    let functions = await db.getAllUnits();
    assert.strictEqual(functions.length, 2, "Should have 2 initial units");

    // Add a new file
    await fs.writeFile(
      path.join(testRepoPath, "new.js"),
      `function newFunc() { return "new"; }`
    );

    // Update index
    await dryScan.updateIndex();

    // Verify new function added
    functions = await db.getAllUnits();
    assert.strictEqual(functions.length, 3, "Should have 3 units after adding new file");
    
    const newFunc = functions.find(f => f.name === "newFunc");
    assert.ok(newFunc, "Should find newFunc");
    assert.strictEqual(newFunc.filePath, "new.js");
  });

  it("should detect and process changed files", async () => {
    // Initialize
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = await db.getAllUnits();
    const originalCount = functions.length;
    assert.strictEqual(originalCount, 2, "Should have 2 initial functions");

    // Modify file - add a new function
    await fs.writeFile(
      path.join(testRepoPath, "test.js"),
      `function hello() { return "world"; }\nfunction goodbye() { return "farewell"; }\nfunction added() { return "added"; }`
    );

    // Small delay to ensure mtime changes
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify function added
    functions = await db.getAllUnits();
    assert.strictEqual(functions.length, 3, "Should have 3 units after change");
    
    const addedFunc = functions.find(f => f.name === "added");
    assert.ok(addedFunc, "Should find added function");
  });

  it("should detect and remove deleted files", async () => {
    // Initialize with two files
    await fs.writeFile(
      path.join(testRepoPath, "temp.js"),
      `function temp() { return "temporary"; }`
    );
    
    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = await db.getAllUnits();
    assert.strictEqual(functions.length, 3, "Should have 3 initial units");

    // Delete one file
    await fs.unlink(path.join(testRepoPath, "temp.js"));

    // Update index
    await dryScan.updateIndex();

    // Verify function removed
    functions = await db.getAllUnits();
    assert.strictEqual(functions.length, 2, "Should have 2 units after deletion");
    
    const tempFunc = functions.find(f => f.name === "temp");
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
    assert.strictEqual(trackedFile.filePath, "test.js");
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
      path.join(testRepoPath, "caller.js"),
      `function caller() { return callee(); }\nfunction callee() { return "result"; }`
    );

    await dryScan.init({ skipEmbeddings: true });
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = await db.getAllUnits();
    let caller = functions.find(f => f.name === "caller");
    
    // Verify initial dependency
    assert.ok(caller.callDependencies, "Should have internal functions");
    assert.ok(
      caller.callDependencies.some(f => f.name === "callee"),
      "Should call callee"
    );

    // Modify file - change called function name
    await fs.writeFile(
      path.join(testRepoPath, "caller.js"),
      `function caller() { return newCallee(); }\nfunction newCallee() { return "result"; }`
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify dependency updated
    functions = await db.getAllUnits();
    caller = functions.find(f => f.name === "caller");
    
    assert.ok(
      caller.callDependencies.some(f => f.name === "newCallee"),
      "Should now call newCallee"
    );
    assert.ok(
      !caller.callDependencies.some(f => f.name === "callee"),
      "Should not call callee anymore"
    );
  });

  it("should recompute embeddings for changed functions", async () => {
    // Initialize
    await dryScan.init();
    
    const dbPath = path.join(dryDir, "index.db");
    await db.init(dbPath);
    
    let functions = await db.getAllUnits();
    let hello = functions.find(f => f.name === "hello");
    const originalEmbedding = hello.embedding;
    
    assert.ok(originalEmbedding, "Should have embedding");
    assert.ok(originalEmbedding.length > 0, "Embedding should not be empty");

    // Modify function code significantly
    await fs.writeFile(
      path.join(testRepoPath, "test.js"),
      `function hello() { return "completely different implementation with more code"; }\nfunction goodbye() { return "farewell"; }`
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Update index
    await dryScan.updateIndex();

    // Verify embedding changed
    functions = await db.getAllUnits();
    hello = functions.find(f => f.name === "hello");
    
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
    extractor = new IndexUnitExtractor(tempDir, baseConfig());
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
    await fs.writeFile(path.join(tempDir, "a.js"), "function a(){}\n");
    await fs.writeFile(path.join(tempDir, "b.js"), "function b(){}\n");
    await fs.writeFile(path.join(tempDir, "c.js"), "function c(){}\n");
    // Only a.js and b.js are tracked
    const trackedFiles = [
      { filePath: "a.js", checksum: "old", mtime: 1 },
      { filePath: "b.js", checksum: "checksum", mtime: 2 },
    ];
    const result = await detectFileChanges(tempDir, extractor, { getAllFiles: async () => trackedFiles });
    assert.ok(result.added.includes("c.js"));
  });

  it("detectFileChanges handles changed and unchanged files", async () => {
    // Create a.js and b.js in tempDir
    await fs.writeFile(path.join(tempDir, "a.js"), "function a(){}\n");
    await fs.writeFile(path.join(tempDir, "b.js"), "function b(){}\n");
    // Tracked files: a.js (old checksum/mtime), b.js (current)
    const statA = await fs.stat(path.join(tempDir, "a.js"));
    const statB = await fs.stat(path.join(tempDir, "b.js"));
    const trackedFiles = [
      { filePath: "a.js", checksum: "old", mtime: statA.mtimeMs - 1000 },
      { filePath: "b.js", checksum: "checksum", mtime: statB.mtimeMs },
    ];
    const result = await detectFileChanges(tempDir, extractor, { getAllFiles: async () => trackedFiles });
    assert.ok(result.changed.includes("a.js"));
    assert.ok(result.unchanged.includes("b.js"));
  });

  it("performIncrementalUpdate propagates errors from extractor", async () => {
    const errorExtractor = { ...extractor, listSourceFiles: async () => { throw new Error("fail"); } };
    await assert.rejects(() => performIncrementalUpdate(tempDir, errorExtractor, db), /fail/);
  });

  it("performIncrementalUpdate handles no changes gracefully", async () => {
    // Create a.js in tempDir
    await fs.writeFile(path.join(tempDir, "a.js"), "function a(){}\n");
    const statA = await fs.stat(path.join(tempDir, "a.js"));
    const dbWithTracked = { ...db, getAllFiles: async () => [{ filePath: "a.js", checksum: "checksum", mtime: statA.mtimeMs }] };
    await performIncrementalUpdate(tempDir, extractor, dbWithTracked); // Should not throw
  });
});
