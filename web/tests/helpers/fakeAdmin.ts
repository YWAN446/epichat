import type { SupabaseClient } from "@supabase/supabase-js";

export type Recorded = { table: string; calls: [string, unknown[]][] };
export type Outcome = { data?: unknown; error?: { message: string } | null; count?: number | null };

/**
 * A stand-in for the secret-key client. Every call on a query builder is
 * recorded; awaiting the builder resolves to the next outcome for that table
 * (or `{ data: null, error: null }`). Enough for the thin stores in lib/.
 */
export function fakeAdmin(outcomes: Record<string, Outcome[]> = {}) {
  const recorded: Recorded[] = [];
  const rpcCalls: [string, unknown][] = [];
  const queue = Object.fromEntries(Object.entries(outcomes).map(([table, list]) => [table, [...list]]));

  function builder(table: string) {
    const entry: Recorded = { table, calls: [] };
    recorded.push(entry);
    const outcome = () => queue[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      then(resolve: (value: Outcome) => void, reject?: (reason: unknown) => void) {
        return Promise.resolve({ error: null, ...outcome() }).then(resolve, reject);
      },
    };
    for (const method of ["insert", "upsert", "update", "delete", "select", "eq", "is", "order", "limit", "single", "maybeSingle"]) {
      chain[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return chain;
      };
    }
    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push([name, params]);
      return { error: null, ...(queue[`rpc:${name}`]?.shift() ?? { data: null }) };
    },
  } as unknown as SupabaseClient;

  return { client, recorded, rpcCalls };
}

/** The arguments of the first call of `method` on `table`, or undefined. */
export function callOn(recorded: Recorded[], table: string, method: string): unknown[] | undefined {
  return recorded.find((r) => r.table === table)?.calls.find(([m]) => m === method)?.[1];
}
