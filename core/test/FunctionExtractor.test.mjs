import { expect } from 'chai';
import { IndexUnitExtractor } from "../src/IndexUnitExtractor.ts";
import { IndexUnitType } from "../src/types.ts";
import { configStore } from "../src/config/configStore.ts";

const repoPath = '/fake/root';

async function createExtractor() {
  await configStore.init(repoPath);
  return new IndexUnitExtractor(repoPath);
}

describe('IndexUnitExtractor', () => {
  describe('Error handling and edge cases', () => {
    it('throws if listSourceFiles path does not exist', async () => {
      const extractor = await createExtractor();
      try {
        await extractor.listSourceFiles('missing.java');
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Path not found');
      }
    });

    it('throws if scan path does not exist', async () => {
      const extractor = await createExtractor();
      try {
        await extractor.scan('missing.java');
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Path not found');
      }
    });

    it('returns empty array if tryScanSupportedFile is called with unsupported file and throwOnUnsupported=false', async () => {
      const extractor = await createExtractor();
      extractor.extractors = [];
      const result = await extractor.tryScanSupportedFile('unsupported.xyz', false);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('throws if tryScanSupportedFile is called with unsupported file and throwOnUnsupported=true', async () => {
      const extractor = await createExtractor();
      extractor.extractors = [];
      try {
        await extractor.tryScanSupportedFile('unsupported.xyz', true);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Unsupported file type');
      }
    });

    // findBestFunctionMatch is private/internal, skip direct test
  });
  
});
