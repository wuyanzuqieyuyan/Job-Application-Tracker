import { expect, test, type Page } from '@playwright/test'

/**
 * 日期范围选择器占位符诊断（第一轮：取证与复现，不做业务代码修改）。
 * 验向：Chrome / Edge × 中文 / 英文 四组合（见 playwright.config.ts projects）。
 * 语义：未选择日期时占位文字必须来自项目 i18n（开始日期/结束日期 或 Start date/End date），
 *      绝不能出现浏览器格式模板 yyyy/mm/日、yyyy/mm/dd。
 * 选中日期显示必须为 YYYY-MM-DD；切换语言不清空日期；清除后恢复占位。
 */

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth()
const DAY = now.getDate()

type InputInfo = {
  tag: string
  type: string
  placeholder: string
  value: string
  html: string
  visibleClass: string
}
type PickerInfo = {
  count: number
  pickerClass: string
  pickerHtml: string
  inputs: InputInfo[]
  parentHtml: string
}
type CollectInfo = {
  href: string
  title: string
  documentLang: string
  moduleScripts: string[]
  pickers: PickerInfo[]
  visibleDateTokens: string[]
  appInstanceCount: number
}

const COLLECT_PICKER = () => {
  const pickers = [...document.querySelectorAll('.field-range-picker')].map((el) => {
    const wrap = el.closest('.field-range-inputs')
    return {
      count: 1,
      pickerClass: el.className,
      pickerHtml: el.outerHTML.slice(0, 600),
      inputs: [...el.querySelectorAll('input')].map((i) => {
        const cs = window.getComputedStyle(i)
        return {
          tag: i.tagName,
          type: i.type,
          placeholder: i.placeholder,
          value: i.value,
          html: i.outerHTML.slice(0, 300),
          visibleClass: ['display=', cs.display, ' visibility=', cs.visibility,
            ' opacity=', cs.opacity, ' color=', cs.color,
            ' fill=', (cs as unknown as Record<string, string>).webkitTextFillColor ?? '',
            ' font=', cs.font].join(''),
        }
      }),
      parentHtml: wrap ? wrap.outerHTML.slice(0, 150) : '',
    }
  })
  return {
    pickers,
    appInstanceCount: document.querySelectorAll('#app').length,
  }
}

async function collectPageInfo(page: Page): Promise<CollectInfo> {
  const base = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    documentLang: document.documentElement.lang,
    moduleScripts: [...document.querySelectorAll('script[type="module"]')].map(
      (s) => (s as HTMLScriptElement).src,
    ),
  }))
  const pickerPart = await page.evaluate(COLLECT_PICKER)
  const bodyText = await page.evaluate(() => document.body.innerText || '')
  const patterns = [/yyyy\s*\/\s*mm\s*\/\s*日/u, /yyyy\s*\/\s*mm\s*\/\s*dd/iu, /YYYY-MM-DD/u]
  const visibleDateTokens = base.href
    ? patterns
        .map((p) => (p.test(bodyText) ? p.source : null))
        .filter((t): t is string => t !== null)
    : []
  return {
    href: base.href,
    title: base.title,
    documentLang: base.documentLang,
    moduleScripts: base.moduleScripts,
    appInstanceCount: pickerPart.appInstanceCount,
    pickers: pickerPart.pickers,
    visibleDateTokens,
  }
}

async function toggleToEnglish(page: Page) {
  await page.locator('button.btn-lang').click()
  await expect
    .poll(async () => page.locator('.field-range-picker input').nth(0).getAttribute('placeholder'))
    .toBe('Start date')
}

/**
 * 初始语言探测：项目按 浏览器语言 → localStorage 兜底初始化（useI18n detectBrowserLocale），
 * 全新 Playwright context 无历史状态，故以 document.documentElement.lang 为准，
 * 占位符断言必须与实际初始语言对应（不预设 zh/en 哪个是初始）。
 */
async function detectInitialLang(page: Page): Promise<'zh' | 'en'> {
  const lang = await page.evaluate(() => document.documentElement.lang)
  return lang === 'en-US' ? 'en' : 'zh'
}

const STEP_LABELS: { zh: [string, string]; en: [string, string] } = {
  zh: ['开始日期', '结束日期'],
  en: ['Start date', 'End date'],
}

async function assertPlaceholderPair(page: Page, lang: 'zh' | 'en') {
  const [start, end] = STEP_LABELS[lang]
  const inputs = page.locator('.field-range-picker input')
  await expect(inputs.nth(0)).toHaveAttribute('placeholder', start)
  await expect(inputs.nth(1)).toHaveAttribute('placeholder', end)
}

