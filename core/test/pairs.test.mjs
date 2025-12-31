import { expect } from "chai";
import { PairingService } from "../src/services/PairingService.ts";
import { IndexUnitExtractor, defaultExtractors } from "../src/IndexUnitExtractor.ts";
import { IndexUnitType } from "../src/types.ts";

const extractor = new IndexUnitExtractor(process.cwd(), defaultExtractors(process.cwd()));
const pairing = new PairingService(extractor);

describe("pair key utilities", () => {
  it("builds order-insensitive class pair keys and matches globs", () => {
    const left = {
      unitType: IndexUnitType.CLASS,
      filePath: "src/a/A.java",
      name: "A",
      code: "class A {}",
    };
    const right = {
      unitType: IndexUnitType.CLASS,
      filePath: "src/b/B.java",
      name: "B",
      code: "class B {}",
    };

    const key = pairing.pairKeyForUnits(left, right);
    expect(key).to.equal("class|src/a/A.java|src/b/B.java");

    const pattern = pairing.parsePairKey("class|src/**/B.java|src/**/A.java");
    const actual = key ? pairing.parsePairKey(key) : null;
    expect(actual).to.not.be.null;
    expect(pattern).to.not.be.null;
    expect(pairing.pairKeyMatches(actual, pattern)).to.equal(true);
  });

  it("uses canonical function signatures with arity via pair keys", () => {
    const fn1 = {
      unitType: IndexUnitType.FUNCTION,
      filePath: "src/Foo.ts",
      name: "Foo.bar",
      code: "function bar(a, b) { return a + b; }",
    };
    const fn2 = {
      unitType: IndexUnitType.FUNCTION,
      filePath: "src/Foo.ts",
      name: "Foo.bar",
      code: "function bar(a,b){return a+b;}",
    };
    const key = pairing.pairKeyForUnits(fn1, fn2);
    expect(key).to.equal("function|Foo.bar(arity:2)|Foo.bar(arity:2)");

    const parsed = key ? pairing.parsePairKey(key) : null;
    expect(parsed?.left).to.equal("Foo.bar(arity:2)");
    expect(parsed?.right).to.equal("Foo.bar(arity:2)");
  });

  it("hashes blocks ignoring whitespace and comments via pair keys", () => {
    const blockA = {
      unitType: IndexUnitType.BLOCK,
      filePath: "src/file.ts",
      name: "fn",
      code: "{\n  // add values\n  return a + b;\n}",
    };
    const blockB = {
      unitType: IndexUnitType.BLOCK,
      filePath: "src/file.ts",
      name: "fn",
      code: "{/* comment */ return   a + b; }",
    };
    const blockC = {
      unitType: IndexUnitType.BLOCK,
      filePath: "src/file.ts",
      name: "fn",
      code: "{ return a - b; }",
    };

    const keyAB = pairing.pairKeyForUnits(blockA, blockB);
    expect(keyAB?.startsWith("block|")).to.equal(true);

    const parsedAB = keyAB ? pairing.parsePairKey(keyAB) : null;
    expect(parsedAB?.type).to.equal(IndexUnitType.BLOCK);
    expect(parsedAB?.left).to.equal(parsedAB?.right);
    expect(parsedAB?.left?.length).to.equal(40); // sha1 hex length

    const keyAC = pairing.pairKeyForUnits(blockA, blockC);
    const parsedAC = keyAC ? pairing.parsePairKey(keyAC) : null;
    expect(parsedAC?.left).to.not.equal(parsedAB?.left);
  });
});
