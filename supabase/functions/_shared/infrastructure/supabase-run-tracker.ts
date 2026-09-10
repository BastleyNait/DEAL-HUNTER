import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RunStats, RunTracker } from "../domain/types.ts";

export class SupabaseRunTracker implements RunTracker {
  constructor(private readonly supabase: SupabaseClient) {}

  async start(): Promise<number> {
    const { data } = await this.supabase
      .from("hunt_runs")
      .insert({ started_at: new Date().toISOString() })
      .select("id")
      .single();
    return data!.id as number;
  }

  async finish(runId: number | string, stats: RunStats): Promise<void> {
    await this.supabase
      .from("hunt_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_scanned: stats.itemsScanned,
        candidates_checked: stats.candidatesChecked,
        items_qualified: stats.itemsQualified,
        error: stats.error ?? null,
      })
      .eq("id", runId);
  }
}
