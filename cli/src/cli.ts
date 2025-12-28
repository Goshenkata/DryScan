#!/usr/bin/env node
import { Command } from 'commander';
import { DryScan, DuplicateGroup } from '@dryscan/core';
import { resolve } from 'path';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { URL } from 'url';

const UI_PORT = 3000;

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
  .command('update')
  .description('Update the DryScan index (incremental scan for changes)')
  .argument('[path]', 'Repository path', '.')
  .action(async (path: string) => {
    const repoPath = resolve(path);
    const scanner = new DryScan(repoPath);
    await scanner.updateIndex();
    console.log('DryScan index updated successfully');
  });

program
  .command('dupes')
  .description('Find duplicate code blocks')
  .argument('[path]', 'Repository path', '.')
  .option('--json', 'Output results as JSON')
  .option('--ui', 'Serve interactive report at http://localhost:3000')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)', '0.85')
  .action(async (path: string, options: { json?: boolean; ui?: boolean; threshold?: string }) => {
    const repoPath = resolve(path);
    const threshold = parseFloat(options.threshold || '0.85');
    
    const scanner = new DryScan(repoPath);
    const duplicates = await scanner.findDuplicates(threshold);
    
    if (options.ui) {
      await serveUi(duplicates, repoPath, threshold);
      return;
    }

    if (options.json) {
      // Output as JSON
      console.log(JSON.stringify(duplicates, null, 2));
    } else {
      // Human-readable format
      formatDuplicates(duplicates, threshold);
    }
  });

program.parse();

async function serveUi(duplicates: DuplicateGroup[], repoPath: string, threshold: number): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/api/duplicates') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(duplicates));
      return;
    }

    if (url.pathname === '/api/file') {
      const relPath = url.searchParams.get('path');
      if (!relPath) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing path' }));
        return;
      }

      try {
        const fullPath = resolve(repoPath, relPath);
        if (!fullPath.startsWith(resolve(repoPath))) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const content = await readFile(fullPath, 'utf8');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ path: relPath, content }));
      } catch (err: any) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found', message: err?.message }));
      }
      return;
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(renderUiHtml(threshold));
  });

  server.listen(UI_PORT, () => {
    console.log(`\nUI available at http://localhost:${UI_PORT}\n`);
  });

  // Keep process alive while server runs
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.on('error', rejectPromise);
    server.on('listening', () => resolvePromise());
  });
}

