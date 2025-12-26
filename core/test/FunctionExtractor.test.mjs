import { expect } from 'chai';
import { FunctionExtractor } from '../dist/FunctionExtractor';

describe('FunctionExtractor - Internal Dependencies', () => {
  
  describe('applyInternalDependencies', () => {
    it('resolves simple function calls', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'file.js:1-3', name: 'helper', filePath: 'file.js', startLine: 1, endLine: 3, code: 'function helper() {}' },
        { id: 'file.js:5-7', name: 'caller', filePath: 'file.js', startLine: 5, endLine: 7, code: 'function caller() { helper(); }' }
      ];
      
      // Mock the extractor to return calls
      extractor.extractors[0].extractCallsFromFunction = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.internalFunctions).to.be.an('array');
      expect(caller.internalFunctions).to.have.lengthOf(1);
      expect(caller.internalFunctions[0].name).to.equal('helper');
    });

    it('handles multiple internal calls', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'file.js:1-3', name: 'helper1', filePath: 'file.js', startLine: 1, endLine: 3, code: 'function helper1() {}' },
        { id: 'file.js:5-7', name: 'helper2', filePath: 'file.js', startLine: 5, endLine: 7, code: 'function helper2() {}' },
        { id: 'file.js:9-12', name: 'caller', filePath: 'file.js', startLine: 9, endLine: 12, code: 'function caller() { helper1(); helper2(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromFunction = () => ['helper1', 'helper2'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.internalFunctions).to.have.lengthOf(2);
    });

    it('ignores external library calls', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'file.js:1-5', name: 'doWork', filePath: 'file.js', startLine: 1, endLine: 5, code: 'function doWork() { console.log("hi"); }' }
      ];
      
      extractor.extractors[0].extractCallsFromFunction = () => ['log'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const doWork = result.find(f => f.name === 'doWork');
      expect(doWork.internalFunctions).to.be.an('array').that.is.empty;
    });

    it('prefers same-file matches for ambiguous names', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'file1.js:1-3', name: 'helper', filePath: 'file1.js', startLine: 1, endLine: 3, code: 'function helper() {}' },
        { id: 'file2.js:1-3', name: 'helper', filePath: 'file2.js', startLine: 1, endLine: 3, code: 'function helper() {}' },
        { id: 'file2.js:5-7', name: 'caller', filePath: 'file2.js', startLine: 5, endLine: 7, code: 'function caller() { helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromFunction = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.internalFunctions[0].filePath).to.equal('file2.js');
    });

    it('handles Java qualified names', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'Sample.java:1-3', name: 'Sample.helper', filePath: 'Sample.java', startLine: 1, endLine: 3, code: 'public void helper() {}' },
        { id: 'Sample.java:5-7', name: 'Sample.caller', filePath: 'Sample.java', startLine: 5, endLine: 7, code: 'public void caller() { helper(); }' }
      ];
      
      extractor.extractors[1].extractCallsFromFunction = () => ['helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'Sample.caller');
      expect(caller.internalFunctions).to.have.lengthOf(1);
      expect(caller.internalFunctions[0].name).to.equal('Sample.helper');
    });

    it('avoids duplicate internal functions', async () => {
      const extractor = new FunctionExtractor('/fake/root');
      
      const allFunctions = [
        { id: 'file.js:1-3', name: 'helper', filePath: 'file.js', startLine: 1, endLine: 3, code: 'function helper() {}' },
        { id: 'file.js:5-7', name: 'caller', filePath: 'file.js', startLine: 5, endLine: 7, code: 'function caller() { helper(); helper(); }' }
      ];
      
      extractor.extractors[0].extractCallsFromFunction = () => ['helper', 'helper'];
      
      const result = await extractor.applyInternalDependencies(allFunctions, allFunctions);
      
      const caller = result.find(f => f.name === 'caller');
      expect(caller.internalFunctions).to.have.lengthOf(1);
    });
  });
});
