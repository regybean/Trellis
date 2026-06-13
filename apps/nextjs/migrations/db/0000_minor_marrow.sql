CREATE TABLE IF NOT EXISTS "acme_assessment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessmentId" uuid NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"projectId" uuid NOT NULL,
	"startedByUserId" text NOT NULL,
	"totalNonConformances" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"phases" json NOT NULL,
	"documents" json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_bugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"description" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_chats" (
	"sessionId" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_customQuestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"question" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_diagram_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jobId" uuid NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_diagram_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"userId" text NOT NULL,
	"queries" json NOT NULL,
	"fileName" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jobId" uuid NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"userId" text NOT NULL,
	"standards" text[] NOT NULL,
	"queries" json NOT NULL,
	"documents" text[] NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_maturity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"maturityLevel" real NOT NULL,
	"completedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_projectMembers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ownerId" text NOT NULL,
	"assessmentIds" uuid[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'not_assessed' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acme_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"company" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"review" text NOT NULL,
	"role" text NOT NULL,
	"service" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'acme_assessment_events_assessmentId_acme_assessments_id_fk'
    ) THEN
        EXECUTE 'ALTER TABLE "acme_assessment_events" ADD CONSTRAINT "acme_assessment_events_assessmentId_acme_assessments_id_fk" FOREIGN KEY ("assessmentId") REFERENCES "public"."acme_assessments"("id") ON DELETE cascade ON UPDATE no action';
    END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'acme_diagram_job_events_jobId_acme_diagram_jobs_id_fk'
    ) THEN
        EXECUTE 'ALTER TABLE "acme_diagram_job_events" ADD CONSTRAINT "acme_diagram_job_events_jobId_acme_diagram_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."acme_diagram_jobs"("id") ON DELETE cascade ON UPDATE no action';
    END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'acme_job_events_jobId_acme_jobs_id_fk'
    ) THEN
        EXECUTE 'ALTER TABLE "acme_job_events" ADD CONSTRAINT "acme_job_events_jobId_acme_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."acme_jobs"("id") ON DELETE cascade ON UPDATE no action';
    END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'acme_messages_sessionId_acme_chats_sessionId_fk'
    ) THEN
        EXECUTE 'ALTER TABLE "acme_messages" ADD CONSTRAINT "acme_messages_sessionId_acme_chats_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."acme_chats"("sessionId") ON DELETE cascade ON UPDATE no action';
    END IF;
END;
$$;