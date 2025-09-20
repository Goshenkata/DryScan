#!/usr/bin/env node

import { Command } from 'commander';
import { analyzeRepo, updateEmbeddings, searchQuery, findDuplicates } from '@dryscan/core';
import { resolve } from 'path';

const program = new Command();

program
  .name('dryscan')
  .description('DryScan - A Semantic Code Duplication & Reuse Analyzer')
  .version('0.1.0');

/**
 * Initialize analysis for a repository
 */
program
  .command('init')
  .description('Initialize analysis for a repository')
  .argument('<repo>', 'Repository path to initialize')
  .action(async (repoPath: string) => {
    try {
      const fullPath = resolve(repoPath);
      console.log(`🚀 Initializing DryScan analysis for: ${fullPath}`);
      
      const result = await analyzeRepo(fullPath);
      
      console.log(`✅ Analysis complete!`);
      console.log(`   Files analyzed: ${result.metrics.totalFiles}`);
      console.log(`   Unique lines: ${result.metrics.uniqueLines}`);
      console.log(`   Duplicate lines: ${result.metrics.duplicateLines}`);
      
      if (result.duplicates.length > 0) {
        console.log(`   Found ${result.duplicates.length} duplicate groups`);
      }
    } catch (error) {
      console.error('❌ Error during initialization:', error);
      process.exit(1);
    }
  });

/**
 * Update embeddings for a repository
 */
program
  .command('update')
  .description('Update embeddings for a repository')
  .argument('<repo>', 'Repository path to update')
  .action(async (repoPath: string) => {
    try {
      const fullPath = resolve(repoPath);
      console.log(`🔄 Updating embeddings for: ${fullPath}`);
      
      const result = await updateEmbeddings(fullPath);
      
      console.log(`✅ Embeddings updated!`);
      console.log(`   Files processed: ${result.processed}`);
      console.log(`   Embeddings updated: ${result.updated}`);
      
      if (result.errors.length > 0) {
        console.log(`   Errors: ${result.errors.length}`);
        result.errors.forEach(error => console.log(`     - ${error}`));
      }
    } catch (error) {
      console.error('❌ Error updating embeddings:', error);
      process.exit(1);
    }
  });

/**
 * Search for code using semantic query
 */
program
  .command('search')
  .description('Search for code using semantic query')
  .argument('<query>', 'Search query')
  .option('-r, --repo <path>', 'Repository path to search in')
  .action(async (query: string, options: { repo?: string }) => {
    try {
      console.log(`🔍 Searching for: "${query}"`);
      if (options.repo) {
        console.log(`   In repository: ${resolve(options.repo)}`);
      }
      
      const results = await searchQuery(query, options.repo ? resolve(options.repo) : undefined);
      
      if (results.length === 0) {
        console.log('📭 No results found');
        return;
      }
      
      console.log(`✅ Found ${results.length} result(s):`);
      results.forEach((result, index) => {
        console.log(`\n  ${index + 1}. ${result.file}:${result.line}`);
        console.log(`     Relevance: ${(result.relevance * 100).toFixed(1)}%`);
        console.log(`     ${result.snippet}`);
      });
    } catch (error) {
      console.error('❌ Error during search:', error);
      process.exit(1);
    }
  });

/**
 * Find duplicates in a repository
 */
program
  .command('dupes')
  .description('Find duplicate code patterns in a repository')
  .argument('<repo>', 'Repository path to analyze for duplicates')
  .action(async (repoPath: string) => {
    try {
      const fullPath = resolve(repoPath);
      console.log(`🔍 Finding duplicates in: ${fullPath}`);
      
      const duplicates = await findDuplicates(fullPath);
      
      if (duplicates.length === 0) {
        console.log('✅ No duplicates found!');
        return;
      }
      
      console.log(`⚠️  Found ${duplicates.length} duplicate group(s):`);
      duplicates.forEach((group, index) => {
        console.log(`\n  ${index + 1}. Group ${group.id} (${(group.similarity * 100).toFixed(1)}% similarity)`);
        console.log(`     Files: ${group.files.join(', ')}`);
        console.log(`     ${group.codeSnippet}`);
      });
    } catch (error) {
      console.error('❌ Error finding duplicates:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();