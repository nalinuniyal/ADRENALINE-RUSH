"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import type { Database } from "@/lib/database.types";
import { CURRICULUM_LIMITS, parseCurriculum } from "@/lib/forms/curriculum";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  categorySchema,
  courseSchema,
  curriculumSchema,
  integrityErrorForChange,
  isReservedFieldKey,
  nextCopySlug,
  registrationFieldSchema,
  type CourseFormOutput,
  type FieldState,
} from "@/lib/validation/courses";

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Id of a created record, when the action creates one. */
  id?: string;
};

type CourseUpdate = Database["public"]["Tables"]["courses"]["Update"];
type PgError = { code?: string; message?: string } | null;

const idSchema = z.uuid();
const MANAGE = ["courses.manage"] as const;

function logError(msg: string, error: PgError) {
  // No PII: only the Postgres error code goes to the logs.
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
}

function invalidId(): ActionResult {
  return { ok: false, message: "That item could not be found. Refresh the page and try again." };
}

function revalidateCourses(courseId?: string) {
  revalidatePath("/admin/courses");
  if (courseId) revalidatePath(`/admin/courses/${courseId}`, "layout");
  // Public catalogue and course pages read published data.
  revalidatePath("/courses", "layout");
  // The home page can feature a course.
  revalidatePath("/");
}

function courseColumns(v: CourseFormOutput): CourseUpdate {
  return {
    title: v.title,
    slug: v.slug,
    category_id: v.categoryId,
    short_description: v.shortDescription,
    description: v.description,
    who_is_it_for: v.whoIsItFor,
    cover_image_url: v.coverImageUrl,
    instructor_name: v.instructorName,
    level: v.level,
    prerequisites: v.prerequisites,
    learning_outcomes: v.learningOutcomes,
    duration_text: v.durationText,
    delivery_mode: v.deliveryMode,
    list_price: v.listPrice,
    discounted_price: v.discountedPrice,
    currency: v.currency,
    show_price: v.showPrice,
    capacity: v.capacity,
    enrollment_opens_on: v.enrollmentOpensOn,
    enrollment_closes_on: v.enrollmentClosesOn,
    certificate_details: v.certificateDetails,
    faqs: v.faqs,
    demo_url: v.demoUrl,
    success_message: v.successMessage,
    inclusions: v.inclusions,
    registration_mode: v.registrationMode,
    cta_label: v.ctaLabel,
    highlight_badge: v.highlightBadge,
  };
}

function courseWriteError(error: PgError, msg: string): ActionResult {
  if (error?.code === "23505") {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { slug: ["Another course already uses this slug. Choose a different one."] } };
  }
  if (error?.code === "23503") {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { categoryId: ["That category no longer exists. Choose another one."] } };
  }
  logError(msg, error);
  if (error?.code === "23514") return { ok: false, message: "Some values were not accepted. Check the form and try again." };
  return { ok: false, message: "Could not save the course. Please try again." };
}

// -----------------------------------------------------------------------------
// Courses
// -----------------------------------------------------------------------------

export async function createCourse(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      ...courseColumns(parsed.data),
      title: parsed.data.title,
      slug: parsed.data.slug,
      organization_id: access.organization.id,
      created_by: access.userId,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) return courseWriteError(error, "course create failed");

  revalidateCourses();
  return { ok: true, id: data.id, message: "Course created as a draft." };
}

export async function updateCourse(courseId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(courseId).success) return invalidId();
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .update(courseColumns(parsed.data))
    .eq("id", courseId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return courseWriteError(error, "course update failed");
  if (!data?.length) return invalidId();

  revalidateCourses(courseId);
  return { ok: true, message: "Course saved." };
}

const statusSchema = z.enum(["draft", "published", "archived"]);

export async function setCourseStatus(courseId: string, status: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const parsedStatus = statusSchema.safeParse(status);
  if (!idSchema.safeParse(courseId).success || !parsedStatus.success) return invalidId();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .update({ status: parsedStatus.data })
    .eq("id", courseId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("course status change failed", error);
    return { ok: false, message: "Could not change the course status. Please try again." };
  }
  if (!data?.length) return invalidId();

  revalidateCourses(courseId);
  const messages = {
    published: "Course published. Its public page and registration form are live.",
    draft: "Course moved back to draft. Its public page is no longer visible.",
    archived: "Course archived. It is hidden from the public site.",
  } as const;
  return { ok: true, message: messages[parsedStatus.data] };
}

