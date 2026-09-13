CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "graph_id" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "plain_text" TEXT NOT NULL DEFAULT '',
    "yjs_state" BYTEA,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "documents_graph_id_key" ON "documents"("graph_id");
