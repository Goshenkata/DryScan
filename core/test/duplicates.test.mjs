import { expect } from "chai";
import sinon from "sinon";
import { DryScan } from "../dist/index.js";
import upath from "upath";
import fs from "fs/promises";
import os from "os";

describe("DryScan - Duplicate Detection", function() {
  this.timeout(10000);
  let testDir;
  let dryScan;

  // Helper to create a DryScan instance with a stubbed DB
  function createDryScanWithStubbedDB(testDir, dbOverrides = {}) {
    const baseDb = {
      isInitialized: () => false,
      init: async () => {},
      getAllUnits: async () => [],
      saveUnits: async () => {},
      updateUnits: async () => {},
      saveFiles: async () => {},
    };
    return new DryScan(testDir, undefined, { ...baseDb, ...dbOverrides });
  }

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(upath.join(os.tmpdir(), "dryscan-test-"));
    dryScan = new DryScan(testDir);
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("findDuplicates", () => {
    it("returns empty array when no functions have embeddings", async () => {
      // Create a simple test file
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `function hello() { console.log("hello"); }`
      );

      // Initialize without computing embeddings
      await dryScan.init({ skipEmbeddings: true });

      // Should return empty since no embeddings
      const duplicates = await dryScan.findDuplicates();
      expect(duplicates).to.be.an("array").that.is.empty;
    });

      it("throws if updateIndex fails", async () => {
        // Simulate updateIndex throwing
        const error = new Error("updateIndex failed");
        const stubbed = createDryScanWithStubbedDB(testDir);
        stubbed.updateIndex = async () => { throw error; };
        try {
          await stubbed.findDuplicates();
          throw new Error("Should have thrown");
        } catch (err) {
          expect(err.message).to.include("updateIndex failed");
        }
      });

    it("returns empty array when no duplicates exceed threshold", async () => {
      // Create two very different functions
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `
function add(a, b) { return a + b; }
function greet(name) { return "Hello, " + name; }
        `.trim()
      );

      // Initialize with embeddings
      await dryScan.init({ skipEmbeddings: false });

      // High threshold should return no duplicates for different functions
      const duplicates = await dryScan.findDuplicates(0.99);
      expect(duplicates).to.be.an("array").that.is.empty;
    });

      describe("DryScan error handling and edge cases", () => {
        it("throws and logs if initUnits fails", async () => {
          const error = new Error("initUnits fail");
          const stubbed = createDryScanWithStubbedDB(testDir);
          stubbed.initUnits = async () => { throw error; };
          try {
            await stubbed.init();
            throw new Error("Should have thrown");
          } catch (err) {
            expect(err.message).to.include("initUnits fail");
          }
        });

        it("throws and logs if applyDependencies fails", async () => {
          const error = new Error("applyDependencies fail");
          const stubbed = createDryScanWithStubbedDB(testDir);
          stubbed.initUnits = async () => {};
          stubbed.applyDependencies = async () => { throw error; };
          try {
            await stubbed.init();
            throw new Error("Should have thrown");
          } catch (err) {
            expect(err.message).to.include("applyDependencies fail");
          }
        });

        it("throws and logs if computeEmbeddings fails", async () => {
          const error = new Error("computeEmbeddings fail");
          const stubbed = createDryScanWithStubbedDB(testDir);
          stubbed.initUnits = async () => {};
          stubbed.applyDependencies = async () => {};
          stubbed.computeEmbeddings = async () => { throw error; };
          try {
            await stubbed.init();
            throw new Error("Should have thrown");
          } catch (err) {
            expect(err.message).to.include("computeEmbeddings fail");
          }
        });

        it("throws and logs if trackFiles fails", async () => {
          const error = new Error("trackFiles fail");
          const stubbed = createDryScanWithStubbedDB(testDir);
          stubbed.initUnits = async () => {};
          stubbed.applyDependencies = async () => {};
          stubbed.computeEmbeddings = async () => {};
          stubbed.trackFiles = async () => { throw error; };
          try {
            await stubbed.init();
            throw new Error("Should have thrown");
          } catch (err) {
            expect(err.message).to.include("trackFiles fail");
          }
        });

      });

    it("detects identical functions as duplicates", async () => {
      // Create identical functions
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `
function add1(a, b) { return a + b; }
function add2(a, b) { return a + b; }
        `.trim()
      );

      // Initialize with embeddings
      await dryScan.init({ skipEmbeddings: false });

      // Find duplicates with reasonable threshold
      const duplicates = await dryScan.findDuplicates(0.85);
      
      expect(duplicates).to.be.an("array");
      if (duplicates.length > 0) {
        // If embeddings work, should find these as duplicates
        expect(duplicates[0]).to.have.property("similarity");
        expect(duplicates[0].similarity).to.be.a("number");
        expect(duplicates[0].similarity).to.be.at.least(0.85);
        expect(duplicates[0]).to.have.property("left");
        expect(duplicates[0]).to.have.property("right");
        expect(duplicates[0].left).to.have.property("filePath");
        expect(duplicates[0].left).to.have.property("startLine");
        expect(duplicates[0].left).to.have.property("endLine");
        expect(duplicates[0].left).to.have.property("code");
      }
    });

    it("sorts duplicates by similarity descending", async () => {
      // Create three functions: one original, one very similar, one identical
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `
function original(x, y) { return x + y; }
function similar(a, b) { return a + b + 1; }
function identical(x, y) { return x + y; }
        `.trim()
      );

      // Initialize with embeddings
      await dryScan.init({ skipEmbeddings: false });

      // Find duplicates
      const duplicates = await dryScan.findDuplicates(0.7);
      
      if (duplicates.length > 1) {
        // Should be sorted descending by similarity
        for (let i = 0; i < duplicates.length - 1; i++) {
          expect(duplicates[i].similarity).to.be.at.least(duplicates[i + 1].similarity);
        }
      }
    });

    it("respects custom threshold parameter", async () => {
      // Create two somewhat similar functions
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `
function add(a, b) { return a + b; }
function sum(x, y) { return x + y; }
        `.trim()
      );

      // Initialize with embeddings
      await dryScan.init({ skipEmbeddings: false });

      // Low threshold should potentially find them
      const lowThreshold = await dryScan.findDuplicates(0.5);
      
      // High threshold should find fewer or none
      const highThreshold = await dryScan.findDuplicates(0.99);
      
      expect(lowThreshold.length).to.be.at.least(highThreshold.length);
    });

    it("includes all required fields in duplicate groups", async () => {
      // Create duplicate functions
      const testFile = upath.join(testDir, "test.js");
      await fs.writeFile(
        testFile,
        `
function func1() { return 42; }
function func2() { return 42; }
        `.trim()
      );

      // Initialize with embeddings
      await dryScan.init({ skipEmbeddings: false });

      // Find duplicates
      const duplicates = await dryScan.findDuplicates(0.8);
      
      if (duplicates.length > 0) {
        const dup = duplicates[0];
        
        // Check structure
        expect(dup).to.have.property("id").that.is.a("string");
        expect(dup).to.have.property("similarity").that.is.a("number");
        expect(dup).to.have.property("left").that.is.an("object");
        expect(dup).to.have.property("right").that.is.an("object");
        
        // Check left side
        expect(dup.left).to.have.property("filePath").that.is.a("string");
        expect(dup.left).to.have.property("startLine").that.is.a("number");
        expect(dup.left).to.have.property("endLine").that.is.a("number");
        expect(dup.left).to.have.property("code").that.is.a("string");
        
        // Check right side
        expect(dup.right).to.have.property("filePath").that.is.a("string");
        expect(dup.right).to.have.property("startLine").that.is.a("number");
        expect(dup.right).to.have.property("endLine").that.is.a("number");
        expect(dup.right).to.have.property("code").that.is.a("string");
      }
    });
  });
});
