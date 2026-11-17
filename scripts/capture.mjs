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

async function waitPhase(page, phase) {
  await page.waitForSelector(`[data-speak-phase="${phase}"]`, { timeout: 5000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((resolve) => setTimeout(resolve, 280))
}

async function shot(page, file, { fullPage = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  if (fullPage) {
    await page.addStyleTag({
      content: "html, body { overflow: visible !important; } .topbar { position: static !important; }",
    })
  }
  await page.screenshot({ path: file, type: "png", fullPage })
  console.log("saved", path.relative(root, file))
}

async function flow(page, folder, v2prefix) {
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
  const readText = await page.$eval("body", (el) => el.innerText)
  if (!readText.includes("刚来两周的新同事")) throw new Error("阅读页没有语境")
  if (readText.includes("这些前提") || /前提[：:]/.test(readText)) {
    throw new Error("阅读页不应出现前提清单或前提标记")
  }
  await shot(page, path.join(folder, "03-read.png"))

  await clickText(page, "开始复述")
  await waitScreen(page, "speak")
  await waitPhase(page, "check")
  const auto = await page.$eval("main.speak", (el) => el.getAttribute("data-recording"))
  if (auto !== "0") throw new Error("进入试音时不应自动录音")
  const checkText = await page.$eval("body", (el) => el.innerText)
  if (!checkText.includes("先对小黄鸭说一句") && !checkText.includes("可以开始复述")) {
    throw new Error("试音页没有「你好」提示")
  }
  await page.mouse.click(200, 400)
  await new Promise((resolve) => setTimeout(resolve, 800))
  await shot(page, path.join(folder, "04-mic-check.png"))
  await shot(page, path.join(root, "shots", `${v2prefix}-mic-check.png`))

  await clickText(page, "开始复述")
  await page.waitForSelector('[data-recording="1"]', { timeout: 5000 })
  await waitPhase(page, "speak")
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const speakingText = await page.$eval("body", (el) => el.innerText)
  if (speakingText.includes("嗯，就是那个")) throw new Error("讲的时候不该出现逐字稿")
  if (!(await page.$(".voice-meter"))) throw new Error("讲的时候应有声波")
  await shot(page, path.join(folder, "05-speaking.png"))
  await shot(page, path.join(root, "shots", `${v2prefix}-speaking.png`))

  await clickText(page, "讲完了")
  await waitPhase(page, "recalling")
  const recalling = await page.$eval("body", (el) => el.innerText)
  if (!recalling.includes("小黄鸭正在回想你说的话")) throw new Error("缺少回想过渡")
  await shot(page, path.join(folder, "06-transition.png"))
  await shot(page, path.join(root, "shots", `${v2prefix}-transition.png`))

  await waitScreen(page, "transcript")
  const hasPlayer = await page.$(".recording-btn")
  if (!hasPlayer) throw new Error("有录音时应该能播放")
  const mock = await page.$eval("body", (el) => el.innerText.includes("示例逐字稿"))
  if (!mock) throw new Error("缺少示例逐字稿标记")
  await shot(page, path.join(folder, "07-transcript.png"))

  await clickText(page, "看看小黄鸭听到了什么")
  await waitScreen(page, "feedback")
  const feedback = await page.$eval("body", (el) => el.innerText)
  if (!feedback.includes("示例反馈")) throw new Error("缺少示例反馈标记")
  if (!feedback.includes("仓储接口") && !feedback.includes("原来不是在会议室开吗")) {
    throw new Error("反馈没有指向材料里的缺口")
  }
  if (!feedback.includes("这些前提交代清楚了没有")) throw new Error("反馈后应揭开前提清单")
  if (!feedback.includes("获取复述报告")) throw new Error("缺少获取复述报告")
  await page.$eval(".premise-reveal", (el) => el.scrollIntoView({ block: "center" }))
  await new Promise((resolve) => setTimeout(resolve, 200))
  await shot(page, path.join(folder, "08-feedback.png"), { fullPage: true })
  await shot(page, path.join(root, "shots", `${v2prefix}-feedback.png`), { fullPage: true })

  await clickText(page, "获取复述报告")
  await waitScreen(page, "report")
  const report = await page.$eval("body", (el) => el.innerText)
  if (!report.includes("示例报告")) throw new Error("缺少示例报告标记")
  if (!report.includes("材料匹配度") || !report.includes("逻辑完整性") || !report.includes("语言流畅度")) {
    throw new Error("报告维度不完整")
  }
  await shot(page, path.join(folder, "09-report.png"), { fullPage: true })
  await shot(page, path.join(root, "shots", `${v2prefix}-report.png`), { fullPage: true })

  await clickText(page, "返回反馈")
  await waitScreen(page, "feedback")
  await clickText(page, "再讲一遍")
  await waitScreen(page, "speak")
  await waitPhase(page, "idle")
  const second = await page.$eval("main.speak", (el) => el.getAttribute("data-recording"))
  if (second !== "0") throw new Error("第二遍不应自动开始录音")
  const timer = await page.$eval(".timer", (el) => el.textContent?.trim())
  if (timer !== "0:00") throw new Error(`第二遍计时不是 0:00：${timer}`)
  await clickText(page, "开始讲")
  await page.waitForSelector('[data-recording="1"]', { timeout: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  await clickText(page, "讲完了")
  await waitPhase(page, "recalling")
  await waitScreen(page, "compare")
  const compare = await page.$eval("body", (el) => el.innerText)
  if (!compare.includes("第一遍") || !compare.includes("第二遍")) throw new Error("对照页不完整")
  if (!compare.includes("四十分钟")) throw new Error("第二遍反馈没有留下未讲清的时长")
  if (!compare.includes("这些前提交代清楚了没有")) throw new Error("对照页应揭开前提清单")
  await page.$eval(".compare-feedback", (el) => el.scrollIntoView({ block: "start" }))
  await new Promise((resolve) => setTimeout(resolve, 200))
  await shot(page, path.join(folder, "10-compare.png"), { fullPage: true })
  await shot(page, path.join(root, "shots", `${v2prefix}-compare.png`), { fullPage: true })
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
  if (await page.$eval(".drawer", (el) => el.innerText.includes("这些前提交代清楚了没有"))) {
    throw new Error("抽屉里不应出现前提清单")
  }
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
    await page.waitForFunction(
      () => document.body.innerText.includes("演示模式"),
      { timeout: 5000 },
    )
    if (!(await page.$(".voice-meter"))) throw new Error("演示模式也应有声波")
    await clickText(page, "开始复述")
    await page.waitForSelector('[data-recording="1"]', { timeout: 5000 })
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
  await flow(page, path.join(root, "artifacts/1440"), "v2-1440")
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  await flow(page, path.join(root, "artifacts/390"), "v2-390")
  await assertPeek(page)
} finally {
  await browser.close()
}

await assertMicDenial()
await assertEdit()

const cloud = "/opt/cursor/artifacts"
try {
  await mkdir(cloud, { recursive: true })
  for (const size of ["1440", "390"]) {
    const dir = path.join(root, "artifacts", size)
    for (const name of await readdir(dir)) {
      await copyFile(path.join(dir, name), path.join(cloud, `${size}-${name}`))
    }
  }
  console.log("copied to", cloud)
} catch (error) {
  console.log("skip cloud artifacts:", error.message)
}
