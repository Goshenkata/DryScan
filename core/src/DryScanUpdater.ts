import path from "path";
import fs from "fs/promises";
import debug from "debug";
import { IndexUnit } from "./types";
import { IndexUnitExtractor } from "./IndexUnitExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
import { FileEntity } from "./db/entities/FileEntity";
import { OllamaEmbeddings } from "@langchain/ollama";
import { configStore } from "./config/configStore";

const log = debug("DryScan:Updater");

/**
 * DryScan Updater Module
 * 
 * This module contains all incremental update logic for DryScan.
 * Separated from DryScan.ts to keep that file focused on core operations.
 * 
 * Represents the result of change detection.
 * Categorizes files into added, changed, deleted, and unchanged.
 */
export interface FileChangeSet {
  added: string[];
  changed: string[];
  deleted: string[];
  unchanged: string[];
}

/**
 * Detects which files have been added, changed, or deleted since last scan.
 * Uses mtime as fast check, then checksum for verification.
 * 
 * @param repoPath - Root path of the repository
 * @param extractor - Index unit extractor instance for file operations
 * @param db - Database instance for retrieving tracked files
 * @returns Change set with categorized file paths
 */
export async function detectFileChanges(
  repoPath: string,
  extractor: IndexUnitExtractor,
  db: DryScanDatabase
): Promise<FileChangeSet> {
  // Get current files in repository
  const currentFiles = await extractor.listSourceFiles(repoPath);
  const currentFileSet = new Set(currentFiles);

  // Get tracked files from database
  const trackedFiles = await db.getAllFiles();
  const trackedFileMap = new Map(trackedFiles.map(f => [f.filePath, f]));

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  // Check each current file
  for (const filePath of currentFiles) {
    const tracked = trackedFileMap.get(filePath);
    
    if (!tracked) {
      // New file
      added.push(filePath);
      continue;
    }

    // Check if file changed using mtime first (fast check)
    const fullPath = path.join(repoPath, filePath);
    const stat = await fs.stat(fullPath);
    
    if (stat.mtimeMs !== tracked.mtime) {
      // Mtime changed, verify with checksum
      const currentChecksum = await extractor.computeChecksum(fullPath);
      if (currentChecksum !== tracked.checksum) {
        changed.push(filePath);
      } else {
        // Mtime changed but content same
        unchanged.push(filePath);
      }
    } else {
      unchanged.push(filePath);
    }
  }

  // Find deleted files
  const deleted = trackedFiles
    .map(f => f.filePath)
    .filter(fp => !currentFileSet.has(fp));

  return { added, changed, deleted, unchanged };
}

/**
 * Extracts index units from a list of files.
 * Used during incremental updates.
 * 
 * @param filePaths - Array of relative file paths to extract from
 * @param extractor - Index unit extractor instance
 * @returns Array of extracted units
 */
export async function extractUnitsFromFiles(
  filePaths: string[],
  extractor: IndexUnitExtractor
): Promise<IndexUnit[]> {
  const allUnits: IndexUnit[] = [];
  
  for (const relPath of filePaths) {
    const functions = await extractor.scan(relPath);
    allUnits.push(...functions);
  }
  
  return allUnits;
}

/**
 * Updates file tracking metadata after processing changes.
 * Removes deleted files, updates changed files, adds new files.
 * 
 * @param changeSet - Set of file changes to apply
 * @param repoPath - Root path of the repository
 * @param extractor - Index unit extractor for checksum computation
 * @param db - Database instance for file tracking
 */
export async function updateFileTracking(
  changeSet: FileChangeSet,
  repoPath: string,
  extractor: IndexUnitExtractor,
  db: DryScanDatabase
): Promise<void> {
  // Remove deleted files
  if (changeSet.deleted.length > 0) {
    if (typeof (db as any).removeFilesByFilePaths === "function") {
      await (db as any).removeFilesByFilePaths(changeSet.deleted);
    } else if (typeof (db as any).removeFiles === "function") {
      await (db as any).removeFiles(changeSet.deleted);
    }
  }

  // Create file entities for new and changed files
  const filesToTrack = [...changeSet.added, ...changeSet.changed];
  if (filesToTrack.length > 0) {
    const fileEntities: FileEntity[] = [];
    
    for (const relPath of filesToTrack) {
      const fullPath = path.join(repoPath, relPath);
      const stat = await fs.stat(fullPath);
      const checksum = await extractor.computeChecksum(fullPath);
      
      const fileEntity = new FileEntity();
      fileEntity.filePath = relPath;
      fileEntity.checksum = checksum;
      fileEntity.mtime = stat.mtimeMs;
      
      fileEntities.push(fileEntity);
    }
    
    await db.saveFiles(fileEntities);
  }
}

