import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

function localHttpsConfig() {
	if (process.env.APEX_HTTPS !== '1') return undefined;
	const keyPath = process.env.APEX_HTTPS_KEY ?? 'data/certs/verde-local.key';
	const certPath = process.env.APEX_HTTPS_CERT ?? 'data/certs/verde-local.crt';
	if (!existsSync(keyPath) || !existsSync(certPath)) return undefined;
	return {
		key: readFileSync(keyPath),
		cert: readFileSync(certPath)
	};
}

const https = localHttpsConfig();

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		https,
		watch: {
			ignored: ['**/data/session/**', '**/data/participants/**']
		}
	},
	preview: {
		host: '0.0.0.0',
		https
	}
});
