export interface DocumentVersionDto {
  id: string;
  graph_id: string;
  source_version: number;
  is_manual: boolean;
  created_by: string | null;
  created_at: Date;
}

export interface DocumentVersionDetailDto extends DocumentVersionDto {
  content: Record<string, unknown>;
  plain_text: string;
  yjs_state: string | null; // base64-encoded
}

export interface AutomaticCheckpointResult {
  created?: DocumentVersionDto;
  skipped: boolean;
}

export interface CreateManualSnapshotResponse extends DocumentVersionDto {}
