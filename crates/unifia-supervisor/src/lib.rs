//! Ownership-checked process supervision.
//!
//! Replaces killing by image name. `taskkill /F /IM llama-server.exe` ends every
//! process with that name on the machine — including the one belonging to the
//! user's genuine OpenCode install, which shares the binary name and cannot be
//! disambiguated by renaming. Decision A3 of the rebrand plan requires that we
//! only ever terminate a process we can prove is ours.
//!
//! The proof is a lease: when a child is spawned we record its PID together with
//! its executable path and its start time, and we re-check both before acting.
//! A PID alone is not enough — PIDs are recycled, and the process wearing one
//! after a crash is usually somebody else's.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// How long a child gets to exit on its own before it is force-killed.
const DEFAULT_GRACE: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    #[error("no live process with pid {0}")]
    NotRunning(u32),
    #[error("cannot read the lease directory {path}: {source}")]
    LeaseDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("cannot write lease {nonce}: {source}")]
    LeaseWrite {
        nonce: String,
        #[source]
        source: std::io::Error,
    },
}

/// A process this application spawned and is therefore allowed to terminate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Lease {
    pub nonce: String,
    pub pid: u32,
    /// Absolute path of the running image, as the OS reports it.
    pub exe: PathBuf,
    /// Seconds since the epoch. Together with `exe` this survives PID reuse:
    /// a recycled PID belongs to a process that started later.
    pub start_time: u64,
    /// PID of the supervisor that took the lease, for diagnostics only — a
    /// crashed parent must not make its children unkillable.
    pub owner_pid: u32,
}

/// Why a lease was refused, so callers can log a reason instead of failing mutely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The live process still matches the lease: acting on it is safe.
    Owned,
    /// Nothing is running under that PID any more.
    Gone,
    /// Something is running under that PID, but it is not what we spawned.
    Impostor { running_exe: PathBuf, running_start_time: u64 },
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RecoveryReport {
    pub terminated: Vec<u32>,
    pub already_gone: Vec<u32>,
    pub refused: Vec<u32>,
}

/// The process table. Behind a trait so the ownership rules can be tested
/// against a fabricated table instead of whatever happens to run on the machine.
pub trait ProcessTable {
    fn lookup(&mut self, pid: u32) -> Option<(PathBuf, u64)>;
    fn request_stop(&mut self, pid: u32) -> bool;
    fn force_kill(&mut self, pid: u32) -> bool;
}

pub struct SystemProcessTable {
    system: System,
}

impl Default for SystemProcessTable {
    fn default() -> Self {
        Self { system: System::new() }
    }
}

impl ProcessTable for SystemProcessTable {
    fn lookup(&mut self, pid: u32) -> Option<(PathBuf, u64)> {
        let pid = Pid::from_u32(pid);
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::Always),
        );
        let process = self.system.process(pid)?;
        Some((process.exe()?.to_path_buf(), process.start_time()))
    }

    fn request_stop(&mut self, pid: u32) -> bool {
        let pid = Pid::from_u32(pid);
        self.system
            .process(pid)
            .map(|process| {
                // SIGTERM on Unix; on Windows sysinfo has no graceful variant, so
                // this is the same as force_kill and the grace period simply ends early.
                process.kill_with(sysinfo::Signal::Term).unwrap_or_else(|| process.kill())
            })
            .unwrap_or(false)
    }

    fn force_kill(&mut self, pid: u32) -> bool {
        self.system.process(Pid::from_u32(pid)).map(|process| process.kill()).unwrap_or(false)
    }
}

pub struct Supervisor<T: ProcessTable = SystemProcessTable> {
    lease_dir: PathBuf,
    table: T,
}

impl Supervisor<SystemProcessTable> {
    pub fn new(lease_dir: impl Into<PathBuf>) -> Self {
        Self { lease_dir: lease_dir.into(), table: SystemProcessTable::default() }
    }
}

impl<T: ProcessTable> Supervisor<T> {
    pub fn with_table(lease_dir: impl Into<PathBuf>, table: T) -> Self {
        Self { lease_dir: lease_dir.into(), table }
    }

    /// Records a freshly spawned child so a later run can recognise it.
    pub fn adopt(&mut self, pid: u32) -> Result<Lease, SupervisorError> {
        let (exe, start_time) = self.table.lookup(pid).ok_or(SupervisorError::NotRunning(pid))?;
        let lease = Lease {
            nonce: uuid::Uuid::new_v4().to_string(),
            pid,
            exe,
            start_time,
            owner_pid: std::process::id(),
        };
        self.write_lease(&lease)?;
        Ok(lease)
    }

    /// Is the process behind this lease still the one we spawned?
    pub fn verify(&mut self, lease: &Lease) -> Verdict {
        match self.table.lookup(lease.pid) {
            None => Verdict::Gone,
            Some((exe, start_time)) if exe == lease.exe && start_time == lease.start_time => Verdict::Owned,
            Some((exe, start_time)) => Verdict::Impostor { running_exe: exe, running_start_time: start_time },
        }
    }

