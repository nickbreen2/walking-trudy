// Tiny Bot API client. Corgi Relay speaks the Telegram Bot API, so only the
// base URL differs: BASE/bot<TOKEN>/<method>.

export class BotApiError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
  ) {
    super(`${method} failed: ${code} ${description}`);
  }
}

export interface BotApi {
  call<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T>;
}

export class RelayClient implements BotApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: { ok?: boolean; result?: T; error_code?: number; description?: string };
    try {
      data = await res.json();
    } catch {
      throw new BotApiError(method, res.status, "non-JSON response");
    }
    if (!data.ok) {
      throw new BotApiError(method, data.error_code ?? res.status, data.description ?? "unknown error");
    }
    return data.result as T;
  }
}
