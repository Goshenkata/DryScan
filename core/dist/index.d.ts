declare enum IndexUnitType {
    CLASS = "class",
    FUNCTION = "function",
    BLOCK = "block"
}
interface DuplicateGroup {
    id: string;
    similarity: number;
    left: DuplicateSide;
    right: DuplicateSide;
    shortId: string;
    exclusionString: string;
}
interface DuplicationScore {
    score: number;
    grade: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical';
    totalLines: number;
    duplicateLines: number;
    duplicateGroups: number;
}
interface DuplicateReport {
    version: number;
    generatedAt: string;
    threshold: number;
    grade: DuplicationScore["grade"];
    score: DuplicationScore;
    duplicates: DuplicateGroup[];
}
interface DuplicateSide {
    id: string;
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    code: string;
    unitType: IndexUnitType;
}
interface DryConfig {
    excludedPaths: string[];
    excludedPairs: string[];
    minLines: number;
    minBlockLines: number;
    threshold: number;
    embeddingModel: string;
    embeddingSource?: string;
    contextLength: number;
}
interface IndexUnit {
    id: string;
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    code: string;
    unitType: IndexUnitType;
    parentId?: string | null;
    parent?: IndexUnit | null;
    children?: IndexUnit[];
    embedding?: number[] | null;
}

interface LanguageExtractor {
    readonly id: string;
    readonly exts: string[];
    supports(filePath: string): boolean;
    extractFromText(filePath: string, source: string): Promise<IndexUnit[]>;
    unitLabel(unit: IndexUnit): string | null;
}

/**
 * Extracts and indexes code units (classes, functions, blocks) for a repository.
 * Owns shared file-system helpers and delegates language-specific parsing to LanguageExtractors.
 */
declare class IndexUnitExtractor {
    private readonly root;
    readonly extractors: LanguageExtractor[];
    private readonly gitignore;
    constructor(rootPath: string, extractors?: LanguageExtractor[]);
    /**
     * Lists all supported source files from a path. Honors exclusion globs from config.
     */
    listSourceFiles(dirPath: string): Promise<string[]>;
    /**
     * Computes MD5 checksum of file content to track changes.
     */
    computeChecksum(filePath: string): Promise<string>;
    /**
     * Scans a file or directory and extracts indexable units using the matching LanguageExtractor.
     * The returned units have repo-relative file paths and no embedding attached.
     */
    scan(targetPath: string): Promise<IndexUnit[]>;
    /**
     * Scans a directory recursively, extracting units from supported files while honoring exclusions.
     */
    private scanDirectory;
    /**
     * Scans a single file and extracts supported units.
     */
    private scanFile;
    /**
     * Extracts units from a supported file.
     * Optionally throws when the file type is unsupported (used when scanning an explicit file).
     */
    private tryScanSupportedFile;
    /**
     * Converts an absolute path to a repo-relative, normalized (POSIX-style) path.
     * This keeps paths stable across platforms and consistent in the index/DB.
     */
    private relPath;
    /**
     * Returns true if a repo-relative path matches any configured exclusion glob.
     */
    private shouldExclude;
    private loadConfig;
    /**
     * Normalizes repo-relative paths and strips leading "./" to keep matcher inputs consistent.
     */
    private normalizeRelPath;
    private resolveTarget;
    private filterSingleFile;
    private globSourceFiles;
    private filterSupportedFiles;
}

/**
 * Represents a tracked source file in the repository.
 * Used to detect changes via checksum and mtime for incremental updates.
 */
declare class FileEntity {
    /**
     * Relative path to the file from repository root.
     * Used as primary key for uniqueness.
     */
    filePath: string;
    /**
     * MD5 checksum of file content.
     * Used to detect content changes.
     */
    checksum: string;
    /**
     * Last modification time in milliseconds since epoch.
     * Used as fast sanity check before computing checksum.
     */
    mtime: number;
}

