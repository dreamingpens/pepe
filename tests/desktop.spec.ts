import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('the built desktop app opens offline and handles native shortcuts', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PEPE_DEV_URL
  const app = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
    expect(page.url()).toBe('pepe://reader/index.html')
    await expect(page.getByRole('button')).toHaveCount(1)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+l`)
    await expect(page.getByRole('textbox', { name: 'Ask about this paper' })).toBeVisible()
    await page.keyboard.press(`${modifier}+l`)
    await expect(page.getByRole('complementary')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await expect(page.getByRole('tabpanel', { name: 'Paper', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button')).toHaveCount(1)
    // Exercise Electron's native input path as well as Playwright's direct DOM events.
    const pressNativeToggle = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.focus()
        const modifiers: ('meta' | 'control')[] = [
          process.platform === 'darwin' ? 'meta' : 'control',
        ]
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers })
      })
    await pressNativeToggle()
    await expect(page.getByRole('textbox', { name: 'Ask about this paper' })).toBeVisible()
    await pressNativeToggle()
    await expect(page.getByRole('complementary')).toHaveCount(0)
    await expect(page.getByRole('main')).toBeFocused()
    const fileChooser = page.waitForEvent('filechooser')
    await page.keyboard.press(`${modifier}+o`)
    await (await fileChooser).setFiles(resolve('public/attention-is-all-you-need.pdf'))
    await expect(page.locator('.pdf-page').first().locator('canvas')).toBeVisible()
    await page.screenshot({ path: 'artifacts/desktop.png', animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
