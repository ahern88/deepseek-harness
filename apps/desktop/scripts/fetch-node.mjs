#!/usr/bin/env node
/**
 * Download the Node.js runtime that the packaged desktop app uses to run
 * `dsh web`. The dsh loader relies on Node's internal ESM loader, which
 * Electron's embedded Node (ELECTRON_RUN_AS_NODE) does not reproduce, so the
 * app ships an official Node binary instead.
 *
 * Usage: node apps/desktop/scripts/fetch-node.mjs [--arch arm64|x64|arm64,x64] (default: this machine's arch) [--version v24.22.3]
 * Output: apps/desktop/.stage/node/<arch>/bin/node (darwin builds only)
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')

/** Node release bundled with the app; must satisfy the repository `engines.node` range. */
const NODE_VERSION = 'v24.22.3'

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const version = option('version', NODE_VERSION)
const archs = option('arch', process.arch).split(',')

for (const arch of archs) {
  const target = join(desktopRoot, '.stage', 'node', arch)
  const binary = join(target, 'bin', 'node')
  const stamp = join(target, '.version')
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8') === version) {
    console.log(`fetch-node: ${version} darwin-${arch} already staged`)
    continue
  }
  const base = `https://nodejs.org/dist/${version}`
  const file = `node-${version}-darwin-${arch}.tar.gz`
  console.log(`fetch-node: downloading ${base}/${file}`)
  const [archive, sums] = await Promise.all([
    fetch(`${base}/${file}`).then(async response => {
      if (!response.ok) throw new Error(`fetch-node: ${file}: HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    }),
    fetch(`${base}/SHASUMS256.txt`).then(async response => {
      if (!response.ok) throw new Error(`fetch-node: SHASUMS256.txt: HTTP ${response.status}`)
      return response.text()
    }),
  ])
  const expected = sums.split('\n').find(line => line.endsWith(`  ${file}`))?.split(' ')[0]
  const actual = createHash('sha256').update(archive).digest('hex')
  if (expected !== actual) throw new Error(`fetch-node: checksum mismatch for ${file}`)

  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const tarball = join(target, file)
  writeFileSync(tarball, archive)
  // Only bin/node is needed at runtime; npm/corepack and headers stay out of the app.
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1', `node-${version}-darwin-${arch}/bin/node`, `node-${version}-darwin-${arch}/LICENSE`])
  rmSync(tarball)
  writeFileSync(stamp, version)
  console.log(`fetch-node: staged ${binary}`)
}
