#!/bin/bash
echo "Building TLS JA3 Spoofing Proxy..."
go mod tidy
go build -o tls-proxy-bin main.go
echo "Build complete: ./tls-proxy-bin"