declare class DryScanDatabase {
    private dataSource?;
    private unitRepository?;
    private fileRepository?;
    isInitialized(): boolean;
    init(dbPath: string): Promise<void>;
    saveUnit(unit: IndexUnit): Promise<void>;
    saveUnits(units: IndexUnit | IndexUnit[]): Promise<void>;
    getUnit(id: string): Promise<IndexUnit | null>;
    getAllUnits(): Promise<IndexUnit[]>;
    updateUnit(unit: IndexUnit): Promise<void>;
    updateUnits(units: IndexUnit | IndexUnit[]): Promise<void>;
    /**
     * Returns total count of indexed units.
     */
    countUnits(): Promise<number>;
    /**
     * Removes index units by their file paths.
     * Used during incremental updates when files change.
     */
    removeUnitsByFilePaths(filePaths: string[]): Promise<void>;
    /**
     * Saves file metadata (path, checksum, mtime) to track changes.
     */
    saveFile(file: FileEntity): Promise<void>;
    /**
     * Saves multiple file metadata entries.
     */
    saveFiles(files: FileEntity[]): Promise<void>;
    /**
     * Gets file metadata by file path.
     */
    getFile(filePath: string): Promise<FileEntity | null>;
    /**
     * Gets all tracked files.
     */
    getAllFiles(): Promise<FileEntity[]>;
    /**
     * Removes file metadata entries by file paths.
     * Used when files are deleted from repository.
     */
    removeFilesByFilePaths(filePaths: string[]): Promise<void>;
    close(): Promise<void>;
}

interface InitOptions$1 {
    skipEmbeddings?: boolean;
}

type InitOptions = InitOptions$1;
declare class DryScan {
    repoPath: string;
    private readonly extractor;
    private db;
    private readonly services;
    private readonly serviceDeps;
    constructor(repoPath: string, extractor?: IndexUnitExtractor, db?: DryScanDatabase);
    /**
     * Initializes the DryScan repository with a 3-phase analysis:
     * Phase 1: Extract and save all functions
     * Phase 2: Resolve and save internal dependencies
     * Phase 3: Compute and save semantic embeddings
     */
    init(options?: InitOptions): Promise<void>;
    /**
     * Updates the index by detecting changed, new, and deleted files.
     * Only reprocesses units in changed files for efficiency.
     * Delegates to DryScanUpdater module for implementation.
     *
     * Update process:
     * 1. List all current source files in repository
     * 2. For each file, check if it's new, changed, or unchanged (via mtime + checksum)
     * 3. Remove old units from changed/deleted files
     * 4. Extract and save units from new/changed files
     * 5. Recompute internal dependencies for affected units
     * 6. Recompute embeddings for affected units
     * 7. Update file tracking metadata
     */
    updateIndex(): Promise<void>;
    /**
     * Runs duplicate detection and returns a normalized report payload ready for persistence or display.
     */
    buildDuplicateReport(): Promise<DuplicateReport>;
    /**
     * Finds duplicate code blocks using cosine similarity on embeddings.
     * Automatically updates the index before searching to ensure results are current.
     * Compares all function pairs and returns groups with similarity above the configured threshold.
     *
     * @returns Analysis result with duplicate groups and duplication score
     */
    private findDuplicates;
    /**
     * Cleans excludedPairs entries that no longer match any indexed units.
     * Runs an update first to ensure the index reflects current code.
     */
    cleanExclusions(): Promise<{
        removed: number;
        kept: number;
    }>;
    private ensureDatabase;
    private loadConfig;
    private isInitialized;
}

declare class ConfigStore {
    private readonly cache;
    private readonly loading;
    init(repoPath: string): Promise<DryConfig>;
    get(repoPath: string): Promise<DryConfig>;
    refresh(repoPath: string): Promise<DryConfig>;
    save(repoPath: string, config: DryConfig): Promise<void>;
    private load;
    private normalize;
}
declare const configStore: ConfigStore;

export { type DryConfig, DryScan, type DuplicateGroup, type DuplicateReport, type DuplicationScore, configStore };
