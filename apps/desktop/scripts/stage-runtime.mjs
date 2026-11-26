#!/usr/bin/env node
/**
 * Stage the `dsh` runtime that the packaged desktop app launches.
 *
 * `pnpm deploy --legacy` copies `@deepseek-ai/dsh` with its production
 * dependencies, but it omits peer dependencies (every harness package peers on
 * Cordis and its siblings) and the `link:` overrides for vendored packages. This
 * script deploys, then walks every staged package manifest and copies each
 * missing dependency or peer from its resolved workspace location until the
 * closure is complete. Copies are dereferenced so the payload holds no symlinks.
 *
 * Usage: node apps/desktop/scripts/stage-runtime.mjs [outDir]
 * Default outDir: apps/desktop/.stage/dsh-runtime
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '../..')
const outDir = resolve(process.argv[2] ?? join(desktopRoot, '.stage', 'dsh-runtime'))

if (repoRoot === outDir || repoRoot.startsWith(outDir + sep)) {
  throw new Error(`stage-runtime: refusing to clear ${outDir}: it contains the repository root`)
}

const cliRoot = join(repoRoot, 'apps', 'cli')
if (!existsSync(join(cliRoot, 'lib', 'bin.js'))) {
  throw new Error('stage-runtime: apps/cli/lib/bin.js is missing; run `pnpm run build` at the repository root first')
}

rmSync(outDir, { recursive: true, force: true })
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
execFileSync(pnpm, [
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  '--config.ignore-scripts=false',
  outDir,
], { cwd: repoRoot, stdio: 'inherit' })

const stagedModules = join(outDir, 'node_modules')

/** Read a package manifest. */
function manifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** Every package directory directly under a node_modules folder. */
function packageDirs(nodeModules) {
  if (!existsSync(nodeModules)) return []
  const dirs = []
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue
    const full = join(nodeModules, entry)
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(full)) dirs.push(join(full, scoped))
    } else {
      dirs.push(full)
    }
  }
  return dirs.filter(dir => existsSync(join(dir, 'package.json')))
}

/** Workspace packages by name, from the pnpm-workspace globs this closure can reach. */
const workspacePackages = new Map()
for (const pattern of [['vendor'], ['apps'], ['packages', '*']]) {
  const bases = pattern.length === 1
    ? [join(repoRoot, pattern[0])]
    : readdirSync(join(repoRoot, pattern[0])).map(group => join(repoRoot, pattern[0], group))
  for (const base of bases) {
    if (!lstatSync(base).isDirectory()) continue
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry)
      if (existsSync(join(dir, 'package.json'))) workspacePackages.set(manifest(dir).name, dir)
    }
  }
}

/**
 * Locate the workspace copy of `name` as seen from `fromDir` (a workspace
 * package directory), falling back to the repository root.
 */
function workspaceSource(name, fromDir) {
  const local = workspacePackages.get(name)
  if (local !== undefined) return local
  for (const base of [fromDir, cliRoot, repoRoot]) {
    if (base === undefined) continue
    try {
      const req = createRequire(join(base, 'package.json'))
      const pkgJson = req.resolve(`${name}/package.json`)
      return realpathSync(dirname(pkgJson))
    } catch {
      // Packages without an exported ./package.json: walk node_modules by hand.
      let dir = base
      while (true) {
        const candidate = join(dir, 'node_modules', ...name.split('/'))
        if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }
  }
  return undefined
}

/** True when `path` exists as a link or entry, even if it is a dangling link. */
function present(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    // ENOENT: nothing at this path.
    return false
  }
}

/**
 * Remove links whose target is gone. `pnpm deploy` can leave `link:` overrides
 * (the vendored cosmokit and schemastery) as links relative to the workspace,
 * which dangle inside the deploy directory and would hide the package from the
 * closure walk below.
 */
function removeDanglingLinks(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) {
      if (!existsSync(full)) {
        console.log(`stage-runtime: removing dangling link ${full}`)
        rmSync(full, { force: true })
      }
    } else if (stat.isDirectory()) {
      removeDanglingLinks(full)
    }
  }
}
removeDanglingLinks(stagedModules)

/** Where each staged package came from, so its own deps resolve from the right place. */
const origin = new Map()
const queue = packageDirs(stagedModules)
const copied = []
const unresolved = new Set()

