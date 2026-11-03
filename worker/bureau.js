// bureau.belpire.com: the Bureau of Finality, the community's Star Citizen org.
// Same Worker and the same static files as belpire.com; the hostname decides what is served.
//   bureau.belpire.com/<path>  → site/bureau/<path>  (shared fonts and icons pass through)
//   bureau.belpire.com/api/*   → the normal API (the Star Citizen division reads /api/star-citizen)
//   belpire.com/bureau/...     → 301 to bureau.belpire.com, so the org has one address
//   belpire.com/star-citizen/  → 301 to bureau.belpire.com/rsi1/ (Star Citizen now lives in DIV_RSI1)
// Other hosts (local dev, preview URLs) serve /bureau/ as a normal folder so it can be checked before a deploy.

const MAIN_HOSTS = new Set(['belpire.com', 'www.belpire.com']);
const SHARED = [/^\/fonts\//, /^\/favicon\.svg$/, /^\/apple-touch-icon\.png$/, /^\/og\//, /^\/data\//];

export const isBureauHost = (hostname) => hostname === 'bureau.belpire.com' || hostname.startsWith('bureau.localhost');

// Returns null (not ours), { path } (serve this static path) or { redirect, status }.
export function bureauRoute(url) {
  const { hostname, pathname, search } = url;
  if (isBureauHost(hostname)) {
    if (SHARED.some((re) => re.test(pathname))) return { path: pathname };
    if (pathname.startsWith('/api/')) return null;
    if (pathname.startsWith('/auth/')) return { redirect: `https://belpire.com${pathname}${search}`, status: 302 };
    return { path: `/bureau${pathname}` };
  }
  if (pathname === '/star-citizen' || pathname.startsWith('/star-citizen/')) {
    return { redirect: MAIN_HOSTS.has(hostname) ? 'https://bureau.belpire.com/rsi1/' : '/bureau/rsi1/', status: 301 };
  }
  if (MAIN_HOSTS.has(hostname) && (pathname === '/bureau' || pathname.startsWith('/bureau/'))) {
    return { redirect: `https://bureau.belpire.com${pathname.slice('/bureau'.length) || '/'}${search}`, status: 301 };
  }
  return null;
}
