import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaScriptExtractor, IndexUnitType } from '../../dist/index.js';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaScriptExtractor - Call Extraction', () => {
  let extractor;
  let file;
  let source;

  before(async () => {
    file = path.join(resourcesDir, 'calls.js');
    source = await fs.readFile(file, 'utf8');
    extractor = new JavaScriptExtractor();
  });

  it('extracts function calls from callsHelper', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.name === 'callsHelper' && u.unitType === IndexUnitType.FUNCTION);
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    expect(calls).to.include('helper');
  });

  it('extracts multiple function calls from callsMultiple', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.name === 'callsMultiple' && u.unitType === IndexUnitType.FUNCTION);
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    expect(calls).to.include('helper');
    expect(calls).to.include('callsHelper');
  });

  it('extracts method calls correctly', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.unitType === IndexUnitType.FUNCTION && u.name.includes('addAndLog'));
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    expect(calls).to.include('add');
  });

  it('returns empty array for non-existent function', () => {
    const calls = extractor.extractCallsFromUnit(file, 'invalid:1-2');
    expect(calls).to.be.an('array').that.is.empty;
  });

  it('returns empty array for non-existent file', () => {
    const calls = extractor.extractCallsFromUnit('nonexistent.js', 'id');
    expect(calls).to.be.an('array').that.is.empty;
  });
});
