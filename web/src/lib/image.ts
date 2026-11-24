// 채팅에 올릴 이미지를 줄인다 (Android data/ImageCompressor.kt와 같은 기준).
// 긴 쪽을 최대 1600픽셀로 맞추고 JPEG로 압축해서 스크린샷 한 장이 보통 수백 KB가 되게 한다 (올릴 수 있는 한도는 5MB).

const MAX_SIDE = 1600;
const QUALITY = 0.82;

export class ImageReadError extends Error {
  constructor() {
    super("이미지를 읽을 수 없습니다.");
    this.name = "UserFacingError";
  }
}

/** 사진의 회전 정보(EXIF)를 반영해 그린다. createImageBitmap이 없거나 실패하면 <img>로 읽는다. */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new ImageReadError();
    }
  }
}

export async function toJpeg(file: Blob): Promise<Blob> {
  const image = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImageReadError();
    // 투명한 PNG가 검게 나오지 않도록 흰 바탕을 깐다.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new ImageReadError();
    return blob;
  } finally {
    image.close();
  }
}
