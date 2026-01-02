#!/usr/bin/env node
import { Command } from 'commander';
import {
  DryScan,
  configStore,
} from '@goshenkata/dryscan-core';
import { resolve } from 'path';
import { handleDupesCommand } from './dupes.js';
import { applyExclusionFromLatestReport } from './reports.js';

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
    await configStore.init(repoPath);
    const scanner = new DryScan(repoPath);
    await scanner.init();
    console.log('DryScan initialized successfully');
  });

program
  .command('update')
  .description('Update the DryScan index (incremental scan for changes)')
  .argument('[path]', 'Repository path', '.')
  .action(async (path: string) => {
    const repoPath = resolve(path);
    await configStore.init(repoPath);
    const scanner = new DryScan(repoPath);
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
  .action(handleDupesCommand);

dupesCommand
  .command('exclude')
  .description('Add the duplicate pair identified by short id to dryconfig.json from the latest report')
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
    await configStore.init(repoPath);
    const scanner = new DryScan(repoPath);
    const { kept, removed } = await scanner.cleanExclusions();
    console.log(`Clean complete. Kept ${kept} exclusions, removed ${removed}.`);
  });

program.parse();