//! Local HTTP CONNECT proxy for musl-linked Bun on Android.
//!
//! musl's getaddrinfo reads /etc/resolv.conf which doesn't exist on Android.
//! LD_PRELOAD can't intercept musl's internal syscalls. Instead, we run a local
//! CONNECT proxy that Bun connects to via HTTP_PROXY/HTTPS_PROXY env vars.
//! The proxy uses reqwest (Bionic/rustls) which has working DNS resolution.

use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

static PROXY_RUNNING: AtomicBool = AtomicBool::new(false);
static mut PROXY_PORT: u16 = 0;

/// Start the local CONNECT proxy on a random port. Returns the port number.
pub async fn start_proxy() -> Result<u16, String> {
    if PROXY_RUNNING.load(Ordering::Relaxed) {
        return Ok(unsafe { PROXY_PORT });
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Proxy bind: {}", e))?;

    let port = listener.local_addr()
        .map_err(|e| format!("Proxy addr: {}", e))?
        .port();

    unsafe { PROXY_PORT = port; }
    PROXY_RUNNING.store(true, Ordering::Relaxed);

    eprintln!("[Proxy] CONNECT proxy listening on 127.0.0.1:{}", port);

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tokio::spawn(handle_connection(stream));
                }
                Err(e) => {
                    eprintln!("[Proxy] Accept error: {}", e);
                }
            }
        }
    });

    Ok(port)
}

async fn handle_connection(mut client: TcpStream) {
    let mut buf = vec![0u8; 4096];
    let n = match client.read(&mut buf).await {
        Ok(0) => return,
        Ok(n) => n,
        Err(_) => return,
    };

    let request = String::from_utf8_lossy(&buf[..n]);

    if request.starts_with("CONNECT ") {
        // HTTPS CONNECT tunnel
        handle_connect(&request, &mut client).await;
    } else {
        // Regular HTTP proxy request
        handle_http(&request, &buf[..n], &mut client).await;
    }
}

async fn handle_connect(request: &str, client: &mut TcpStream) {
    // Parse "CONNECT host:port HTTP/1.1"
    let target = match request.split_whitespace().nth(1) {
        Some(t) => t.to_string(),
        None => return,
    };

    // Connect to the target via Android's native DNS
    match TcpStream::connect(&target).await {
        Ok(mut upstream) => {
            // Send 200 OK to client
            let response = "HTTP/1.1 200 Connection Established\r\n\r\n";
            if client.write_all(response.as_bytes()).await.is_err() {
                return;
            }

            // Bidirectional tunnel
            let (mut cr, mut cw) = client.split();
            let (mut ur, mut uw) = upstream.split();

            let c2u = tokio::io::copy(&mut cr, &mut uw);
            let u2c = tokio::io::copy(&mut ur, &mut cw);

            let _ = tokio::select! {
                r = c2u => r,
                r = u2c => r,
            };
        }
        Err(e) => {
            eprintln!("[Proxy] CONNECT to {} failed: {}", target, e);
            let response = format!("HTTP/1.1 502 Bad Gateway\r\nContent-Length: {}\r\n\r\n{}", e.to_string().len(), e);
            let _ = client.write_all(response.as_bytes()).await;
        }
    }
}

async fn handle_http(request: &str, raw: &[u8], client: &mut TcpStream) {
    // For plain HTTP, extract the full URL and forward
    let first_line = request.lines().next().unwrap_or("");
    let url = first_line.split_whitespace().nth(1).unwrap_or("");

    if url.starts_with("http://") {
        // Parse host from URL
        if let Ok(parsed) = url::Url::parse(url) {
            let host = parsed.host_str().unwrap_or("");
            let port = parsed.port().unwrap_or(80);
            let target = format!("{}:{}", host, port);

            match TcpStream::connect(&target).await {
                Ok(mut upstream) => {
                    // Forward the original request
                    if upstream.write_all(raw).await.is_err() {
                        return;
                    }

                    // Relay response back
                    let mut buf = vec![0u8; 8192];
                    loop {
                        match upstream.read(&mut buf).await {
                            Ok(0) => break,
                            Ok(n) => {
                                if client.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                Err(e) => {
                    let body = format!("Proxy error: {}", e);
                    let resp = format!("HTTP/1.1 502 Bad Gateway\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                    let _ = client.write_all(resp.as_bytes()).await;
                }
            }
        }
    } else {
        let resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
        let _ = client.write_all(resp.as_bytes()).await;
    }
}
