import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaExtractor } from '../../dist/extractors/java.js';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaExtractor', () => {
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
    const results = await extractor.extractFromText(file, source);
    const names = results.map(r => r.name).sort();

    expect(names).to.include('Sample.hello');
    expect(names).to.include('Sample.sum');
    // constructor may appear as Sample.Sample or just Sample depending on grammar
    expect(names.some(n => n === 'Sample' || n === 'Sample.Sample' || n.includes('constructor'))).to.equal(true);
    expect(results.length).to.be.greaterThanOrEqual(4);
  });
});
