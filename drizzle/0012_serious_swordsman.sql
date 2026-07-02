CREATE TABLE "crm"."embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(3072) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_source_uq" UNIQUE("source_type","source_id"),
	CONSTRAINT "embeddings_source_type_check" CHECK ("crm"."embeddings"."source_type" IS NULL OR "crm"."embeddings"."source_type" IN ('memo', 'task', 'need_memo', 'need_customer_note', 'need_review_note', 'consultation'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_hnsw_idx" ON "crm"."embeddings" USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
