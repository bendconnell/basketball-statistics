import type { HttpRequest } from "@azure/functions";
import { HttpError } from "./errors.js";

export async function readBody(request: Pick<HttpRequest, "headers" | "body">): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && Number(length) >= 48 * 1024) throw new HttpError(413, "too_large", "Request must be smaller than 48 KiB");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  let count = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count >= 48 * 1024) { await reader.cancel(); throw new HttpError(413, "too_large", "Request must be smaller than 48 KiB"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!count) return undefined;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "json_required", "Content-Type application/json required");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError(400, "invalid_json", "Malformed JSON"); }
}