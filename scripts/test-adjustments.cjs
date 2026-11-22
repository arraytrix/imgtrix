// Run with node scripts/test-adjustments.cjs. Uses the app's Electron canvas APIs.
const path = require('path')
const fs = require('fs')
const root = path.resolve(__dirname, '..')

if (!process.versions.electron) {
  const { spawn } = require('child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  })
  const timer = setTimeout(() => { console.error('Adjustment checks timed out'); child.kill(); process.exit(1) }, 60000)
  child.on('exit', code => { clearTimeout(timer); process.exit(code ?? 1) })
} else {
  const { app, BrowserWindow } = require('electron')
  const { build } = require('esbuild')
  const { compile, preprocess } = require('svelte/compiler')
  const ts = require('typescript')
  const output = path.join(root, 'dist', 'adjustment-tests')
  fs.mkdirSync(output, { recursive: true })
  app.setPath('userData', path.join(output, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    await build({
      entryPoints: [path.join(root, 'tests/adjustments.ts')],
      bundle: true, platform: 'browser', format: 'iife',
      conditions: ['browser'], outfile: path.join(output, 'tests.js'),
      plugins: [{
        name: 'svelte-test',
        setup(build) {
          build.onResolve({ filter: /\/telemetry$/ }, () => ({ path: 'telemetry', namespace: 'stub' }))
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export function initTelemetry() {} export function track() {}',
          }))
          build.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
            const source = await preprocess(fs.readFileSync(filename, 'utf8'), {
              script: ({ content }) => ({ code: ts.transpileModule(content, {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
              }).outputText }),
            }, { filename })
            return { contents: compile(source.code, { filename, css: 'injected' }).js.code, resolveDir: path.dirname(filename) }
          })
        },
      }],
    })
    const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8').replace('./main.ts', './tests.js')
    fs.writeFileSync(path.join(output, 'index.html'), html)
    const win = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
    await win.loadFile(path.join(output, 'index.html'))
    console.log(await win.webContents.executeJavaScript('window.adjustmentTests'))
    fs.writeFileSync(path.join(output, 'preview.png'), (await win.webContents.capturePage()).toPNG())
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
