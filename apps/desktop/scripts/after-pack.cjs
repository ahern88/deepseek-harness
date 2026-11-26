/**
 * electron-builder afterPack hook: copy the staged dsh runtime into the app's
 * Resources directory. electron-builder filters every node_modules directory
 * out of `extraResources`, and the runtime cannot work without its own.
 */

const { cpSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const source = join(context.packager.projectDir, '.stage', 'dsh-runtime')
  if (!existsSync(join(source, 'lib', 'bin.js'))) {
    throw new Error(`after-pack: ${source} is missing; run scripts/stage-runtime.mjs first`)
  }
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const target = join(resources, 'dsh-runtime')
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, dereference: true })
  console.log(`  • copied dsh runtime  to=${target}`)
}
