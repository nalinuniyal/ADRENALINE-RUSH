import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Plus, Receipt, Search, Tags } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { todayIn } from "@/lib/calendar";
import { getBatchOptions } from "@/lib/data/batches";
import { getCourseOptions } from "@/lib/data/candidates";
import { expensesQuery, getExpenseCategories } from "@/lib/data/finance";
import { formatPaise, paiseToInput, PAYMENT_METHOD_LABELS, toPaise, type PaymentMethod } from "@/lib/finance/money";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { filterQuery, parseFinanceFilters } from "@/lib/validation/finance";
import { CategoryManager, ExpenseForm, ExpenseRowActions, type ExpenseValues } from "../_components/expense-forms";
import { FilterField, FinanceFilterBar } from "../_components/filters";
import { FinanceHeader, FinanceSkeleton } from "../_components/finance-header";

export const metadata: Metadata = { title: "Expenses" };
const LIMIT = 500;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default function ExpensesPage({ searchParams }: PageProps<"/admin/finance/expenses">) {
  return (
    <Suspense fallback={<FinanceSkeleton label="Loading expenses" />}>
      <ExpensesList searchParams={searchParams} />
    </Suspense>
  );
}

async function ExpensesList({ searchParams }: { searchParams: PageProps<"/admin/finance/expenses">["searchParams"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const canManage = access.permissions.includes("finance.manage");
  const canExport = access.permissions.includes("reports.export");
  const filters = parseFinanceFilters(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [res, categories, courses, batches] = await Promise.all([
    expensesQuery(supabase, orgId, filters).limit(LIMIT),
    getExpenseCategories(supabase, orgId),
    getCourseOptions(supabase, orgId),
    getBatchOptions(supabase, orgId, { includeClosed: true }),
  ]);
  if (res.error) {
    console.error(JSON.stringify({ level: "error", msg: "expenses list failed", code: res.error.code }));
    throw new Error("Could not load expenses.");
  }
  const rows = res.data ?? [];
  const usedRes = canManage ? await supabase.from("expenses").select("category_id").eq("organization_id", orgId).limit(10000) : { data: [] };
  const used = new Set((usedRes.data ?? []).map((r) => r.category_id));
  const cur = access.organization.currency;
  const total = rows.filter((r) => r.status === "recorded" && r.currency === cur).reduce((s, r) => s + toPaise(r.amount), 0);
  const filtered = Boolean(filters.from || filters.to || filters.course || filters.batch || filters.category || filters.status || filters.q);

  const catOpts = categories.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name }));
  const courseOpts = courses.map((c) => ({ id: c.id, label: c.title }));
  const batchOpts = batches.map((b) => ({ id: b.id, label: `${b.name} — ${b.courseTitle}`, courseId: b.courseId }));
  const blank: ExpenseValues = {
    categoryId: "",
    spentOn: todayIn(access.organization.timezone),
    amount: "",
    currency: cur,
    description: "",
    vendor: "",
    method: "upi",
    reference: "",
    notes: "",
    receiptUrl: "",
    courseId: "",
    batchId: "",
  };

  return (
    <>
      <FinanceHeader
        active="expenses"
        description="Money spent running the business: ads, tools, trainer payouts, venue and more."
        actions={
          canExport ? (
            <a href={`/admin/finance/expenses/export${filterQuery(filters)}`} className={buttonVariants({ variant: "secondary" })}>
              <Download className="size-4" aria-hidden /> Export CSV
            </a>
          ) : undefined
        }
      />

      {canManage ? (
        <Card className="mb-4">
          <details open={rows.length === 0 && !filtered} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <IconTile icon={Plus} color="pink" size="sm" />
              <span className="font-bold">Add an expense</span>
              <span className="ml-auto text-xs text-muted group-open:hidden">Click to open</span>
            </summary>
            <div className="border-t border-line px-4 py-4">
              {catOpts.length ? (
                <ExpenseForm initial={blank} categories={catOpts} courses={courseOpts} batches={batchOpts} />
              ) : (
                <p className="text-sm text-muted">Add or switch on an expense category below first.</p>
              )}
            </div>
          </details>
        </Card>
      ) : null}

      <FinanceFilterBar
        action="/admin/finance/expenses"
        filters={filters}
        courses={courseOpts}
        batches={batchOpts}
        extra={
          <>
            <FilterField id="f-cat" label="Category">
              <Select id="f-cat" name="category" defaultValue={filters.category}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField id="f-status" label="Status">
              <Select id="f-status" name="status" defaultValue={filters.status}>
                <option value="">Recorded</option>
                <option value="voided">Voided</option>
                <option value="all">All</option>
              </Select>
            </FilterField>
            <FilterField id="f-q" label="Description or vendor">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="f-q" name="q" type="search" defaultValue={filters.q} className="pl-9" maxLength={80} />
              </div>
            </FilterField>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" aria-hidden />}
          title={filtered ? "No expenses match these filters" : "No expenses yet"}
          description={filtered ? undefined : "Record what you spend so the overview can show your cash result."}
          action={
            filtered ? (
              <Link href="/admin/finance/expenses" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            {rows.length}
            {rows.length >= LIMIT ? "+" : ""} expense{rows.length === 1 ? "" : "s"} · total <span className="font-semibold text-fg">{formatPaise(total, cur)}</span>
          </p>
          <ul className="divide-y divide-line">
            {rows.map((x) => {
              const cat = one(x.expense_categories);
              const course = one(x.courses);
              const batch = one(x.batches);
              return (
                <li key={x.id} className={cn("grid gap-2 px-4 py-3 md:grid-cols-[7rem_minmax(0,1fr)_auto] md:items-start", x.status === "voided" && "opacity-70")}>
                  <p className="text-sm whitespace-nowrap">{formatDate(x.spent_on)}</p>
                  <div className="min-w-0">
                    <p className={cn("font-medium", x.status === "voided" && "line-through")}>{x.description}</p>
                    <p className="text-xs text-muted">
                      {cat?.name ?? "—"}
                      {x.vendor ? ` · ${x.vendor}` : ""} · {PAYMENT_METHOD_LABELS[x.method as PaymentMethod] ?? x.method}
                      {x.reference ? ` · Ref ${x.reference}` : ""}
                      {course ? ` · ${course.title}` : ""}
                      {batch ? ` · ${batch.name}` : ""}
                    </p>
                    {x.receipt_url ? (
                      <a href={x.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
                        Receipt
                      </a>
                    ) : null}
                    {x.void_reason ? <p className="text-xs text-danger-700">Voided: {x.void_reason}</p> : null}
                    {canManage && x.status === "recorded" ? (
                      <div className="mt-1">
                        <ExpenseRowActions
                          expenseId={x.id}
                          categories={categories.filter((c) => c.is_active || c.id === x.category_id).map((c) => ({ id: c.id, label: c.name }))}
                          courses={courseOpts}
                          batches={batchOpts}
                          initial={{
                            categoryId: x.category_id,
                            spentOn: x.spent_on,
                            amount: paiseToInput(toPaise(x.amount)),
                            currency: x.currency,
                            description: x.description,
                            vendor: x.vendor ?? "",
                            method: x.method,
                            reference: x.reference ?? "",
                            notes: x.notes ?? "",
                            receiptUrl: x.receipt_url ?? "",
                            courseId: x.course_id ?? "",
                            batchId: x.batch_id ?? "",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className={cn("text-right font-semibold whitespace-nowrap tabular-nums", x.status === "voided" && "line-through")}>{formatPaise(toPaise(x.amount), x.currency)}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {canManage ? (
        <Card className="mt-4">
          <CardHeader icon={<IconTile icon={Tags} color="slate" size="sm" />}>
            <CardTitle>Expense categories</CardTitle>
            <CardDescription>Rename them to suit you. Categories with expenses can be switched off but not deleted.</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryManager categories={categories.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active, used: used.has(c.id) }))} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
