import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaExtractor, DEFAULT_CONFIG } from '../../dist/index.js';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaExtractor', () => {
  const config = { ...DEFAULT_CONFIG, minLines: 0 };
  describe('Error handling and edge cases', () => {
    it('returns empty array if extractFromText is called with empty source', async () => {
      const extractor = new JavaExtractor();
      const results = await extractor.extractFromText('Empty.java', '', config);
      expect(results).to.be.an('array').that.is.empty;
    });

    it('returns empty array if extractCallsFromUnit is called before extractFromText', () => {
      const extractor = new JavaExtractor();
      const calls = extractor.extractCallsFromUnit('SomeFile.java', 'id');
      expect(calls).to.be.an('array').that.is.empty;
    });
  });
  it('supports only .java', () => {
    const ex = new JavaExtractor();
    expect(ex.supports('Main.java')).to.equal(true);
    expect(ex.supports('Main.py')).to.equal(false);
    expect(ex.supports('Main.ts')).to.equal(false);
  });

  it('extracts methods and constructors from Sample.java', async () => {
    const file = path.join(resourcesDir, 'Sample.java');
    const source = await fs.readFile(file, 'utf8');
    const extractor = new JavaExtractor();
    const results = await extractor.extractFromText(file, source, config);
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

    const extractor = new JavaExtractor();
    const results = await extractor.extractFromText('A.java', source, { ...DEFAULT_CONFIG, minLines: 3 });
    const names = results.map(r => r.name);

    expect(names).to.include('A.longer');
    expect(names).to.not.include('A.shorty');
  });
});
