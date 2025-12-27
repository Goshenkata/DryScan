import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaScriptExtractor } from '../../dist/index.js';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaScriptExtractor', () => {
  describe('Error handling and edge cases', () => {
    it('returns empty array if extractFromText is called with empty source', async () => {
      const extractor = new JavaScriptExtractor();
      const results = await extractor.extractFromText('Empty.js', '');
      expect(results).to.be.an('array').that.is.empty;
    });

    it('returns empty array if extractCallsFromFunction is called before extractFromText', () => {
      const extractor = new JavaScriptExtractor();
      const calls = extractor.extractCallsFromFunction('SomeFile.js', 'id');
      expect(calls).to.be.an('array').that.is.empty;
    });
  });
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
