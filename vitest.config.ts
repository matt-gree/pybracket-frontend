import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Mirror the tsconfig `@/*` alias so tests import the studio code the same way the app does.
	resolve: { alias: { '@': root } },
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts']
	}
});
