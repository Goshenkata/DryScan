import Handlebars from 'handlebars';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  DryScan,
  DuplicateAnalysisResult,
  buildDuplicateReport,
  writeDuplicateReport,
  resolveDryConfig,
} from '@dryscan/core';
import { DuplicateReportServer } from './uiServer.js';

const UI_PORT = 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

let duplicatesTemplate: Handlebars.TemplateDelegate | null = null;

async function loadDuplicatesTemplate(): Promise<Handlebars.TemplateDelegate> {
  if (duplicatesTemplate) return duplicatesTemplate;

  const templatesDir = resolve(__dirname, 'templates');
  const [duplicateTemplateSource, codeSnippetSource] = await Promise.all([
    readFile(resolve(templatesDir, 'duplicate-cli.hbs'), 'utf8'),
    readFile(resolve(templatesDir, 'code-snippet.hbs'), 'utf8'),
  ]);

  Handlebars.registerPartial('codeSnippet', codeSnippetSource);
  duplicatesTemplate = Handlebars.compile(duplicateTemplateSource);
  return duplicatesTemplate;
}

type DupesOptions = { json?: boolean; ui?: boolean };
type SnippetLine = { num: string; content: string };
type SnippetView = { lines: SnippetLine[]; truncatedCount?: number };

type DuplicateTemplateData = {
  reportPath?: string;
  thresholdPercent: string;
  hasDuplicates: boolean;
  duplicatesCount: number;
  dividers: {
    heavy: string;
    light: string;
    vs: string;
  };
  score: {
    percent: string;
    grade: string;
    totalLines: string;
    duplicateLines: string;
    duplicateGroups: string;
  };
  groups: Array<{
    index: number;
    similarityPercent: string;
    shortId?: string;
    exclusionString?: string;
    left: SnippetView & {
      filePath: string;
      startLine: number;
      endLine: number;
    };
    right: SnippetView & {
      filePath: string;
      startLine: number;
      endLine: number;
    };
  }>;
};

function toSnippetView(code: string, maxLines = 15): SnippetView {
  const lines = code.split('\n');
  const displayLines = lines.slice(0, maxLines);

  return {
    lines: displayLines.map((line, idx) => ({
      num: (idx + 1).toString().padStart(3, ' '),
      content: line,
    })),
    truncatedCount: lines.length > maxLines ? lines.length - maxLines : undefined,
  };
}

function toDuplicateTemplateData(
  result: DuplicateAnalysisResult,
  threshold: number,
  reportPath?: string
): DuplicateTemplateData {
  const { duplicates, score } = result;
  const thresholdPercent = (threshold * 100).toFixed(0);

  return {
    reportPath,
    thresholdPercent,
    hasDuplicates: duplicates.length > 0,
    duplicatesCount: duplicates.length,
    dividers: {
      heavy: '═'.repeat(80),
      light: '─'.repeat(80),
      vs: `${'~'.repeat(40)} VS ${'~'.repeat(40)}`,
    },
    score: {
      percent: score.score.toFixed(2),
      grade: score.grade,
      totalLines: score.totalLines.toLocaleString(),
      duplicateLines: score.duplicateLines.toLocaleString(),
      duplicateGroups: score.duplicateGroups.toLocaleString(),
    },
    groups: duplicates.map((group, index) => ({
      index: index + 1,
      similarityPercent: (group.similarity * 100).toFixed(1),
      shortId: group.shortId,
      exclusionString: group.exclusionString ?? undefined,
      left: {
        filePath: group.left.filePath,
        startLine: group.left.startLine,
        endLine: group.left.endLine,
        ...toSnippetView(group.left.code),
      },
      right: {
        filePath: group.right.filePath,
        startLine: group.right.startLine,
        endLine: group.right.endLine,
        ...toSnippetView(group.right.code),
      },
    })),
  };
}

async function renderDuplicateReport(
  result: DuplicateAnalysisResult,
  threshold: number,
  reportPath?: string
): Promise<void> {
  const template = await loadDuplicatesTemplate();
  const view = toDuplicateTemplateData(result, threshold, reportPath);
  const rendered = template(view).trimEnd();
  console.log('\n' + rendered + '\n');
}

export async function handleDupesCommand(path: string, options: DupesOptions): Promise<void> {
  const repoPath = resolve(path);
  const config = await resolveDryConfig(repoPath);
  const scanner = new DryScan(repoPath, config);
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
    await renderDuplicateReport(output, displayThreshold, reportPath);
  }
}
