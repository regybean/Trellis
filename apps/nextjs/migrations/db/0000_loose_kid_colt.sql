CREATE TABLE "acme"."mastra_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"content" text NOT NULL,
	"role" text NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"resourceId" text
);
--> statement-breakpoint
CREATE TABLE "acme"."mastra_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"workingMemory" text,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acme"."mastra_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"resourceId" text NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
