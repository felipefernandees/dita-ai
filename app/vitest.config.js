import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

export default defineConfig({
  test: {
    alias: {
      // Sob ELECTRON_RUN_AS_NODE o módulo 'electron' é uma string de caminho.
      // Os testes não exercitam a área de transferência de verdade.
      electron: fileURLToPath(new URL('./tests/stubs/electron.js', import.meta.url))
    }
  }
})
