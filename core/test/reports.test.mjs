import { expect } from "chai";
import fs from "fs/promises";
import os from "os";
import upath from "upath";
import {
  buildDuplicateReport,
  writeDuplicateReport,
  loadLatestReport,
  applyExclusionFromLatestReport,
  pairKeyForUnits,
  loadDryConfig,
  IndexUnitType,
} from "../dist/index.js";

function makeSide(name, filePath) {
  return {
    name,
    filePath,
    startLine: 1,
    endLine: 3,
    code: `function ${name}(arg) { return arg; }`,
    unitType: IndexUnitType.FUNCTION,
  };
}

function makeGroup() {
  const left = makeSide("Foo", "src/foo.js");
  const right = makeSide("Bar", "src/bar.js");
  return {
    id: "g1",
    similarity: 0.92,
    left,
    right,
  };
}

describe("Duplicate reports", function () {
  this.timeout(5000);
  let repoPath;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(upath.join(os.tmpdir(), "dryscan-report-test-"));
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("enriches duplicates with ids and exclusion strings", () => {
    const group = makeGroup();
    const report = buildDuplicateReport([group], 0.85, {
      score: 10,
      grade: "Good",
      totalLines: 100,
      duplicateLines: 10,
      duplicateGroups: 1,
    });

    expect(report.duplicates).to.have.length(1);
    const enriched = report.duplicates[0];
    const expectedKey = pairKeyForUnits(enriched.left, enriched.right);
    expect(enriched.shortId).to.be.a("string").that.is.not.empty;
    expect(enriched.exclusionString).to.equal(expectedKey);
  });

  it("writes and reloads the latest report", async () => {
    const report = buildDuplicateReport([makeGroup()], 0.9, {
      score: 12,
      grade: "Fair",
      totalLines: 200,
      duplicateLines: 24,
      duplicateGroups: 1,
    });

    const path = await writeDuplicateReport(repoPath, report);
    const stat = await fs.stat(path);
    expect(stat.isFile()).to.be.true;

    const latest = await loadLatestReport(repoPath);
    expect(latest).to.not.be.null;
    expect(latest.threshold).to.equal(report.threshold);
    expect(latest.duplicates[0].shortId).to.equal(report.duplicates[0].shortId);
  });

  it("applies exclusions from the latest report", async () => {
    const report = buildDuplicateReport([makeGroup()], 0.8, {
      score: 5,
      grade: "Excellent",
      totalLines: 50,
      duplicateLines: 5,
      duplicateGroups: 1,
    });

    await writeDuplicateReport(repoPath, report);
    const target = report.duplicates[0];
    const result = await applyExclusionFromLatestReport(repoPath, target.shortId);
    expect(result.exclusion).to.equal(target.exclusionString);
    expect(result.added).to.be.true;

    const config = await loadDryConfig(repoPath);
    expect(config.excludedPairs).to.include(target.exclusionString);

    const second = await applyExclusionFromLatestReport(repoPath, target.shortId);
    expect(second.added).to.be.false;
  });
});
