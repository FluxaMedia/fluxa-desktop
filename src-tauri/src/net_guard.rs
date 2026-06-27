use std::net::IpAddr;

fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || (v4.octets()[0] == 100 && (64..=127).contains(&v4.octets()[1]))
            // CGNAT 100.64.0.0/10
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

/// Resolves `url`'s host and rejects it if any resolved address is loopback/private/
/// link-local -- addon-supplied URLs are otherwise free to point at internal services.
pub async fn ensure_public_host(url_str: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(url_str).map_err(|_| "invalid url".to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported scheme: {other}")),
    }
    let host = url
        .host_str()
        .ok_or_else(|| "url has no host".to_string())?;
    let port = url.port_or_known_default().unwrap_or(80);
    let mut addrs = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("dns lookup failed: {e}"))?
        .peekable();
    if addrs.peek().is_none() {
        return Err("dns lookup returned no addresses".to_string());
    }
    for addr in addrs {
        if is_blocked_ip(&addr.ip()) {
            return Err("refusing to fetch a local/private address".to_string());
        }
    }
    Ok(())
}
