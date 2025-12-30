import { resolve } from 'path';
import {
  DryScan,
  DuplicateAnalysisResult,
  buildDuplicateReport,
  writeDuplicateReport,
  configStore,
} from '@dryscan/core';
import { DuplicateReportServer } from './uiServer.js';

const UI_PORT = 3000;

type DupesOptions = { json?: boolean; ui?: boolean };

function formatCodeSnippet(code: string, maxLines: number = 15): string {
  const lines = code.split('\n');
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  const formatted = displayLines
    .map((line, i) => {
      const lineNum = (i + 1).toString().padStart(3, ' ');
      return `  ${lineNum} │ ${line}`;
    })
    .join('\n');

  return formatted + (truncated ? `\n  ... │ (${lines.length - maxLines} more lines)` : '');
}

function formatDuplicates(
  result: DuplicateAnalysisResult,
  threshold: number,
  reportPath?: string
): void {
  const { duplicates, score } = result;

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

    console.log(`\n📄 ${group.left.filePath}:${group.left.startLine}-${group.left.endLine}`);
    console.log(formatCodeSnippet(group.left.code));

    console.log('\n' + '~'.repeat(40) + ' VS ' + '~'.repeat(40) + '\n');

    console.log(`📄 ${group.right.filePath}:${group.right.startLine}-${group.right.endLine}`);
    console.log(formatCodeSnippet(group.right.code));

    if (index < duplicates.length - 1) {
      console.log('\n' + '═'.repeat(80));
    }
  });

  console.log('\n' + '═'.repeat(80) + '\n');
}

export async function handleDupesCommand(path: string, options: DupesOptions): Promise<void> {
  const repoPath = resolve(path);
  await configStore.init(repoPath);
  const config = await configStore.get(repoPath);
  const scanner = new DryScan(repoPath);
  const result = await scanner.findDuplicates();
  const displayThreshold = config.threshold;

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
    console.log(
      JSON.stringify(
        {
          ...output,
          reportPath,
          generatedAt: report.generatedAt,
        },
        null,
        2
      )
    );
  } else {
    formatDuplicates(output, displayThreshold, reportPath);
  }
}
