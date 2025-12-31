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
}

export interface DuplicateReport {
  version: number;
  generatedAt: string;
  threshold: number;
  score: DuplicationScore;
  duplicates: DuplicateGroup[];
}

export interface DuplicateSide {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  unitType: IndexUnitType;
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
  callDependencies?: IndexUnit[];
  embedding?: number[];
}

export interface EmbeddingResult {
  processed: number;
  updated: number;
  errors: string[];
}
