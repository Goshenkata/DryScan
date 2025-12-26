#!/usr/bin/env node
import { Command } from 'commander';
import { DryScan } from '@dryscan/core';
import { resolve } from 'path';

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
  .action(async (path: string) => {
    const repoPath = resolve(path);
    const scanner = new DryScan(repoPath);
    const duplicates = await scanner.findDuplicates();
    console.log(JSON.stringify(duplicates, null, 2));
  });

program.parse();
