CREATE TABLE "action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"conversation_id" text,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"shop" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"model" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"source" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"path" text NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquid_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"title" text NOT NULL,
	"handle" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"theme_id" text,
	"page_id" text,
	"preview_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"domain" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"scopes" text NOT NULL,
	"name" text,
	"currency_code" text,
	"timezone" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquid_drafts" ADD CONSTRAINT "liquid_drafts_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;