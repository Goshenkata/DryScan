import { expect } from "chai";
import {
  pairKeyForUnits,
  parsePairKey,
  pairKeyMatches,
  canonicalFunctionSignature,
  normalizedBlockHash,
} from "../src/pairs.ts";
import { IndexUnitType } from "../src/types.ts";

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

    const key = pairKeyForUnits(left, right);
    expect(key).to.equal("class|src/a/A.java|src/b/B.java");

    const pattern = parsePairKey("class|src/**/B.java|src/**/A.java");
    const actual = key ? parsePairKey(key) : null;
    expect(actual).to.not.be.null;
    expect(pattern).to.not.be.null;
    expect(pairKeyMatches(actual, pattern)).to.equal(true);
  });

  it("uses canonical function signatures with arity", () => {
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

    const signature = canonicalFunctionSignature(fn1);
    expect(signature).to.equal("Foo.bar(arity:2)");

    const key = pairKeyForUnits(fn1, fn2);
    const parsed = key ? parsePairKey(key) : null;
    expect(parsed?.left).to.equal("Foo.bar(arity:2)");
    expect(parsed?.right).to.equal("Foo.bar(arity:2)");
  });

  it("hashes blocks ignoring whitespace and comments", () => {
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

    const hashA = normalizedBlockHash(blockA);
    const hashB = normalizedBlockHash(blockB);
    expect(hashA).to.equal(hashB);

    const key = pairKeyForUnits(blockA, blockB);
    const parsed = key ? parsePairKey(key) : null;
    expect(parsed?.type).to.equal(IndexUnitType.BLOCK);
    expect(parsed?.left).to.equal(hashA);
    expect(parsed?.right).to.equal(hashB);
  });
});
