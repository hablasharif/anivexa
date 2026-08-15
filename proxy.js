// Residential proxy pool — used ONLY for .m3u8 requests
const PROXY_USER = 'xdwwyuwg';
const PROXY_PASS = '5j97qhea02pz';
const PROXY_LIST = [
  { host: '31.59.20.176',    port: 6754 },
  { host: '31.56.127.193',   port: 7684 },
  { host: '45.38.107.97',    port: 6014 },
  { host: '198.105.121.200', port: 6462 },
  { host: '64.137.96.74',    port: 6641 },
  { host: '198.23.243.226',  port: 6361 },
  { host: '38.154.185.97',   port: 6370 },
  { host: '84.247.60.125',   port: 6095 },
  { host: '142.111.67.146',  port: 5611 },
  { host: '191.96.254.138',  port: 6185 },
];

let proxyIndex = 0;
function getNextProxy() {
  const p = PROXY_LIST[proxyIndex % PROXY_LIST.length];
  proxyIndex++;
  return p;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
  };
}

function parseParams(reqUrl) {
  const urlObj = new URL(reqUrl);
  let rawUrl = urlObj.searchParams.get('url');
  let rawRef = urlObj.searchParams.get('ref') || urlObj.searchParams.get('referer');

  if (!rawUrl) {
    const fullSearch = urlObj.search;
    if (fullSearch.startsWith('?')) {
      const query = fullSearch.substring(1);
      if (query.startsWith('http://') || query.startsWith('https://')) {
        rawUrl = query;
      }
    }
  }

  if (!rawUrl) return null;

  try { rawUrl = decodeURIComponent(rawUrl); } catch (_) {}
  if (rawRef) { try { rawRef = decodeURIComponent(rawRef); } catch (_) {} }

  if (rawUrl.includes('|')) {
    const parts = rawUrl.split('|');
    rawUrl = parts[0].trim();
    if (!rawRef && parts[1]) rawRef = parts[1].trim();
  }

  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;

  let referer = rawRef || null;
  let origin = null;

  if (referer) {
    if (!/^https?:\/\//i.test(referer)) referer = 'https://' + referer;
    try { origin = new URL(referer).origin; } catch (_) { referer = null; }
  }

  if (!origin) {
    try {
      const t = new URL(rawUrl);
      origin = t.origin;
      if (!referer) referer = t.origin + '/';
    } catch (_) {}
  }

  return { targetUrl: rawUrl, referer, origin };
}

function getSecSite(targetUrl, referer) {
  try {
    const tHost = new URL(targetUrl).hostname.toLowerCase();
    const rHost = referer ? new URL(referer).hostname.toLowerCase() : tHost;
    if (tHost === rHost) return 'same-origin';
    if (tHost.split('.').slice(-2).join('.') === rHost.split('.').slice(-2).join('.')) return 'same-site';
    return 'cross-site';
  } catch (_) { return 'cross-site'; }
}

function browserHeaders(targetUrl, referer, origin, requestHeaders) {
  const tHost = new URL(targetUrl).hostname;
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || `https://${tHost}/`,
    'Origin': origin || `https://${tHost}`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': getSecSite(targetUrl, referer),
    'Sec-CH-UA': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
  if (requestHeaders) {
    const range = requestHeaders.get('Range') || requestHeaders.get('range');
    if (range) h['Range'] = range;
  }
  return h;
}

function minimalHeaders(targetUrl, referer, requestHeaders) {
  const tHost = new URL(targetUrl).hostname;
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || `https://${tHost}/`,
  };
  if (requestHeaders) {
    const range = requestHeaders.get('Range') || requestHeaders.get('range');
    if (range) h['Range'] = range;
  }
  return h;
}

function resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  try { return new URL(rel, base).href; } catch (_) { return rel; }
}

function isPlaylistContent(text) {
  const t = text.trim();
  return t.startsWith('#EXTM3U') || t.includes('#EXT-X-STREAM-INF') || t.includes('#EXT-X-TARGETDURATION');
}

function isTxtPlaylist(text) {
  const t = text.trim();
  return t.startsWith('#EXTM3U') || t.includes('#EXT-X-TARGETDURATION') || t.includes('#EXTINF');
}

function rewriteM3u8(text, baseUrl, referer, proxyBase) {
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (t.startsWith('#') && t.includes('URI="')) {
      return t.replace(/URI="([^"]+)"/g, (m, p1) => {
        const abs = resolveUrl(p1, baseUrl);
        return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}"`;
      });
    }
    if (t && !t.startsWith('#')) {
      const abs = resolveUrl(t, baseUrl);
      return `${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}`;
    }
    return line;
  }).join('\n');
}

