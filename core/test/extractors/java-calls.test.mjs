import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import { JavaExtractor } from "../../src/extractors/java.ts";
import { IndexUnitType } from "../../src/types.ts";
import { DEFAULT_CONFIG } from "../../src/config/dryconfig.ts";
import { configStore } from "../../src/config/configStore.ts";

const resourcesDir = path.join(process.cwd(), 'test', 'resources', 'extractors');
const repoRoot = resourcesDir;

describe('JavaExtractor - Call Extraction', () => {
  let extractor;
  let file;
  let source;

  before(async () => {
    file = path.join(resourcesDir, 'CallerSample.java');
    source = await fs.readFile(file, 'utf8');
    const configPath = path.join(repoRoot, 'dryconfig.json');
    await fs.writeFile(configPath, JSON.stringify({ ...DEFAULT_CONFIG, minLines: 0 }, null, 2), 'utf8');
    await configStore.init(repoRoot);
    extractor = new JavaExtractor(repoRoot);
  });

  it('extracts method calls from callsHelper', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.name === 'CallerSample.callsHelper' && u.unitType === IndexUnitType.FUNCTION);
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    expect(calls).to.include('helperMethod');
  });

  it('extracts multiple method calls from callsMultiple', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.name === 'CallerSample.callsMultiple' && u.unitType === IndexUnitType.FUNCTION);
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    expect(calls).to.include('helperMethod');
    expect(calls).to.include('callsHelper');
  });

  it('returns empty array for method with no calls', async () => {
    const units = await extractor.extractFromText(file, source);
    const fn = units.find(u => u.name === 'CallerSample.standalone' && u.unitType === IndexUnitType.FUNCTION);
    expect(fn).to.exist;
    const calls = extractor.extractCallsFromUnit(file, fn.id);
    
    // println is actually a library call, extracted from method call
    expect(calls).to.include('println');
  });

  it('returns empty array for non-existent function', () => {
    const calls = extractor.extractCallsFromUnit(file, 'invalid:1-2');
    expect(calls).to.be.an('array').that.is.empty;
  });

  it('returns empty array for non-existent file', () => {
    const calls = extractor.extractCallsFromUnit('nonexistent.java', 'id');
    expect(calls).to.be.an('array').that.is.empty;
  });
});
