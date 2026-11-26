/**
 * The application menu. Labels are Chinese; standard roles keep macOS
 * behavior (Services, Hide, Window list, Edit shortcuts) intact.
 */

import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'

/** Menu commands the main process handles. */
export type MenuAction =
  | 'new-task'
  | 'toggle-sidebar'
  | 'open-settings'
  | 'focus-composer'
  | 'open-logs'
  | 'open-dsh-home'
  | 'restart-server'

/**
 * Build the application menu.
 * @param run - handler for app-specific commands.
 * @returns the menu to install with `Menu.setApplicationMenu`.
 */
export function buildMenu(run: (action: MenuAction) => void): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: `关于 ${app.name}` },
            { type: 'separator' },
            { label: '设置…', accelerator: 'Cmd+,', click: () => run('open-settings') },
            { type: 'separator' },
            { role: 'services', label: '服务' },
            { type: 'separator' },
            { role: 'hide', label: `隐藏 ${app.name}` },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: `退出 ${app.name}` },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建任务', accelerator: 'CmdOrCtrl+N', click: () => run('new-task') },
        { label: '聚焦输入框', accelerator: 'CmdOrCtrl+L', click: () => run('focus-composer') },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { label: '切换侧边栏', accelerator: 'CmdOrCtrl+\\', click: () => run('toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { role: 'reload', label: '重新加载页面' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] satisfies MenuItemConstructorOptions[]
          : []),
      ],
    },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        { label: '重启本地服务', click: () => run('restart-server') },
        { label: '打开日志目录', click: () => run('open-logs') },
        { label: '打开数据目录（~/.zharness）', click: () => run('open-dsh-home') },
        { type: 'separator' },
        { label: 'DeepSeek Harness 文档', click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}
