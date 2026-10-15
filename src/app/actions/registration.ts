"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runRegistrationAutomations } from "@/lib/email/automations";
import { getPublicCourse, getPublicForm } from "@/lib/data/public-courses";
import { buildRegistrationSchema, readRegistrationForm, splitRegistration } from "@/lib/forms/registration";
import { checkRateLimit, clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";

export type RegistrationState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, unknown>;
};

const MIN_FILL_MS = 2500;
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer"] as const;

/**
 * Public course registration. Server-side validation against the course's
 * configured fields, honeypot + timing + per-IP rate limit + one-time form
 * token, then an atomic insert in the database (submit_registration).
 */
export async function submitRegistration(slug: string, requestedChannel: "public_form" | "demo_request", _prev: RegistrationState, formData: FormData): Promise<RegistrationState> {
  const [form, course] = await Promise.all([getPublicForm(slug), getPublicCourse(slug)]);
  if (!form || !course) return { error: "This course is no longer available." };
  // The course decides what a submission is (Courses › Registration type); the
  // value bound in the browser is ignored so it cannot be tampered with.
  void requestedChannel;
  const channel: "public_form" | "demo_request" = course.registration_mode === "demo" ? "demo_request" : "public_form";
  if (!form.course.registration_open) return { error: "Registration for this course is closed." };

  const raw = readRegistrationForm(form.fields, formData);

  // Bots: hidden honeypot field filled in, or form submitted implausibly fast.
  const honeypot = String(formData.get("website") ?? "");
  const startedAt = Number(formData.get("started_at") ?? 0);
  if (honeypot || !startedAt || Date.now() - startedAt < MIN_FILL_MS) {
    console.warn(JSON.stringify({ level: "warn", msg: "registration rejected as automated" }));
    return { error: "Please take a moment to review your details and submit again.", values: raw };
  }

  const ip = await clientIp();
  const rate = await checkRateLimit(RATE_LIMITS.registrationPerIp, ip);
  if (rate === "unavailable") return { error: "Registration is temporarily unavailable. Please try again shortly.", values: raw };
  if (rate === "limited") return { error: "Too many submissions from your network. Please try again in an hour.", values: raw };

  const parsed = buildRegistrationSchema(form.fields).safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>, values: raw, error: "Please fix the highlighted fields." };
  }

  // Double-click / refresh protection: each rendered form has a one-time token.
  const token = String(formData.get("form_token") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(token) && !(await consumeRateLimit(RATE_LIMITS.registrationToken, token))) {
    redirect(`/courses/${slug}/thank-you`);
  }

  const { values, answers } = splitRegistration(form.fields, parsed.data);
  const attribution: Record<string, string> = {};
  for (const k of ATTR_KEYS) {
    const v = String(formData.get(k) ?? "").slice(0, k === "referrer" ? 500 : 120);
    if (v) attribution[k] = v;
  }

  const { data, error } = await createSupabaseAdminClient().rpc("submit_registration", {
    p_course_slug: slug,
    p_values: values as never,
    p_answers: answers as never,
    p_attribution: attribution,
    p_channel: channel,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "registration failed", code: error.code }));
    return {
      error: error.code === "55000" ? "Registration for this course is closed." : "We couldn't save your registration. Please try again.",
      values: raw,
    };
  }

  // --- Email automations (src/lib/email/automations.ts) ---------------------
  // Runs after the response, so email problems never delay or break the
  // visitor's redirect. The runner never throws and logs every attempt.
  const registrationId = (data as { registration_id?: unknown } | null)?.registration_id;
  if (typeof registrationId === "string") {
    after(() => runRegistrationAutomations(registrationId));
  }
  // --- end email automations ------------------------------------------------

  redirect(`/courses/${slug}/thank-you${channel === "demo_request" ? "?demo=1" : ""}`);
}
