/**
 * NEXON Open API 클라이언트.
 *
 * - Cloud Functions 안에서만 사용한다.
 * - API Key와 ocid는 헤더·쿼리로만 보내고 로그나 에러 메시지에 남기지 않는다.
 * - 재시도는 429, 5xx, 점검 중 코드에만 지수 백오프로 한다.
 */

const HOST = "https://open.api.nexon.com";

/** 재시도 대상인 NEXON 에러 코드: 게임 점검, API 점검 */
const MAINTENANCE_CODES = new Set(["OPENAPI00010", "OPENAPI00011"]);
const INVALID_KEY_CODE = "OPENAPI00005";

export type NexonErrorKind =
  | "invalid-key"
  | "rate-limited"
  | "maintenance"
  | "bad-request"
  | "server"
  | "network";

export class NexonApiError extends Error {
  constructor(
    readonly kind: NexonErrorKind,
    readonly status: number,
    readonly code: string | null,
  ) {
    // 메시지에는 종류와 코드만 담는다. URL(ocid 포함)과 키는 넣지 않는다.
    super(`NEXON API error: ${kind}${code ? ` (${code})` : ""}`);
    this.name = "NexonApiError";
  }
}

export interface NexonClientOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

export interface NexonCharacterSummary {
  ocid: string;
  character_name: string;
  world_name: string;
  character_class: string;
  character_level: number;
}

interface CharacterListResponse {
  account_list?: { account_id: string; character_list?: NexonCharacterSummary[] }[];
}

export interface NexonCharacterBasic {
  character_name: string;
  world_name: string;
  character_class: string;
  character_level: number;
  character_image: string | null;
  character_guild_name: string | null;
}

function classify(status: number, code: string | null): NexonErrorKind {
  if (code === INVALID_KEY_CODE) return "invalid-key";
  if (code !== null && MAINTENANCE_CODES.has(code)) return "maintenance";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "bad-request";
}

function isRetryable(kind: NexonErrorKind): boolean {
  return kind === "rate-limited" || kind === "maintenance" || kind === "server" || kind === "network";
}

export class NexonClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: NexonClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** 계정의 모든 캐릭터 (여러 메이플 계정이 묶여 있으면 합쳐서 반환) */
  async listCharacters(): Promise<NexonCharacterSummary[]> {
    const body = await this.get<CharacterListResponse>("/maplestory/v1/character/list", {});
    return (body.account_list ?? []).flatMap((account) => account.character_list ?? []);
  }

  async getCharacterBasic(ocid: string): Promise<NexonCharacterBasic> {
    const body = await this.get<Partial<NexonCharacterBasic>>("/maplestory/v1/character/basic", { ocid });
    return {
      character_name: body.character_name ?? "",
      world_name: body.world_name ?? "",
      character_class: body.character_class ?? "",
      character_level: body.character_level ?? 0,
      character_image: body.character_image ?? null,
      character_guild_name: body.character_guild_name ?? null,
    };
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(path, HOST);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    let lastError: NexonApiError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) await this.sleep(this.baseDelayMs * 2 ** (attempt - 2));
      try {
        return await this.requestOnce<T>(url);
      } catch (error) {
        if (!(error instanceof NexonApiError) || !isRetryable(error.kind)) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new NexonApiError("network", 0, null);
  }

  private async requestOnce<T>(url: URL): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        headers: { "x-nxopen-api-key": this.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // 원본 에러에는 URL이 들어 있을 수 있어 버린다.
      throw new NexonApiError("network", 0, null);
    }

    if (response.ok) return (await response.json()) as T;

    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: { name?: unknown } };
      if (typeof body.error?.name === "string") code = body.error.name;
    } catch {
      // JSON이 아닌 에러 응답은 상태 코드로만 분류한다.
    }
    throw new NexonApiError(classify(response.status, code), response.status, code);
  }
}
