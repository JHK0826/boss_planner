// 설정 탭의 사용 가이드. 문구는 저장소 최상위 guide/guide.json 한 곳에 두고 Android 앱(assets)과 같이 쓴다.
import data from "../../../guide/guide.json";

export interface GuideItem {
  id: string;
  title: string;
  /** 줄마다 문단, "- "로 시작하면 점 항목 */
  body: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  items: GuideItem[];
}

export const GUIDE: GuideSection[] = data.sections;

/** 화면에 그릴 덩어리: 문단 하나, 또는 이어진 점 항목 묶음 */
export type GuideBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** 본문 줄을 문단과 점 항목 묶음으로 나눈다 (Android data/Guide.kt와 같은 규칙) */
export function guideBlocks(body: string[]): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  for (const line of body) {
    if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list") last.items.push(line.slice(2));
      else blocks.push({ kind: "list", items: [line.slice(2)] });
    } else {
      blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks;
}
