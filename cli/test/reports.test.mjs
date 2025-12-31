import { expect } from "chai";
import fs from "fs/promises";
import os from "os";
import { join } from "path";
import { loadDryConfig, IndexUnitType } from "@dryscan/core";
import {
  writeDuplicateReport,
  loadLatestReport,
  applyExclusionFromLatestReport,
} from "../src/reports.ts";

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

function makeReport() {
  const left = makeSide("Foo", "src/foo.js");
  const right = makeSide("Bar", "src/bar.js");
  const exclusionString = "function|Foo|Bar";
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    threshold: 0.85,
    score: {
      score: 10,
      grade: "Good",
      totalLines: 100,
      duplicateLines: 10,
      duplicateGroups: 1,
    },
    duplicates: [
      {
        id: "g1",
        similarity: 0.92,
        left,
        right,
        shortId: "abc123",
        exclusionString,
      },
    ],
  };
}

describe("CLI duplicate reports", function () {
  this.timeout(5000);
  let repoPath;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(join(os.tmpdir(), "dryscan-cli-report-test-"));
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("returns null when no reports exist", async () => {
    const latest = await loadLatestReport(repoPath);
    expect(latest).to.be.null;
  });

  it("writes and reloads the latest report", async () => {
    const report = makeReport();

    const path = await writeDuplicateReport(repoPath, report);
    const stat = await fs.stat(path);
    expect(stat.isFile()).to.be.true;

    const latest = await loadLatestReport(repoPath);
    expect(latest).to.not.be.null;
    expect(latest.threshold).to.equal(report.threshold);
    expect(latest.duplicates[0].shortId).to.equal(report.duplicates[0].shortId);
  });

  it("applies exclusions from the latest report", async () => {
    const report = makeReport();

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
