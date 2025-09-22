import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { PythonExtractor } from '../../dist/extractors/python.js';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('PythonExtractor', () => {
  it('supports only .py', () => {
    const ex = new PythonExtractor();
    expect(ex.supports('script.py')).to.equal(true);
    expect(ex.supports('script.js')).to.equal(false);
    expect(ex.supports('script.java')).to.equal(false);
  });

  it('extracts functions from sample.py', async () => {
    const file = path.join(resourcesDir, 'sample.py');
    const source = await fs.readFile(file, 'utf8');
    const extractor = new PythonExtractor();
    const results = await extractor.extractFromText(file, source);
    const names = results.map(r => r.name).sort();

    expect(names).to.include('greet');
    expect(names.some(n => n.includes('Greeter.__init__') || n.includes('Greeter.greet'))).to.equal(true);
    expect(results.length).to.be.greaterThanOrEqual(3);
  });
});
