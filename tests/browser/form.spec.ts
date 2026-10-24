import { expect, test, type Page } from '@playwright/test'

/**
 * 新增记录窗口「申请日期」控件（Element Plus）功能与回归测试。
 * - 服务器为测试运行时提供的独立临时数据库（JOBTRACK_DATA_DIR=%TEMP%），
 *   提交/编辑流程在该临时库上执行，不触碰 server/data 真实数据。
 * - 占位文案 formApplicationDatePlaceholder 仅用于本窗口；
 *   筛选栏占位（开始日期/结束日期）不受影响（diagnostics.spec.ts 反向覆盖）。
 */

const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth()
const DAY = now.getDate()
const iso = (d: number) => `${YEAR}-${String(MONTH + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const today = () => iso(DAY)

async function detectInitialLang(page: Page): Promise<'zh' | 'en'> {
  const lang = await page.evaluate(() => document.documentElement.lang)
  return lang === 'en-US' ? 'en' : 'zh'
}

const PLACEHOLDER = { zh: '点击选择申请日期', en: 'Click to select application date' }

async function openCreate(page: Page) {
  await page.locator('button.btn-primary', { hasText: /新增记录|Add record/i }).first().click()
  const form = page.locator('form.job-form')
  await expect(form).toBeVisible()
  return form
}

test.describe('新增记录窗口申请日期控件', () => {
  const errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors.length = 0
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`http${res.status()}: ${res.url()}`)
    })
  })

  test('必填与占位：中文态默认提示与空提交校验', async ({ page }) => {
    await page.goto('/')
    const initialLang = await detectInitialLang(page)

    const form = await openCreate(page)
    const dateTrigger = page.locator('#appliedDate')

    // 1) 占位文案只在本窗口生效，并与当前语言对应
    await expect(dateTrigger).toHaveAttribute('placeholder', PLACEHOLDER[initialLang])

    // 2) 必填校验：空提交（先填其他必填项）→ errorDateRequired（useI18n 实际文案）
    await form.locator('#company').fill('测试公司')
    await form.locator('#position').fill('前端工程师')
    await form.locator('button[type="submit"]').click()
    const errorText = await page.evaluate(() => document.body.innerText || '')
    const requiredMsg = initialLang === 'zh' ? '未选择申请日期' : 'Please choose an application date'
    expect(errorText, '日期必填错误应当显示').toContain(requiredMsg)
    await form.locator('button.btn-ghost', { hasText: /取消|Cancel/i }).click()
    await expect(page.locator('form.job-form')).toBeHidden()
  })

  test('选择与提交：日期 YYYY-MM-DD 落库、编辑回填、取消不改', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const initialLang = await detectInitialLang(page)
    const stamp = `PW-${YEAR}-${DAY}`

    const form = await openCreate(page)
    await form.locator('#company').fill(stamp)
    await form.locator('#position').fill('QA 工程师')

    // 打开日期面板（限定本表单弹层；单日历面板语言随当前语言）
    const dateTrigger = page.locator('#appliedDate')
    await dateTrigger.click()
    const panel = page.locator('.jobtrack-form-date-popper .el-picker-panel')
    await expect(panel).toBeVisible()
    if (initialLang === 'zh') {
      await expect(panel, '中文面板语言').toContainText(`${MONTH + 1} 月`)
    } else {
      const monthEn = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)
      await expect(panel, '英文面板语言').toContainText(monthEn)
    }

    // 选择今天（disabled-date 已禁止未来日期）
    const dayCell = panel.locator('td.available', { hasText: new RegExp(`^\\s*${DAY}\\s*$`) }).first()
    await expect(dayCell).toBeEnabled()
    await dayCell.click()
    await expect(dateTrigger).toHaveValue(today())
    // 等日期面板完全关闭，避免淡出中的弹层吞掉提交点击
    await expect(panel).toBeHidden()

    // 提交 → 对话框关闭 → 列表出现记录
    await form.locator('button[type="submit"]').click()
    await expect(page.locator('form.job-form')).toBeHidden()

    // 编辑回填：打开编辑 → 日期正确（同 today）；行容器在表格视图是 tr、卡片视图是 article
    const row = page.locator('tr, article', { hasText: stamp }).first()
    await row.locator('button.btn-edit').click()
    const form2 = page.locator('form.job-form')
    await expect(form2).toBeVisible()
    await expect(dateTrigger, '编辑时申请日期应回填为提交时的日期').toHaveValue(today())
    await form2.locator('button.btn-ghost', { hasText: /取消|Cancel/i }).click()
    await expect(form2).toBeHidden()

    // 取消不改记录：再次打开编辑仍为原值（未产生副作用）
    await row.locator('button.btn-edit').click()
    await expect(form2).toBeVisible()
    await expect(dateTrigger, '取消后原值不应被改动').toHaveValue(today())
    await expect(form2.locator('#company')).toHaveValue(stamp)
    await form2.locator('button.btn-ghost', { hasText: /取消|Cancel/i }).click()
  })

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') {
      await page
        .screenshot({ path: `tests/browser/screens/fail-form-${testInfo.title.replace(/\W+/gu, '_').slice(0, 40)}.png` })
        .catch(() => {})
    }
    const hard = errors.filter((e) => !e.includes('/favicon.ico'))
    expect(hard, '页面不应有未处理异常/资源失败：\n' + hard.join('\n')).toHaveLength(0)
  })
})
