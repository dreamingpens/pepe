import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const panel = (page: Page) => page.getByRole('complementary', { name: 'Reading panel' })

async function start(page: Page) {
  await page.goto('/')
  await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
  await expect(page.locator('.textLayer').first().locator('span').first()).toBeAttached()
}

test('reading mode exposes only the paper tab, including on hover', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await start(page)
  await expect(page.getByRole('button')).toHaveCount(1)
  await expect(panel(page)).toHaveCount(0)
  await page.mouse.move(1437, 450)
  await page.mouse.move(700, 45)
  await expect(page.getByRole('button')).toHaveCount(1)
  await expect(page.locator('.textLayer').first()).toContainText('Attention Is All You Need')
  await page.screenshot({ path: 'artifacts/reading.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('reading controls navigate, resize, and return to a clean paper', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Open reading controls' }).click()
  await expect(panel(page)).toBeVisible()
  await page.getByRole('tab', { name: 'Paper', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /Assistant/ })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Paper', exact: true })).toBeFocused()
  await page.screenshot({ path: 'artifacts/reading-controls.png', animations: 'disabled' })
  await page.getByRole('spinbutton', { name: 'Page number' }).fill('4')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.locator('[data-page-number="4"] canvas')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('4')
  const before = await page.locator('[data-page-number="4"]').boundingBox()
  await page.getByRole('button', { name: 'Compact', exact: true }).click()
  await expect(page.locator('[data-page-number="4"]')).toHaveCSS('width', '720px')
  await expect(page.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('4')
  const after = await page.locator('[data-page-number="4"]').boundingBox()
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(6)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(1)
  await expect(page.getByRole('main')).toBeFocused()
})

test('selected PDF text goes into the assistant and draft survives closing', async ({ page }) => {
  await start(page)
  const selected = await page
    .locator('.textLayer')
    .first()
    .evaluate((layer) => {
      const element = Array.from(layer.querySelectorAll('span')).find((span) =>
        span.textContent!.includes('Attention Is All You Need'),
      )!
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    })
  await page.keyboard.press(`${modifier}+l`)
  await expect(page.getByRole('tabpanel', { name: /Assistant/ })).toBeVisible()
  await expect(page.locator('.selected-passage blockquote')).toHaveText(selected)
  await page
    .getByRole('textbox', { name: 'Ask about this paper' })
    .fill('How does self-attention work?')
  await expect(page.getByRole('button', { name: /Send message/ })).toBeDisabled()
  await page.screenshot({ path: 'artifacts/assistant-preview.png', animations: 'disabled' })
  await page.keyboard.press(`${modifier}+l`)
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('main')).toBeFocused()
  await page.keyboard.press(`${modifier}+l`)
  await expect(page.getByRole('textbox', { name: 'Ask about this paper' })).toHaveValue(
    'How does self-attention work?',
  )
  await expect(page.locator('.selected-passage blockquote')).toHaveText(selected)
  await page.getByRole('button', { name: 'Remove selected passage' }).click()
  await expect(page.locator('.selected-passage')).toHaveCount(0)
})

test('opening a local PDF resets context and handles invalid files without losing the paper', async ({
  page,
}) => {
  await start(page)
  await page.keyboard.press(`${modifier}+l`)
  await page
    .getByRole('textbox', { name: 'Ask about this paper' })
    .fill('A question from the previous paper')
  await page
    .locator('input[type="file"]')
    .setInputFiles(resolve('public/attention-is-all-you-need.pdf'))
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
  await page.keyboard.press(`${modifier}+l`)
  await expect(page.getByRole('textbox', { name: 'Ask about this paper' })).toHaveValue('')
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    })
  await expect(page.getByRole('alert')).toContainText('couldn’t be opened')
  await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') })
  await expect(page.getByRole('alert')).toContainText('Choose a PDF')
})

test('small windows keep controls usable and preferences persist', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 640 })
  await start(page)
  await page.getByRole('button', { name: 'Open reading controls' }).click()
  await page.getByRole('button', { name: 'Night', exact: true }).click()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(page.locator('.app')).toHaveAttribute('data-tone', 'night')
  await page.reload()
  await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
  await expect(page.locator('.app')).toHaveAttribute('data-tone', 'night')
  await page.keyboard.press(`${modifier}+l`)
  await expect(page.getByRole('textbox', { name: 'Ask about this paper' })).toBeInViewport()
  await page.screenshot({ path: 'artifacts/compact-window.png', animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
