use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

const TERMUX_PACKAGE: &str = "com.termux";
const DEFAULT_PORT: u32 = 14096;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TermuxInfo {
    pub installed: bool,
    pub server_running: bool,
    pub port: u32,
    pub bun_available: bool,
}

/// Check if Termux is installed and if a local server is already running.
#[tauri::command]
pub async fn check_termux() -> TermuxInfo {
    let installed = is_termux_installed();
    let port = DEFAULT_PORT;
    let server_running = if installed {
        check_health(port, None).await
    } else {
        false
    };

    TermuxInfo {
        installed,
        server_running,
        port,
        bun_available: installed, // If Termux is installed, assume setup was done
    }
}

/// Launch the OpenCode server inside Termux via Android intent.
///
/// Uses `am` (Activity Manager) to send a RUN_COMMAND intent to Termux.
/// Requires `allow-external-apps = true` in `~/.termux/termux.properties`.
#[tauri::command]
pub async fn launch_termux_server(port: u32, password: String) -> Result<(), String> {
    // Build the command to run inside Termux
    let server_cmd = format!(
        "export OPENCODE_SERVER_USERNAME=opencode && export OPENCODE_SERVER_PASSWORD={} && export PATH=$HOME/.bun/bin:$PATH && opencode serve --hostname 127.0.0.1 --port {}",
        password, port
    );

    // Use am start with RUN_COMMAND action
    let output = Command::new("am")
        .args([
            "startservice",
            "-n",
            "com.termux/.app.RunCommandService",
            "-a",
            "com.termux.RUN_COMMAND",
            "--es",
            "com.termux.RUN_COMMAND_PATH",
            "/data/data/com.termux/files/usr/bin/bash",
            "--esa",
            "com.termux.RUN_COMMAND_ARGUMENTS",
            &format!("-c,{}", server_cmd),
            "--ez",
            "com.termux.RUN_COMMAND_BACKGROUND",
            "true",
        ])
        .output()
        .map_err(|e| format!("Failed to launch Termux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Fallback: try opening Termux activity directly with the command
        let fallback = Command::new("am")
            .args([
                "start",
                "-n",
                "com.termux/.app.TermuxActivity",
                "-a",
                "android.intent.action.MAIN",
            ])
            .output()
            .map_err(|e| format!("Failed to open Termux: {}", e))?;

        if !fallback.status.success() {
            return Err(format!(
                "Failed to launch Termux server. Service error: {}",
                stderr
            ));
        }

        // Termux activity opened — user needs to run the command manually
        return Err("Termux opened but RUN_COMMAND failed. Please run the server manually in Termux.".to_string());
    }

    Ok(())
}

/// Check if the local OpenCode server is healthy.
#[tauri::command]
pub async fn check_local_health(port: u32, password: Option<String>) -> bool {
    check_health(port, password.as_deref()).await
}

/// Open Termux app for manual setup (install bun, opencode, etc.)
#[tauri::command]
pub fn open_termux_setup() -> Result<(), String> {
    let output = Command::new("am")
        .args([
            "start",
            "-n",
            "com.termux/.app.TermuxActivity",
            "-a",
            "android.intent.action.MAIN",
        ])
        .output()
        .map_err(|e| format!("Failed to open Termux: {}", e))?;

    if !output.status.success() {
        return Err("Failed to open Termux. Is it installed?".to_string());
    }

    Ok(())
}

/// Stop the local OpenCode server by sending a dispose request.
#[tauri::command]
pub async fn stop_local_server(port: u32, password: Option<String>) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/instance/dispose", port);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut req = client.post(&url);
    if let Some(ref pw) = password {
        req = req.basic_auth("opencode", Some(pw));
    }

    req.send()
        .await
        .map_err(|e| format!("Failed to stop server: {}", e))?;

    Ok(())
}

// ─── Internal ───────────────────────────────────────────────────────

fn is_termux_installed() -> bool {
    Command::new("pm")
        .args(["list", "packages", TERMUX_PACKAGE])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(TERMUX_PACKAGE))
        .unwrap_or(false)
}

async fn check_health(port: u32, password: Option<&str>) -> bool {
    let url = format!("http://127.0.0.1:{}/global/health", port);

    let client = match reqwest::Client::builder()
        .timeout(HEALTH_CHECK_TIMEOUT)
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let mut req = client.get(&url);
    if let Some(pw) = password {
        req = req.basic_auth("opencode", Some(pw));
    }

    match req.send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}
