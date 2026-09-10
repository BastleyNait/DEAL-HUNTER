import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ConfigProvider, SearchConfig } from "../domain/types.ts";
import { DEFAULT_SEARCH_CONFIG } from "../domain/default-config.ts";

/**
 * Lee el SearchConfig activo desde la tabla `search_config` (fila id=1).
 * Si no existe fila o falla la lectura, cae a DEFAULT_SEARCH_CONFIG — así el
 * sistema nunca deja de correr por un problema de config, y editar la fila en
 * DB alcanza para ajustar el criterio sin redeployar.
 */
export class SupabaseConfigProvider implements ConfigProvider {
  constructor(private readonly supabase: SupabaseClient) {}

  async getConfig(): Promise<SearchConfig> {
    const { data, error } = await this.supabase
      .from("search_config")
      .select("config")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data?.config) {
      return DEFAULT_SEARCH_CONFIG;
    }

    return { ...DEFAULT_SEARCH_CONFIG, ...(data.config as Partial<SearchConfig>) };
  }
}
