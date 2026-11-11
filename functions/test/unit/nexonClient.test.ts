import { describe, expect, it, vi } from "vitest";
import { NexonApiError, NexonClient } from "../../src/nexon/client";

const KEY = "test_key_abcdefghijklmnopqrstuvwxyz";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(fetchFn: typeof fetch, sleep = vi.fn(async (_ms: number) => {})) {
  return { nexon: new NexonClient(KEY, { fetchFn, sleep, baseDelayMs: 100 }), sleep };
}

describe("NexonClient", () => {
  it("모든 계정의 캐릭터를 합치고 API Key를 헤더로 보낸다", async () => {
    const fetchFn = vi.fn(async () =>
      json(200, {
        account_list: [
          { account_id: "a", character_list: [{ ocid: "o1", character_name: "가", world_name: "스카니아", character_class: "비숍", character_level: 280 }] },
          { account_id: "b", character_list: [{ ocid: "o2", character_name: "나", world_name: "루나", character_class: "히어로", character_level: 260 }] },
        ],
      }),
    );
    const { nexon } = client(fetchFn as unknown as typeof fetch);

    const list = await nexon.listCharacters();

    expect(list.map((c) => c.ocid)).toEqual(["o1", "o2"]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://open.api.nexon.com/maplestory/v1/character/list");
    expect((init.headers as Record<string, string>)["x-nxopen-api-key"]).toBe(KEY);
  });

  it("429와 5xx는 지수 백오프로 재시도한다", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: { name: "OPENAPI00007", message: "too many" } }))
      .mockResolvedValueOnce(json(500, { error: { name: "OPENAPI00001", message: "server" } }))
      .mockResolvedValueOnce(json(200, { account_list: [] }));
    const { nexon, sleep } = client(fetchFn as unknown as typeof fetch);

    await expect(nexon.listCharacters()).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("점검 중 코드는 재시도하고, 끝까지 실패하면 maintenance로 던진다", async () => {
    const fetchFn = vi.fn(async () => json(400, { error: { name: "OPENAPI00010", message: "점검" } }));
    const { nexon } = client(fetchFn as unknown as typeof fetch);

    await expect(nexon.listCharacters()).rejects.toMatchObject({ kind: "maintenance", code: "OPENAPI00010" });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("잘못된 API Key는 재시도하지 않는다", async () => {
    const fetchFn = vi.fn(async () => json(400, { error: { name: "OPENAPI00005", message: "invalid key" } }));
    const { nexon, sleep } = client(fetchFn as unknown as typeof fetch);

    await expect(nexon.listCharacters()).rejects.toMatchObject({ kind: "invalid-key" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("에러 메시지에 API Key와 ocid를 남기지 않는다", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`connect failed https://open.api.nexon.com/x?ocid=SECRET_OCID key=${KEY}`);
    });
    const { nexon } = client(fetchFn as unknown as typeof fetch);

    const error = await nexon.getCharacterBasic("SECRET_OCID").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NexonApiError);
    const text = `${(error as Error).message} ${(error as Error).stack} ${JSON.stringify(error)}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("SECRET_OCID");
  });

  it("기본 정보 조회는 ocid를 쿼리로 보내고 빠진 값은 null로 채운다", async () => {
    const fetchFn = vi.fn(async () =>
      json(200, { character_name: "가", world_name: "스카니아", character_class: "비숍", character_level: 280 }),
    );
    const { nexon } = client(fetchFn as unknown as typeof fetch);

    const basic = await nexon.getCharacterBasic("o1");

    expect((fetchFn.mock.calls[0] as unknown as [URL])[0].searchParams.get("ocid")).toBe("o1");
    expect(basic).toMatchObject({ character_level: 280, character_image: null, character_guild_name: null });
  });
});
