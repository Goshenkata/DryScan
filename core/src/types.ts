export interface DuplicateGroup {
  id: string;
  similarity: number;
  left: DuplicateSide;
  right: DuplicateSide;
}

export interface DuplicateSide {
  filePath: string;
  snippet:string
}

export interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  embedding?: number[];
  hash: string;
}

export interface EmbeddingResult {
  processed: number;
  updated: number;
  errors: string[];
}
