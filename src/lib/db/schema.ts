import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { UIMessage } from 'ai';

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const shops = pgTable('shops', {
  domain: text('domain').primaryKey(),
  accessToken: text('access_token').notNull(), // encrypted, see lib/crypto
  scopes: text('scopes').notNull(),
  name: text('name'),
  currencyCode: text('currency_code'),
  timezone: text('timezone'),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New chat'),
  model: text('model'),
  messages: jsonb('messages').$type<UIMessage[]>().notNull().default([]),
  createdAt,
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** A pinned generative-UI card; `source` is re-run on load so the widget stays live. */
export const dashboardWidgets = pgTable('dashboard_widgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<'chart' | 'kpis' | 'table'>().notNull(),
  spec: jsonb('spec').notNull(),
  source: jsonb('source').$type<{ tool: string; input: unknown; map?: unknown } | null>(),
  position: integer('position').notNull().default(0),
  /** Grid placement on the dashboard (12 columns); null until first placed. */
  layout: jsonb('layout').$type<{ x: number; y: number; w: number; h: number } | null>(),
  createdAt,
});

/** Audit trail for every write the agent performed (after user approval). */
export const actionLog = pgTable('action_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  conversationId: text('conversation_id'),
  tool: text('tool').notNull(),
  input: jsonb('input').notNull(),
  result: jsonb('result'),
  status: text('status').$type<'succeeded' | 'failed'>().notNull(),
  /** How to reverse this write (captured from the before-state), or null when it can't be undone. */
  undo: jsonb('undo').$type<{ op: string; args: unknown; summary: string } | null>(),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  /** Set on the log entry of an undo, pointing at the action it reversed. */
  undoOf: uuid('undo_of'),
  createdAt,
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  extracted: jsonb('extracted'),
  createdAt,
});

export const liquidDrafts = pgTable('liquid_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  handle: text('handle').notNull(),
  code: text('code').notNull(),
  /** 'page' renders on its own page; 'product' becomes a product template for productId. */
  target: text('target').$type<'page' | 'product'>().notNull().default('page'),
  productId: text('product_id'),
  status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
  themeId: text('theme_id'),
  pageId: text('page_id'),
  previewUrl: text('preview_url'),
  createdAt,
});

/** Preferences and facts the merchant asked the agent to remember; injected into every conversation. */
export const storeMemory = pgTable('store_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  fact: text('fact').notNull(),
  createdAt,
});

/** One agent request: model, steps, tool timings, Shopify query cost and token usage. */
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  conversationId: text('conversation_id'),
  model: text('model').notNull(),
  durationMs: integer('duration_ms'),
  steps: integer('steps').notNull().default(0),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  shopifyCost: integer('shopify_cost').notNull().default(0),
  toolCalls: jsonb('tool_calls').$type<{ tool: string; ms: number; ok: boolean }[]>().notNull().default([]),
  finishReason: text('finish_reason'),
  error: text('error'),
  createdAt,
});

export type Finding = { severity: 'critical' | 'warning' | 'info' | 'good'; title: string; detail: string };

/** Proactive briefs: computed findings plus a short written summary. */
export const insights = pgTable('insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  kind: text('kind').$type<'daily' | 'weekly'>().notNull(),
  period: text('period').notNull(),
  summary: text('summary').notNull(),
  findings: jsonb('findings').$type<Finding[]>().notNull().default([]),
  metrics: jsonb('metrics'),
  trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
  createdAt,
});

/** Generated PDF reports kept for download. */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  path: text('path').notNull(),
  size: integer('size').notNull(),
  trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
  createdAt,
});

/** Connected third-party data sources (e.g. Meta Ads), one row per shop and provider. */
export const integrations = pgTable(
  'integrations',
  {
    shop: text('shop').notNull().references(() => shops.domain, { onDelete: 'cascade' }),
    provider: text('provider').$type<'meta'>().notNull(),
    accessToken: text('access_token').notNull(), // encrypted, see lib/crypto
    accountId: text('account_id'),
    accountName: text('account_name'),
    currency: text('currency'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.shop, t.provider] })],
);

/** Per-shop automation settings for the scheduler. */
export const shopSettings = pgTable('shop_settings', {
  shop: text('shop').primaryKey().references(() => shops.domain, { onDelete: 'cascade' }),
  briefEnabled: boolean('brief_enabled').notNull().default(true),
  briefHour: integer('brief_hour').notNull().default(8),
  weeklyReportEnabled: boolean('weekly_report_enabled').notNull().default(true),
  /** 1 = Monday … 7 = Sunday, in the store's timezone. */
  weeklyReportDay: integer('weekly_report_day').notNull().default(1),
  lastBriefDate: text('last_brief_date'),
  lastReportWeek: text('last_report_week'),
});