/**
 * Registrations visible to this user are limited by candidate RLS, so the
 * "is it safe to delete" check counts with the privileged client — after the
 * caller has been authorised and only for a course in their organization.
 */
async function registrationCount(courseId: string, organizationId: string): Promise<number | null> {
  const { count, error } = await createSupabaseAdminClient()
    .from("course_registrations")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId)
    .eq("organization_id", organizationId);
  if (error) {
    logError("course registration count failed", error);
    return null;
  }
  return count ?? 0;
}

export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(courseId).success) return invalidId();

  const supabase = await createSupabaseServerClient();
  const { data: course, error: readError } = await supabase
    .from("courses")
    .select("id, status")
    .eq("id", courseId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (readError) {
    logError("course read failed", readError);
    return { ok: false, message: "Could not delete the course. Please try again." };
  }
  if (!course) return invalidId();
  if (course.status !== "draft") {
    return { ok: false, message: "Only draft courses can be deleted. Archive this course instead to hide it." };
  }

  const count = await registrationCount(courseId, access.organization.id);
  if (count === null) return { ok: false, message: "Could not check this course’s registrations. Please try again." };
  if (count > 0) {
    return { ok: false, message: `This course has ${count} registration${count === 1 ? "" : "s"}. Archive it instead so the history is kept.` };
  }

  const { data, error } = await supabase
    .from("courses")
    .delete()
    .eq("id", courseId)
    .eq("organization_id", access.organization.id)
    .eq("status", "draft")
    .select("id");
  if (error) {
    logError("course delete failed", error);
    return { ok: false, message: "Could not delete the course. Please try again." };
  }
  if (!data?.length) return invalidId();

  revalidateCourses();
  return { ok: true, message: "Course deleted." };
}

export async function cloneCourse(courseId: string): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(courseId).success) return invalidId();
  const org = access.organization.id;
  const supabase = await createSupabaseServerClient();

  const { data: source, error: readError } = await supabase.from("courses").select("*").eq("id", courseId).eq("organization_id", org).maybeSingle();
  if (readError) {
    logError("course clone read failed", readError);
    return { ok: false, message: "Could not copy the course. Please try again." };
  }
  if (!source) return invalidId();

  const [modulesRes, fieldsRes, slugsRes] = await Promise.all([
    supabase.from("course_modules").select("id, title, description, position, lessons(title, duration_minutes, position)").eq("course_id", courseId).order("position"),
    supabase.from("course_registration_fields").select("*").eq("course_id", courseId),
    supabase.from("courses").select("slug").eq("organization_id", org).like("slug", `${source.slug.slice(0, 70)}%`),
  ]);
  if (modulesRes.error || fieldsRes.error || slugsRes.error) {
    logError("course clone read failed", modulesRes.error ?? fieldsRes.error ?? slugsRes.error);
    return { ok: false, message: "Could not copy the course. Please try again." };
  }

  const title = `${source.title.slice(0, 140 - " (copy)".length)} (copy)`;
  const taken = (slugsRes.data ?? []).map((r) => r.slug);
  let slug = nextCopySlug(source.slug, taken);

  /* eslint-disable @typescript-eslint/no-unused-vars -- strip columns that must not be copied */
  const { id: _id, created_at: _c, updated_at: _u, published_at: _p, status: _s, course_is_open: _o, public_course_json: _j, ...rest } = source;
  /* eslint-enable @typescript-eslint/no-unused-vars */

  let created: { id: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const { data, error } = await supabase
      .from("courses")
      .insert({ ...rest, title, slug, status: "draft", created_by: access.userId, organization_id: org })
      .select("id")
      .single();
    if (data) created = data;
    else if (error?.code === "23505") {
      // Someone took the slug in the meantime: skip it and try the next one.
      taken.push(slug);
      slug = nextCopySlug(source.slug, taken);
    } else {
      logError("course clone insert failed", error);
      return { ok: false, message: "Could not copy the course. Please try again." };
    }
  }
  if (!created) return { ok: false, message: "Could not find a free slug for the copy. Rename the course and try again." };
  const newId = created.id;

  const partial = (msg: string, error: PgError): ActionResult => {
    logError(msg, error);
    revalidateCourses();
    return { ok: true, id: newId, message: "The course was copied, but some curriculum or form fields could not be copied. Review the copy before publishing." };
  };

  // Curriculum
  for (const m of modulesRes.data ?? []) {
    const { data: mod, error } = await supabase
      .from("course_modules")
      .insert({ course_id: newId, title: m.title, description: m.description, position: m.position })
      .select("id")
      .single();
    if (error || !mod) return partial("course clone module failed", error);
    if (m.lessons.length) {
      const { error: lessonError } = await supabase
        .from("lessons")
        .insert(m.lessons.map((l) => ({ module_id: mod.id, title: l.title, duration_minutes: l.duration_minutes, position: l.position })));
      if (lessonError) return partial("course clone lessons failed", lessonError);
    }
  }

  // Registration form: the insert trigger seeded the default fields; make them match the source, then add custom ones.
  const { data: seeded, error: seededError } = await supabase.from("course_registration_fields").select("id, key").eq("course_id", newId);
  if (seededError) return partial("course clone fields read failed", seededError);
  const seededByKey = new Map((seeded ?? []).map((f) => [f.key, f.id]));
  const sourceFields = fieldsRes.data ?? [];
  const sourceKeys = new Set(sourceFields.map((f) => f.key));

  for (const f of sourceFields) {
    const values = {
      label: f.label,
      type: f.type,
      maps_to: f.maps_to,
      required: f.required,
      options: f.options,
      help_text: f.help_text,
      placeholder: f.placeholder,
      position: f.position,
      is_active: f.is_active,
    };
    const existingId = seededByKey.get(f.key);
    const { error } = existingId
      ? await supabase.from("course_registration_fields").update(values).eq("id", existingId)
      : await supabase.from("course_registration_fields").insert({ ...values, course_id: newId, key: f.key });
    if (error) return partial("course clone field failed", error);
  }
  const extra = (seeded ?? []).filter((f) => !sourceKeys.has(f.key)).map((f) => f.id);
  if (extra.length) {
    const { error } = await supabase.from("course_registration_fields").delete().in("id", extra);
    if (error) return partial("course clone field cleanup failed", error);
  }

  revalidateCourses();
  return { ok: true, id: newId, message: "Course copied as a draft." };
}

