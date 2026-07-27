// Preload controlável usado como "binário" do helper do Windows nos testes
// de paster.win32.js.
//
// Por que não é um .cmd/.bat: testamos e confirmamos que spawn/execFile no
// Windows recusa executar .cmd/.bat diretamente sem `shell: true` (erro
// EINVAL) — e paster.win32.js roda execFile sem shell de propósito (evita
// injeção de comando via texto ditado). Em vez de mudar produção só pra
// viabilizar o teste, usamos o próprio node.exe como DITA_HELPER e entramos
// aqui via NODE_OPTIONS=--require, que roda ANTES do node tentar resolver
// 'frontapp'/'paste' (os argumentos que paster.win32.js passa) como se
// fossem um módulo — sem isso o node erraria com "Cannot find module".
//
// Controlado só por env var (não por arquivo): assim cada teste liga/desliga
// o cenário sem deixar estado em disco pra limpar.
if (process.env.DITA_HELPER_STUB_STDOUT) process.stdout.write(process.env.DITA_HELPER_STUB_STDOUT)
process.exit(Number(process.env.DITA_HELPER_STUB_EXIT || '0'))
