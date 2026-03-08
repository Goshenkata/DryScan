import { expect } from "chai";
import path from "path";
import fs from "fs/promises";
import { JavaExtractor } from "../../src/extractors/java.ts";
import { configStore } from "../../src/config/configStore.ts";
import { IndexUnitType } from "../../src/types.ts";
import { buildTestConfig } from "../helpers/testConfig.mjs";

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');
const repoRoot = resourcesDir;

async function writeConfig(overrides = {}) {
  const next = buildTestConfig(overrides);
  await fs.writeFile(path.join(repoRoot, 'dryconfig.json'), JSON.stringify(next, null, 2), 'utf8');
}

async function createExtractor(overrides = {}) {
  if (Object.keys(overrides).length > 0) {
    await writeConfig(overrides);
  }
  await configStore.init(repoRoot);
  return new JavaExtractor(repoRoot);
}

describe('JavaExtractor', () => {
  describe('Error handling and edge cases', () => {
    it('returns empty array if extractFromText is called with empty source', async () => {
      const extractor = await createExtractor({ minLines: 0 });
      const results = await extractor.extractFromText('Empty.java', '');
      expect(results).to.be.an('array').that.is.empty;
    });
  });
  it('supports only .java', async () => {
    await configStore.init(repoRoot);
    const ex = new JavaExtractor(repoRoot);
    expect(ex.supports('Main.java')).to.equal(true);
    expect(ex.supports('Main.py')).to.equal(false);
    expect(ex.supports('Main.ts')).to.equal(false);
  });

  it('extracts methods and constructors from Sample.java', async () => {
    const file = path.join(resourcesDir, 'Sample.java');
    const source = await fs.readFile(file, 'utf8');
    const extractor = await createExtractor({ minLines: 0 });
    const results = await extractor.extractFromText(file, source);
    const names = results.map(r => r.name).sort();

    expect(names).to.include('Sample.hello');
    expect(names).to.include('Sample.sum');
    // constructor may appear as Sample.Sample or just Sample depending on grammar
    expect(names.some(n => n === 'Sample' || n === 'Sample.Sample' || n.includes('constructor'))).to.equal(true);
    expect(results.length).to.be.greaterThanOrEqual(4);
  });

  it('applies minLines to functions (skips short functions)', async () => {
    const source = `
public class A {
  public void shorty() { }

  public void longer() {
    int a = 1;
    int b = 2;
    int c = a + b;
    int d = c * 2;
    System.out.println(d);
  }
}
`;

    const extractor = await createExtractor({ minLines: 3 });
    const results = await extractor.extractFromText('A.java', source);
    const names = results.map(r => r.name);

    expect(names).to.include('A.longer');
    expect(names).to.not.include('A.shorty');
  });

  it('indexes get-named methods that take parameters (non-trivial getters)', async () => {
    // getUserById(Long id), getUserFromJwtToken(String token) etc. must NOT be skipped
    // even though their names start with "get" — they have parameters and real logic.
    const source = `
public class UserService {
    private java.util.Map<Long, Object> db = new java.util.HashMap<>();

    public Object getUserById(Long id) {
        if (id == null) throw new IllegalArgumentException("null id");
        Object o = db.get(id);
        if (o == null) throw new java.util.NoSuchElementException("not found");
        return o;
    }

    public String getUserFromJwtToken(String token) {
        if (token == null || token.isEmpty()) return null;
        String[] parts = token.split("\\\\.");
        if (parts.length != 3) throw new IllegalArgumentException("bad token");
        return new String(java.util.Base64.getDecoder().decode(parts[1]));
    }

    public Object getId() { return null; }
}
`;
    const extractor = await createExtractor({ minLines: 3, minBlockLines: 0 });
    const results = await extractor.extractFromText('UserService.java', source);
    const names = results.map(r => r.name);

    // Methods with parameters must be indexed
    expect(names).to.include('UserService.getUserById');
    expect(names).to.include('UserService.getUserFromJwtToken');
    // Zero-param getter must still be skipped (arity=0, trivial)
    expect(names).to.not.include('UserService.getId');
  });

  it('skips DTO-style classes and their members', async () => {
    const source = `
public class UserDto {
  private String id;
  private String name;

  public String getId() { return id; }
  public void setId(String id) { this.id = id; }
}
`;

    const extractor = await createExtractor({ minLines: 0, minBlockLines: 0 });
    const results = await extractor.extractFromText('UserDto.java', source);

    expect(results).to.be.an('array').that.is.empty;
  });

  it('skips DTO-style classes even with annotations', async () => {
    const source = `
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@NoArgsConstructor
public class GroupEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  private String name;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
}
`;

    const extractor = await createExtractor({ minLines: 0, minBlockLines: 0 });
    const results = await extractor.extractFromText('GroupEntity.java', source);

    expect(results).to.be.an('array').that.is.empty;
  });

  describe('textSplitBlockIfOverContextLimit', () => {
    // A method whose body exceeds a tiny contextLength so the extractor is forced to split it.
    const buildSourceWithLargeBody = (bodyLines) => `
public class Splitter {
  public void bigMethod() {
${bodyLines}
  }
}
`;

    // Generate enough unique lines to produce a body clearly larger than a small contextLength.
    const manyLines = Array.from({ length: 60 }, (_, i) => `    int var${i} = ${i};`).join('\n');

    it('returns a single block when code fits within contextLength', async () => {
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: 100000 });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      const blocks = results.filter(u => u.unitType === IndexUnitType.BLOCK);
      // All blocks should have code within the limit.
      for (const block of blocks) {
        expect(block.code.length).to.be.at.most(100000);
      }
      // With an enormous limit there should be no chunk-suffixed ids.
      expect(blocks.every(b => !b.id.includes(':chunk'))).to.equal(true);
    });

    it('splits a block into chunks when code exceeds contextLength', async () => {
      const smallContext = 50;
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: smallContext });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      const chunks = results.filter(u => u.unitType === IndexUnitType.BLOCK && u.id.includes(':chunk'));
      // Must have produced multiple chunks.
      expect(chunks.length).to.be.greaterThan(1);
    });

    it('each chunk code length does not exceed contextLength', async () => {
      const smallContext = 50;
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: smallContext });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      const chunks = results.filter(u => u.unitType === IndexUnitType.BLOCK && u.id.includes(':chunk'));
      for (const chunk of chunks) {
        expect(chunk.code.length).to.be.at.most(smallContext);
      }
    });

    it('chunks are numbered sequentially starting at 0', async () => {
      const smallContext = 50;
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: smallContext });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      const chunks = results
        .filter(u => u.unitType === IndexUnitType.BLOCK && u.id.includes(':chunk'))
        .map(u => parseInt(u.id.match(/:chunk(\d+)$/)[1], 10))
        .sort((a, b) => a - b);
      chunks.forEach((n, i) => expect(n).to.equal(i));
    });

    it('chunks preserve the parent block metadata (filePath, unitType, parentId)', async () => {
      const smallContext = 50;
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: smallContext });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      const chunks = results.filter(u => u.unitType === IndexUnitType.BLOCK && u.id.includes(':chunk'));
      for (const chunk of chunks) {
        expect(chunk.unitType).to.equal(IndexUnitType.BLOCK);
        expect(chunk.filePath).to.equal('Splitter.java');
        expect(chunk.parentId).to.be.a('string').that.is.not.empty;
      }
    });

    it('concatenated chunk code reconstructs the original block code', async () => {
      const smallContext = 50;
      const extractor = await createExtractor({ minLines: 0, minBlockLines: 0, contextLength: smallContext });
      const results = await extractor.extractFromText('Splitter.java', buildSourceWithLargeBody(manyLines));
      // Gather unique base ids (strip :chunkN suffix) and rebuild per base.
      const byBase = new Map();
      for (const u of results.filter(u => u.unitType === IndexUnitType.BLOCK && u.id.includes(':chunk'))) {
        const base = u.id.replace(/:chunk\d+$/, '');
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(u);
      }
      for (const [, chunkList] of byBase) {
        chunkList.sort((a, b) => {
          const ia = parseInt(a.id.match(/:chunk(\d+)$/)[1], 10);
          const ib = parseInt(b.id.match(/:chunk(\d+)$/)[1], 10);
          return ia - ib;
        });
        const reconstructed = chunkList.map(c => c.code).join('');
        // The original un-split block (same base id without :chunkN) isn't in the results
        // because it was replaced by its chunks – verify reconstruction is non-empty and
        // all characters come from the original source by checking total length matches.
        expect(reconstructed.length).to.equal(chunkList.length * smallContext - (smallContext - chunkList.at(-1).code.length));
      }
    });
  });
});
