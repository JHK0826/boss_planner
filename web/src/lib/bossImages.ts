// 내 캐릭터 탭 보스 칩에 쓰는 보스 이미지. 이미지는 scripts/boss_images.py로 원본 카드를 잘라 만든다.
// Android ui/BossImages.kt와 같은 표다.

/** 보스 이름 → 이미지 파일 이름(슬러그). 표에 없거나 파일이 없는 보스는 이름 글씨로 보여 준다. */
export const BOSS_IMAGE_SLUGS: Record<string, string> = {
  자쿰: "zakum",
  매그너스: "magnus",
  파풀라투스: "papulatus",
  피에르: "pierre",
  반반: "vonbon",
  블러디퀸: "crimson_queen",
  벨룸: "vellum",
  스우: "lotus",
  데미안: "damien",
  "가디언 엔젤 슬라임": "guardian_angel_slime",
  루시드: "lucid",
  윌: "will",
  더스크: "gloom",
  "진 힐라": "verus_hilla",
  듄켈: "darknell",
  "검은 마법사": "black_mage",
  "선택받은 세렌": "seren",
  "감시자 칼로스": "kalos",
  카링: "kaling",
  림보: "limbo",
  발드릭스: "baldrix",
  "최초의 대적자": "first_adversary",
  "찬란한 흉성": "radiant_malefic_star",
  유피테르: "jupiter",
  벨로나: "bellona",
};

const files = import.meta.glob<string>("../assets/bosses/*.webp", { eager: true, import: "default", query: "?url" });
const urls: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".webp".length), url]),
);
const squash = (name: string) => name.replace(/\s+/g, "");
const slugByName = new Map(Object.entries(BOSS_IMAGE_SLUGS).map(([name, slug]) => [squash(name), slug]));

/** 보스 이미지 주소. 이름의 띄어쓰기는 보지 않는다. 이미지가 없으면 undefined */
export function bossImage(name: string): string | undefined {
  const slug = slugByName.get(squash(name));
  return slug ? urls[slug] : undefined;
}
