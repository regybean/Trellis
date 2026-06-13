CREATE TABLE IF NOT EXISTS "acme_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metadata" json NOT NULL,
	"embeddings" vector(1024) NOT NULL,
	"external_id" varchar NOT NULL,
	"collection" varchar NOT NULL,
	"document" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_projects_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metadata" json NOT NULL,
	"embeddings" vector(1024) NOT NULL,
	"external_id" varchar NOT NULL,
	"collection" varchar NOT NULL,
	"document" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metadata" json NOT NULL,
	"embeddings" vector(1024) NOT NULL,
	"external_id" varchar NOT NULL,
	"collection" varchar NOT NULL,
	"document" text NOT NULL
);
