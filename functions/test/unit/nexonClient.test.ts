import { describe, expect, it, vi } from "vitest";
import { NexonApiError, NexonClient, allBossesCompleted, bossCompleted } from "../../src/nexon/client";

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

describe("스케줄러 API", () => {
  // 실제 응답에서 확인한 형식: 플래그는 문자열, 난이도는 소문자, 같은 보스가 일간·주간에 따로 있다.
  const contents = [
    { content_name: "자쿰", difficulty: "normal", cycle: "bossDaily", list_order_no: 1, registration_flag: "false", complete_flag: "true" },
    { content_name: "자쿰", difficulty: "chaos", cycle: "bossWeekly", list_order_no: 2, registration_flag: "false", complete_flag: "false" },
    { content_name: "스우", difficulty: "hard", cycle: "bossWeekly", list_order_no: 3, registration_flag: "true", complete_flag: "true" },
    { content_name: "검은 마법사", difficulty: "hard", cycle: "bossMonthly", list_order_no: 4, registration_flag: "false", complete_flag: "false" },
  ];

  it("ocid와 date를 쿼리로 보내고 boss_contents를 돌려준다", async () => {
    const fetchFn = vi.fn(async () => json(200, { date: "2026-11-10T00:00+09:00", boss_contents: contents }));
    const { nexon } = client(fetchFn as unknown as typeof fetch);

    expect(await nexon.getBossContents("o1", "2026-11-10")).toHaveLength(4);
    const url = (fetchFn.mock.calls[0] as unknown as [URL])[0];
    expect(url.pathname).toBe("/maplestory/v1/scheduler/character-state");
    expect(url.searchParams.get("date")).toBe("2026-11-10");
  });

  it("조회 가능 기간을 벗어난 날짜(OPENAPI00004)는 재시도하지 않는다", async () => {
    const fetchFn = vi.fn(async () => json(400, { error: { name: "OPENAPI00004", message: "Please input valid parameter" } }));
    const { nexon } = client(fetchFn as unknown as typeof fetch);
    await expect(nexon.getBossContents("o1", "2025-01-01")).rejects.toMatchObject({ kind: "bad-request" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("보스 이름과 난이도로 클리어 여부를 찾는다", () => {
    expect(bossCompleted(contents, "스우", "HARD")).toBe(true);
    expect(bossCompleted(contents, "자쿰", "CHAOS")).toBe(false);
    expect(bossCompleted(contents, "검은 마법사", "HARD")).toBe(false);
    // 일간 보스 항목은 보지 않는다. 목록에 없는 보스·난이도는 판단하지 않는다.
    expect(bossCompleted(contents, "자쿰", "NORMAL")).toBeNull();
    expect(bossCompleted(contents, "스우", "EXTREME")).toBeNull();
    expect(bossCompleted(contents, "없는 보스", "HARD")).toBeNull();
  });

  it("묶음 파티는 전부 클리어해야 클리어, 하나라도 미클리어면 미클리어다", () => {
    const boss = (name: string, difficulty: string) => ({ name, difficulty });
    expect(allBossesCompleted(contents, [boss("스우", "HARD")])).toBe(true);
    expect(allBossesCompleted(contents, [boss("스우", "HARD"), boss("자쿰", "CHAOS")])).toBe(false);
    // 판단할 수 없는 보스가 섞여 있으면 클리어라고 하지 않는다. 미클리어가 있으면 미클리어다.
    expect(allBossesCompleted(contents, [boss("스우", "HARD"), boss("없는 보스", "HARD")])).toBeNull();
    expect(allBossesCompleted(contents, [boss("자쿰", "CHAOS"), boss("없는 보스", "HARD")])).toBe(false);
    expect(allBossesCompleted(contents, [])).toBeNull();
  });
});
