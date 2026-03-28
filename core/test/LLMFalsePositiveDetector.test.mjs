import { expect } from "chai";
import sinon from "sinon";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { LLMFalsePositiveDetector } from "../src/services/LLMFalsePositiveDetector.ts";
import { configStore } from "../src/config/configStore.ts";
import { IndexUnitType } from "../src/types.ts";

// ── helpers ────────────────────────────────────────────────────────────────

function makeGroup(leftId, rightId, leftFile = "A.java", rightFile = "B.java") {
  return {
    id: `${leftId}::${rightId}`,
    similarity: 0.92,
    shortId: "short1",
    exclusionString: "FUNCTION|fn1|fn2",
    left: {
      id: leftId,
      name: "fn1",
      filePath: leftFile,
      startLine: 1,
      endLine: 10,
      code: "void fn1() { return 1; }",
      unitType: IndexUnitType.FUNCTION,
    },
    right: {
      id: rightId,
      name: "fn2",
      filePath: rightFile,
      startLine: 20,
      endLine: 30,
      code: "void fn2() { return 1; }",
      unitType: IndexUnitType.FUNCTION,
    },
  };
}

function mockFetch(answer) {
  return sinon.stub(globalThis, "fetch").resolves({
    ok: true,
    json: async () => ({ message: { content: answer } }),
  });
}

function makeMockDb(cachedVerdicts = []) {
  return {
    getLLMVerdicts: sinon.stub().resolves(cachedVerdicts),
    saveLLMVerdicts: sinon.stub().resolves(),
    removeLLMVerdictsByFilePaths: sinon.stub().resolves(),
  };
}

// ── suite ──────────────────────────────────────────────────────────────────

