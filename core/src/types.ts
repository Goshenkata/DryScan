export enum IndexUnitType {
  CLASS = "class",
  FUNCTION = "function",
  BLOCK = "block",
}

export interface DuplicateGroup {
  id: string;
  similarity: number;
  left: DuplicateSide;
  right: DuplicateSide;
  shortId: string;
  exclusionString: string;
}

export interface DuplicationScore {
  score: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical';
  totalLines: number;
  duplicateLines: number;
  duplicateGroups: number;
}

export interface DuplicateAnalysisResult {
  duplicates: DuplicateGroup[];
  score: DuplicationScore;
  metrics?: DuplicateServiceMetrics;
}

/** Metrics produced by DuplicateService — subset of ScanMetrics filled during analysis. */
export interface DuplicateServiceMetrics {
  unitCounts: ScanMetrics["unitCounts"];
  pairsBeforeLLM: number;
  pairsAfterLLM: number;
  llmFilterMs: number;
}

export interface DuplicateReport {
  version: number;
  generatedAt: string;
  threshold: number;
  grade: DuplicationScore["grade"];
  score: DuplicationScore;
  duplicates: DuplicateGroup[];
  /** Scan metrics populated during duplicate analysis. */
  metrics?: ScanMetrics;
}

export interface DuplicateSide {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  unitType: IndexUnitType;
}

export interface DryConfig {
  excludedPaths: string[];
  excludedPairs: string[];
  minLines: number;
  minBlockLines: number;
  threshold: number;
  embeddingSource: string;
  contextLength: number;
  /** When true, confirmed duplicate candidates are sent to the fine-tuned LLM for false-positive filtering. Default: true. */
  enableLLMFilter: boolean;
}

export interface LLMDecision {
  truePositives: DuplicateGroup[];
  falsePositives: DuplicateGroup[];
}

export interface IndexUnit {
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

export interface EmbeddingResult {
  processed: number;
  updated: number;
  errors: string[];
}

/** Metrics collected during a full scan, used for experiment evaluation. */
export interface ScanMetrics {
  /** Number of source files scanned. */
  filesScanned: number;
  /** Total lines of code across all source files. */
  totalLinesOfCode: number;
  /** Extracted units broken down by type. */
  unitCounts: { classes: number; functions: number; blocks: number; total: number };
  /** Duplicate pairs found before LLM filtering. */
  pairsBeforeLLM: number;
  /** Duplicate pairs remaining after LLM filtering (or same as before if LLM disabled). */
  pairsAfterLLM: number;
  /** Phase timings in milliseconds. */
  timings: {
    indexUpdateMs: number;
    duplicateDetectionMs: number;
    llmFilterMs: number;
    totalMs: number;
  };
}
