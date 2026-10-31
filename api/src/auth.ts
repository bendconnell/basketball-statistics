import { z } from "zod";
import { fail } from "./errors.js";

export const accountSchema = z.object({ id: z.string().min(1).max(256), name: z.string().min(1).max(120), role: z.enum(["user", "administrator"]) }).strict();
export type LocalAccount = z.infer<typeof accountSchema>;
const principalSchema = z.object({ userId: z.string().min(1).max(256), userRoles: z.array(z.string().max(128)).max(100) }).passthrough();
export function approvedAccounts(raw: string | undefined): LocalAccount[] {
  if (!raw) return fail(503, "configuration_unavailable", "Account configuration unavailable");
  try {
    const accounts = z.array(accountSchema).min(1).max(1000).parse(JSON.parse(raw));
    if (new Set(accounts.map(a => a.id)).size !== accounts.length) throw new Error("Duplicate accounts");
    return accounts;
  } catch { return fail(503, "configuration_unavailable", "Account configuration unavailable"); }
}
// ONLY the managed SWA proxy may reach this handler. This header is not a JWT
// and cannot be securely trusted on an independently public Functions endpoint.
// Local development uses the SWA emulator with the SAME configured approved IDs.
export function authenticate(header: string | null, accounts: LocalAccount[]): LocalAccount {
  if (!header || header.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) return fail(401, "unauthenticated", "Authentication required");
  let principal: z.infer<typeof principalSchema>;
  try { principal = principalSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8"))); }
  catch { return fail(401, "unauthenticated", "Invalid authentication principal"); }
  if (!principal.userRoles.includes("authenticated")) return fail(401, "unauthenticated", "Authentication required");
  const account = accounts.find(a => a.id === principal.userId);
  if (!account) return fail(403, "not_approved", "Account is not approved");
  return account; // Never use client userDetails, claims or administrator role.
}
export function requireAdmin(account: LocalAccount): void {
  if (account.role !== "administrator") fail(403, "admin_required", "Administrator required");
}
export function requireMaster(account: LocalAccount, masterUserId: string): void {
  if (account.id !== masterUserId) fail(403, "master_required", "Session master required");
}