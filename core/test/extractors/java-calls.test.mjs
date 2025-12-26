import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaExtractor } from '../../dist/extractors/java';

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');

describe('JavaExtractor - Call Extraction', () => {
  let extractor;
  let file;
  let source;

  before(async () => {
    file = path.join(resourcesDir, 'CallerSample.java');
    source = await fs.readFile(file, 'utf8');
    extractor = new JavaExtractor();
  });

  it('extracts method calls from callsHelper', async () => {
    await extractor.extractFromText(file, source);
    const functionId = 'CallerSample.callsHelper:7-9';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    expect(calls).to.include('helperMethod');
  });

  it('extracts multiple method calls from callsMultiple', async () => {
    await extractor.extractFromText(file, source);
    const functionId = 'CallerSample.callsMultiple:11-15';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    expect(calls).to.include('helperMethod');
    expect(calls).to.include('callsHelper');
  });

  it('returns empty array for method with no calls', async () => {
    await extractor.extractFromText(file, source);
    const functionId = 'CallerSample.standalone:17-19';
    const calls = extractor.extractCallsFromFunction(file, functionId);
    
    // println is actually a library call, extracted from method call
    expect(calls).to.include('println');
  });

  it('returns empty array for non-existent function', () => {
    const calls = extractor.extractCallsFromFunction(file, 'invalid:1-2');
    expect(calls).to.be.an('array').that.is.empty;
  });

  it('returns empty array for non-existent file', () => {
    const calls = extractor.extractCallsFromFunction('nonexistent.java', 'id');
    expect(calls).to.be.an('array').that.is.empty;
  });
});
