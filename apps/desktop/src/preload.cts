/**
 * Preload script for the desktop window (sandboxed, CommonJS).
 *
 * - Exposes a small `zhDesktop` bridge that the splash page uses for start-up
 *   status, retry, and opening the log directory.
 * - On the dsh Web UI page, marks the document for desktop.css, sets the
 *   home-screen greeting, adds the quick-start task cards under the hero
 *   composer, and performs menu commands by driving the existing UI controls.
 *
 * The Web UI's CSS-module class names carry a build hash prefix and a readable
 * suffix (`_4xGAka_newSession`), so selectors match the suffix.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface SplashStatus {
  phase: 'starting' | 'error'
  message: string
  detail?: string
  logFile?: string
}

contextBridge.exposeInMainWorld('zhDesktop', {
  platform: process.platform,
  getStatus: (): Promise<SplashStatus> => ipcRenderer.invoke('zh:get-status'),
  onStatus: (listener: (status: SplashStatus) => void): void => {
    ipcRenderer.on('zh:status', (_event: IpcRendererEvent, status: SplashStatus) => listener(status))
  },
  retry: (): void => ipcRenderer.send('zh:retry'),
  openLogs: (): void => ipcRenderer.send('zh:open-logs'),
})

/** Quick-start cards shown under the composer on the empty home screen. */
const QUICK_TASKS: ReadonlyArray<{ icon: string; title: string; hint: string; prompt: string }> = [
  {
    icon: '🧭',
    title: '梳理代码仓库',
    hint: '理解结构与核心模块',
    prompt: '请梳理当前工作区的代码仓库：说明整体架构、主要模块及其职责、关键入口和数据流，并给出一份新人上手指南。',
  },
  {
    icon: '🐞',
    title: '定位并修复 Bug',
    hint: '描述现象，自动排查',
    prompt: '我遇到了一个问题：<在这里描述现象、报错信息和复现步骤>。请帮我定位根因并修复，修复后运行相关测试验证。',
  },
  {
    icon: '🧪',
    title: '补充单元测试',
    hint: '为关键逻辑补测试',
    prompt: '请找出当前工作区中测试覆盖薄弱的关键逻辑，为它们补充单元测试，并运行测试确保全部通过。',
  },
  {
    icon: '📝',
    title: '生成技术文档',
    hint: 'README、接口说明',
    prompt: '请为当前工作区生成技术文档：包括 README 概述、安装与运行方式、核心接口说明和常见问题。',
  },
  {
    icon: '🔍',
    title: '代码评审',
    hint: '检查最近的改动',
    prompt: '请评审当前工作区最近的 git 改动：指出潜在的 bug、安全风险和可维护性问题，并给出具体修改建议。',
  },
  {
    icon: '📊',
    title: '数据处理分析',
    hint: '读取文件并出结论',
    prompt: '请读取工作区中的数据文件（如 CSV/Excel/JSON），进行清洗和统计分析，总结关键发现，并把结果保存为 Markdown 报告。',
  },
]

function greeting(now = new Date()): string {
  const hour = now.getHours()
  const part = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  return `${part}，今天想完成什么任务？`
}

function find<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector)
}

/** Set a React-controlled textarea's value so React sees the change. */
function setComposerText(textarea: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus()
  textarea.setSelectionRange(text.length, text.length)
}

function composerTextarea(): HTMLTextAreaElement | null {
  return find<HTMLTextAreaElement>('[data-slot="conversation.composer.bar"] textarea')
}

/** A prompt picked before a workspace existed; applied once the composer becomes editable. */
let pendingPrompt: string | undefined

function applyQuickTask(prompt: string): void {
  const textarea = composerTextarea()
  if (textarea === null) return
  if (textarea.readOnly) {
    pendingPrompt = prompt
    // No workspace yet: open the workspace chooser the composer itself offers.
    textarea.click()
    return
  }
  setComposerText(textarea, prompt)
}

function buildQuickStart(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'zh-quickstart'
  const label = document.createElement('div')
  label.className = 'zh-quickstart-label'
  label.textContent = '试试这些任务'
  wrap.append(label)
  const grid = document.createElement('div')
  grid.className = 'zh-quickstart-grid'
  for (const task of QUICK_TASKS) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'zh-quickstart-card'
    const icon = document.createElement('span')
    icon.className = 'zh-quickstart-icon'
    icon.textContent = task.icon
    const text = document.createElement('span')
    text.className = 'zh-quickstart-text'
    const title = document.createElement('span')
    title.className = 'zh-quickstart-title'
    title.textContent = task.title
    const hint = document.createElement('span')
    hint.className = 'zh-quickstart-hint'
    hint.textContent = task.hint
    text.append(title, hint)
    card.append(icon, text)
    card.addEventListener('click', () => applyQuickTask(task.prompt))
    grid.append(card)
  }
  wrap.append(grid)
  return wrap
}

function enhance(): void {
  const root = document.documentElement
  root.style.setProperty('--zh-greeting', JSON.stringify(greeting()))

  // The composer container survives the hero → conversation transition; the
  // cards belong to the empty home screen only.
  for (const stale of document.querySelectorAll('.zh-quickstart')) {
    if (stale.closest('[data-phase="hero"]') === null) stale.remove()
  }
  const hero = find('[data-phase="hero"] [class*="_composerHero"]')
  if (hero !== null && find('.zh-quickstart', hero) === null) hero.append(buildQuickStart())

  if (pendingPrompt !== undefined) {
    const textarea = composerTextarea()
    if (textarea !== null && !textarea.readOnly) {
      const prompt = pendingPrompt
      pendingPrompt = undefined
      setComposerText(textarea, prompt)
    }
  }
}

function clickFirst(selectors: string[]): boolean {
  for (const selector of selectors) {
    const element = find(selector)
    if (element !== null) {
      element.click()
      return true
    }
  }
  return false
}

function runAction(action: string): void {
  switch (action) {
    case 'new-task':
      clickFirst(['[class*="_newSession"]', '[class*="_logoRow"] [class*="_brand"]'])
      return
    case 'toggle-sidebar':
      clickFirst(['[class*="_logoRow"] [class*="_toggle"]', 'button[class*="_toggle"]'])
      return
    case 'open-settings':
      clickFirst(['[data-slot="sidebar.settings"] button'])
      return
    case 'focus-composer':
      composerTextarea()?.focus()
      return
  }
}

if (location.protocol === 'http:' || location.protocol === 'https:') {
  ipcRenderer.on('zh:action', (_event: IpcRendererEvent, action: string) => runAction(action))
  window.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement
    root.classList.add('zh-desktop', `zh-${process.platform}`)
    const drag = document.createElement('div')
    drag.className = 'zh-titlebar-drag'
    document.body.append(drag)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        enhance()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['readonly', 'data-phase'] })
    enhance()
    // Refresh the greeting as the day moves on.
    setInterval(() => root.style.setProperty('--zh-greeting', JSON.stringify(greeting())), 10 * 60 * 1000)
  })
}
