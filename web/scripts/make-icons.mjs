// public/icon.svg를 PWA·아이폰 홈 화면용 PNG로 만든다. 아이콘을 바꿨을 때만 다시 실행하면 된다.
// 아이폰은 홈 화면 아이콘(apple-touch-icon)에 SVG를 쓰지 못해서 PNG가 필요하다.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, file] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname });
}
await browser.close();
