// 사용 가이드: 기본 사용 흐름, 기능별 설명, 자주 묻는 질문 (Android GuideScreen.kt와 같은 내용).
import { useNavigate } from "react-router-dom";
import { GUIDE, guideBlocks, type GuideItem } from "../lib/guide";

export function GuideScreen() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/settings")}>
        ← 설정
      </button>
      <h1 style={{ margin: 0 }}>사용 가이드</h1>
      {GUIDE.map((section, sectionIndex) => (
        <section key={section.id} className="stack" aria-labelledby={`guide-${section.id}`}>
          <h2 id={`guide-${section.id}`}>{section.title}</h2>
          {section.items.map((item, itemIndex) => (
            // 처음 여는 사람이 바로 읽을 수 있게 첫 항목만 펴 둔다.
            <GuideEntry key={item.id} item={item} open={sectionIndex === 0 && itemIndex === 0} />
          ))}
        </section>
      ))}
      <p className="small muted">
        버전 {__APP_VERSION__}
        <br />
        Data based on NEXON Open API
      </p>
    </div>
  );
}

function GuideEntry({ item, open }: { item: GuideItem; open: boolean }) {
  return (
    <details className="guide-item" open={open}>
      <summary>{item.title}</summary>
      <div className="guide-body">
        {guideBlocks(item.body).map((block, index) =>
          block.kind === "paragraph" ? (
            <p key={index}>{block.text}</p>
          ) : (
            <ul key={index}>
              {block.items.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ),
        )}
      </div>
    </details>
  );
}
