import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	outputFileTracingRoot: import.meta.dirname,
	images: {
		// Cloudflare Workers does not run the default Next.js image optimizer.
		unoptimized: true
	}
};

export default nextConfig;
