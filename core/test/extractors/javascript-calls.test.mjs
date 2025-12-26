import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaScriptExtractor } from '../../dist/extractors/javascript';

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
    await extractor.extractFromText(file, source);
    const functionId = 'callsHelper:5-8';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    expect(calls).to.include('helper');
  });

  it('extracts multiple function calls from callsMultiple', async () => {
    await extractor.extractFromText(file, source);
    const functionId = 'callsMultiple:10-14';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    expect(calls).to.include('helper');
    expect(calls).to.include('callsHelper');
  });

  it('extracts method calls correctly', async () => {
    await extractor.extractFromText(file, source);
    const functionId = 'addAndLog:21-25';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    expect(calls).to.include('add');
  });

  it('returns empty array for non-existent function', () => {
    const calls = extractor.extractCallsFromFunction(file, 'invalid:1-2');
    expect(calls).to.be.an('array').that.is.empty;
  });

  it('returns empty array for non-existent file', () => {
    const calls = extractor.extractCallsFromFunction('nonexistent.js', 'id');
    expect(calls).to.be.an('array').that.is.empty;
  });
});
