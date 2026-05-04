# Cromminm TLS/JA3 Spoofing Proxy

This is a local microservice written in Go that intercepts HTTPS traffic from the Playwright Chromium instance and forwards it to the target website using [uTLS](https://github.com/refraction-networking/utls).

## Why is this needed?
Custom Chromium builds (and Node.js itself) have unique TLS fingerprints (JA3/JA4) that do not match a real Google Chrome installation on Windows/macOS. Cloudflare Turnstile, Datadome, and other anti-bot systems check the TLS handshake *before* any JavaScript runs. 

By tunneling our traffic through this proxy, we wrap our requests in a TLS handshake that is mathematically identical to a real, standard Google Chrome browser, bypassing network-level bot detection.

## Setup Instructions (On your Proxmox Linux Server)

1. Install Go:
   \`\`\`bash
   sudo apt install golang
   # or download from golang.org
   \`\`\`

2. Build the proxy:
   \`\`\`bash
   cd tls-proxy
   chmod +x build.sh
   ./build.sh
   \`\`\`

3. How it integrates:
   Once built, you can run this binary. In \`local-api\`, you would spawn this process on an available port (e.g., 8080), and instruct Playwright to use \`http://127.0.0.1:8080\` as its proxy. 
   *(Note: Since this does SSL MITM locally to rewrite the JA3, you will need to launch Playwright with the \`--ignore-certificate-errors\` flag, or install the Go proxy's generated Root CA into your Linux Chromium NSS database).*
