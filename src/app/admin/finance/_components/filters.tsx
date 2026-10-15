import type { ReactNode } from "react";
import Form from "next/form";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import type { FinanceFilters } from "@/lib/validation/finance";

export type Option = { id: string; label: string };

function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-[#444]">
        {label}
      </label>
      {children}
    </div>
  );
}

/** GET filter bar: period, course and batch, plus page-specific fields. */
export function FinanceFilterBar({
  action,
  filters,
  courses,
  batches,
  showPeriod = true,
  extra,
  periodHint,
}: {
  action: string;
  filters: FinanceFilters;
  courses: Option[];
  batches: Option[];
  showPeriod?: boolean;
  extra?: ReactNode;
  periodHint?: string;
}) {
  const active = Boolean(filters.from || filters.to || filters.course || filters.batch || filters.method || filters.status || filters.category || filters.q);
  return (
    <Card className="mb-4">
      <Form
        key={JSON.stringify(filters)}
        action={action}
        role="search"
        aria-label="Filter"
        className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] lg:items-end"
      >
        {showPeriod ? (
          <>
            <FilterField id="f-from" label="From">
              <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
            </FilterField>
            <FilterField id="f-to" label="To">
              <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
            </FilterField>
          </>
        ) : null}
        <FilterField id="f-course" label="Course">
          <Select id="f-course" name="course" defaultValue={filters.course}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField id="f-batch" label="Batch">
          <Select id="f-batch" name="batch" defaultValue={filters.batch}>
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </FilterField>
        {extra}
        <div className="flex gap-2">
          <button type="submit" className={buttonVariants({ className: "flex-1 sm:flex-none" })}>
            Apply
          </button>
          {active ? (
            <Link href={action} className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </div>
        {periodHint ? <p className="text-xs text-muted sm:col-span-full">{periodHint}</p> : null}
      </Form>
    </Card>
  );
}

export { FilterField };
