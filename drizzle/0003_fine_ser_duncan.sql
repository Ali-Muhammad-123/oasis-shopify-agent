CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"conversation_id" text,
	"model" text NOT NULL,
	"duration_ms" integer,
	"steps" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"shopify_cost" integer DEFAULT 0 NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"summary" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"shop" text NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"account_id" text,
	"account_name" text,
	"currency" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_shop_provider_pk" PRIMARY KEY("shop","provider")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"title" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"shop" text PRIMARY KEY NOT NULL,
	"brief_enabled" boolean DEFAULT true NOT NULL,
	"brief_hour" integer DEFAULT 8 NOT NULL,
	"weekly_report_enabled" boolean DEFAULT true NOT NULL,
	"weekly_report_day" integer DEFAULT 1 NOT NULL,
	"last_brief_date" text,
	"last_report_week" text
);
--> statement-breakpoint
CREATE TABLE "store_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop" text NOT NULL,
	"fact" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "undo" jsonb;--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "undo_of" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memory" ADD CONSTRAINT "store_memory_shop_shops_domain_fk" FOREIGN KEY ("shop") REFERENCES "public"."shops"("domain") ON DELETE cascade ON UPDATE no action;