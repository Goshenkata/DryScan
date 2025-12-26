#!/usr/bin/env node
import { Command } from 'commander';
import { DryScan, DuplicateGroup } from '@dryscan/core';
import { resolve } from 'path';

/**
 * Formats duplicate groups in a human-readable format.
 * Shows similarity percentage, file locations, and code snippets.
 */
function formatDuplicates(duplicates: DuplicateGroup[], threshold: number): void {
  if (duplicates.length === 0) {
    console.log(`\n✓ No duplicates found (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
    return;
  }
  
  console.log(`\n🔍 Found ${duplicates.length} duplicate group(s) (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
  console.log('═'.repeat(80));
  
  duplicates.forEach((group, index) => {
    const similarityPercent = (group.similarity * 100).toFixed(1);
    
    console.log(`\n[${index + 1}] Similarity: ${similarityPercent}%`);
    console.log('─'.repeat(80));
    
    // Left side
    console.log(`\n📄 ${group.left.filePath}:${group.left.startLine}-${group.left.endLine}`);
    console.log(formatCodeSnippet(group.left.code));
    
    console.log('\n' + '~'.repeat(40) + ' VS ' + '~'.repeat(40) + '\n');
    
    // Right side
    console.log(`📄 ${group.right.filePath}:${group.right.startLine}-${group.right.endLine}`);
    console.log(formatCodeSnippet(group.right.code));
    
    if (index < duplicates.length - 1) {
      console.log('\n' + '═'.repeat(80));
    }
  });
  
  console.log('\n' + '═'.repeat(80) + '\n');
}

/**
 * Formats code snippet with line numbers and truncation for long code.
 */
function formatCodeSnippet(code: string, maxLines: number = 15): string {
  const lines = code.split('\n');
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;
  
  const formatted = displayLines.map((line, i) => {
    const lineNum = (i + 1).toString().padStart(3, ' ');
    return `  ${lineNum} │ ${line}`;
  }).join('\n');
  
  return formatted + (truncated ? `\n  ... │ (${lines.length - maxLines} more lines)` : '');
}

const program = new Command();

program
  .name('dryscan')
  .description('Semantic code duplication analyzer')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize DryScan in the current repository')
  .argument('[path]', 'Repository path', '.')
  .action(async (path: string) => {
    const repoPath = resolve(path);
    const scanner = new DryScan(repoPath);
    await scanner.init();
    console.log('DryScan initialized successfully');
  });

program
  .command('dupes')
  .description('Find duplicate code blocks')
  .argument('[path]', 'Repository path', '.')
  .option('--json', 'Output results as JSON')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)', '0.85')
  .action(async (path: string, options: { json?: boolean; threshold?: string }) => {
    const repoPath = resolve(path);
    const threshold = parseFloat(options.threshold || '0.85');
    
    const scanner = new DryScan(repoPath);
    const duplicates = await scanner.findDuplicates(threshold);
    
    if (options.json) {
      // Output as JSON
      console.log(JSON.stringify(duplicates, null, 2));
    } else {
      // Human-readable format
      formatDuplicates(duplicates, threshold);
    }
  });

program.parse();
