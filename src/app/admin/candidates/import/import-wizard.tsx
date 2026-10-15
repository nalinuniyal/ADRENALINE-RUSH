"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CopyX, FileSpreadsheet, Upload } from "lucide-react";
import { findExistingImportKeys, importCandidates, type ImportResult } from "@/app/actions/candidates";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { parseCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import {
  autoMapColumns,
  buildImportPreview,
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_PAYLOAD_BYTES,
  MAX_IMPORT_ROWS,
  normalizeEmail,
  phoneMatchKey,
  summarizePreview,
  applyMapping,
  type ColumnMapping,
  type ImportFieldKey,
  type ImportRow,
} from "@/lib/validation/candidates";

type Parsed = { fileName: string; headers: string[]; rows: string[][] };
type Option = { value: string; label: string };

const PREVIEW_LIMIT = 50;

export function ImportWizard({
  statuses,
  courseSlugs,
  owners,
  defaultOwnerId,
}: {
  statuses: { key: string; label: string }[];
  courseSlugs: string[];
  owners: Option[];
  defaultOwnerId: string;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [fileError, setFileError] = useState<string>();
  const [existing, setExisting] = useState<{ emails: Set<string>; phones: Set<string> } | null>(null);
  const [checkMessage, setCheckMessage] = useState<string>();
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [result, setResult] = useState<ImportResult & { rowNumbers?: number[] }>();
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setExisting(null);
    setResult(undefined);
    setFileError(undefined);
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setFileError("Choose a .csv file. In Excel or Google Sheets use File → Download → CSV.");
    if (file.size > MAX_IMPORT_BYTES) return setFileError(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB; split it into smaller files.`);
    const text = await file.text();
    const all = parseCsv(text);
    if (all.length < 2) return setFileError("The file needs a header row and at least one candidate row.");
    const [headers, ...rows] = all;
    if (rows.length > MAX_IMPORT_ROWS) return setFileError(`The file has ${rows.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);
    setParsed({ fileName: file.name, headers: headers.map((h, i) => h.trim() || `Column ${i + 1}`), rows });
    setMapping(autoMapColumns(headers));
  };

  const setField = (index: number, field: ImportFieldKey | null) => {
    setExisting(null);
    setMapping((m) => m.map((f, i) => (i === index ? field : f === field && field !== null ? null : f)));
  };

  const mappedFields = new Set(mapping.filter(Boolean));
  const mappingReady = mappedFields.has("full_name") && (mappedFields.has("email") || mappedFields.has("phone"));

  const preview = useMemo(
    () =>
      parsed && mappingReady
        ? buildImportPreview(parsed.rows, mapping, {
            statuses,
            courseSlugs,
            existingEmails: existing?.emails,
            existingPhoneKeys: existing?.phones,
          })
        : [],
    [parsed, mapping, mappingReady, statuses, courseSlugs, existing],
  );
  const summary = summarizePreview(preview);
  const shown = (onlyProblems ? preview.filter((p) => p.errors.length || p.existing || p.duplicateOfRow) : preview).slice(0, PREVIEW_LIMIT);
  const visibleFields = IMPORT_FIELDS.filter((f) => mappedFields.has(f.key));

  const checkExisting = () => {
    if (!parsed) return;
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const row of parsed.rows) {
      const v = applyMapping(row, mapping);
      const e = normalizeEmail(v.email);
      const p = phoneMatchKey(v.phone);
      if (e) emails.add(e);
      if (p) phones.add(p);
    }
    setCheckMessage(undefined);
    startCheck(async () => {
      const res = await findExistingImportKeys({ emails: [...emails], phoneKeys: [...phones] });
      if (!res.ok) setCheckMessage(res.message);
      setExisting({ emails: new Set(res.emails), phones: new Set(res.phoneKeys) });
    });
  };

  const runImport = () => {
    if (!parsed) return;
    const valid = preview.filter((p) => p.errors.length === 0);
    const rows: ImportRow[] = valid.map((p) => p.values);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(rows)).length;
    if (payloadBytes > MAX_IMPORT_PAYLOAD_BYTES) {
      setResult({ ok: false, message: "This file has too much data to import in one go. Split it into two files, or unmap columns you don't need (e.g. long notes)." });
      return;
    }
    setResult(undefined);
    startImport(async () => {
      const res = await importCandidates({ rows, ownerId: ownerId || null, fileName: parsed.fileName });
      setResult({ ...res, rowNumbers: valid.map((p) => p.row) });
    });
  };

  if (result?.ok) {
    const problems = (result.results ?? []).filter((r) => r.status !== "created");
    return (
      <Card>
        <CardHeader icon={<CheckCircle2 className="size-6 text-success-700" aria-hidden />}>
          <CardTitle>Import finished</CardTitle>
          <CardDescription>{parsed?.fileName}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div role="status" className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Created" value={result.created ?? 0} tone="text-success-700" />
            <Stat label="Skipped as duplicates" value={result.duplicates ?? 0} tone="text-warning-700" />
            <Stat label="Invalid" value={(result.invalid ?? 0) + summary.invalid} tone="text-danger-700" />
          </div>
          {problems.length ? (
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">Rows that were not imported ({problems.length})</summary>
              <ul className="mt-2 max-h-72 overflow-y-auto text-sm">
                {problems.map((p) => (
                  <li key={p.row} className="flex gap-2 border-b border-line py-1.5 last:border-0">
                    <span className="w-16 shrink-0 text-muted">Row {result.rowNumbers?.[p.row - 1] ?? p.row}</span>
                    <span>{p.reason}</span>
                    {p.candidate_id ? <Link href={`/admin/candidates/${p.candidate_id}`} className="ml-auto text-brand-700 hover:underline">Open</Link> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/candidates?sort=newest" className={buttonVariants()}>View candidates</Link>
            <Button variant="secondary" onClick={() => { setParsed(null); setResult(undefined); setExisting(null); }}>Import another file</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader icon={<FileSpreadsheet className="size-6 text-brand-600" aria-hidden />}>
          <CardTitle>1. Choose a CSV file</CardTitle>
          <CardDescription>
            Up to 2 MB and {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows, with a header row. Each candidate needs a name and an email or phone number.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label htmlFor="csv-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50 focus-within:border-brand-400 focus-within:ring-[3px] focus-within:ring-brand-400/25">
            <Upload className="size-6 text-brand-600" aria-hidden />
            <span className="text-sm font-medium">{parsed ? parsed.fileName : "Select a CSV file"}</span>
            <span className="text-xs text-muted">{parsed ? `${parsed.rows.length} rows · ${parsed.headers.length} columns` : "Nothing is uploaded until you confirm the import."}</span>
            <input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-describedby={fileError ? "csv-file-error" : undefined} />
          </label>
          {fileError ? <p id="csv-file-error" role="alert" className="text-sm font-medium text-danger-700">{fileError}</p> : null}
          <p className="text-xs text-muted">
            Recognised columns: {IMPORT_FIELDS.map((f) => f.label).join(", ")}. Lead status accepts a status name such as “Interested”; course uses the course&apos;s URL slug. Consent is never assumed for imported contacts.
          </p>
        </CardContent>
      </Card>

      {parsed ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Match columns</CardTitle>
            <CardDescription>We guessed from the header names. Choose “Don&apos;t import” for columns you want to leave out.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parsed.headers.map((h, i) => (
                <div key={`${h}-${i}`} className="rounded-lg border border-line p-3">
                  <label htmlFor={`map-${i}`} className="block truncate text-sm font-medium" title={h}>{h}</label>
                  <p className="truncate text-xs text-muted">e.g. {parsed.rows.find((r) => r[i]?.trim())?.[i] ?? "(empty)"}</p>
                  <Select id={`map-${i}`} className="mt-2" value={mapping[i] ?? ""} onChange={(e) => setField(i, (e.target.value || null) as ImportFieldKey | null)}>
                    <option value="">Don&apos;t import</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!mappingReady ? (
              <Alert tone="warning" className="mt-4">Map a column to <strong>Full name</strong> and at least one of <strong>Email</strong> or <strong>Phone</strong>.</Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {parsed && mappingReady ? (
        <Card>
          <CardHeader
            actions={
              <Button size="sm" variant="secondary" onClick={checkExisting} disabled={checking} aria-busy={checking}>
                {checking ? "Checking…" : existing ? "Check again" : "Check for existing candidates"}
              </Button>
            }
          >
            <CardTitle>3. Review</CardTitle>
            <CardDescription>
              {existing ? "Compared with candidates already in your CRM." : "Duplicates inside the file are shown below. Check against existing candidates before importing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {checkMessage ? <Alert tone="warning">{checkMessage}</Alert> : null}
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4" aria-live="polite">
              <Stat label="Rows" value={summary.total} />
              <Stat label="Ready to import" value={summary.ready} tone="text-success-700" />
              <Stat label="Duplicates (skipped)" value={summary.duplicates} tone="text-warning-700" />
              <Stat label="With errors (skipped)" value={summary.invalid} tone="text-danger-700" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-600" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Show only rows with problems
            </label>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] text-left text-xs">
                <caption className="sr-only">Import preview, first {PREVIEW_LIMIT} rows</caption>
                <thead className="border-b border-line bg-canvas text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Row</th>
                    <th scope="col" className="px-3 py-2 font-medium">Result</th>
                    {visibleFields.map((f) => (
                      <th key={f.key} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const dup = p.existing || p.duplicateOfRow !== null;
                    return (
                      <tr key={p.row} className={cn("border-b border-line align-top last:border-0", p.errors.length ? "bg-danger-50" : dup ? "bg-warning-50" : undefined)}>
                        <td className="px-3 py-2 text-muted">{p.row}</td>
                        <td className="px-3 py-2">
                          {p.errors.length ? (
                            <span className="flex flex-col gap-0.5 text-danger-700">
                              {p.errors.map((e) => (
                                <span key={e} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{e}</span>
                              ))}
                            </span>
                          ) : dup ? (
                            <Badge tone="warning"><CopyX className="size-3" aria-hidden />{p.duplicateOfRow ? `Same as row ${p.duplicateOfRow}` : "Already in CRM"}</Badge>
                          ) : (
                            <Badge tone="success">Ready</Badge>
                          )}
                        </td>
                        {visibleFields.map((f) => (
                          <td key={f.key} className="max-w-48 truncate px-3 py-2" title={p.values[f.key]}>{p.values[f.key] ?? ""}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview.length > PREVIEW_LIMIT || (onlyProblems && shown.length === PREVIEW_LIMIT) ? (
              <p className="text-xs text-muted">Showing the first {PREVIEW_LIMIT} rows. Every row is checked again when you import.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {parsed && mappingReady ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Import</CardTitle>
            <CardDescription>All rows are saved together. Rows with errors and duplicates are skipped and listed afterwards.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {owners.length ? (
              <div className="grid max-w-sm gap-1">
                <label htmlFor="import-owner" className="text-xs font-medium text-[#444]">Assign imported candidates to</label>
                <Select id="import-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Nobody (unassigned)</option>
                  {owners.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="text-sm text-muted">Imported candidates will be assigned to you.</p>
            )}
            {result && !result.ok ? <Alert tone="danger">{result.message}</Alert> : null}
            <div>
              <Button onClick={runImport} disabled={importing || summary.ready === 0} aria-busy={importing}>
                {importing ? "Importing…" : `Import ${summary.ready} candidate${summary.ready === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/60 px-2 py-3">
      <p className={cn("text-xl font-bold", tone)}>{value.toLocaleString("en-IN")}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
