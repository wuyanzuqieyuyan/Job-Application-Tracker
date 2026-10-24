import { expect, test, type Page } from '@playwright/test'

/**
 * UI 优化回归：Element Plus 选择器统一（工具栏状态筛选/排序 + 表单申请状态）、
 * 详情抽屉操作层级（编辑主操作 / 删除弱化样式）、卡片信息区详情入口与事件隔离、
 * 中英文切换与 PC/移动端布局（375/1280）。数据写入均为运行时独立临时库（%TEMP%）。
 */

const now = new Date()
const YEAR = now.getFullYear()
const DAY = now.getDate()
// 运行级唯一后缀：临时库跨用例累积，历史同名记录会污染 hasText 检索
const runNonce = Date.now().toString(36).slice(-5)
const stamp = (i: number) => `PWSEL-${YEAR}-${DAY}-${i}-${runNonce}`

async function detectInitialLang(page: Page): Promise<'zh' | 'en'> {
  const lang = await page.evaluate(() => document.documentElement.lang)
  return lang === 'en-US' ? 'en' : 'zh'
}

/** EP 每个 select 渲染外层容器+内层面板两层同名 popper；仅外层带 aria-hidden，打开时为 "false" */
const visiblePopper = (page: Page) => page.locator('.jobtrack-select-popper[aria-hidden="false"]')

async function switchToCardView(page: Page) {
  await page.locator('.view-toggle-btn', { hasText: /卡片|Cards/i }).first().click()
  await expect(page.locator('article.job-card').first()).toBeVisible()
}

/**
 * 在打开的表单中选择一个可用日期（申请日期必填）。
 * indexFromEnd: 0 = 面板内最新可用日，1 = 前一日……（不依赖“今天”，避开日期边界）
 */
async function pickAvailableDate(page: Page, indexFromEnd = 0) {
  await page.locator('#appliedDate').click()
  const panel = page.locator('.jobtrack-form-date-popper .el-picker-panel')
  await expect(panel).toBeVisible()
  const cells = panel.locator('td.available')
  const cell = cells.nth(Math.max(0, (await cells.count()) - 1 - indexFromEnd))
  await expect(cell).toBeVisible({ timeout: 10000 })
  await cell.click()
  await page.keyboard.press('Escape')
}

async function createJobs(page: Page, entries: [string, string, number?][]) {
  for (const [company, position, dateIndex] of entries) {
    await page.locator('button.btn-primary', { hasText: /新增记录|Add record/i }).first().click()
    const form = page.locator('form.job-form')
    await expect(form).toBeVisible()
    await form.locator('#company').fill(company)
    await form.locator('#position').fill(position)
    await pickAvailableDate(page, dateIndex ?? 0)
    await form.locator('button[type="submit"]').click()
    await expect(form).toBeHidden()
    const row = page.locator('tr, article', { hasText: company }).last()
    await expect(row).toBeVisible()
  }
}

