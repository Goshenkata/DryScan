export interface DuplicateGroup {
  id: string;
  functions: FunctionInfo[]; // Instead of files, group by functions
  similarity: number;
  codeSnippet: string;
}

export interface FunctionInfo {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  code: string;
}

export interface EmbeddingResult {
  processed: number;
  updated: number;
  errors: string[];
}
