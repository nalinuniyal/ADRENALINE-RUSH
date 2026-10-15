/** Strips characters that have meaning inside a PostgREST filter expression. */
export function searchTerm(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[,()%*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "";
}
