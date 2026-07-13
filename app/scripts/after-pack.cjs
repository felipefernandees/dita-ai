// electron-builder afterPack: sem assinatura Developer ID, o builder deixa a
// chave ElectronAsarIntegrity do Info.plist apontando pro default_app.asar
// original, e o Electron aborta na validação (SIGTRAP no boot). Removemos a
// chave e re-assinamos ad-hoc.
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const plist = path.join(appPath, 'Contents/Info.plist')
  try {
    execSync(`plutil -remove ElectronAsarIntegrity "${plist}"`)
    console.log('  • afterPack: ElectronAsarIntegrity removido')
  } catch {
    console.log('  • afterPack: ElectronAsarIntegrity já ausente')
  }
  execSync(`codesign --force --deep --sign - "${appPath}"`)
  console.log('  • afterPack: re-assinado ad-hoc')
}
