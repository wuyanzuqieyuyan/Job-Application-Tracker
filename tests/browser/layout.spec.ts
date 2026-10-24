import { expect, test } from '@playwright/test'

/**
 * 六视口布局回归：弹层是否水平溢出 / 超出视口 / 输入框可操作。
 * 不修改任何数据，不做业务断言；仅记录布局事实并做视口内断言。
 */

const WIDTHS = [375, 390, 768, 1020, 1021, 1440]

for (const width of WIDTHS) {
  test(`视口 ${width}px：弹层不造成水平溢出且输入框可操作`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')

    // 窄视口（≤640）下高级筛选默认折叠 → 展开后再测日期控件
    if (width <= 640) {
      const adv = page.locator('[aria-controls="advanced-filters"]')
      await adv.click()
    }

    const picker = page.locator('.field-range-picker')
    await expect(picker).toBeVisible()
    await picker.click()

    const panel = page.locator('.el-picker-panel')
    await expect(panel).toBeVisible()

    const stats = await page.evaluate(() => {
      const panel = document.querySelector('.el-picker-panel') as HTMLElement
      const b = panel.getBoundingClientRect()
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        panelLeft: b.left,
        panelRight: b.right,
        pickerClass: panel.className,
      }
    })
    console.log(`视口 ${width}px 取证:`, JSON.stringify(stats))

    expect(stats.scrollWidth, `文档 scrollWidth=${stats.scrollWidth} 不应超过视口 ${stats.innerWidth}`).toBeLessThanOrEqual(
      stats.innerWidth,
    )
    expect(stats.panelLeft).toBeGreaterThanOrEqual(0)
    expect(stats.panelRight).toBeLessThanOrEqual(width)

    await picker.click()
    await expect(picker).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `tests/browser/screens/viewport-${width}.png` })
  })
}
