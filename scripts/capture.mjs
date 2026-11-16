import { mkdir, copyFile, readdir } from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer-core"

const root = path.resolve(import.meta.dirname, "..")
const base = "http://127.0.0.1:4731/"
const chrome = "/usr/bin/google-chrome"

async function clickText(page, label) {
  const ok = await page.evaluate((wanted) => {
    const nodes = [...document.querySelectorAll("a,button")]
    const el = nodes.find((node) => (node.textContent ?? "").replace(/\s+/g, "").includes(wanted))
    if (!el) return false
    el.click()
    return true
  }, label)
  if (!ok) throw new Error(`找不到「${label}」`)
}

async function waitScreen(page, name) {
  await page.waitForSelector(`[data-screen="${name}"]`, { timeout: 5000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((resolve) => setTimeout(resolve, 320))
}

async function shot(page, file) {
  await mkdir(path.dirname(file), { recursive: true })
  await page.screenshot({ path: file, type: "png" })
  console.log("saved", path.relative(root, file))
}

async function flow(page, folder) {
  await page.goto(`${base}#/`, { waitUntil: "networkidle0" })
  await waitScreen(page, "home")
  const font = await page.$eval("h1", (el) => getComputedStyle(el).fontFamily)
  console.log(folder, "h1", font)
  if (!font.includes("Noto Serif SC")) throw new Error(`标题字体不对：${font}`)
  const disabledTag = await page.$eval(".work-row.is-disabled", (el) => el.tagName)
  if (disabledTag !== "DIV") throw new Error("复杂表达不该是链接")
  await shot(page, path.join(folder, "01-home.png"))

  await clickText(page, "简单复述")
  await waitScreen(page, "pick")
  await shot(page, path.join(folder, "02-pick.png"))

  await clickText(page, "周四的客户会改到线上")
  await waitScreen(page, "read")
  await shot(page, path.join(folder, "03-read.png"))

  await clickText(page, "开始复述")
  await waitScreen(page, "speak")
  const auto = await page.$eval("main.speak", (el) => el.getAttribute("data-recording"))
  if (auto !== "0") throw new Error("进入复述时不应自动录音")
  await clickText(page, "开始讲")
  await page.waitForSelector('[data-recording="1"]', { timeout: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await shot(page, path.join(folder, "04-speaking.png"))

  await clickText(page, "讲完了")
  await waitScreen(page, "transcript")
  const hasPlayer = await page.$(".recording-btn")
  if (!hasPlayer) throw new Error("有录音时应该能播放")
  const mock = await page.$eval("body", (el) => el.innerText.includes("示例逐字稿"))
  if (!mock) throw new Error("缺少示例逐字稿标记")
  await shot(page, path.join(folder, "05-transcript.png"))

  await clickText(page, "看看小黄鸭听到了什么")
  await waitScreen(page, "feedback")
  const feedback = await page.$eval("body", (el) => el.innerText)
  if (!feedback.includes("示例反馈")) throw new Error("缺少示例反馈标记")
  if (!feedback.includes("仓储接口")) throw new Error("反馈没有指向材料里的缺口")
  await shot(page, path.join(folder, "06-feedback.png"))

  await clickText(page, "再讲一遍")
  await waitScreen(page, "speak")
  const second = await page.$eval("main.speak", (el) => el.getAttribute("data-recording"))
  if (second !== "0") throw new Error("第二遍不应自动开始录音")
  const timer = await page.$eval(".timer", (el) => el.textContent?.trim())
  if (timer !== "0:00") throw new Error(`第二遍计时不是 0:00：${timer}`)
  await clickText(page, "开始讲")
  await page.waitForSelector('[data-recording="1"]', { timeout: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  await clickText(page, "讲完了")
  await waitScreen(page, "compare")
  const compare = await page.$eval("body", (el) => el.innerText)
  if (!compare.includes("第一遍") || !compare.includes("第二遍")) throw new Error("对照页不完整")
  if (!compare.includes("四十分钟")) throw new Error("第二遍反馈没有留下未讲清的时长")
  await shot(page, path.join(folder, "07-compare.png"))
}

async function assertPeek(page) {
  await page.goto(`${base}#/speak/meeting/1`, { waitUntil: "networkidle0" })
  await waitScreen(page, "speak")
  const before = await page.$eval("body", (el) => el.innerText.includes("仓储接口"))
  if (before) throw new Error("材料不该默认出现在复述页")
  await clickText(page, "再看一眼材料")
  await page.waitForSelector(".drawer")
  const during = await page.$eval(".drawer", (el) => el.innerText.includes("仓储接口"))
  if (!during) throw new Error("抽屉里没有原文")
  await clickText(page, "收回")
  await page.waitForSelector(".drawer", { hidden: true })
  const after = await page.$eval("body", (el) => el.innerText.includes("仓储接口"))
  if (after) throw new Error("收回后材料还在")
  console.log("peek opens and closes")
}

async function assertMicDenial() {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${base}#/read/meeting`, { waitUntil: "networkidle0" })
    await clickText(page, "开始复述")
    await waitScreen(page, "speak")
    await clickText(page, "开始讲")
    await page.waitForFunction(
      () => document.body.innerText.includes("讲完了」会进入示例逐字稿"),
      { timeout: 5000 },
    )
    await clickText(page, "讲完了")
    await waitScreen(page, "transcript")
    const text = await page.$eval("body", (el) => el.innerText)
    if (!text.includes("这次没有录音")) throw new Error("拒绝麦克风后没有走到示例逐字稿")
    console.log("mic denial continues")
  } finally {
    await browser.close()
  }
}

async function assertEdit() {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(`${base}#/transcript/gym`, { waitUntil: "networkidle0" })
    await waitScreen(page, "transcript")
    await clickText(page, "以后再办一个月的")
    await page.waitForSelector("textarea.sentence-edit")
    await page.click("textarea.sentence-edit")
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyA")
    await page.keyboard.up("Control")
    await page.keyboard.type("以后再办一个月的，这句是识别错了。")
    await page.click("h1")
    await clickText(page, "看看小黄鸭听到了什么")
    await waitScreen(page, "feedback")
    const text = await page.$eval("body", (el) => el.innerText)
    if (!text.includes("这句是识别错了")) throw new Error("改正没有出现在反馈引用里")
    if (!text.includes("不会跟着重算")) throw new Error("改字后没有说明反馈不重算")
    console.log("inline edit reaches the quote")
  } finally {
    await browser.close()
  }
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
})

try {
  const page = await browser.newPage()
  const context = browser.defaultBrowserContext()
  await context.overridePermissions(base, ["microphone"])
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await flow(page, path.join(root, "artifacts/1440"))
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  await flow(page, path.join(root, "artifacts/390"))
  await assertPeek(page)
} finally {
  await browser.close()
}

await assertMicDenial()
await assertEdit()

const cloud = "/opt/cursor/artifacts"
await mkdir(cloud, { recursive: true })
for (const size of ["1440", "390"]) {
  const dir = path.join(root, "artifacts", size)
  for (const name of await readdir(dir)) {
    await copyFile(path.join(dir, name), path.join(cloud, `${size}-${name}`))
  }
}
console.log("copied to", cloud)