test.describe('Element Plus 选择器与卡片/抽屉交互', () => {
  const errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors.length = 0
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`http${res.status()}: ${res.url()}`)
    })
  })

  test('工具栏状态/排序选择器：业务值选项 + 切换即重排 + 语言跟随', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    // 记录 1 取较旧日期、记录 2 取最新日期（排序比较器同日期时保持插入顺序，必须不同日期）
    await createJobs(page, [
      [stamp(1), '工程师一', 1],
      [stamp(2), '工程师二', 0],
    ])

    // 状态筛选 ElSelect：EP 2.14 不在 DOM 暴露选项 value，用行为断言验证业务值接线
    const statusSelect = page.locator('.field-status .toolbar-select')
    await expect(statusSelect).toBeVisible()
    const row1 = page.locator('tbody tr td.cell-company, article .card-company').filter({ hasText: stamp(1) }).first()
    const row2 = page.locator('tbody tr td.cell-company, article .card-company').filter({ hasText: stamp(2) }).first()
    // 选项数量 = 全部 + 4 个业务状态
    await statusSelect.click()
    const statusPopper = visiblePopper(page)
    await expect(statusPopper).toBeVisible()
    await expect(statusPopper.locator('.el-select-dropdown__item')).toHaveCount(5)
    // applied：两条默认状态记录都保留（zh applied 标签为「待回复」）
    await statusPopper.locator('.el-select-dropdown__item').filter({ hasText: /Pending|待回复/ }).first().click()
    await expect(row1).toBeVisible()
    await expect(row2).toBeVisible()
    // rejected：本测试两条记录都不应出现（其余历史记录不管）
    await statusSelect.click()
    await visiblePopper(page)
      .locator('.el-select-dropdown__item')
      .filter({ hasText: /Rejected|已拒绝/ })
      .first()
      .click()
    await expect(row1).toBeHidden()
    await expect(row2).toBeHidden()
    // 回到全部
    await statusSelect.click()
    await visiblePopper(page)
      .locator('.el-select-dropdown__item')
      .filter({ hasText: /All statuses|全部状态/ })
      .first()
      .click()
    await expect(row1).toBeVisible()
    await expect(row2).toBeVisible()

    // 排序 ElSelect：共享库含多日历史记录，断言两条记录的相对顺序而非首行
    const orderOf = async () => {
      const texts = await page.locator('tbody tr td.cell-company, article .card-company').allInnerTexts()
      return { i1: texts.indexOf(stamp(1)), i2: texts.indexOf(stamp(2)) }
    }
    const sortSelect = page.locator('.field-sort .toolbar-select')
    await sortSelect.click()
    await visiblePopper(page)
      .locator('.el-select-dropdown__item')
      .filter({ hasText: /Oldest first|旧 → 新/ })
      .first()
      .click()
    const asc = await orderOf()
    expect(asc.i1, '最早优先：记录 1（较旧日期）应排在记录 2 之前').toBeGreaterThanOrEqual(0)
    expect(asc.i2, '最早优先：记录 1 应在记录 2 之前').toBeGreaterThan(asc.i1)

    await sortSelect.click()
    await visiblePopper(page)
      .locator('.el-select-dropdown__item')
      .filter({ hasText: /Newest first|新 → 旧/ })
      .first()
      .click()
    const desc = await orderOf()
    expect(desc.i2, '最新优先：记录 2（较新日期）应排在记录 1 之前').toBeGreaterThan(-1)
    expect(desc.i2, '最新优先：记录 2 应在记录 1 之前').toBeLessThan(desc.i1)

    // 切语言后选择器当前显示的标签立即切换（方向取决于初始语言；zh applied=待回复）
    const switchedPattern =
      (await detectInitialLang(page)) === 'en'
        ? /全部状态|待回复|面试中|录取|已拒绝/
        : /All statuses|Pending|Interviewing|Offer|Rejected/i
    await page.locator('button.btn-lang').click()
    await expect
      .poll(async () => page.locator('.field-status .toolbar-select .el-select__wrapper').innerText())
      .toMatch(switchedPattern)
  })

  test('表单申请状态：默认值 / 编辑回填 / 提交后徽标', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const lang = await detectInitialLang(page)
    const company = stamp(9)

    await page.locator('button.btn-primary', { hasText: /新增记录|Add record/i }).first().click()
    const form = page.locator('form.job-form')
    await expect(form).toBeVisible()
    // 新增默认状态（zh 待回复 / en Pending）
    const defaultLabel = lang === 'zh' ? '待回复' : 'Pending'
    await expect(form.locator('.job-form-select .el-select__wrapper')).toContainText(defaultLabel)

    await form.locator('#company').fill(company)
    await form.locator('#position').fill('状态验证')
    await pickAvailableDate(page)
    await form.locator('button[type="submit"]').click()
    await expect(form).toBeHidden()

    // 提交后行内状态徽标 = 默认状态标签（共享库含历史同名记录，取最后插入的本用例记录）
    const row = page.locator('tr, article', { hasText: company }).last()
    await expect(row.locator('.badge')).toContainText(defaultLabel)

    // 编辑回填：状态选择器显示原状态；改状态并提交后徽标同步
    await row.locator('button.btn-edit').click()
    const form2 = page.locator('form.job-form')
    await expect(form2).toBeVisible()
    await expect(form2.locator('.job-form-select .el-select__wrapper')).toContainText(defaultLabel)
    await form2.locator('.job-form-select').click()
    const popper = visiblePopper(page)
    const targetLabel = lang === 'zh' ? '已拒' : 'Rejected'
    await popper.locator('.el-select-dropdown__item').filter({ hasText: targetLabel }).first().click()
    await form2.locator('button[type="submit"]').click()
    await expect(form2).toBeHidden()
    await expect(row.locator('.badge')).toContainText(targetLabel)
  })

  test('卡片信息区打开详情、事件隔离、抽屉按钮层级与撤销', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const company = stamp(7)
    await createJobs(page, [[company, '交互验证']])
    await switchToCardView(page)

    const card = page.locator('article.job-card', { hasText: company }).last()

    // 1) 卡片信息区点击 → 详情抽屉（操作区点击不会打开抽屉）
    await card.locator('.card-main').click()
    const drawer = page.locator('.drawer-overlay')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText(company)

    // 2) 抽屉：编辑为主操作（主色蓝实底）、删除弱化（浅红底/深红字）
    const editStyle = await drawer.locator('button', { hasText: /编辑|Edit/i }).evaluate(
      (el) => `${window.getComputedStyle(el).backgroundColor}|${window.getComputedStyle(el).color}`,
    )
    expect(editStyle, `编辑按钮应为蓝色实底（实际=${editStyle}）`).toMatch(/rgb\(37,\s*99,\s*235\)/)
    const deleteStyle = await drawer.locator('button', { hasText: /删除|Delete/i }).evaluate(
      (el) => `${window.getComputedStyle(el).backgroundColor}|${window.getComputedStyle(el).color}`,
    )
    expect(deleteStyle, `删除按钮应为浅红底/深红字（实际=${deleteStyle}）`).toMatch(
      /rgb\(254,\s*226,\s*226\)|rgb\(185,\s*28,\s*28\)/,
    )
    await drawer.locator('.drawer-close').click()
    await expect(drawer).toBeHidden()

    // 3) 点击卡片“编辑”打开表单而非详情抽屉
    await card.locator('button.btn-edit').click()
    const form = page.locator('form.job-form')
    await expect(form).toBeVisible()
    await expect(page.locator('.drawer-overlay')).toBeHidden()
    await form.locator('button.btn-ghost', { hasText: /取消|Cancel/i }).click()
    await expect(form).toBeHidden()

    // 4) 点击卡片“删除”打开确认对话框而非详情；确认后撤销成功、记录回到列表
    await card.locator('.btn-danger-ghost').click()
    const confirm = page.locator('.dialog-confirm')
    await expect(confirm).toBeVisible()
    await expect(page.locator('.drawer-overlay')).toBeHidden()
    await confirm.locator('button', { hasText: /删除|Delete/i }).last().click()
    await expect(page.locator('.toast')).toBeVisible()
    await page.locator('.toast-action').click()
    await expect(card).toBeVisible()
  })

  test('卡片键盘可达 + 无详情按钮 + 表格视图保留入口 + 长文本不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    // 40 字符：足够触发换行/截断，且不超过输入框 maxlength=50（超长会被截断导致检索不到）
    const longCompany = `${stamp(5)}-${'很长公司名称文案'.repeat(3)}`
    await createJobs(page, [[longCompany, '这个职位名称也非常长非常长非常长非常长']])
    await switchToCardView(page)

    const card = page.locator('article.job-card', { hasText: longCompany }).last()
    // 键盘：Enter 打开详情
    await card.locator('.card-main').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.drawer-overlay')).toBeVisible()
    await page.locator('.drawer-close').click()

    // 卡片操作区编辑+删除两枚按钮，无“详情”
    const cardDetailButtons = await card.locator('.card-actions button').evaluateAll(
      (els) => els.map((el) => el.textContent?.trim() ?? '').filter((t) => /详情|Details/i.test(t)),
    )
    expect(cardDetailButtons, '卡片操作区不应再有详情按钮').toHaveLength(0)
    expect(await card.locator('.card-actions button').count(), '卡片操作区恰好编辑+删除两枚按钮').toBe(2)

    // 切表格视图：行点击入口保留
    await page.locator('.view-toggle-btn', { hasText: /表格|Table/i }).first().click()
    await expect(card).toBeHidden()
    const tableRow = page.locator('tbody tr', { hasText: stamp(5) }).last()
    await expect(tableRow).toBeVisible()
    await tableRow.click()
    await expect(page.locator('.drawer-overlay')).toBeVisible()
    await page.locator('.drawer-close').click()

    // 长文本不引发横向溢出（表格视图）
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, `无横向溢出（实际差值=${overflow}px）`).toBeLessThanOrEqual(0)

    // 卡片视图同样无溢出
    await switchToCardView(page)
    const overflowCards = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflowCards).toBeLessThanOrEqual(0)
  })

  test('移动端 375px：选择器弹层不溢出、无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    // 展开高级筛选
    await page.locator('[aria-controls="advanced-filters"]').click()
    const statusSelect = page.locator('.field-status .toolbar-select')
    await expect(statusSelect).toBeVisible()
    await statusSelect.click()
    const stats = await page.evaluate(() => {
      const popper = [...document.querySelectorAll('.jobtrack-select-popper')].find(
        (el) => getComputedStyle(el).display !== 'none',
      )
      const b = popper.getBoundingClientRect()
      return { l: b.left, r: b.right, w: window.innerWidth, sw: document.documentElement.scrollWidth }
    })
    expect(stats.sw, '无横向滚动').toBeLessThanOrEqual(stats.w)
    expect(stats.l, '弹层左边缘不越界').toBeGreaterThanOrEqual(0)
    expect(stats.r, '弹层右边缘不越界').toBeLessThanOrEqual(stats.w)
    await page.keyboard.press('Escape')

    const cardStats = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      w: window.innerWidth,
    }))
    expect(cardStats.sw).toBeLessThanOrEqual(cardStats.w)
  })

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') {
      await page
        .screenshot({ path: `tests/browser/screens/fail-sel-${testInfo.title.replace(/\W+/gu, '_').slice(0, 40)}.png` })
        .catch(() => {})
    }
    const hard = errors.filter((e) => !e.includes('/favicon.ico'))
    expect(hard, '页面不应有未处理异常/资源失败：\n' + hard.join('\n')).toHaveLength(0)
  })
})
