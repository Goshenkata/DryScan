import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { IndexUnitExtractor, configStore } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test suite for IndexUnitExtractor file listing and checksum methods.
 */
describe("IndexUnitExtractor - File Management", () => {
  const testDir = path.join(__dirname, "temp-extractor-test");
  let extractor;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await configStore.init(testDir);
    extractor = new IndexUnitExtractor(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("listSourceFiles", () => {
    it("should list all supported source files in directory", async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, "file1.java"), "content");
      await fs.writeFile(path.join(testDir, "file2.java"), "content");
      await fs.writeFile(path.join(testDir, "file3.txt"), "content"); // unsupported
      
      await fs.mkdir(path.join(testDir, "subdir"), { recursive: true });
      await fs.writeFile(path.join(testDir, "subdir", "file4.java"), "content");

      const files = await extractor.listSourceFiles(testDir);
      
      // Sort for consistent comparison
      files.sort();

      assert.strictEqual(files.length, 3, "Should find 3 supported files");
      assert.ok(files.includes("file1.java"), "Should include file1.java");
      assert.ok(files.includes("file2.java"), "Should include file2.java");
      assert.ok(files.includes("subdir/file4.java"), "Should include nested file");
      assert.ok(!files.some(f => f.includes("file3.txt")), "Should not include unsupported file");
    });

    it("should return single file if path is a file", async () => {
      await fs.writeFile(path.join(testDir, "single.java"), "content");

      const files = await extractor.listSourceFiles("single.java");
      
      assert.strictEqual(files.length, 1, "Should return single file");
      assert.strictEqual(files[0], "single.java");
    });

    it("should return empty array for unsupported single file", async () => {
      await fs.writeFile(path.join(testDir, "unsupported.txt"), "content");

      const files = await extractor.listSourceFiles("unsupported.txt");
      
      assert.strictEqual(files.length, 0, "Should return empty array");
    });

    it("should handle empty directory", async () => {
      const emptyDir = path.join(testDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      const files = await extractor.listSourceFiles(emptyDir);
      
      assert.strictEqual(files.length, 0, "Should return empty array for empty directory");
    });

    it("should return relative paths from root", async () => {
      await fs.mkdir(path.join(testDir, "src", "components"), { recursive: true });
      await fs.writeFile(path.join(testDir, "src", "components", "App.java"), "content");

      const files = await extractor.listSourceFiles(testDir);
      
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0], "src/components/App.java", "Should use forward slashes and relative path");
    });
  });

  describe("computeChecksum", () => {
    it("should compute MD5 checksum of file content", async () => {
      const content = "function test() { return 'hello'; }";
      await fs.writeFile(path.join(testDir, "test.java"), content);

      const checksum = await extractor.computeChecksum("test.java");
      
      assert.ok(checksum, "Should return checksum");
      assert.strictEqual(typeof checksum, "string", "Checksum should be string");
      assert.strictEqual(checksum.length, 32, "MD5 checksum should be 32 chars");
    });

    it("should return same checksum for identical content", async () => {
      const content = "function test() { return 'hello'; }";
      await fs.writeFile(path.join(testDir, "test1.java"), content);
      await fs.writeFile(path.join(testDir, "test2.java"), content);

      const checksum1 = await extractor.computeChecksum("test1.java");
      const checksum2 = await extractor.computeChecksum("test2.java");
      
      assert.strictEqual(checksum1, checksum2, "Same content should produce same checksum");
    });

    it("should return different checksum for different content", async () => {
      await fs.writeFile(path.join(testDir, "test1.java"), "content1");
      await fs.writeFile(path.join(testDir, "test2.java"), "content2");

      const checksum1 = await extractor.computeChecksum("test1.java");
      const checksum2 = await extractor.computeChecksum("test2.java");
      
      assert.notStrictEqual(checksum1, checksum2, "Different content should produce different checksum");
    });

    it("should work with absolute paths", async () => {
      const content = "test content";
      const filePath = path.join(testDir, "test.java");
      await fs.writeFile(filePath, content);

      const checksum = await extractor.computeChecksum(filePath);
      
      assert.ok(checksum, "Should compute checksum from absolute path");
      assert.strictEqual(checksum.length, 32, "Should be valid MD5 checksum");
    });

    it("should detect even small content changes", async () => {
      await fs.writeFile(path.join(testDir, "test.java"), "hello world");
      const checksum1 = await extractor.computeChecksum("test.java");

      // Change single character
      await fs.writeFile(path.join(testDir, "test.java"), "hello World");
      const checksum2 = await extractor.computeChecksum("test.java");
      
      assert.notStrictEqual(checksum1, checksum2, "Should detect single character change");
    });
  });
});
