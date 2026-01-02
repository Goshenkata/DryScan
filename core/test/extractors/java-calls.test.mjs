import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaExtractor } from "../../src/extractors/java.ts";
import { IndexUnitType } from "../../src/types.ts";
import { DEFAULT_CONFIG } from "../../src/config/dryconfig.ts";
import { configStore } from "../../src/config/configStore.ts";

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');
const repoRoot = resourcesDir;

describe('JavaExtractor - Comment stripping', () => {
  let extractor;

  before(async () => {
    const configPath = path.join(repoRoot, 'dryconfig.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ ...DEFAULT_CONFIG, minLines: 0, minBlockLines: 0 }, null, 2),
      'utf8'
    );
    await configStore.init(repoRoot);
    extractor = new JavaExtractor(repoRoot);
  });

  it('removes comments from extracted units', async () => {
    const filePath = path.join(resourcesDir, 'CommentSample.java');
    const commentedSource = `
      public class CommentSample {
        // class comment
        /* block comment */
        public int foo() {
          // line comment inside method
          int x = 1; /* inline block */
          int y = 2;
          return x + y; // trailing comment
        }
      }
    `;

    const units = await extractor.extractFromText(filePath, commentedSource);

    const classUnit = units.find(u => u.unitType === IndexUnitType.CLASS && u.name === 'CommentSample');
    const fnUnit = units.find(u => u.unitType === IndexUnitType.FUNCTION && u.name === 'CommentSample.foo');
    const blockUnit = units.find(u => u.unitType === IndexUnitType.BLOCK && u.parentId === fnUnit?.id);

    expect(classUnit).to.exist;
    expect(fnUnit).to.exist;
    expect(blockUnit).to.exist;

    [classUnit, fnUnit, blockUnit].forEach(unit => {
      expect(unit.code).to.not.include('//');
      expect(unit.code).to.not.include('/*');
    });
  });
});
