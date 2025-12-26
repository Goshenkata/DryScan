export interface DuplicateGroup {
  id: string;
  similarity: number;
  left: DuplicateSide;
  right: DuplicateSide;
}

export interface DuplicateSide {
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
}

export interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  internalFunctions?: FunctionInfo[];
  embedding?: number[];
}

export interface EmbeddingResult {
  processed: number;
  updated: number;
  errors: string[];
}
