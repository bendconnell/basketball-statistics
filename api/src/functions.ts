import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { ZodError } from "zod";
import { approvedAccounts } from "./auth.js";
import { HttpError } from "./errors.js";
import { AzureRepository } from "./repository.js";
import { ApiService } from "./service.js";
import { SessionInvariantError } from "../../shared/reducer.js";
import { readBody } from "./http.js";

let repository: AzureRepository | undefined;
function getService(context: InvocationContext): ApiService {
  const accounts = approvedAccounts(process.env.APPROVED_USERS_JSON);
  if (!repository) {
    const connection = process.env.STORAGE_CONNECTION_STRING;
    if (!connection) throw new HttpError(503, "configuration_unavailable", "Storage configuration unavailable");
    repository = new AzureRepository(connection);
  }
  // Recheck account approval per request; don't retain an expired invocation logger.
  return new ApiService(repository, accounts, () => context.warn("Session checkpoint failed; committed operation log retained"));
}
async function handler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };
  const path = `v1/${request.params.path ?? ""}`.replace(/\/$/, "");
  if (request.method === "GET" && path === "v1/health") return { status: 200, headers, jsonBody: { status: "ok" } };
  try {
    const result = await getService(context).handle(request.method, path, request.headers, await readBody(request));
    return result.body === undefined ? { status: result.status, headers } : { status: result.status, headers, jsonBody: result.body };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, headers, jsonBody: { error: { code: e.code, message: e.message } } };
    if (e instanceof SessionInvariantError) return { status: 400, headers, jsonBody: { error: { code: "invalid_operation", message: e.message } } };
    if (e instanceof ZodError) return { status: 400, headers, jsonBody: { error: { code: "validation_failed", message: "Request validation failed", issues: e.issues.map(issue => ({ path: issue.path, message: issue.message })) } } };
    // Reducer invariants are client errors; unexpected SDK/config failures do
    // not expose credentials, principal headers, payloads or SDK diagnostics.
    if (e instanceof Error && /Operation must be smaller/.test(e.message)) return { status: 413, headers, jsonBody: { error: { code: "too_large", message: e.message } } };
    context.error("API request failed", context.invocationId);
    return { status: 500, headers, jsonBody: { error: { code: "internal_error", message: "Request failed" } } };
  }
}
app.http("v1", { route: "v1/{*path}", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], authLevel: "anonymous", handler });