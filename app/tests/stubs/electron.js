let texto = ''
export const clipboard = {
  readText: () => texto,
  writeText: (t) => { texto = String(t) }
}
export const app = { isPackaged: false, getPath: () => '' }
export default { clipboard, app }
