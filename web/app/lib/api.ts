import { z } from "zod";

/** Go serialises empty slices as null; accept both. */
const arr = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);

// ---- schemas (kept in sync with the Go structs in internal/api, internal/jobs, internal/engine)

export const ResourceTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  global: z.boolean(),
  risk: z.enum(["low", "medium", "high"]),
});
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ServiceSchema = z.object({
  id: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  defaultSelected: z.boolean(),
  resourceTypes: z.array(ResourceTypeSchema),
});
export type Service = z.infer<typeof ServiceSchema>;

export const RegionSchema = z.object({ code: z.string(), group: z.string() });
export type Region = z.infer<typeof RegionSchema>;

export const SessionInfoSchema = z.object({
  sessionId: z.string().optional(),
  accountId: z.string(),
  arn: z.string(),
  userId: z.string(),
  iamUserName: z.string().optional(),
  principal: z.string().optional(),
  isTemporary: z.boolean(),
  expiresAt: z.string(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SelectionSchema = z.object({
  resourceType: z.string(),
  region: z.string(),
  identifier: z.string(),
});
export type Selection = z.infer<typeof SelectionSchema>;

export const SpecSchema = z.object({
  mode: z.enum(["scan", "nuke"]),
  regions: arr(z.string()),
  resourceTypes: arr(z.string()),
  olderThan: z.string().optional(),
  excludeIamUserName: z.string().optional(),
  selections: arr(SelectionSchema).optional(),
  parallelism: z.number().optional(),
});
export type Spec = z.infer<typeof SpecSchema>;

export const FoundResourceSchema = z.object({
  resourceType: z.string(),
  region: z.string(),
  identifier: z.string(),
  nukable: z.boolean(),
  reason: z.string().optional(),
});
export type FoundResource = z.infer<typeof FoundResourceSchema>;

export const DeleteResultSchema = z.object({
  resourceType: z.string(),
  region: z.string(),
  identifier: z.string(),
  success: z.boolean(),
  warning: z.boolean().optional(),
  error: z.string().optional(),
  note: z.string().optional(),
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

export const GeneralErrorSchema = z.object({
  resourceType: z.string(),
  message: z.string(),
  error: z.string(),
});
export type GeneralError = z.infer<typeof GeneralErrorSchema>;

export const SummarySchema = z.object({
  mode: z.enum(["scan", "nuke"]),
  found: z.number(),
  nukable: z.number(),
  notNukable: z.number(),
  generalErrors: z.number(),
  deleted: z.number(),
  warned: z.number(),
  failed: z.number(),
  alreadyGone: z.number(),
  notSelected: z.number(),
});
export type Summary = z.infer<typeof SummarySchema>;

export const JobStateSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobSchema = z.object({
  id: z.string(),
  mode: z.enum(["scan", "nuke"]),
  state: JobStateSchema,
  phase: z.string().optional(),
  accountId: z.string(),
  spec: SpecSchema,
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  lastSeq: z.number(),
  scanned: z.number(),
  found: arr(FoundResourceSchema),
  results: arr(DeleteResultSchema),
  errors: arr(GeneralErrorSchema),
  summary: SummarySchema.optional(),
  logTail: arr(z.string()).optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const EventTypeSchema = z.enum([
  "phase",
  "scan_progress",
  "resource_found",
  "general_error",
  "nuke_progress",
  "resource_deleted",
  "summary",
  "fatal",
  "log",
]);
export type EventType = z.infer<typeof EventTypeSchema>;
export const EVENT_TYPES = EventTypeSchema.options;

export const EventSchema = z.object({
  seq: z.number(),
  type: EventTypeSchema,
  at: z.string(),
  phase: z.string().optional(),
  message: z.string().optional(),
  resourceType: z.string().optional(),
  region: z.string().optional(),
  identifier: z.string().optional(),
  nukable: z.boolean().optional(),
  reason: z.string().optional(),
  success: z.boolean().optional(),
  warning: z.boolean().optional(),
  error: z.string().optional(),
  note: z.string().optional(),
  batchSize: z.number().optional(),
  summary: SummarySchema.optional(),
});
export type JobEvent = z.infer<typeof EventSchema>;

export function isTerminal(state: JobState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function selectionKey(s: { resourceType: string; region: string; identifier: string }): string {
  return `${s.resourceType}\u0000${s.region}\u0000${s.identifier}`;
}

// ---- client

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "X-Broom-Client": "web",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return schema.parse(undefined);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `HTTP ${res.status}`);
  }
  return schema.parse(body);
}

export const api = {
  catalog: () => request(z.object({ services: arr(ServiceSchema), version: z.string().optional(), engine: z.string().optional() }), "/api/catalog"),

  createSession: (body: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }) =>
    request(SessionInfoSchema, "/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  getSession: () => request(SessionInfoSchema, "/api/session"),
  deleteSession: () => request(z.undefined(), "/api/session", { method: "DELETE" }),
  regions: () => request(z.object({ regions: arr(RegionSchema) }), "/api/session/regions"),

  createScan: (body: { regions: string[]; resourceTypes: string[]; olderThanHours?: number }) =>
    request(z.object({ jobId: z.string(), job: JobSchema }), "/api/scans", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createNuke: (body: { scanJobId: string; confirmAccountId: string; selections: Selection[] }) =>
    request(z.object({ jobId: z.string(), job: JobSchema }), "/api/nukes", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  job: (id: string) => request(JobSchema, `/api/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) =>
    request(z.object({ state: JobStateSchema }), `/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  eventsUrl: (id: string, after: number) => `/api/jobs/${encodeURIComponent(id)}/events?after=${after}`,
};
