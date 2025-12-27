
import { expect } from "chai";
import { DryScanDatabase } from "../dist/index.js";

describe("DryScanDatabase - Error Handling", () => {
  let db;
  beforeEach(() => {
    db = new DryScanDatabase();
  });

  it("throws if saveFunctions called before init", async () => {
    try {
      await db.saveFunctions([]);
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if updateFunctions called before init", async () => {
    try {
      await db.updateFunctions([]);
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if getAllFunctions called before init", async () => {
    try {
      await db.getAllFunctions();
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if saveFiles called before init", async () => {
    try {
      await db.saveFiles([]);
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if getAllFiles called before init", async () => {
    try {
      await db.getAllFiles();
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });
});
