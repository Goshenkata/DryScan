import { expect } from "chai";
import path from "path";
import fs from "fs/promises";
import { JavaExtractor } from "../../src/extractors/java.ts";
import { DEFAULT_CONFIG } from "../../src/config/dryconfig.ts";
import { configStore } from "../../src/config/configStore.ts";
import { IndexUnitType } from "../../src/types.ts";

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');
const repoRoot = resourcesDir;

async function writeConfig(overrides = {}) {
  const next = { ...DEFAULT_CONFIG, ...overrides };
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

    it('returns empty array if extractCallsFromUnit is called before extractFromText', () => {
      const extractor = new JavaExtractor(repoRoot);
      const calls = extractor.extractCallsFromUnit('SomeFile.java', 'id');
      expect(calls).to.be.an('array').that.is.empty;
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
});
