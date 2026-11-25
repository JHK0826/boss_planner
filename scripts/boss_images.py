#!/usr/bin/env python3
"""
보스 이미지 가공: 원본 보스 카드에서 이름 글씨를 빼고 정사각형으로 잘라 칩용 이미지를 만든다.

  python3 scripts/boss_images.py <원본 폴더> [--preview <미리보기.png>]

- 원본: 메이플스토리 보스 카드 (422×500, 이름 글씨가 왼쪽 위. 벨로나만 776×554, 오른쪽 위)
- 결과: 192×192 webp
    web/src/assets/bosses/<slug>.webp
    app/src/main/res/drawable-nodpi/boss_<slug>.webp
- 새 보스가 나오면 BOSSES에 (원본 파일, 슬러그, 자를 영역)을 한 줄 더하고, 웹 lib/bossImages.ts와
  Android ui/BossImages.kt의 이름 → 슬러그 표에도 넣는다.

자를 영역은 (x, y, 한 변 길이)이다. 이름 글씨(카드 위쪽 약 60px)를 피하고 얼굴이 들어가게 골랐다.
"""
import argparse
import os

from PIL import Image, ImageDraw

SIZE = 192
QUALITY = 82
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web", "src", "assets", "bosses")
ANDROID_DIR = os.path.join(ROOT, "app", "src", "main", "res", "drawable-nodpi")

# (원본 파일, 슬러그, (x, y, 한 변))
BOSSES = [
    ("9437.webp", "zakum", (130, 62, 290)),
    ("9438.webp", "papulatus", (0, 78, 422)),
    ("9439.webp", "pierre", (0, 78, 422)),
    ("9440.webp", "vonbon", (20, 62, 330)),
    ("9441.webp", "crimson_queen", (0, 78, 422)),
    ("9442.webp", "vellum", (0, 78, 422)),
    ("9443.webp", "lotus", (30, 70, 330)),
    ("9444.webp", "damien", (0, 78, 422)),
    ("9445.webp", "guardian_angel_slime", (0, 78, 422)),
    ("9446.webp", "lucid", (20, 62, 340)),
    ("9447.webp", "will", (100, 62, 322)),
    ("9448.webp", "gloom", (0, 78, 422)),
    ("9449.webp", "verus_hilla", (40, 62, 340)),
    ("9450.webp", "darknell", (20, 62, 360)),
    ("9451.webp", "black_mage", (0, 78, 422)),
    ("9452.webp", "seren", (40, 64, 320)),
    ("9453.webp", "kalos", (100, 64, 322)),
    ("9454.webp", "first_adversary", (0, 78, 422)),
    ("9455.webp", "kaling", (20, 62, 300)),
    ("9456.webp", "radiant_malefic_star", (40, 62, 300)),
    ("9457.webp", "limbo", (0, 78, 422)),
    ("9458.webp", "baldrix", (0, 78, 422)),
    ("9459.webp", "jupiter", (20, 62, 320)),
    ("9433.png", "bellona", (220, 40, 380)),
    ("magnus.png", "magnus", (70, 66, 330)),
]


def crop(path, box):
    x, y, s = box
    image = Image.open(path).convert("RGBA").crop((x, y, x + s, y + s)).resize((SIZE, SIZE), Image.LANCZOS)
    # 카드 모서리의 투명한 부분이 들어가도 칩 배경과 어울리게 어두운 색으로 채운다.
    background = Image.new("RGBA", image.size, (24, 24, 28, 255))
    return Image.alpha_composite(background, image).convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--preview")
    args = parser.parse_args()
    os.makedirs(WEB_DIR, exist_ok=True)
    os.makedirs(ANDROID_DIR, exist_ok=True)
    tiles = []
    for name, slug, box in BOSSES:
        image = crop(os.path.join(args.source, name), box)
        image.save(os.path.join(WEB_DIR, f"{slug}.webp"), "WEBP", quality=QUALITY, method=6)
        image.save(os.path.join(ANDROID_DIR, f"boss_{slug}.webp"), "WEBP", quality=QUALITY, method=6)
        tiles.append((slug, image))
    if args.preview:
        cols, cell = 6, 110
        sheet = Image.new("RGB", (cols * cell, ((len(tiles) + cols - 1) // cols) * (cell + 16)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (slug, image) in enumerate(tiles):
            x, y = (i % cols) * cell, (i // cols) * (cell + 16)
            sheet.paste(image.resize((cell - 6, cell - 6), Image.LANCZOS), (x + 3, y + 3))
            draw.text((x + 3, y + cell), slug, fill="black")
        sheet.save(args.preview)
    print(f"{len(tiles)} images")


if __name__ == "__main__":
    main()
