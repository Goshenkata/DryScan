
import { expect } from "chai";
import { DryScanDatabase } from "../dist/index.js";

describe("DryScanDatabase - Error Handling", () => {
  let db;
  beforeEach(() => {
    db = new DryScanDatabase();
  });

  it("throws if saveUnits called before init", async () => {
    try {
      await db.saveUnits([]);
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if updateUnits called before init", async () => {
    try {
      await db.updateUnits([]);
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.message).to.include("Database not initialized");
    }
  });

  it("throws if getAllUnits called before init", async () => {
    try {
      await db.getAllUnits();
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
