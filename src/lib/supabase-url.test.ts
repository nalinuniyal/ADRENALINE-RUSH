import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "./supabase-url.mjs";
import { describeProbeError } from "../../scripts/admin-password.mjs";

const REF = "https://abcdefghijklmnopqrst.supabase.co";

describe("normalizeSupabaseUrl", () => {
  it.each([
    [REF, false],
    [`${REF}/`, true],
    [`${REF}/rest/v1`, true],
    [`${REF}/rest/v1/`, true],
    [`${REF}/auth/v1/`, true],
    [` "${REF}" `, true],
    ["abcdefghijklmnopqrst.supabase.co", true],
    ["https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api", true],
  ])("%s → project URL", (input, changed) => {
    expect(normalizeSupabaseUrl(input)).toEqual({ ok: true, url: REF, changed });
  });

  it("keeps a local URL with its port", () => {
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321")).toEqual({ ok: true, url: "http://127.0.0.1:54321", changed: false });
  });

  it.each(["", "   ", "sb_publishable_abc", "ftp://x.supabase.co", undefined])("rejects %s", (input) => {
    expect(normalizeSupabaseUrl(input).ok).toBe(false);
  });
});

describe("describeProbeError", () => {
  it("explains each common failure", () => {
    expect(describeProbeError({ message: "Invalid path specified in request URL" })).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(describeProbeError({ message: "Invalid API key" })).toMatch(/SUPABASE_SECRET_KEY/);
    expect(describeProbeError({ code: "PGRST202", message: "Could not find the function public.setup_required" })).toMatch(/setup\.sql/);
    expect(describeProbeError({ message: "TypeError: fetch failed" })).toMatch(/paused/);
  });
});
