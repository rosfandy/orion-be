export interface SaveDocumentDto {
  content?: Record<string, unknown>;
  plainText?: string | null;
  yjsState?: string | null;
  baseVersion: number;
}

export interface LoadDocumentResponse {
  graph_id: string;
  content: Record<string, unknown>;
  plain_text: string;
  version: number;
  has_content: boolean;
}
