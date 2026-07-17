// Shared by every observability settings sub-panel (Overview/Traces/
// Comparisons/Events/Privacy/Timeline/Cost) — the generated SDK returns
// `{ data?, error? }` rather than throwing, so each call site would
// otherwise repeat this same unwrap.
export async function unwrap<T>(request: Promise<{ data?: T; error?: unknown }>) {
  const result = await request
  if (result.data !== undefined) return result.data
  throw new Error(result.error instanceof Error ? result.error.message : "Request failed")
}