// -----------------------------------------------------------------------------
// Curriculum
// -----------------------------------------------------------------------------

export async function saveCurriculum(courseId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(courseId).success) return invalidId();
  const parsedInput = curriculumSchema.safeParse(input);
  if (!parsedInput.success) return { ok: false, fieldErrors: parsedInput.error.flatten().fieldErrors, message: "The curriculum is too long." };

  const { modules, issues } = parseCurriculum(parsedInput.data.text);
  if (issues.length) {
    return { ok: false, message: "Fix the lines listed below and save again.", fieldErrors: { text: issues.map((i) => `Line ${i.line}: ${i.message}`) } };
  }
  if (modules.length > CURRICULUM_LIMITS.modules) return { ok: false, message: "Too many modules." };

  const supabase = await createSupabaseServerClient();
  const { data: course } = await supabase.from("courses").select("id").eq("id", courseId).eq("organization_id", access.organization.id).maybeSingle();
  if (!course) return invalidId();

  const { data: oldModules, error: oldError } = await supabase.from("course_modules").select("id").eq("course_id", courseId);
  if (oldError) {
    logError("curriculum read failed", oldError);
    return { ok: false, message: "Could not save the curriculum. Please try again." };
  }

  // Insert the new curriculum first and only then remove the old one, so a
  // failure part-way leaves the previous curriculum intact.
  const insertedIds: string[] = [];
  const rollback = async (msg: string, error: PgError): Promise<ActionResult> => {
    logError(msg, error);
    if (insertedIds.length) await supabase.from("course_modules").delete().in("id", insertedIds);
    return { ok: false, message: "Could not save the curriculum. Your previous curriculum was kept. Please try again." };
  };

  if (modules.length) {
    const { data: newModules, error } = await supabase
      .from("course_modules")
      .insert(modules.map((m, i) => ({ course_id: courseId, title: m.title, description: m.description, position: (i + 1) * 10 })))
      .select("id, position");
    if (error || !newModules || newModules.length !== modules.length) return rollback("curriculum modules insert failed", error);
    insertedIds.push(...newModules.map((m) => m.id));
    const idByPosition = new Map(newModules.map((m) => [m.position, m.id]));

    const lessons = modules.flatMap((m, i) =>
      m.lessons.map((l, j) => ({ module_id: idByPosition.get((i + 1) * 10)!, title: l.title, duration_minutes: l.durationMinutes, position: (j + 1) * 10 })),
    );
    if (lessons.length) {
      const { error: lessonError } = await supabase.from("lessons").insert(lessons);
      if (lessonError) return rollback("curriculum lessons insert failed", lessonError);
    }
  }

  const oldIds = (oldModules ?? []).map((m) => m.id);
  if (oldIds.length) {
    const { error } = await supabase.from("course_modules").delete().in("id", oldIds);
    if (error) return rollback("curriculum cleanup failed", error);
  }

  revalidateCourses(courseId);
  const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);
  return {
    ok: true,
    message: modules.length
      ? `Curriculum saved: ${modules.length} module${modules.length === 1 ? "" : "s"}, ${lessonCount} lesson${lessonCount === 1 ? "" : "s"}.`
      : "Curriculum cleared.",
  };
}

