export interface CollaborationAuthResponse {
  /** Deterministic room identity, e.g. "doc:<graph_id>" */
  room: string;
  /** JWT scoped to this room and permission level */
  token: string;
  /** WebSocket endpoint for this document, e.g. "wss://host/collaboration" */
  websocketUrl: string;
  /** Permission level granted: "read" or "edit" */
  permission: 'read' | 'edit';
}
