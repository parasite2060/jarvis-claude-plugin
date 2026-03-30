export interface MemorySearchResult {
  content: string;
  relevance: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResponse {
  data: {
    results: MemorySearchResult[];
    query: string;
    method: string;
  };
  status: string;
}

export interface MemoryAddResponse {
  data: {
    memoryId: string;
    status: string;
  };
  status: string;
}
