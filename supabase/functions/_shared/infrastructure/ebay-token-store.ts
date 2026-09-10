import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const EBAY_ENV = Deno.env.get("EBAY_ENV") ?? "PRODUCTION";
const IS_SANDBOX = EBAY_ENV === "SANDBOX";

const TOKEN_URL = IS_SANDBOX
  ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
  : "https://api.ebay.com/identity/v1/oauth2/token";

/** Responsabilidad única: mantener un application token de eBay válido, persistido en DB. */
export class EbayTokenStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async getValidToken(): Promise<string> {
    const { data } = await this.supabase
      .from("ebay_oauth_token")
      .select("access_token, expires_at")
      .eq("id", 1)
      .maybeSingle();

    if (data && new Date(data.expires_at).getTime() - Date.now() > 60_000) {
      return data.access_token;
    }

    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("Faltan EBAY_CLIENT_ID / EBAY_CLIENT_SECRET en las secrets de la función.");
    }

    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    });

    if (!res.ok) {
      throw new Error(`eBay OAuth token error ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    const expiresAt = new Date(Date.now() + json.expires_in * 1000 - 120_000).toISOString();

    await this.supabase.from("ebay_oauth_token").upsert({
      id: 1,
      access_token: json.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });

    return json.access_token as string;
  }
}