    /// Asks the child to exit, then force-kills it — but only after `verify`
    /// says it is still ours. An impostor is left strictly alone.
    pub fn stop(&mut self, lease: &Lease, grace: Duration) -> Verdict {
        let verdict = self.verify(lease);
        if verdict != Verdict::Owned {
            self.forget(lease);
            return verdict;
        }
        self.table.request_stop(lease.pid);
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            if self.verify(lease) != Verdict::Owned {
                self.forget(lease);
                return Verdict::Owned;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
        // Re-verify before the forceful step: the grace period is long enough for
        // the child to exit and its PID to be handed to someone else.
        if self.verify(lease) == Verdict::Owned {
            self.table.force_kill(lease.pid);
        }
        self.forget(lease);
        Verdict::Owned
    }

    /// Terminates the leftovers of a previous run. Only leases that still match
    /// a live process are acted on; everything else is discarded untouched.
    pub fn recover_orphans(&mut self) -> Result<RecoveryReport, SupervisorError> {
        let mut report = RecoveryReport::default();
        for lease in self.read_leases()? {
            match self.verify(&lease) {
                Verdict::Owned => {
                    self.stop(&lease, DEFAULT_GRACE);
                    report.terminated.push(lease.pid);
                }
                Verdict::Gone => {
                    self.forget(&lease);
                    report.already_gone.push(lease.pid);
                }
                Verdict::Impostor { running_exe, .. } => {
                    tracing::warn!(
                        pid = lease.pid,
                        expected = %lease.exe.display(),
                        running = %running_exe.display(),
                        "refusing to kill pid: it no longer runs the image we spawned"
                    );
                    self.forget(&lease);
                    report.refused.push(lease.pid);
                }
            }
        }
        Ok(report)
    }

    fn lease_path(&self, nonce: &str) -> PathBuf {
        self.lease_dir.join(format!("{nonce}.json"))
    }

    fn write_lease(&self, lease: &Lease) -> Result<(), SupervisorError> {
        let wrap = |source| SupervisorError::LeaseWrite { nonce: lease.nonce.clone(), source };
        fs::create_dir_all(&self.lease_dir).map_err(wrap)?;
        let body = serde_json::to_vec_pretty(lease)
            .map_err(|e| wrap(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
        // Write-then-rename: a half-written lease would be unparseable on the
        // next run, and an unparseable lease means an orphan nobody can reclaim.
        let temporary = self.lease_path(&format!("{}.partial", lease.nonce));
        fs::write(&temporary, body).map_err(wrap)?;
        fs::rename(&temporary, self.lease_path(&lease.nonce)).map_err(wrap)
    }

    fn forget(&self, lease: &Lease) {
        let path = self.lease_path(&lease.nonce);
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = %path.display(), %error, "could not remove lease");
            }
        }
    }

    fn read_leases(&self) -> Result<Vec<Lease>, SupervisorError> {
        if !self.lease_dir.exists() {
            return Ok(Vec::new());
        }
        let entries = fs::read_dir(&self.lease_dir)
            .map_err(|source| SupervisorError::LeaseDir { path: self.lease_dir.clone(), source })?;
        let mut leases = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match parse_lease(&path) {
                Some(lease) => leases.push(lease),
                // A corrupt lease names a process we can no longer prove is ours,
                // so the only safe action is to drop the file and leave the
                // process running rather than guess at a PID.
                None => {
                    tracing::warn!(path = %path.display(), "discarding unreadable lease");
                    let _ = fs::remove_file(&path);
                }
            }
        }
        Ok(leases)
    }
}

fn parse_lease(path: &Path) -> Option<Lease> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Resolves the process holding a TCP port. Used to reclaim a port from a
/// previous run without knowing its PID in advance.
pub fn pid_listening_on(port: u16) -> Option<u32> {
    listeners::get_all()
        .ok()?
        .into_iter()
        .find(|listener| listener.socket.port() == port)
        .map(|listener| listener.process.pid)
}

impl<T: ProcessTable> Supervisor<T> {
    /// Frees `port`, but only if the process holding it is running exactly
    /// `expected_exe`.
    ///
    /// The alternative in use before this was `taskkill /F /IM llama-server.exe`,
    /// which ends every llama-server on the machine — the user's genuine
    /// OpenCode install runs one under the same name. Matching on the full
    /// executable path is what distinguishes our copy from theirs, since the
    /// name alone cannot.
    pub fn reclaim_port(&mut self, port: u16, expected_exe: &Path) -> Verdict {
        match pid_listening_on(port) {
            Some(pid) => self.reclaim_port_from(port, pid, expected_exe),
            None => Verdict::Gone,
        }
    }

    /// The decision half of [`Supervisor::reclaim_port`], split out so the
    /// ownership rule can be tested without a real socket.
    pub fn reclaim_port_from(&mut self, port: u16, pid: u32, expected_exe: &Path) -> Verdict {
        let Some((exe, start_time)) = self.table.lookup(pid) else {
            return Verdict::Gone;
        };
        if exe != expected_exe {
            tracing::warn!(
                port,
                pid,
                expected = %expected_exe.display(),
                running = %exe.display(),
                "refusing to free port: it is held by another product's process"
            );
            return Verdict::Impostor { running_exe: exe, running_start_time: start_time };
        }
        let lease = Lease {
            nonce: format!("port-{port}"),
            pid,
            exe,
            start_time,
            owner_pid: std::process::id(),
        };
        self.stop(&lease, DEFAULT_GRACE)
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