test.describe('日期范围占位符诊断', () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = []
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const loc = msg.location()
        errors.push(`console.error: ${msg.text()} @ ${loc ? loc.url : 'unknown'}`)
      }
    })
    page.on('requestfailed', (req) =>
      errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`),
    )
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`http${res.status()}: ${res.url()}`)
    })
  })

  test('已选日期与清除行为的格式链', async ({ page }) => {
    await page.goto('/')

    const picker = page.locator('.field-range-picker')
    await expect(picker).toBeVisible()

    // 初始语言按项目初始化方式（浏览器语言）探测，占位断言与之对应
    const initialLang = await detectInitialLang(page)
    await assertPlaceholderPair(page, initialLang)

    // 选中日期：在本月第一个日历中点击 DAY 日 → 弹层内第二天
    const firstCal = page.locator('.el-date-range-picker .el-date-table').first()
    await picker.click()
    await expect(firstCal).toBeVisible()
    await firstCal
      .locator('td.available', { hasText: new RegExp(`^\\s*${DAY}\\s*$`) })
      .first()
      .click()
    const secondCal = page.locator('.el-date-range-picker .el-date-table').nth(1)
    const endDay = Math.min(DAY + 1, 28)
    await secondCal
      .locator('td.available', { hasText: new RegExp(`^\\s*${endDay}\\s*$`) })
      .first()
      .click()
    await page.keyboard.press('Escape')

    const inputs = page.locator('.field-range-picker input')
    const startVal = await inputs.nth(0).inputValue()
    const endVal = await inputs.nth(1).inputValue()
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    expect(startVal, `起始输入框应在 YYYY-MM-DD，实际="${startVal}"`).toMatch(isoRe)
    expect(endVal, `结束输入框应在 YYYY-MM-DD，实际="${endVal}"`).toMatch(isoRe)
    expect(startVal, `选中起始月=${MONTH + 1}`).toBe(
      `${YEAR}-${String(MONTH + 1).padStart(2, '0')}-${String(DAY).padStart(2, '0')}`,
    )

    // 切换语言不清空已选日期（toggleLocale 双向：目标语言与初始相反）
    const targetLang = initialLang === 'en' ? 'zh' : 'en'
    await page.locator('button.btn-lang').click()
    await expect
      .poll(async () => page.locator('.field-range-picker input').nth(0).getAttribute('placeholder'))
      .toBe(targetLang === 'en' ? 'Start date' : '开始日期')
    expect(await inputs.nth(0).inputValue(), '切换语言后起始日期不应丢失').toBe(startVal)
    expect(await inputs.nth(1).inputValue(), '切换语言后结束日期不应丢失').toBe(endVal)

    // 面板语言取证（切换后语言态打开一次）
    await picker.click()
    const panelText = (await page.locator('.el-date-range-picker').innerText()).slice(0, 400)
    const monthEn = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)
    if (targetLang === 'en') {
      expect(panelText, `英文态面板语言取证（应含 ${monthEn}）：\n${panelText}`).toContain(monthEn)
      expect(panelText, '英文态面板不应出现中文月份符号').not.toMatch(/月/)
    } else {
      expect(panelText, '中文态面板语言取证').toContain(`${MONTH + 1} 月`)
      expect(panelText, '中文态面板不应出现英文月份名').not.toContain(monthEn)
    }
    await page.keyboard.press('Escape')

    // 清除：两个输入框恢复目标语言占位，值清空
    const clear = picker.locator('.el-range__close-icon')
    await expect(clear).toBeVisible()
    await clear.click()
    await expects.clear(page, targetLang)
  })

  test('英文切换与占位符证据（含 yyyy/mm 模板排除）', async ({ page }) => {
    await page.goto('/')

    const initial = await collectPageInfo(page)
    console.log('初始取证:', JSON.stringify(initial, null, 2))
    await expect(initial.pickers, '日期选择器总数应为 1（无重复挂载/旧组件）').toHaveLength(1)
    await expect(initial.appInstanceCount, '应用实例应为 1').toBe(1)

    const initialLang = await detectInitialLang(page)
    const inputs = page.locator('.field-range-picker input')
    // 原生 date 控件特征 = type="date"；EP 触发器 input 不带 type 属性（HTML 默认 text，
    // collectPageInfo 里的 i.type 已显式为 "text"），任何 date 型 type 均视为回退原生控件
    for (const i of [0, 1]) {
      const t = await inputs.nth(i).getAttribute('type')
      expect(t, `input[${i}].type 不得为原生 date（实际=${String(t)}）`).not.toBe('date')
    }
    await assertPlaceholderPair(page, initialLang)

    const bodyText = await page.evaluate(() => document.body.innerText || '')
    expect(bodyText, '初始态可见文本不应含 yyyy/mm/日 模板').not.toMatch(/yyyy\s*\/\s*mm\s*\/\s*日/u)
    expect(bodyText, '初始态可见文本不应含 yyyy/mm/dd 模板').not.toMatch(/yyyy\s*\/\s*mm\s*\/\s*dd/iu)

    // 面板语言取证（初始态）
    await inputs.nth(0).click()
    await page.locator('.el-date-range-picker').waitFor()
    const panelInitial = (await page.locator('.el-date-range-picker').innerText()).slice(0, 400)
    console.log('初始态面板文字取证:', panelInitial)
    expect(panelInitial, '初始态面板应含当前月份').toContain(
      initialLang === 'en'
        ? new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)
        : `${MONTH + 1} 月`,
    )
    await page.keyboard.press('Escape')

    // 切到英文（若初始已是英文则切到中文再切回，覆盖两种状态）
    if (initialLang === 'en') {
      // 初始即英文：先切中文取证，再切回英文收尾
      await page.locator('button.btn-lang').click()
      await expect
        .poll(async () => page.locator('.field-range-picker input').nth(0).getAttribute('placeholder'))
        .toBe('开始日期')
      const bodyZh = await page.evaluate(() => document.body.innerText || '')
      expect(bodyZh, '切换到中文后不应含 yyyy/mm 模板').not.toMatch(/yyyy\s*\/\s*mm/iu)
    }
    await toggleToEnglish(page)
    const switched = await collectPageInfo(page)
    console.log('切换后取证:', JSON.stringify(switched, null, 2))
    await assertPlaceholderPair(page, 'en')

    const bodyEnText = await page.evaluate(() => document.body.innerText || '')
    expect(bodyEnText, '英文态可见文本不应含 yyyy/mm/日 模板').not.toMatch(/yyyy\s*\/\s*mm\s*\/\s*日/u)
    expect(bodyEnText, '英文态可见文本不应含 yyyy/mm/dd 模板').not.toMatch(/yyyy\s*\/\s*mm\s*\/\s*dd/iu)

    // 筛选栏专属回归：不得出现新增窗口的表单占位文案（两控件互不影响）
    expect(bodyEnText, '筛选栏/页面不应出现表单占位文案').not.toContain(
      initialLang === 'en' ? 'Click to select application date' : '点击选择申请日期',
    )
  })

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') {
      const slug = `${process.env.PW_PROJECT ?? 'x'}-${testInfo.title.replace(/\W+/gu, '_')}`
      const info = await collectPageInfo(page).catch(() => null)
      const report = JSON.stringify({ failures: testInfo.errors, collect: info, console: errors }, null, 2)
      console.log(`\n=== 诊断报告（${slug}）===\n${report}`)
      await page.screenshot({ path: `tests/browser/screens/fail-${slug}.png` }).catch(() => {})
    }
    // 资源失败分类：dev server 无 favicon 静态文件是已知环境噪声（记录后不判失败）；
    // 其余 pageerror / console.error / requestfailed / 404 一律失败
    const knownBenign = errors.filter((e) => e.includes('/favicon.ico'))
    const hard = errors.filter((e) => !e.includes('/favicon.ico'))
    if (knownBenign.length > 0) {
      console.log(`[记录] 已知环境噪声（dev server 无 favicon）：\n${knownBenign.join('\n')}`)
    }
    expect(hard, '页面不应有未处理异常/非噪声资源失败：\n' + hard.join('\n')).toHaveLength(0)
  })
})

// 清除后的占位符恢复断言（帮助函数）：占位语言按当前态传入
const expects = {
  async clear(page: Page, lang: 'zh' | 'en') {
    const inputs = page.locator('.field-range-picker input')
    const info = await collectPageInfo(page)
    const [startPh, endPh] = STEP_LABELS[lang]
    expect(await inputs.nth(0).inputValue(), '清空后起始值应为空').toBe('')
    expect(await inputs.nth(1).inputValue(), '清空后结束值应为空').toBe('')
    const pickerInfo = info.pickers[0]
    expect(pickerInfo.inputs[0].placeholder, '清空后起始占位应恢复').toBe(startPh)
    expect(pickerInfo.inputs[1].placeholder, '清空后结束占位应恢复').toBe(endPh)
  },
}
