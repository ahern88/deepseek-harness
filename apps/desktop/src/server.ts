/**
 * Supervises the local `dsh web` server that the desktop window renders.
 *
 * The server runs as a child Node process bound to 127.0.0.1 on a free port.
 * Readiness is the `dsh web: <url>` line the web app prints once its HTTP
 * server listens; the process's stdout and stderr are appended to a log file
 * that the error screen and the Help menu point to.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, type WriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

/** How to launch the server. */
export interface ServerLaunch {
  /** Node executable that runs the dsh CLI. */
  node: string
  /** Absolute path of the dsh CLI entry (`lib/bin.js`). */
  bin: string
  /** Working directory; dsh uses it as the default filesystem location. */
  cwd: string
  /** Environment for the child process. */
  env: NodeJS.ProcessEnv
  /** File that receives the child's stdout and stderr. */
  logFile: string
  /** Milliseconds to wait for the ready line before giving up. */
  readyTimeoutMs: number
}

/** A running server. */
export interface RunningServer {
  /** Base URL printed by `dsh web`, for example `http://127.0.0.1:53817`. */
  url: string
  /** Stop the server: SIGTERM, then SIGKILL after `graceMs`. Resolves once the process exited. */
  stop(graceMs?: number): Promise<void>
  /** Register a listener for an exit that `stop()` did not request. */
  onUnexpectedExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
}

/** Thrown when the server exits or times out before printing its URL. */
export class ServerStartError extends Error {
  constructor(message: string, readonly logFile: string, readonly logTail: string) {
    super(message)
    this.name = 'ServerStartError'
  }
}

const READY_LINE = /dsh web: (https?:\/\/\S+)/

/**
 * Ask the OS for a free loopback TCP port.
 * @returns a port that was free at the time of the call.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/**
 * Read the last lines of a log file for error reporting.
 * @param file - log path.
 * @param lines - number of trailing lines to keep.
 * @returns the trailing text, or an empty string when the file is absent.
 */
export function tail(file: string, lines = 40): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

/**
 * Start `dsh web` and wait until it prints its URL.
 * @param launch - executable, entry, environment, and log settings.
 * @returns the running server.
 */
export async function startServer(launch: ServerLaunch): Promise<RunningServer> {
  const port = await findFreePort()
  mkdirSync(dirname(launch.logFile), { recursive: true })
  const log: WriteStream = createWriteStream(launch.logFile, { flags: 'a' })
  log.write(`\n===== ${new Date().toISOString()} starting dsh web on 127.0.0.1:${port} =====\n`)
  log.write(`node: ${launch.node}\nbin: ${launch.bin}\ncwd: ${launch.cwd}\n`)

  const child: ChildProcess = spawn(launch.node, [launch.bin, 'web', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (chunk: Buffer) => log.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => log.write(chunk))

  let stopping = false
  let exited = false
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  const exitPromise = new Promise<void>(resolve => {
    child.once('exit', (code, signal) => {
      exited = true
      log.write(`===== dsh web exited (code ${code}, signal ${signal}) =====\n`)
      log.end()
      if (!stopping) for (const listener of exitListeners) listener(code, signal)
      resolve()
    })
  })

  const url = await new Promise<string>((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => {
      fail(`dsh web 在 ${Math.round(launch.readyTimeoutMs / 1000)} 秒内没有就绪`)
    }, launch.readyTimeoutMs)

    function fail(message: string): void {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      if (!exited) child.kill('SIGKILL')
      // Let the log stream flush so the tail includes the failure output.
      setTimeout(() => reject(new ServerStartError(message, launch.logFile, tail(launch.logFile))), 200)
    }

    function onStdout(chunk: Buffer): void {
      buffered += chunk.toString('utf8')
      const match = READY_LINE.exec(buffered)
      if (match !== null) {
        clearTimeout(timer)
        child.stdout?.off('data', onStdout)
        child.off('exit', onEarlyExit)
        child.off('error', onError)
        resolve(match[1]!.replace(/\/$/, ''))
      } else if (buffered.length > 64 * 1024) {
        buffered = buffered.slice(-1024)
      }
    }
    function onEarlyExit(code: number | null, signal: NodeJS.Signals | null): void {
      fail(`dsh web 启动失败（退出码 ${code ?? signal}）`)
    }
    function onError(error: Error): void {
      fail(`无法启动 Node.js（${launch.node}）：${error.message}`)
    }

    child.stdout?.on('data', onStdout)
    child.once('exit', onEarlyExit)
    child.once('error', onError)
  })

  return {
    url,
    onUnexpectedExit(listener) {
      exitListeners.push(listener)
    },
    async stop(graceMs = 5000) {
      if (exited) return
      stopping = true
      child.kill('SIGTERM')
      const timer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL')
      }, graceMs)
      await exitPromise
      clearTimeout(timer)
    },
  }
}

/**
 * Join a path under the log directory.
 * @param logsDir - Electron's logs directory.
 * @returns the server log path.
 */
export function serverLogFile(logsDir: string): string {
  return join(logsDir, 'dsh-web.log')
}
