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
});
