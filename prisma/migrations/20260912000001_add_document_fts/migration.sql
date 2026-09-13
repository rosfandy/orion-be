-- Add FTS support to documents table.
-- tsvector is computed from plain_text via PostgreSQL tsvector_update_trigger;
-- workspace_graph_id stores the owning workspace's Neo4j graph_id for efficient filtering.

ALTER TABLE "documents"
  ADD COLUMN "workspace_graph_id" TEXT,
  ADD COLUMN "search_vector" tsvector;

CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON "documents" USING GIN ("search_vector");
