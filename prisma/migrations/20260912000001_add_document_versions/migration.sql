CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "graph_id" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "plain_text" TEXT NOT NULL DEFAULT '',
    "yjs_state" BYTEA,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "documents"("graph_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_doc_versions_graph_created" ON "document_versions"("graph_id", "created_at");
CREATE INDEX "idx_doc_versions_graph_source" ON "document_versions"("graph_id", "source_version");
