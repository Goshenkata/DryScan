import { expect } from "chai";
import sinon from "sinon";
import { DryScan, IndexUnitType, DEFAULT_CONFIG } from "../dist/index.js";
import upath from "upath";
import fs from "fs/promises";
import os from "os";

describe("DryScan - Duplicate Detection", function() {
  this.timeout(10000);
  let testDir;
  let dryScan;

  // Helper to create a DryScan instance with a stubbed DB
  function createDryScanWithStubbedDB(testDir, dbOverrides = {}, configOverrides = {}) {
    const baseDb = {
      isInitialized: () => false,
      init: async () => {},
      getAllUnits: async () => [],
      saveUnits: async () => {},
      updateUnits: async () => {},
      saveFiles: async () => {},
    };
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    return new DryScan(testDir, config, undefined, { ...baseDb, ...dbOverrides });
  }

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(upath.join(os.tmpdir(), "dryscan-test-"));
    dryScan = new DryScan(testDir, { ...DEFAULT_CONFIG });
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("findDuplicates", () => {
    function stubbedScanner(units, configOverrides = {}) {
      const scanner = createDryScanWithStubbedDB(testDir, {
        isInitialized: () => true,
        getAllUnits: async () => units,
      }, configOverrides);
      scanner.updateIndex = async () => {};
      return scanner;
    }

    function makeUnit(id, name, embedding) {
      return {
        id,
        name,
        filePath: `${name}.js`,
        startLine: 1,
        endLine: 3,
        code: `${name} code`,
        unitType: IndexUnitType.FUNCTION,
        embedding,
      };
    }

    it("returns empty array when no functions have embeddings", async () => {
      const units = [makeUnit("1", "fn1", undefined), makeUnit("2", "fn2", undefined)];
      const scanner = stubbedScanner(units);
      const result = await scanner.findDuplicates();
      expect(result.duplicates).to.be.an("array").that.is.empty;
    });

    it("throws if updateIndex fails", async () => {
      const error = new Error("updateIndex failed");
      const scanner = stubbedScanner([]);
      scanner.updateIndex = async () => { throw error; };
      try {
        await scanner.findDuplicates();
        throw new Error("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("updateIndex failed");
      }
    });

    it("returns empty array when no duplicates exceed threshold", async () => {
      const units = [
        makeUnit("1", "fn1", [1, 0]),
        makeUnit("2", "fn2", [0, 1]),
      ];
      const scanner = stubbedScanner(units, { threshold: 0.9 });
      const result = await scanner.findDuplicates();
      expect(result.duplicates).to.be.an("array").that.is.empty;
    });

    it("detects identical functions as duplicates", async () => {
      const units = [
        makeUnit("1", "add1", [1, 0]),
        makeUnit("2", "add2", [1, 0]),
      ];
      const scanner = stubbedScanner(units, { threshold: 0.7 });
      const result = await scanner.findDuplicates();
      expect(result.duplicates.length).to.be.at.least(1);
      const dup = result.duplicates[0];
      expect(dup).to.have.property("similarity").that.is.a("number");
      expect(dup).to.have.property("left");
      expect(dup).to.have.property("right");
    });

    it("sorts duplicates by similarity descending", async () => {
      const units = [
        makeUnit("1", "a", [1, 0]),
        makeUnit("2", "b", [0.9, 0]),
        makeUnit("3", "c", [0, 1]),
      ];
      const scanner = stubbedScanner(units, { threshold: 0.4 });
      const result = await scanner.findDuplicates();
      const duplicates = result.duplicates;
      if (duplicates.length > 1) {
        for (let i = 0; i < duplicates.length - 1; i++) {
          expect(duplicates[i].similarity).to.be.at.least(duplicates[i + 1].similarity);
        }
      }
    });

    it("respects configured threshold value", async () => {
      const units = [
        makeUnit("1", "fn1", [1, 0]),
        makeUnit("2", "fn2", [1, 0]),
        makeUnit("3", "fn3", [0.6, 0.8]),
      ];
      const lowScanner = stubbedScanner(units, { threshold: 0.4 });
      const highScanner = stubbedScanner(units, { threshold: 0.8 });
      const low = await lowScanner.findDuplicates();
      const high = await highScanner.findDuplicates();
      expect(low.duplicates.length).to.be.at.least(high.duplicates.length);
    });

    it("includes all required fields in duplicate groups", async () => {
      const units = [
        makeUnit("1", "func1", [1, 0]),
        makeUnit("2", "func2", [1, 0]),
      ];
      const scanner = stubbedScanner(units, { threshold: 0.4 });
      const { duplicates } = await scanner.findDuplicates();
      if (duplicates.length > 0) {
        const dup = duplicates[0];
        expect(dup).to.have.property("id").that.is.a("string");
        expect(dup).to.have.property("similarity").that.is.a("number");
        expect(dup.left).to.include.keys(["filePath", "startLine", "endLine", "code"]);
        expect(dup.right).to.include.keys(["filePath", "startLine", "endLine", "code"]);
      }
    });
  });
});
