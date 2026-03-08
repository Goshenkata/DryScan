import { expect } from "chai";
import { DuplicateService } from "../src/services/DuplicateService.ts";
import { DuplicationCache } from "../src/services/DuplicationCache.ts";
import { IndexUnitType } from "../src/types.ts";
import { DEFAULT_CONFIG } from "../src/config/dryconfig.ts";

const pairingStub = {
  pairKeyForUnits: () => "function|a|b",
  parsePairKey: (key) => ({ type: IndexUnitType.FUNCTION, left: "a", right: "b", key }),
  pairKeyMatches: () => true,
};

const makeUnit = (id, filePath, embedding) => ({
  id,
  name: id,
  filePath,
  startLine: 1,
  endLine: 5,
  code: `${id} code() {}`,
  unitType: IndexUnitType.FUNCTION,
  embedding,
});

describe("DuplicationCache", () => {
  let cache;
  let units;
  let service;

  const config = { ...DEFAULT_CONFIG, threshold: 0.8 };

  beforeEach(() => {
    cache = DuplicationCache.getInstance();
    cache.clear();
    units = [
      makeUnit("A", "fileA.js", [1, 0]),
      makeUnit("B", "fileB.js", [1, 0]),
    ];

    const deps = {
      repoPath: "/repo",
      db: { getAllUnits: async () => units },
      extractor: {},
      pairing: pairingStub,
    };

    service = new DuplicateService(deps);
  });

  it("reuses cached similarity when embeddings are missing", async () => {
    const first = await service.findDuplicates(config);
    expect(first.duplicates).to.have.lengthOf(1);
    const initialSimilarity = first.duplicates[0].similarity;

    // Remove embeddings; without cache this would drop similarity to 0.
    units = units.map((u) => ({ ...u, embedding: null }));

    // Allow the async cache update to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await service.findDuplicates(config);
    expect(second.duplicates).to.have.lengthOf(1);
    expect(second.duplicates[0].similarity).to.equal(initialSimilarity);
  });

  it("invalidates cached comparisons for changed files", async () => {
    const first = await service.findDuplicates(config);
    expect(first.duplicates).to.have.lengthOf(1);

    // Allow cache to persist the result.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await cache.invalidate(["fileA.js"]);

    // Remove embeddings so fresh computation would fail if cache is gone.
    units = units.map((u) => ({ ...u, embedding: null }));

    const next = await service.findDuplicates(config);
    expect(next.duplicates).to.have.lengthOf(0);
  });

  describe("incremental dirty×all matrix", () => {
    // Three units: A (clean), B (clean), C (dirty/new).
    // After first run, A×B similarity is in the matrix.
    // On a second run with only C dirty, the cache must:
    //   - reuse A×B without recomputing
    //   - compute A×C and B×C (dirty rows)
    // We verify this by mutating C's embedding after the first run and
    // checking that A×B similarity is still intact while A×C reflects the new value.

    let serviceABC;
    let unitA, unitB, unitC;

    beforeEach(() => {
      cache.clear();

      unitA = makeUnit("A", "fileA.js", [1, 0]);
      unitB = makeUnit("B", "fileB.js", [1, 0]);  // identical to A → high similarity
      unitC = makeUnit("C", "fileC.js", [0, 1]);  // orthogonal to A/B → low similarity

      const allUnits = [unitA, unitB, unitC];
      const deps = {
        repoPath: "/repo",
        db: { getAllUnits: async () => allUnits },
        extractor: {},
        pairing: pairingStub,
      };
      serviceABC = new DuplicateService(deps);
    });

    it("preserves clean×clean similarity when only dirty units are given", async () => {
      // First full run — builds the complete matrix A×B×C
      await serviceABC.findDuplicates(config);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const simAB_before = cache.getEmbSim("A", "B");
      expect(simAB_before).to.be.a("number", "A×B should be in matrix after first run");

      // Mutate C's embedding to something new and mark only C's file as dirty.
      unitC.embedding = [0.5, 0.5];
      const simAC_before = cache.getEmbSim("A", "C");

      // Second run with dirty paths = only fileC.js
      await serviceABC.findDuplicates(config, ["fileC.js"]);

      // A×B must be identical (not recomputed)
      const simAB_after = cache.getEmbSim("A", "B");
      expect(simAB_after).to.equal(simAB_before, "Clean×clean similarity must be preserved");

      // A×C must reflect the new embedding for C
      const simAC_after = cache.getEmbSim("A", "C");
      expect(simAC_after).to.not.equal(simAC_before, "Dirty×clean similarity must be recomputed");
    });

    it("falls back to full rebuild when no prior matrix exists", async () => {
      cache.clear();
      // With dirty paths but no existing matrix, should still work correctly
      await serviceABC.findDuplicates(config, ["fileC.js"]);
      const simAB = cache.getEmbSim("A", "B");
      expect(simAB).to.be.a("number", "Full rebuild on cold cache must still populate A×B");
    });
  });
});
