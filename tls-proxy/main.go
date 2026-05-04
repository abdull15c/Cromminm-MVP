package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"

	"github.com/elazarl/goproxy"
	utls "github.com/refraction-networking/utls"
)

func main() {
	port := flag.Int("port", 8080, "Proxy listen port")
	upstream := flag.String("upstream", "", "Upstream proxy (e.g. http://host:port)")
	flag.Parse()

	proxy := goproxy.NewProxyHttpServer()
	proxy.Verbose = false

	// Force MITM for all HTTPS connections so we can intercept and use uTLS upstream
	proxy.OnRequest().HandleConnect(goproxy.AlwaysMitm)

	// Override the default transport to use uTLS
	proxy.Tr.DialTLSContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}

		var rawConn net.Conn

		// If upstream proxy is provided, we need to dial via the upstream proxy
		if *upstream != "" {
			u, err := url.Parse(*upstream)
			if err != nil {
				return nil, err
			}
			
			// This is a simplified upstream connection. 
			// In a production-ready version, you'd handle Proxy-Authorization and SOCKS5 here.
			rawConn, err = net.Dial(network, u.Host)
			if err != nil {
				return nil, err
			}
			
			// Send CONNECT request to upstream proxy
			req, err := http.NewRequest("CONNECT", "http://"+addr, nil)
			if err != nil {
				return nil, err
			}
			req.Write(rawConn)
			
			// Read the response from upstream (expect 200 Connection Established)
			// For MVP, we assume success or write a quick reader
		} else {
			rawConn, err = net.Dial(network, addr)
			if err != nil {
				return nil, err
			}
		}

		// Wrap the raw TCP connection with uTLS to spoof the JA3 fingerprint
		utlsConfig := &utls.Config{
			ServerName:         host,
			InsecureSkipVerify: true, // Ignore upstream cert errors for now
		}
		
		// Use HelloChrome_Auto to automatically mimic the latest Chrome JA3 fingerprint
		uConn := utls.UClient(rawConn, utlsConfig, utls.HelloChrome_Auto)
		err = uConn.Handshake()
		if err != nil {
			return nil, fmt.Errorf("uTLS Handshake failed: %v", err)
		}

		return uConn, nil
	}

	log.Printf("Starting TLS spoofing proxy on 127.0.0.1:%d", *port)
	if *upstream != "" {
		log.Printf("Upstream proxy configured: %s", *upstream)
	}

	err := http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", *port), proxy)
	if err != nil {
		log.Fatal(err)
	}
}
