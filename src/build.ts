/**
 * MEATBASH production build.
 * Bundles everything into dist/ for static hosting.
 */

import { mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';

async function build() {
  console.log('🥩 Building MEATBASH for production...');

  // Ensure dist exists
  await mkdir('./dist', { recursive: true });

  // Bundle TypeScript
  const result = await Bun.build({
    entrypoints: ['./src/main.ts'],
    outdir: './dist',
    target: 'browser',
    format: 'esm',
    sourcemap: 'none',
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  if (!result.success) {
    console.error('Build failed:');
    for (const msg of result.logs) {
      console.error(msg);
    }
    process.exit(1);
  }

  // Generate production index.html
  const indexHtml = await Bun.file('./src/index.html').text();
  const prodHtml = indexHtml.replace(
    '<script type="module" src="./main.ts"></script>',
    '<script type="module" src="/main.js"></script>'
  );
  await Bun.write('./dist/index.html', prodHtml);

  // Copy public assets
  if (existsSync('./public')) {
    await cp('./public', './dist', { recursive: true, force: true });
  }
  if (existsSync('./sound')) {
    await cp('./sound', './dist/sound', { recursive: true, force: true });
  }

  console.log('✅ Build complete! Output in ./dist/');
  console.log('   Deploy dist/ to any static hosting.');
}

build();
