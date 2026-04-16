/**
 * MEATBASH dev server.
 * Uses Bun.serve() for HTTP + Bun.build() for bundling.
 * Hot-reloads on file changes (manual refresh for now).
 */

const PORT = 3000;

async function buildBundle() {
  const result = await Bun.build({
    entrypoints: ['./src/main.ts'],
    outdir: './dist',
    target: 'browser',
    format: 'esm',
    sourcemap: 'inline',
    minify: false,
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  });

  if (!result.success) {
    console.error('Build failed:');
    for (const msg of result.logs) {
      console.error(msg);
    }
    return false;
  }
  return true;
}

// Initial build
console.log('🥩 Building MEATBASH...');
const buildOk = await buildBundle();
if (!buildOk) {
  console.error('Initial build failed. Fix errors and restart.');
  process.exit(1);
}

// Read index.html and rewrite the script src to point at the bundle
const indexHtml = await Bun.file('./src/index.html').text();
const servedHtml = indexHtml.replace(
  '<script type="module" src="./main.ts"></script>',
  '<script type="module" src="/main.js"></script>'
);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Root → serve index.html
    if (path === '/' || path === '/index.html') {
      // Rebuild on each page load during dev
      await buildBundle();
      const freshHtml = (await Bun.file('./src/index.html').text()).replace(
        '<script type="module" src="./main.ts"></script>',
        '<script type="module" src="/main.js"></script>'
      );
      return new Response(freshHtml, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Serve built JS bundle (no cache in dev mode)
    if (path === '/main.js') {
      const file = Bun.file('./dist/main.js');
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
          },
        });
      }
    }

    // Serve static assets from public/
    const publicFile = Bun.file(`./public${path}`);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    if (path.startsWith('/sound/')) {
      const soundFile = Bun.file(`.${path}`);
      if (await soundFile.exists()) {
        return new Response(soundFile);
      }
    }

    // Serve WASM files from node_modules (Rapier needs this)
    if (path.endsWith('.wasm')) {
      // Try dist first, then node_modules
      for (const dir of ['./dist', './node_modules/@dimforge/rapier3d-compat']) {
        const file = Bun.file(`${dir}${path}`);
        if (await file.exists()) {
          return new Response(file, {
            headers: { 'Content-Type': 'application/wasm' },
          });
        }
      }
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`🥩 MEATBASH dev server running at http://localhost:${PORT}`);
console.log('   Refresh browser to pick up changes.');