function renderUiHtml(threshold: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DryScan Duplicates</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    :root {
      --bg: #0f172a;
      --panel: #111827;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #a855f7;
      --border: #1f2937;
      --card: #0b1221;
      --pill: #1e293b;
      --shadow: 0 18px 40px rgba(0,0,0,0.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 20% 20%, rgba(56,189,248,0.08), transparent 30%),
                  radial-gradient(circle at 80% 10%, rgba(168,85,247,0.08), transparent 30%),
                  var(--bg);
      color: #e2e8f0;
      font-family: 'Space Grotesk', 'IBM Plex Sans', sans-serif;
      min-height: 100vh;
      padding: 24px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    .sub {
      color: var(--muted);
      margin-top: 6px;
      font-size: 14px;
    }
    .layout {
      max-width: 1200px;
      margin: 0 auto;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      box-shadow: var(--shadow);
      margin-top: 18px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--pill);
      color: #cbd5e1;
      font-size: 12px;
      letter-spacing: 0.02em;
    }
    .pill.accent { color: var(--accent); }
    .pill.type { text-transform: uppercase; font-weight: 600; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }
    .side {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .path {
      font-family: 'IBM Plex Mono', monospace;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
      word-break: break-all;
    }
    .code {
      background: #0a0f1b;
      border: 1px solid #0f172a;
      border-radius: 10px;
      padding: 10px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12px;
      color: #e2e8f0;
      overflow: auto;
      max-height: 220px;
      white-space: pre;
    }
    .row { display: flex; align-items: center; gap: 10px; }
    .btn {
      background: linear-gradient(120deg, var(--accent), var(--accent-2));
      color: #0b1221;
      border: none;
      padding: 8px 12px;
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      box-shadow: 0 10px 24px rgba(56,189,248,0.25);
    }
    .btn:active { transform: translateY(1px); }
    .table { margin-top: 8px; }
    .muted { color: var(--muted); font-size: 12px; }
    .modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 20;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      max-width: 1000px;
      width: 100%;
      max-height: 90vh;
      overflow: auto;
      padding: 16px;
    }
    .modal h3 { margin: 0 0 10px 0; }
    .close { float: right; cursor: pointer; color: var(--muted); }
  </style>
</head>
<body>
  <div class="layout">
    <div class="header">
      <h1>DryScan Duplicate Report</h1>
      <span class="pill accent">Threshold ${Math.round(threshold * 100)}%</span>
    </div>
    <div class="sub">Interactive view of duplicate classes, functions, and blocks. Click a file to see full context.</div>
    <div id="groups"></div>
  </div>

  <div class="modal" id="modal">
    <div class="modal-content">
      <span class="close" id="modal-close">✕</span>
      <h3 id="modal-title"></h3>
      <pre class="code" id="modal-code"></pre>
    </div>
  </div>

  <script type="module">
    const state = { groups: [] };
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalCode = document.getElementById('modal-code');

    document.getElementById('modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });

    async function fetchDuplicates() {
      const res = await fetch('/api/duplicates');
      state.groups = await res.json();
      render();
    }

    async function fetchFile(path) {
      const res = await fetch('/api/file?path=' + encodeURIComponent(path));
      if (!res.ok) {
        modalTitle.textContent = 'Unable to load file';
        modalCode.textContent = await res.text();
        modal.classList.add('active');
        return;
      }
      const data = await res.json();
      modalTitle.textContent = data.path;
      modalCode.textContent = data.content;
      modal.classList.add('active');
    }

    function render() {
      const container = document.getElementById('groups');
      container.innerHTML = '';
      state.groups.forEach((group, idx) => {
        container.appendChild(renderGroup(group, idx));
      });
    }

    function pill(text, className = '') {
      const el = document.createElement('span');
      el.className = ('pill ' + className).trim();
      el.textContent = text;
      return el;
    }

    function renderGroup(group, idx) {
      const card = document.createElement('div');
      card.className = 'card';

      const header = document.createElement('div');
      header.className = 'row';
      const title = document.createElement('div');
      title.innerHTML = '<strong>Group ' + (idx + 1) + '</strong> · Similarity ' + (group.similarity * 100).toFixed(1) + '%';
      header.appendChild(title);
      header.appendChild(pill(group.left.unitType, 'type'));
      card.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'grid';
      grid.appendChild(renderSide(group.left, 'Left', group.similarity));
      grid.appendChild(renderSide(group.right, 'Right', group.similarity));
      card.appendChild(grid);
      return card;
    }

    function renderSide(side, label, similarity) {
      const wrap = document.createElement('div');
      wrap.className = 'side';

      const row = document.createElement('div');
      row.className = 'row';
      const title = document.createElement('div');
      title.innerHTML = '<strong>' + label + '</strong> · ' + side.name;
      row.appendChild(title);
      row.appendChild(pill(side.unitType, 'type'));
      wrap.appendChild(row);

      const path = document.createElement('div');
      path.className = 'path';
      path.textContent = side.filePath + ':' + side.startLine + '-' + side.endLine;
      wrap.appendChild(path);

      const code = document.createElement('pre');
      code.className = 'code';
      code.textContent = side.code;
      wrap.appendChild(code);

      const actions = document.createElement('div');
      actions.className = 'row';
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'View full file';
      btn.dataset.action = 'view-file';
      btn.dataset.path = side.filePath;
      actions.appendChild(btn);
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = 'Lines ' + side.startLine + '-' + side.endLine + ' · Similarity ' + (similarity * 100).toFixed(1) + '%';
      actions.appendChild(meta);
      wrap.appendChild(actions);
      return wrap;
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.action === 'view-file') {
        fetchFile(target.dataset.path);
      }
    });

    fetchDuplicates();
  </script>
</body>
</html>`;
}