describe("LLMFalsePositiveDetector", function () {
  this.timeout(8000);

  let testDir;
  let detector;
  let mockDb;

  beforeEach(async () => {
    sinon.restore();

    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "dryscan-llm-test-"));

    // Stub configStore so detector doesn't need a real dryconfig.json
    sinon.stub(configStore, "get").resolves({
      embeddingSource: "http://localhost:11434",
      enableLLMFilter: true,
    });

    // Stub fs.readFile so prompt building doesn't hit disk
    sinon.stub(fs, "readFile").resolves("class Stub {}");

    mockDb = makeMockDb();
    detector = new LLMFalsePositiveDetector(testDir, mockDb);
  });

  afterEach(async () => {
    sinon.restore();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ── classify: empty input ────────────────────────────────────────────────

  it("returns empty arrays when candidates list is empty", async () => {
    const result = await detector.classify([], []);
    expect(result.truePositives).to.be.an("array").that.is.empty;
    expect(result.falsePositives).to.be.an("array").that.is.empty;
  });

  // ── classify: LLM verdicts ───────────────────────────────────────────────

  it("classifies pair as true positive when LLM responds 'yes'", async () => {
    mockFetch("yes");
    const group = makeGroup("u1", "u2");
    const { truePositives, falsePositives } = await detector.classify([group], []);
    expect(truePositives).to.have.length(1);
    expect(falsePositives).to.have.length(0);
  });

  it("classifies pair as false positive when LLM responds 'no'", async () => {
    mockFetch("no");
    const group = makeGroup("u1", "u2");
    const { truePositives, falsePositives } = await detector.classify([group], []);
    expect(truePositives).to.have.length(0);
    expect(falsePositives).to.have.length(1);
  });

  it("is case-insensitive: 'YES' → true positive, 'NO' → false positive", async () => {
    const fetchStub = sinon.stub(globalThis, "fetch");
    fetchStub.onFirstCall().resolves({ ok: true, json: async () => ({ message: { content: "YES" } }) });
    fetchStub.onSecondCall().resolves({ ok: true, json: async () => ({ message: { content: "NO" } }) });

    const groups = [makeGroup("a1", "a2", "A.java", "B.java"), makeGroup("b1", "b2", "C.java", "D.java")];
    const { truePositives, falsePositives } = await detector.classify(groups, []);
    expect(truePositives).to.have.length(1);
    expect(falsePositives).to.have.length(1);
  });

  it("defaults to true positive (keep) when LLM HTTP call fails", async () => {
    sinon.stub(globalThis, "fetch").rejects(new Error("connection refused"));
    const group = makeGroup("u1", "u2");
    const { truePositives, falsePositives } = await detector.classify([group], []);
    expect(truePositives).to.have.length(1);
    expect(falsePositives).to.have.length(0);
  });

  it("defaults to true positive when LLM returns a non-OK HTTP status", async () => {
    sinon.stub(globalThis, "fetch").resolves({ ok: false, status: 503 });
    const group = makeGroup("u1", "u2");
    const { truePositives } = await detector.classify([group], []);
    expect(truePositives).to.have.length(1);
  });

  // ── caching: cache hit ───────────────────────────────────────────────────

  it("uses cached verdict and does not call LLM when pair is clean", async () => {
    const fetchStub = mockFetch("yes"); // should never be called
    const group = makeGroup("u1", "u2", "A.java", "B.java");
    const cachedVerdict = {
      pairKey: detector.pairKey(group),
      verdict: "no",
      leftFilePath: "A.java",
      rightFilePath: "B.java",
      createdAt: Date.now(),
    };
    mockDb.getLLMVerdicts.resolves([cachedVerdict]);

    const { truePositives, falsePositives } = await detector.classify([group], []);
    expect(falsePositives).to.have.length(1); // cached "no"
    expect(truePositives).to.have.length(0);
    expect(fetchStub.called).to.equal(false);
  });

  it("persists new verdicts to the database", async () => {
    mockFetch("yes");
    const group = makeGroup("u1", "u2");
    await detector.classify([group], []);
    expect(mockDb.saveLLMVerdicts.calledOnce).to.equal(true);
    const saved = mockDb.saveLLMVerdicts.firstCall.args[0];
    expect(saved).to.have.length(1);
    expect(saved[0].verdict).to.equal("yes");
    expect(saved[0].pairKey).to.equal(detector.pairKey(group));
  });

  // ── caching: dirty-path invalidation ────────────────────────────────────

  it("bypasses cache and calls LLM when a pair's left file is dirty", async () => {
    const fetchStub = mockFetch("yes");
    const group = makeGroup("u1", "u2", "Dirty.java", "Clean.java");
    const cachedVerdict = {
      pairKey: detector.pairKey(group),
      verdict: "no",
      leftFilePath: "Dirty.java",
      rightFilePath: "Clean.java",
      createdAt: Date.now(),
    };
    mockDb.getLLMVerdicts.resolves([cachedVerdict]);

    const { truePositives } = await detector.classify([group], ["Dirty.java"]);
    expect(fetchStub.calledOnce).to.equal(true); // cache bypassed
    expect(truePositives).to.have.length(1);
  });

  it("bypasses cache and calls LLM when a pair's right file is dirty", async () => {
    const fetchStub = mockFetch("no");
    const group = makeGroup("u1", "u2", "Clean.java", "Dirty.java");
    const cachedVerdict = {
      pairKey: detector.pairKey(group),
      verdict: "yes",
      leftFilePath: "Clean.java",
      rightFilePath: "Dirty.java",
      createdAt: Date.now(),
    };
    mockDb.getLLMVerdicts.resolves([cachedVerdict]);

    const { falsePositives } = await detector.classify([group], ["Dirty.java"]);
    expect(fetchStub.calledOnce).to.equal(true); // cache bypassed
    expect(falsePositives).to.have.length(1);
  });

  // ── concurrency batching ─────────────────────────────────────────────────

  it("processes more than 20 candidates in batches without losing results", async () => {
    // 25 groups; all uncached; LLM returns "yes" for even indices, "no" for odd
    const fetchStub = sinon.stub(globalThis, "fetch");
    for (let i = 0; i < 25; i++) {
      const answer = i % 2 === 0 ? "yes" : "no";
      fetchStub.onCall(i).resolves({ ok: true, json: async () => ({ message: { content: answer } }) });
    }

    const groups = Array.from({ length: 25 }, (_, i) =>
      makeGroup(`l${i}`, `r${i}`, `File${i}A.java`, `File${i}B.java`)
    );

    const { truePositives, falsePositives } = await detector.classify(groups, []);
    expect(truePositives.length + falsePositives.length).to.equal(25);
    expect(truePositives).to.have.length(13); // indices 0,2,4,...,24
    expect(falsePositives).to.have.length(12); // indices 1,3,5,...,23
    expect(fetchStub.callCount).to.equal(25);
  });

  // ── prompt content ───────────────────────────────────────────────────────

  it("includes both snippet IDs and code in the LLM prompt", async () => {
    let capturedPrompt = "";
    sinon.stub(globalThis, "fetch").callsFake(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      capturedPrompt = body.messages[0].content;
      return { ok: true, json: async () => ({ message: { content: "yes" } }) };
    });

    const group = makeGroup("unit-left-id", "unit-right-id");
    await detector.classify([group], []);

    expect(capturedPrompt).to.include("unit-left-id");
    expect(capturedPrompt).to.include("unit-right-id");
    expect(capturedPrompt).to.include("fn1");
    expect(capturedPrompt).to.include("fn2");
    expect(capturedPrompt).to.include("Answer:");
  });

  it("uses temperature 0 and num_predict 32 in the LLM request", async () => {
    let capturedBody = null;
    sinon.stub(globalThis, "fetch").callsFake(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ message: { content: "yes" } }) };
    });

    await detector.classify([makeGroup("u1", "u2")], []);

    expect(capturedBody.options.temperature).to.equal(0);
    expect(capturedBody.options.num_predict).to.equal(32);
    expect(capturedBody.stream).to.equal(false);
  });

  // ── pairKey stability ────────────────────────────────────────────────────

  it("pairKey is order-independent (same key regardless of left/right swap)", () => {
    const g1 = makeGroup("alpha", "beta");
    const g2 = makeGroup("beta", "alpha");
    expect(detector.pairKey(g1)).to.equal(detector.pairKey(g2));
  });
});
