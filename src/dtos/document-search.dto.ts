export interface SearchDocumentsQuery {
  q: string;
  workspace_graph_id: string;
}

export interface SearchResultItem {
  graph_id: string;
  rank: number;
  headline: string;
}

export interface SearchDocumentsResponse {
  results: SearchResultItem[];
}