function rewriteMpd(text, baseUrl, referer, proxyBase) {
  let r = text.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (m, p1) => {
    const abs = resolveUrl(p1.trim(), baseUrl);
    return `<BaseURL>${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}</BaseURL>`;
  });
  r = r.replace(/(initialization|media|sourceURL|manifestURL)="([^"]+)"/g, (m, attr, p1) => {
    const abs = resolveUrl(p1, baseUrl);
    return `${attr}="${proxyBase}?url=${encodeURIComponent(abs)}${referer ? '&ref=' + encodeURIComponent(referer) : ''}"`;
  });
  return r;
}

// Fetch via residential proxy using HTTP CONNECT tunnel (Node.js only)
async function fetchViaProxy(targetUrl, headers) {
  const { createConnection } = await import('node:net');
  const http = await import('node:http');
  const https = await import('node:https');

  const proxy = getNextProxy();
  const targetParsed = new URL(targetUrl);
  const targetHost = targetParsed.hostname;
  const targetPort = targetParsed.port || (targetParsed.protocol === 'https:' ? 443 : 80);
  const authB64 = Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64');

  return new Promise((resolve, reject) => {
    // Open TCP connection to proxy
    const socket = createConnection({ host: proxy.host, port: proxy.port }, () => {
      // Send HTTP CONNECT to establish tunnel
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `Proxy-Authorization: Basic ${authB64}\r\n` +
        `\r\n`
      );
    });

    socket.once('data', (data) => {
      const resp = data.toString();
      if (!resp.startsWith('HTTP/1.1 200') && !resp.startsWith('HTTP/1.0 200')) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT failed: ${resp.split('\r\n')[0]}`));
      }

      // Tunnel established — make the actual HTTPS request over it
      const tlsSocket = https.request({
        host: targetHost,
        path: targetParsed.pathname + targetParsed.search,
        method: 'GET',
        headers,
        socket,
        createConnection: () => require('tls').connect({ socket, servername: targetHost }),
      });

      // Use tls directly instead
      const tls = require('tls');
      const tlsConn = tls.connect({ socket, servername: targetHost }, () => {
        const reqLine = `GET ${targetParsed.pathname}${targetParsed.search} HTTP/1.1\r\n`;
        const headerLines = Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n');
        tlsConn.write(reqLine + headerLines + `\r\nHost: ${targetHost}\r\n\r\n`);
      });

      let rawData = Buffer.alloc(0);
      tlsConn.on('data', chunk => { rawData = Buffer.concat([rawData, chunk]); });
      tlsConn.on('end', () => {
        const raw = rawData.toString('utf8');
        const headerEnd = raw.indexOf('\r\n\r\n');
        if (headerEnd === -1) return reject(new Error('Invalid HTTP response'));
        const headersPart = raw.slice(0, headerEnd);
        const body = raw.slice(headerEnd + 4);
        const statusLine = headersPart.split('\r\n')[0];
        const statusCode = parseInt(statusLine.split(' ')[1]);
        const respHeaders = {};
        headersPart.split('\r\n').slice(1).forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) {
            respHeaders[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
          }
        });
        resolve({ status: statusCode, headers: respHeaders, text: () => Promise.resolve(body), body });
      });
      tlsConn.on('error', reject);
    });

    socket.on('error', reject);
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('Proxy connection timeout')); });
  });
}

// Simpler approach: use node-fetch with https-proxy-agent if available, else manual
async function fetchM3u8ViaResidentialProxy(targetUrl, headers) {
  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const proxy = getNextProxy();
    const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${proxy.host}:${proxy.port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const nodeFetch = (await import('node-fetch')).default;
    const resp = await nodeFetch(targetUrl, { headers, agent, redirect: 'follow', timeout: 15000 });
    // Wrap to match expected interface
    return {
      status: resp.status,
      headers: { get: (k) => resp.headers.get(k) },
      text: () => resp.text(),
      body: resp.body,
    };
  } catch (err) {
    throw new Error(`Residential proxy fetch failed: ${err.message}`);
  }
}

async function fetchWithFallback(targetUrl, method, headers, minHeaders, useResidentialProxy) {
  if (useResidentialProxy) {
    // Try residential proxy first for m3u8
    try {
      const resp = await fetchM3u8ViaResidentialProxy(targetUrl, headers);
      if (resp.status === 200) return resp;
    } catch (_) {}
    // Fall back to direct if proxy fails
  }

  // Direct fetch — full headers first
  let resp = await fetch(targetUrl, { method, headers, redirect: 'follow' });
  if ((resp.status === 403 || resp.status === 401 || resp.status === 400) && method !== 'HEAD') {
    const resp2 = await fetch(targetUrl, { method, headers: minHeaders, redirect: 'follow' });
    if (resp2.status < resp.status || (resp2.status === 200 && resp.status !== 200)) {
      resp = resp2;
    }
  }
  return resp;
}

async function handleRequest(request) {
  const reqUrl = new URL(request.url);
  const proxyBase = reqUrl.origin + reqUrl.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (reqUrl.pathname === '/health' || (reqUrl.pathname === '/' && !reqUrl.searchParams.has('url'))) {
    return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const parsed = parseParams(request.url);
  if (!parsed || !parsed.targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing or invalid target url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const { targetUrl, referer, origin } = parsed;
  const headers = browserHeaders(targetUrl, referer, origin, request.headers);
  const minHeaders = minimalHeaders(targetUrl, referer, request.headers);

  const urlPath = targetUrl.split('?')[0].toLowerCase();
  const isM3u8ByUrl = urlPath.endsWith('.m3u8') || urlPath.endsWith('.m3u');
  const isTxtByUrl = urlPath.endsWith('.txt');
  const contentType = ''; // not known yet
  const isMpd = urlPath.endsWith('.mpd');

  // Use residential proxy ONLY for .m3u8 URLs
  const useResidentialProxy = isM3u8ByUrl;

  let upstreamResp;
  try {
    upstreamResp = await fetchWithFallback(
      targetUrl,
      request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      minHeaders,
      useResidentialProxy
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const status = upstreamResp.status;
  const respContentType = (upstreamResp.headers.get('Content-Type') || '').toLowerCase();
  const isM3u8 = respContentType.includes('mpegurl') || respContentType.includes('x-mpegurl') || isM3u8ByUrl;
  const isMpdResp = respContentType.includes('dash+xml') || isMpd;

  if (request.method === 'HEAD') {
    const h = {
      'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/octet-stream',
      ...corsHeaders()
    };
    const cl = upstreamResp.headers.get('Content-Length');
    if (cl) h['Content-Length'] = cl;
    const ar = upstreamResp.headers.get('Accept-Ranges');
    if (ar) h['Accept-Ranges'] = ar;
    return new Response(null, { status, headers: h });
  }

  if (isM3u8) {
    const text = await upstreamResp.text();
    if (isPlaylistContent(text)) {
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', ...corsHeaders() }
      });
    }
    return new Response(text, {
      status,
      headers: { 'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/plain', ...corsHeaders() }
    });
  }

  if (isTxtByUrl) {
    const text = await upstreamResp.text();
    if (isTxtPlaylist(text)) {
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', ...corsHeaders() }
      });
    }
    return new Response(text, {
      status,
      headers: { 'Content-Type': 'text/plain', ...corsHeaders() }
    });
  }

  if (isMpdResp) {
    const text = await upstreamResp.text();
    if (text.includes('<MPD') || text.includes('manifest')) {
      const rewritten = rewriteMpd(text, targetUrl, referer, proxyBase);
      return new Response(rewritten, {
        status,
        headers: { 'Content-Type': 'application/dash+xml', 'Cache-Control': 'no-cache', ...corsHeaders() }
      });
    }
    return new Response(text, {
      status,
      headers: { 'Content-Type': upstreamResp.headers.get('Content-Type') || 'text/xml', ...corsHeaders() }
    });
  }

  const passHeaders = {
    'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/octet-stream',
    'Cache-Control': upstreamResp.headers.get('Cache-Control') || 'public, max-age=86400',
    ...corsHeaders()
  };
  const cl = upstreamResp.headers.get('Content-Length');
  if (cl) passHeaders['Content-Length'] = cl;
  const cr = upstreamResp.headers.get('Content-Range');
  if (cr) passHeaders['Content-Range'] = cr;
  const ar = upstreamResp.headers.get('Accept-Ranges');
  if (ar) passHeaders['Accept-Ranges'] = ar;

  return new Response(upstreamResp.body, { status, headers: passHeaders });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};

if (typeof process !== 'undefined' && process.release && process.release.name === 'node') {
  import('node:http').then(({ createServer }) => {
    const PORT = process.env.PORT || 8080;
    const server = createServer(async (req, res) => {
      const fullUrl = `http://${req.headers.host || '127.0.0.1:' + PORT}${req.url}`;
      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) reqHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      const webReq = new Request(fullUrl, { method: req.method, headers: reqHeaders });
      const webResp = await handleRequest(webReq);
      res.statusCode = webResp.status;
      webResp.headers.forEach((val, key) => res.setHeader(key, val));
      if (webResp.body) {
        const reader = webResp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    });
    server.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
  }).catch(() => {});
}
