CREATE TABLE "acme"."documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"vector_id" text NOT NULL,
	"embedding" vector(1024),
	"metadata" jsonb,
	CONSTRAINT "documents_vector_id_unique" UNIQUE("vector_id")
);
