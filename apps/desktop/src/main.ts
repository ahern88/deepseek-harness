/**
 * Electron main process for the ZHarness desktop app.
 *
 * Lifecycle: show the splash page, start `dsh web` on a loopback port, then
 * navigate the window to the server URL and inject the desktop stylesheet.
 * Quitting the app stops the server; closing the last window on macOS keeps
 * the app and server running until the user quits, matching platform norms.
 */

import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMenu, type MenuAction } from './menu.ts'
import { loginShellPath, resolveRuntime, RuntimeMissingError, serverEnv } from './runtime.ts'
import { serverLogFile, ServerStartError, startServer, type RunningServer } from './server.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const assets = join(appRoot, 'assets')
const preload = join(here, 'preload.cjs')

/** Status pushed to the splash page. */
type SplashStatus =
  | { phase: 'starting'; message: string }
  | { phase: 'error'; message: string; detail: string; logFile: string }

app.setName('ZHarness')

let mainWindow: BrowserWindow | undefined
let server: RunningServer | undefined
let starting: Promise<void> | undefined
let lastStatus: SplashStatus = { phase: 'starting', message: '正在启动本地智能体服务…' }
let quitting = false
const desktopCss = readFileSync(join(assets, 'desktop.css'), 'utf8')

function logFile(): string {
  return serverLogFile(app.getPath('logs'))
}

function serverOrigin(): string | undefined {
  return server === undefined ? undefined : new URL(server.url).origin
}

function pushStatus(status: SplashStatus): void {
  lastStatus = status
  mainWindow?.webContents.send('zh:status', status)
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'ZHarness',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundColor: isMac ? '#00000000' : (nativeTheme.shouldUseDarkColors ? '#17181c' : '#f2f3f7'),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Keep the window on the local server; everything else opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && new URL(url).origin !== serverOrigin()) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (target.protocol === 'file:' || target.origin === serverOrigin()) return
    event.preventDefault()
    if (/^https?:$/i.test(target.protocol)) void shell.openExternal(url)
  })

  win.webContents.on('did-finish-load', () => {
    const current = win.webContents.getURL()
    if (current.startsWith('file:')) {
      win.webContents.send('zh:status', lastStatus)
    } else {
      void win.webContents.insertCSS(desktopCss, { cssOrigin: 'author' })
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })

  if (process.env.DSH_DESKTOP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  return win
}

async function showApp(win: BrowserWindow): Promise<void> {
  if (server !== undefined) {
    await win.loadURL(server.url)
    return
  }
  await win.loadFile(join(assets, 'splash.html'))
  await ensureServer()
  // ensureServer() assigns the module-level `server`; re-read it after the await.
  const started = server as RunningServer | undefined
  if (started !== undefined && !win.isDestroyed()) await win.loadURL(started.url)
}

function ensureServer(): Promise<void> {
  starting ??= (async () => {
    pushStatus({ phase: 'starting', message: '正在启动本地智能体服务…' })
    try {
      const shellPath = await loginShellPath()
      const env = serverEnv(shellPath)
      const runtime = resolveRuntime(app.isPackaged, process.resourcesPath, env.PATH ?? '')
      server = await startServer({
        ...runtime,
        cwd: homedir(),
        env,
        logFile: logFile(),
        readyTimeoutMs: 90_000,
      })
      server.onUnexpectedExit(code => {
        server = undefined
        if (quitting) return
        pushStatus({
          phase: 'error',
          message: `本地智能体服务意外退出（退出码 ${code ?? '未知'}）`,
          detail: '',
          logFile: logFile(),
        })
        void mainWindow?.loadFile(join(assets, 'splash.html'))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushStatus({
        phase: 'error',
        message,
        detail: error instanceof ServerStartError ? error.logTail : error instanceof RuntimeMissingError ? '' : String((error as Error).stack ?? ''),
        logFile: logFile(),
      })
    } finally {
      starting = undefined
    }
  })()
  return starting
}

function runAction(action: MenuAction): void {
  switch (action) {
    case 'open-logs':
      void shell.openPath(dirname(logFile()))
      return
    case 'open-dsh-home':
      void shell.openPath(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
      return
    case 'restart-server':
      void (async () => {
        await server?.stop()
        server = undefined
        const win = mainWindow ?? (mainWindow = createWindow())
        await showApp(win)
      })()
      return
    case 'new-task':
    case 'toggle-sidebar':
    case 'open-settings':
    case 'focus-composer': {
      if (mainWindow === undefined) {
        mainWindow = createWindow()
        void showApp(mainWindow)
        return
      }
      const win = mainWindow
      win.show()
      win.webContents.send('zh:action', action)
      return
    }
  }
}

ipcMain.on('zh:retry', () => {
  const win = mainWindow
  if (win !== undefined) void showApp(win)
})
ipcMain.on('zh:open-logs', () => runAction('open-logs'))
ipcMain.handle('zh:get-status', () => lastStatus)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'ZHarness',
      applicationVersion: app.getVersion(),
      credits: '基于 DeepSeek Harness 的企业桌面智能体工作台',
    })
    Menu.setApplicationMenu(buildMenu(runAction))
    mainWindow = createWindow()
    void showApp(mainWindow)

    app.on('activate', () => {
      if (mainWindow === undefined) {
        mainWindow = createWindow()
        void showApp(mainWindow)
      } else {
        mainWindow.show()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', event => {
    if (quitting || server === undefined) {
      quitting = true
      return
    }
    event.preventDefault()
    quitting = true
    void server.stop().finally(() => app.quit())
  })
}