// -----------------------------------------------------------------------------
// Registration form fields
// -----------------------------------------------------------------------------

type FieldRow = Database["public"]["Tables"]["course_registration_fields"]["Row"];

async function loadCourseFields(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, courseId: string, organizationId: string) {
  const { data: course } = await supabase.from("courses").select("id").eq("id", courseId).eq("organization_id", organizationId).maybeSingle();
  if (!course) return null;
  const { data, error } = await supabase
    .from("course_registration_fields")
    .select("*")
    .eq("course_id", courseId)
    .order("position")
    .order("created_at");
  if (error) {
    logError("form fields read failed", error);
    return null;
  }
  return data ?? [];
}

const toState = (f: Pick<FieldRow, "key" | "required" | "is_active">): FieldState => ({ key: f.key, required: f.required, is_active: f.is_active });
const isProtected = (f: Pick<FieldRow, "maps_to" | "key">) => f.maps_to !== null || f.key === "privacy_consent";

function fieldWriteError(error: PgError, msg: string): ActionResult {
  if (error?.code === "23505") return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { key: ["Another field on this form already uses this key."] } };
  logError(msg, error);
  return { ok: false, message: "Could not save the field. Please try again." };
}

function revalidateForm(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`, "layout");
  revalidatePath("/courses", "layout");
}

export async function createRegistrationField(courseId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(courseId).success) return invalidId();
  const parsed = registrationFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  if (isReservedFieldKey(v.key)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { key: ["This key is reserved for a standard field. Choose another key."] } };
  }

  const supabase = await createSupabaseServerClient();
  const fields = await loadCourseFields(supabase, courseId, access.organization.id);
  if (!fields) return invalidId();
  if (fields.length >= 100) return { ok: false, message: "A form can have at most 100 fields." };
  if (fields.some((f) => f.key === v.key)) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { key: ["Another field on this form already uses this key."] } };
  }

  // New custom fields go after the last field that is not a consent box.
  const consentStart = Math.min(...fields.filter((f) => f.type === "consent" || f.key === "marketing_consent").map((f) => f.position), Infinity);
  const before = fields.filter((f) => f.position < consentStart);
  const lastPos = before.length ? Math.max(...before.map((f) => f.position)) : 0;
  const position = consentStart === Infinity ? lastPos + 10 : Math.min(lastPos + 10, consentStart - 1);

  const { error } = await supabase.from("course_registration_fields").insert({
    course_id: courseId,
    key: v.key,
    label: v.label,
    type: v.type,
    required: v.required,
    options: v.options,
    help_text: v.helpText,
    placeholder: v.placeholder,
    position,
    maps_to: null,
    is_active: true,
  });
  if (error) return fieldWriteError(error, "form field create failed");

  revalidateForm(courseId);
  return { ok: true, message: `Field “${v.label}” added.` };
}

async function loadField(fieldId: string, organizationId: string) {
  if (!idSchema.safeParse(fieldId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data: field } = await supabase.from("course_registration_fields").select("course_id").eq("id", fieldId).maybeSingle();
  if (!field) return null;
  const fields = await loadCourseFields(supabase, field.course_id, organizationId);
  const target = fields?.find((f) => f.id === fieldId);
  if (!fields || !target) return null;
  return { supabase, fields, target };
}

export async function updateRegistrationField(fieldId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const loaded = await loadField(fieldId, access.organization.id);
  if (!loaded) return invalidId();
  const { supabase, fields, target } = loaded;

  const prot = isProtected(target);
  // Key never changes after creation (answers are stored under it); standard fields also keep their type.
  const raw = typeof input === "object" && input !== null ? { ...input, key: target.key, ...(prot ? { type: target.type } : {}) } : input;
  const parsed = registrationFieldSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const required = target.key === "privacy_consent" ? true : v.required;

  const after = fields.map((f) => (f.id === fieldId ? { ...toState(f), required } : toState(f)));
  const integrity = integrityErrorForChange(fields.map(toState), after);
  if (integrity) return { ok: false, message: integrity };

  const { error } = await supabase
    .from("course_registration_fields")
    .update({ label: v.label, type: prot ? target.type : v.type, required, options: v.options, help_text: v.helpText, placeholder: v.placeholder })
    .eq("id", fieldId);
  if (error) return fieldWriteError(error, "form field update failed");

  revalidateForm(target.course_id);
  return { ok: true, message: "Field saved." };
}

export async function setRegistrationFieldActive(fieldId: string, active: boolean): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const loaded = await loadField(fieldId, access.organization.id);
  if (!loaded) return invalidId();
  const { supabase, fields, target } = loaded;
  const isActive = active === true;

  const after = fields.map((f) => (f.id === fieldId ? { ...toState(f), is_active: isActive } : toState(f)));
  const integrity = integrityErrorForChange(fields.map(toState), after);
  if (integrity) return { ok: false, message: integrity };

  const { error } = await supabase.from("course_registration_fields").update({ is_active: isActive }).eq("id", fieldId);
  if (error) return fieldWriteError(error, "form field toggle failed");

  revalidateForm(target.course_id);
  return { ok: true, message: isActive ? `“${target.label}” is now shown on the form.` : `“${target.label}” is now hidden from the form.` };
}

export async function moveRegistrationField(fieldId: string, direction: "up" | "down"): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const loaded = await loadField(fieldId, access.organization.id);
  if (!loaded) return invalidId();
  const { supabase, fields, target } = loaded;

  const index = fields.findIndex((f) => f.id === fieldId);
  const swapWith = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
  if (swapWith < 0 || swapWith >= fields.length) return { ok: true };

  const order = [...fields];
  [order[index], order[swapWith]] = [order[swapWith], order[index]];
  const changes = order.map((f, i) => ({ id: f.id, position: (i + 1) * 10, old: f.position })).filter((c) => c.position !== c.old);
  const results = await Promise.all(changes.map((c) => supabase.from("course_registration_fields").update({ position: c.position }).eq("id", c.id)));
  const failed = results.find((r) => r.error);
  if (failed) return fieldWriteError(failed.error, "form field move failed");

  revalidateForm(target.course_id);
  return { ok: true, message: `Moved “${target.label}” ${direction}.` };
}

export async function deleteRegistrationField(fieldId: string): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const loaded = await loadField(fieldId, access.organization.id);
  if (!loaded) return invalidId();
  const { supabase, target } = loaded;
  if (isProtected(target)) return { ok: false, message: "Standard fields cannot be deleted. Hide the field instead." };

  const { error } = await supabase.from("course_registration_fields").delete().eq("id", fieldId).is("maps_to", null);
  if (error) return fieldWriteError(error, "form field delete failed");

  revalidateForm(target.course_id);
  return { ok: true, message: `Field “${target.label}” deleted. Answers already submitted are kept.` };
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

function categoryWriteError(error: PgError, msg: string): ActionResult {
  if (error?.code === "23505") return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { slug: ["Another category already uses this slug."] } };
  logError(msg, error);
  return { ok: false, message: "Could not save the category. Please try again." };
}

export async function createCategory(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_categories")
    .insert({ ...parsed.data, organization_id: access.organization.id })
    .select("id")
    .single();
  if (error || !data) return categoryWriteError(error, "category create failed");

  revalidateCourses();
  revalidatePath("/admin/courses/categories");
  return { ok: true, id: data.id, message: `Category “${parsed.data.name}” added.` };
}

export async function updateCategory(categoryId: string, input: unknown): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(categoryId).success) return invalidId();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_categories")
    .update(parsed.data)
    .eq("id", categoryId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return categoryWriteError(error, "category update failed");
  if (!data?.length) return invalidId();

  revalidateCourses();
  revalidatePath("/admin/courses/categories");
  return { ok: true, message: "Category saved." };
}

export async function deleteCategory(categoryId: string): Promise<ActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(categoryId).success) return invalidId();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_categories")
    .delete()
    .eq("id", categoryId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("category delete failed", error);
    return { ok: false, message: "Could not delete the category. Please try again." };
  }
  if (!data?.length) return invalidId();

  revalidateCourses();
  revalidatePath("/admin/courses/categories");
  return { ok: true, message: "Category deleted. Its courses are now uncategorised." };
}