while (queue.length > 0) {
  const dir = queue.shift()
  const pkg = manifest(dir)
  const from = origin.get(dir) ?? workspaceSource(pkg.name, cliRoot)
  const wanted = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  }
  for (const name of Object.keys(wanted)) {
    if (pkg.peerDependenciesMeta?.[name]?.optional === true && !(name in (pkg.dependencies ?? {}))) continue
    const destination = join(stagedModules, ...name.split('/'))
    const nested = join(dir, 'node_modules', ...name.split('/'))
    if (existsSync(join(destination, 'package.json')) || existsSync(join(nested, 'package.json'))) continue
    const source = workspaceSource(name, from)
    if (source === undefined) {
      if (!(name in (pkg.optionalDependencies ?? {}))) unresolved.add(`${name} (wanted by ${pkg.name})`)
      continue
    }
    const sourceNodeModules = join(source, 'node_modules')
    if (present(destination)) rmSync(destination, { recursive: true, force: true })
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== sourceNodeModules && !path.startsWith(sourceNodeModules + sep),
    })
    origin.set(destination, source)
    copied.push(name)
    queue.push(destination)
  }
}

// `.bin` links are not needed at runtime and would leave symlinks in the payload.
rmSync(join(stagedModules, '.bin'), { recursive: true, force: true })
for (const dir of packageDirs(stagedModules)) rmSync(join(dir, 'node_modules', '.bin'), { recursive: true, force: true })

/** Find the first remaining symlink, if any. */
function findSymlink(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return full
    if (stat.isDirectory()) {
      const found = findSymlink(full)
      if (found !== undefined) return found
    }
  }
  return undefined
}

let link = findSymlink(stagedModules)
while (link !== undefined) {
  const target = realpathSync(link)
  rmSync(link, { force: true })
  cpSync(target, link, { recursive: true, dereference: true })
  link = findSymlink(stagedModules)
}

console.log(`stage-runtime: copied ${copied.length} packages omitted by pnpm deploy`)
if (unresolved.size > 0) {
  throw new Error(`stage-runtime: unresolved dependencies:\n  ${[...unresolved].join('\n  ')}`)
}

/**
 * Resolve every non-optional dependency and peer of every staged package the
 * way Node does (walking up node_modules), so a gap fails here instead of at
 * app start-up.
 */
function verifyClosure() {
  const missing = []
  const dirs = [...packageDirs(stagedModules)]
  for (const dir of [...dirs]) dirs.push(...packageDirs(join(dir, 'node_modules')))
  for (const dir of dirs) {
    const pkg = manifest(dir)
    const required = { ...pkg.dependencies, ...pkg.peerDependencies }
    for (const name of Object.keys(required)) {
      if (pkg.peerDependenciesMeta?.[name]?.optional === true && !(name in (pkg.dependencies ?? {}))) continue
      let base = dir
      let found = false
      while (base.startsWith(outDir)) {
        if (existsSync(join(base, 'node_modules', ...name.split('/'), 'package.json'))) {
          found = true
          break
        }
        base = dirname(base)
      }
      if (!found) missing.push(`${name} (wanted by ${pkg.name})`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`stage-runtime: staged runtime cannot resolve:\n  ${[...new Set(missing)].join('\n  ')}`)
  }
}
verifyClosure()

/** Boot `dsh web` from the staged runtime and wait for its ready line. */
async function smokeBoot() {
  const { spawn } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const home = mkdtempSync(join(tmpdir(), 'zharness-stage-'))
  const child = spawn(process.execPath, [join(outDir, 'lib', 'bin.js'), 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, NODE_ENV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const ok = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 90_000)
    child.stdout.on('data', () => {
      if (/dsh web: https?:\/\//.test(output)) {
        clearTimeout(timer)
        resolve(true)
      }
    })
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  child.kill('SIGTERM')
  rmSync(home, { recursive: true, force: true })
  if (!ok) throw new Error(`stage-runtime: smoke boot of the staged runtime failed:\n${output.slice(-4000)}`)
  console.log('stage-runtime: smoke boot ok')
}
if (!process.argv.includes('--skip-smoke')) await smokeBoot()

console.log(`stage-runtime: runtime staged at ${outDir}`)
