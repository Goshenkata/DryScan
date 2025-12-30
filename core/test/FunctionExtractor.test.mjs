import { expect } from 'chai';
import { IndexUnitExtractor } from "../src/IndexUnitExtractor.ts";
import { IndexUnitType } from "../src/types.ts";
import { configStore } from "../src/config/configStore.ts";

const repoPath = '/fake/root';

async function createExtractor() {
  await configStore.init(repoPath);
  return new IndexUnitExtractor(repoPath);
}

describe('IndexUnitExtractor - Internal Dependencies', () => {
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
  
  describe('applyInternalDependencies', () => {
    it('resolves simple function calls', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:helper:1-3', name: 'helper', unitType: IndexUnitType.FUNCTION, filePath: 'file.java', startLine: 1, endLine: 3, code: 'void helper() {}' },
        { id: 'function:caller:5-7', name: 'caller', unitType: IndexUnitType.FUNCTION, filePath: 'file.java', startLine: 5, endLine: 7, code: 'void caller() { helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.callDependencies).to.be.an('array');
      expect(caller.callDependencies).to.have.lengthOf(1);
      expect(caller.callDependencies[0].name).to.equal('helper');
    });

    it('handles multiple internal calls', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:helper1:1-3', unitType: IndexUnitType.FUNCTION, name: 'helper1', filePath: 'file.java', startLine: 1, endLine: 3, code: 'void helper1() {}' },
        { id: 'function:helper2:5-7', unitType: IndexUnitType.FUNCTION, name: 'helper2', filePath: 'file.java', startLine: 5, endLine: 7, code: 'void helper2() {}' },
        { id: 'function:caller:9-12', unitType: IndexUnitType.FUNCTION, name: 'caller', filePath: 'file.java', startLine: 9, endLine: 12, code: 'void caller() { helper1(); helper2(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['helper1', 'helper2'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.callDependencies).to.have.lengthOf(2);
    });

    it('ignores external library calls', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:doWork:1-5', unitType: IndexUnitType.FUNCTION, name: 'doWork', filePath: 'file.java', startLine: 1, endLine: 5, code: 'void doWork() { System.out.println("hi"); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['log'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const doWork = result.find(f => f.name === 'doWork');
      expect(doWork.callDependencies).to.be.an('array').that.is.empty;
    });

    it('prefers same-file matches for ambiguous names', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:helper:1-3', unitType: IndexUnitType.FUNCTION, name: 'helper', filePath: 'file1.java', startLine: 1, endLine: 3, code: 'void helper() {}' },
        { id: 'function:helper:10-12', unitType: IndexUnitType.FUNCTION, name: 'helper', filePath: 'file2.java', startLine: 10, endLine: 12, code: 'void helper() {}' },
        { id: 'function:caller:5-7', unitType: IndexUnitType.FUNCTION, name: 'caller', filePath: 'file2.java', startLine: 5, endLine: 7, code: 'void caller() { helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.callDependencies[0].filePath).to.equal('file2.java');
    });

    it('handles Java qualified names', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:Sample.helper:1-3', unitType: IndexUnitType.FUNCTION, name: 'Sample.helper', filePath: 'Sample.java', startLine: 1, endLine: 3, code: 'public void helper() {}' },
        { id: 'function:Sample.caller:5-7', unitType: IndexUnitType.FUNCTION, name: 'Sample.caller', filePath: 'Sample.java', startLine: 5, endLine: 7, code: 'public void caller() { helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'Sample.caller');
      expect(caller.callDependencies).to.have.lengthOf(1);
      expect(caller.callDependencies[0].name).to.equal('Sample.helper');
    });

    it('avoids duplicate internal functions', async () => {
      const extractor = await createExtractor();
      
      const allFunctions = [
        { id: 'function:helper:1-3', unitType: IndexUnitType.FUNCTION, name: 'helper', filePath: 'file.java', startLine: 1, endLine: 3, code: 'void helper() {}' },
        { id: 'function:caller:5-7', unitType: IndexUnitType.FUNCTION, name: 'caller', filePath: 'file.java', startLine: 5, endLine: 7, code: 'void caller() { helper(); helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromUnit = () => ['helper', 'helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.callDependencies).to.have.lengthOf(1);
    });
  });
});
