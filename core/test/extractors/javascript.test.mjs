import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaScriptExtractor } from '../../dist/extractors/javascript';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaScriptExtractor', () => {
  it('supports expected JS/TS extensions', () => {
    const ex = new JavaScriptExtractor();
    expect(ex.supports('file.js')).to.equal(true);
    expect(ex.supports('file.jsx')).to.equal(true);
    expect(ex.supports('file.ts')).to.equal(true);
    expect(ex.supports('file.tsx')).to.equal(true);
    expect(ex.supports('file.mjs')).to.equal(true);
    expect(ex.supports('file.cjs')).to.equal(true);
    expect(ex.supports('file.py')).to.equal(false);
    expect(ex.supports('file.java')).to.equal(false);
  });

  it('extracts functions from sample.js', async () => {
    const file = path.join(resourcesDir, 'sample.js');
    const source = await fs.readFile(file, 'utf8');
    const extractor = new JavaScriptExtractor();
    const results = await extractor.extractFromText(file, source);
    const names = results.map(r => r.name).sort();

    expect(names).to.include('add');
    expect(names).to.include('multiply');
    // Arrow function may be <anonymous> depending on AST; ensure at least 2+
    expect(results.length).to.be.greaterThanOrEqual(2);
  });
});
