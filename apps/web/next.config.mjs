/**
 * Politique de contenu. `unsafe-inline` reste nécessaire pour les scripts
 * d'amorçage de Next (sans nonce) et les styles en ligne de React : le risque
 * résiduel est documenté dans SECURITY.md. Tout le reste est fermé.
 */
function contentSecurityPolicy() {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  let supabaseOrigin = '';
  let supabaseSocket = '';
  try {
    const url = new URL(supabase);
    supabaseOrigin = url.origin;
    supabaseSocket = `wss://${url.host}`;
  } catch {
    // Non configuré (premier clone) : aucune origine externe autorisée.
  }
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    // `unsafe-eval` : rechargement à chaud du serveur de développement uniquement.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ne pas annoncer la pile technique dans chaque réponse.
  poweredByHeader: false,
  // Les packages du monorepo sont consommés en TypeScript source.
  transpilePackages: ['@pharmaiq/db', '@pharmaiq/core', '@pharmaiq/ai', '@pharmaiq/whatsapp'],
  serverExternalPackages: ['@prisma/client', '@anthropic-ai/sdk'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          // Ignoré par les navigateurs en HTTP : sans effet en développement local.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
