#!/usr/bin/env node
import { Command } from 'commander';
import {
  DryScan,
  DuplicateGroup,
  DuplicateAnalysisResult,
  buildDuplicateReport,
  writeDuplicateReport,
  applyExclusionFromLatestReport,
  loadDryConfig,
} from '@dryscan/core';
import { resolve } from 'path';
import { DuplicateReportServer } from './uiServer.js';

const UI_PORT = 3000;

/**
 * Formats duplicate groups in a human-readable format.
 * Shows similarity percentage, file locations, and code snippets.
 */
function formatDuplicates(
  result: DuplicateAnalysisResult,
  threshold: number,
  reportPath?: string
): void {
  const { duplicates, score } = result;
  
  // Display duplication score prominently
  console.log('\n' + '═'.repeat(80));
  console.log(`\n📊 DUPLICATION SCORE: ${score.score.toFixed(2)}% - ${score.grade}`);
  console.log(`   Total Lines: ${score.totalLines.toLocaleString()}`);
  console.log(`   Duplicate Lines (weighted): ${score.duplicateLines.toLocaleString()}`);
  console.log(`   Duplicate Groups: ${score.duplicateGroups}`);
  console.log('\n' + '═'.repeat(80));
  
  if (reportPath) {
    console.log(`\n🗂  Report saved to ${reportPath}`);
  }

  if (duplicates.length === 0) {
    console.log(`\n✓ No duplicates found (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
    return;
  }
  
  console.log(`\n🔍 Found ${duplicates.length} duplicate group(s) (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
  console.log('═'.repeat(80));
  
  duplicates.forEach((group, index) => {
    const similarityPercent = (group.similarity * 100).toFixed(1);
    const exclusionString = group.exclusionString;
    const shortId = group.shortId;
    
    console.log(`\n[${index + 1}] Similarity: ${similarityPercent}%`);
    console.log('─'.repeat(80));

    if (shortId) {
      console.log(`Exclusion ID: ${shortId}`);
    }
    if (exclusionString) {
      console.log(`Exclusion key: ${exclusionString}`);
    }
    
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
    const config = await loadDryConfig(repoPath);
    const scanner = new DryScan(repoPath, config);
    await scanner.init();
    console.log('DryScan initialized successfully');
  });

program
  .command('update')
  .description('Update the DryScan index (incremental scan for changes)')
  .argument('[path]', 'Repository path', '.')
  .action(async (path: string) => {
    const repoPath = resolve(path);
    const config = await loadDryConfig(repoPath);
    const scanner = new DryScan(repoPath, config);
    await scanner.updateIndex();
    console.log('DryScan index updated successfully');
  });

const dupesCommand = program
  .command('dupes')
  .description('Find duplicate code blocks');

dupesCommand
  .argument('[path]', 'Repository path', '.')
  .option('--json', 'Output results as JSON')
  .option('--ui', 'Serve interactive report at http://localhost:3000')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)')
  .action(async (path: string, options: { json?: boolean; ui?: boolean; threshold?: string }) => {
    const repoPath = resolve(path);
    const threshold = options.threshold ? parseFloat(options.threshold) : undefined;

    const config = await loadDryConfig(repoPath);
    const scanner = new DryScan(repoPath, config);
    const result = await scanner.findDuplicates(threshold);
    const displayThreshold = threshold ?? config.threshold ?? 0.85;

    const report = buildDuplicateReport(result.duplicates, displayThreshold, result.score);
    const reportPath = await writeDuplicateReport(repoPath, report);
    const output = { ...result, duplicates: report.duplicates };
    
    if (options.ui) {
      const server = new DuplicateReportServer({
        repoPath,
        threshold: displayThreshold,
        duplicates: report.duplicates,
        score: result.score,
        port: UI_PORT,
      });
      await server.start();
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        ...output,
        reportPath,
        generatedAt: report.generatedAt,
      }, null, 2));
    } else {
      formatDuplicates(output, displayThreshold, reportPath);
    }
  });

dupesCommand
  .command('exclude')
  .description('Add the duplicate pair identified by short id to .dryconfig.json from the latest report')
  .argument('<id>', 'Short id from the latest dryscan report')
  .argument('[path]', 'Repository path', '.')
  .action(async (id: string, path: string) => {
    const repoPath = resolve(path);
    const { exclusion, added } = await applyExclusionFromLatestReport(repoPath, id);
    if (added) {
      console.log(`Added exclusion: ${exclusion}`);
    } else {
      console.log(`Exclusion already present: ${exclusion}`);
    }
  });

program
  .command('clean')
  .description('Remove excludedPairs entries that no longer match indexed code')
  .argument('[path]', 'Repository path', '.')
  .action(async (path: string) => {
    const repoPath = resolve(path);
    const config = await loadDryConfig(repoPath);
    const scanner = new DryScan(repoPath, config);
    const { kept, removed } = await scanner.cleanExclusions();
    console.log(`Clean complete. Kept ${kept} exclusions, removed ${removed}.`);
  });

program.parse();