/**
 * Computes semantic embedding for a single function.
 * Uses Ollama with embeddinggemma model.
 * 
 * @param fn - Function to compute embedding for
 * @returns Function with embedding populated
 */
export async function addEmbedding(repoPath: string, fn: IndexUnit): Promise<IndexUnit> {
  try {
    const config = await configStore.get(repoPath);
    const maxContext = config?.contextLength ?? 2048;
    if (fn.code.length > maxContext) {
      log("Skipping embedding for %s (code length %d exceeds context %d)", fn.id, fn.code.length, maxContext);
      return { ...fn, embedding: null };
    }
    const embeddings = new OllamaEmbeddings({
      model: config?.embeddingModel || "embeddinggemma",
      baseUrl: config?.embeddingBaseUrl || process.env.OLLAMA_API_URL || "http://localhost:11434",
    });
    const embedding = await embeddings.embedQuery(fn.code);
    fn.embedding = embedding;
    return fn;
  } catch (err) {
    log("Embedding provider failed, please connect to Ollama API or Cloud AI:", err);
    throw err;
  }
}


/**
 * Performs incremental update of the DryScan index.
 * Detects file changes and reprocesses only affected files.
 * 
 * @param repoPath - Root path of the repository
 * @param extractor - Index unit extractor instance
 * @param db - Database instance (must be initialized)
 */
export async function performIncrementalUpdate(
  repoPath: string,
  extractor: IndexUnitExtractor,
  db: DryScanDatabase,
): Promise<FileChangeSet> {
  log("Starting incremental update");
  
  // Step 1: Detect changes
  const changeSet = await detectFileChanges(repoPath, extractor, db);
  
  if (changeSet.changed.length === 0 && 
      changeSet.added.length === 0 && 
      changeSet.deleted.length === 0) {
    log("No changes detected. Index is up to date.");
    return changeSet;
  }

  log(`Changes detected: ${changeSet.added.length} added, ${changeSet.changed.length} changed, ${changeSet.deleted.length} deleted`);

  // Step 2: Remove old data for changed/deleted files
  const filesToRemove = [...changeSet.changed, ...changeSet.deleted];
  if (filesToRemove.length > 0) {
      await db.removeUnitsByFilePaths(filesToRemove);
      log(`Removed units from ${filesToRemove.length} files`);
  }

  // Step 3: Extract functions from new/changed files
  const filesToProcess = [...changeSet.added, ...changeSet.changed];
  if (filesToProcess.length > 0) {
    const newUnits = await extractUnitsFromFiles(filesToProcess, extractor);
      await db.saveUnits(newUnits);
      log(`Extracted and saved ${newUnits.length} units from ${filesToProcess.length} files`);

    // Step 4: Recompute embeddings for affected units only
    const total = newUnits.length;
    if (total > 0) {
      log(`Recomputing embeddings for ${total} units`);
      const progressInterval = Math.max(1, Math.ceil(total / 10));
      const updatedWithEmbeddings = [] as IndexUnit[];

      for (let i = 0; i < total; i++) {
        const unit = newUnits[i];
        try {
          const enriched = await addEmbedding(repoPath, unit);
          updatedWithEmbeddings.push(enriched);
        } catch (err: any) {
          console.error(
            `[DryScan] embedding failed for ${unit.filePath} (${unit.name}): ${err?.message || err}`
          );
          throw err;
        }

        const completed = i + 1;
        if (completed === total || completed % progressInterval === 0) {
          const pct = Math.floor((completed / total) * 100);
          console.log(`[DryScan] Incremental embeddings ${completed}/${total} (${pct}%)`);
        }
      }

      await db.updateUnits(updatedWithEmbeddings);
      log(`Recomputed embeddings for ${updatedWithEmbeddings.length} units`);
    }
  }

  // Step 5: Update file tracking
  await updateFileTracking(changeSet, repoPath, extractor, db);
  log("Incremental update complete");

  return changeSet;
}
