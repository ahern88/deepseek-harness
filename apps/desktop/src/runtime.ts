/**
 * Resolves the Node executable, the dsh CLI entry, and the environment the
 * server child process runs with.
 *
 * Packaged builds carry both under `Contents/Resources`: `node/bin/node` and
 * `dsh-runtime/lib/bin.js` (see scripts/fetch-node.mjs and
 * scripts/stage-runtime.mjs). Development runs use the workspace `@deepseek-ai/dsh`
 * build and a `node` from the user's login-shell PATH; `DSH_DESKTOP_NODE`
 * overrides the Node executable in both modes.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

/** Where the server's Node executable and CLI entry live. */
export interface RuntimePaths {
  node: string
  bin: string
}

/** Thrown when the runtime cannot be located; the message is user-facing. */
export class RuntimeMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeMissingError'
  }
}

/**
 * Read PATH from the user's login shell. macOS starts GUI apps with a minimal
 * PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so tools installed by Homebrew, nvm,
 * pyenv, and similar would otherwise be invisible to the agent's shell tools.
 * @param timeoutMs - upper bound for the shell start-up.
 * @returns the login-shell PATH, or undefined when the shell fails or times out.
 */
export function loginShellPath(timeoutMs = 5000): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  const shell = process.env.SHELL ?? '/bin/zsh'
  const marker = '__ZH_DESKTOP_PATH__'
  return new Promise(resolve => {
    execFile(shell, ['-ilc', `printf '%s%s%s' '${marker}' "$PATH" '${marker}'`], {
      timeout: timeoutMs,
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' },
    }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined)
        return
      }
      const match = new RegExp(`${marker}(.*?)${marker}`, 's').exec(stdout)
      resolve(match?.[1]?.trim() || undefined)
    })
  })
}

/**
 * Merge PATH entries, keeping the first occurrence of each directory.
 * @param parts - PATH strings in priority order.
 * @returns the merged PATH.
 */
export function mergePath(...parts: Array<string | undefined>): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    for (const entry of (part ?? '').split(delimiter)) {
      if (entry === '' || seen.has(entry)) continue
      seen.add(entry)
      out.push(entry)
    }
  }
  return out.join(delimiter)
}

/**
 * Find an executable on a PATH string.
 * @param name - executable name.
 * @param path - PATH to search.
 * @returns the absolute path, or undefined.
 */
function which(name: string, path: string): string | undefined {
  for (const dir of path.split(delimiter)) {
    const candidate = join(dir, name)
    if (dir !== '' && existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Locate the Node executable and dsh CLI entry.
 * @param packaged - Electron's `app.isPackaged`.
 * @param resourcesPath - Electron's `process.resourcesPath`.
 * @param path - PATH used to find a development `node`.
 * @returns the runtime paths.
 */
export function resolveRuntime(packaged: boolean, resourcesPath: string, path: string): RuntimePaths {
  if (packaged) {
    const node = process.env.DSH_DESKTOP_NODE ?? join(resourcesPath, 'node', 'bin', 'node')
    const bin = join(resourcesPath, 'dsh-runtime', 'lib', 'bin.js')
    if (!existsSync(node)) throw new RuntimeMissingError(`应用包内缺少 Node.js 运行时：${node}`)
    if (!existsSync(bin)) throw new RuntimeMissingError(`应用包内缺少 dsh 运行时：${bin}`)
    return { node, bin }
  }
  const require = createRequire(import.meta.url)
  const cliRoot = dirname(require.resolve('@deepseek-ai/dsh/package.json'))
  const bin = join(cliRoot, 'lib', 'bin.js')
  if (!existsSync(bin)) {
    throw new RuntimeMissingError(`找不到 ${bin}。请先在仓库根目录运行 pnpm run build。`)
  }
  const node = process.env.DSH_DESKTOP_NODE ?? which('node', path)
  if (node === undefined) {
    throw new RuntimeMissingError('找不到 node。请安装 Node.js 22.19+ 或设置 DSH_DESKTOP_NODE。')
  }
  return { node, bin }
}

/**
 * Build the server's environment: the app environment with the login-shell PATH
 * and Homebrew locations merged in, `ELECTRON_RUN_AS_NODE` removed, and
 * `DSH_DESKTOP=1` so plugins can tell they run under the desktop shell.
 * @param shellPath - login-shell PATH, when it could be read.
 * @returns the child environment.
 */
export function serverEnv(shellPath: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  env.PATH = mergePath(shellPath, process.env.PATH, '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin')
  env.DSH_DESKTOP = '1'
  env.HOME ??= homedir()
  // GUI processes on macOS start without a locale; dsh's shell tools and the
  // model see UTF-8 output only when LANG names one.
  env.LANG ??= 'zh_CN.UTF-8'
  return env
}
