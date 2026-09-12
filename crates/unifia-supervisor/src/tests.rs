//! The ownership rules, exercised against a fabricated process table.
//!
//! A real one cannot express the cases that matter — a recycled PID, a lease
//! forged against another product's binary, a parent that died without cleaning
//! up — and those are exactly the cases where killing the wrong process hurts
//! somebody else's application.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;

const NO_GRACE: Duration = Duration::from_millis(0);

#[derive(Default)]
struct FakeTable {
    /// pid -> (executable, start time)
    live: HashMap<u32, (PathBuf, u64)>,
    stop_requests: Vec<u32>,
    force_kills: Vec<u32>,
    /// Pids the OS refuses to signal, standing in for "access denied".
    unkillable: Vec<u32>,
}

impl FakeTable {
    fn with(pid: u32, exe: &str, start_time: u64) -> Self {
        let mut table = Self::default();
        table.spawn(pid, exe, start_time);
        table
    }

    fn spawn(&mut self, pid: u32, exe: &str, start_time: u64) {
        self.live.insert(pid, (PathBuf::from(exe), start_time));
    }
}

impl ProcessTable for FakeTable {
    fn lookup(&mut self, pid: u32) -> Option<(PathBuf, u64)> {
        self.live.get(&pid).cloned()
    }

    fn request_stop(&mut self, pid: u32) -> bool {
        self.stop_requests.push(pid);
        if self.unkillable.contains(&pid) {
            return false;
        }
        self.live.remove(&pid).is_some()
    }

    fn force_kill(&mut self, pid: u32) -> bool {
        self.force_kills.push(pid);
        if self.unkillable.contains(&pid) {
            return false;
        }
        self.live.remove(&pid).is_some()
    }
}

fn supervisor(table: FakeTable) -> (Supervisor<FakeTable>, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("temp dir");
    (Supervisor::with_table(dir.path().join("leases"), table), dir)
}

#[test]
fn adopt_records_the_running_image_and_start_time() {
    let (mut sup, _dir) = supervisor(FakeTable::with(4242, "/opt/unifia/unifia-cli", 1_000));
    let lease = sup.adopt(4242).expect("adopt");

    assert_eq!(lease.pid, 4242);
    assert_eq!(lease.exe, PathBuf::from("/opt/unifia/unifia-cli"));
    assert_eq!(lease.start_time, 1_000);
    assert_eq!(sup.verify(&lease), Verdict::Owned);
}

#[test]
fn adopt_refuses_a_pid_that_is_not_running() {
    let (mut sup, _dir) = supervisor(FakeTable::default());
    assert!(matches!(sup.adopt(4242), Err(SupervisorError::NotRunning(4242))));
}

#[test]
fn a_recycled_pid_is_not_ours() {
    let (mut sup, _dir) = supervisor(FakeTable::with(4242, "/opt/unifia/unifia-cli", 1_000));
    let lease = sup.adopt(4242).expect("adopt");

    // Our child exits and the OS hands 4242 to something else that happens to
    // run the same binary — only the start time gives it away.
    sup.table.live.insert(4242, (PathBuf::from("/opt/unifia/unifia-cli"), 2_000));

    assert_eq!(
        sup.verify(&lease),
        Verdict::Impostor { running_exe: PathBuf::from("/opt/unifia/unifia-cli"), running_start_time: 2_000 }
    );
}

#[test]
fn a_same_named_binary_from_another_product_is_left_alone() {
    // The case that motivated this module: llama-server exists under both
    // Unifia and the user's genuine OpenCode install.
    let (mut sup, _dir) = supervisor(FakeTable::with(77, "/opt/unifia/llama-server", 500));
    let lease = sup.adopt(77).expect("adopt");
    sup.table.live.insert(77, (PathBuf::from("/opt/opencode/llama-server"), 500));

    assert!(matches!(sup.verify(&lease), Verdict::Impostor { .. }));

    sup.stop(&lease, NO_GRACE);
    assert!(sup.table.stop_requests.is_empty(), "an impostor must never be signalled");
    assert!(sup.table.force_kills.is_empty(), "an impostor must never be force-killed");
    assert!(sup.table.live.contains_key(&77), "the other product's process must survive");
}

#[test]
fn stop_asks_before_forcing() {
    let (mut sup, _dir) = supervisor(FakeTable::with(9, "/opt/unifia/unifia-cli", 1));
    let lease = sup.adopt(9).expect("adopt");

    assert_eq!(sup.stop(&lease, Duration::from_secs(1)), Verdict::Owned);
    assert_eq!(sup.table.stop_requests, vec![9]);
    assert!(sup.table.force_kills.is_empty(), "a child that exits on request must not be force-killed");
}

#[test]
fn stop_forces_a_child_that_ignores_the_request() {
    let mut table = FakeTable::with(9, "/opt/unifia/unifia-cli", 1);
    table.unkillable.push(9);
    let (mut sup, _dir) = supervisor(table);
    let lease = sup.adopt(9).expect("adopt");

    sup.stop(&lease, NO_GRACE);

    assert_eq!(sup.table.stop_requests, vec![9]);
    assert_eq!(sup.table.force_kills, vec![9], "an unresponsive child must reach the forceful step");
}

#[test]
fn stopping_an_already_dead_child_is_not_an_error() {
    let (mut sup, _dir) = supervisor(FakeTable::with(9, "/opt/unifia/unifia-cli", 1));
    let lease = sup.adopt(9).expect("adopt");
    sup.table.live.remove(&9);

    assert_eq!(sup.stop(&lease, NO_GRACE), Verdict::Gone);
    assert!(sup.table.force_kills.is_empty());
}

#[test]
fn recovery_terminates_our_orphans_and_spares_everything_else() {
    let mut table = FakeTable::default();
    table.spawn(1, "/opt/unifia/unifia-cli", 10);
    table.spawn(2, "/opt/unifia/llama-server", 20);
    table.spawn(3, "/opt/unifia/unifia-cli", 30);
    let (mut sup, _dir) = supervisor(table);

    let ours = sup.adopt(1).expect("adopt");
    let recycled = sup.adopt(3).expect("adopt");
    let gone = sup.adopt(2).expect("adopt");

    // pid 3 gets recycled by an unrelated process, pid 2 simply exits.
    sup.table.live.insert(3, (PathBuf::from("/usr/bin/some-editor"), 99));
    sup.table.live.remove(&2);

    let report = sup.recover_orphans().expect("recover");

    assert_eq!(report.terminated, vec![ours.pid]);
    assert_eq!(report.already_gone, vec![gone.pid]);
    assert_eq!(report.refused, vec![recycled.pid]);
    assert!(sup.table.live.contains_key(&3), "the unrelated process must still be running");
}

#[test]
fn a_dead_parent_does_not_make_its_children_unreclaimable() {
    let (mut sup, dir) = supervisor(FakeTable::with(5, "/opt/unifia/unifia-cli", 7));
    let lease = sup.adopt(5).expect("adopt");
    assert_ne!(lease.owner_pid, 0);

    // A fresh supervisor, as after a crash: same lease directory, new owner.
    let mut next = Supervisor::with_table(dir.path().join("leases"), {
        let mut table = FakeTable::default();
        table.spawn(5, "/opt/unifia/unifia-cli", 7);
        table
    });

    let report = next.recover_orphans().expect("recover");
    assert_eq!(report.terminated, vec![5]);
}

#[test]
fn a_forged_lease_naming_another_products_binary_is_refused() {
    let dir = tempfile::tempdir().expect("temp dir");
    let lease_dir = dir.path().join("leases");
    std::fs::create_dir_all(&lease_dir).expect("mkdir");
    let forged = Lease {
        nonce: "forged".into(),
        pid: 1234,
        exe: PathBuf::from("/opt/opencode/opencode-cli"),
        start_time: 1,
        owner_pid: 1,
    };
    std::fs::write(lease_dir.join("forged.json"), serde_json::to_vec(&forged).unwrap()).expect("write");

    let mut table = FakeTable::default();
    // The victim is running, but from a different image than the lease claims.
    table.spawn(1234, "/usr/bin/postgres", 1);
    let mut sup = Supervisor::with_table(&lease_dir, table);

    let report = sup.recover_orphans().expect("recover");
    assert_eq!(report.refused, vec![1234]);
    assert!(sup.table.live.contains_key(&1234));
}

#[test]
fn an_unreadable_lease_is_dropped_without_killing_anything() {
    let dir = tempfile::tempdir().expect("temp dir");
    let lease_dir = dir.path().join("leases");
    std::fs::create_dir_all(&lease_dir).expect("mkdir");
    std::fs::write(lease_dir.join("truncated.json"), b"{\"pid\": 12").expect("write");

    let mut sup = Supervisor::with_table(&lease_dir, FakeTable::with(12, "/opt/unifia/unifia-cli", 1));
    let report = sup.recover_orphans().expect("recover");

    assert_eq!(report, RecoveryReport::default(), "a corrupt lease authorises nothing");
    assert!(sup.table.live.contains_key(&12));
    assert!(!lease_dir.join("truncated.json").exists(), "the corrupt lease should not be retried forever");
}

#[test]
fn two_supervisors_do_not_reclaim_each_others_children() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut first = Supervisor::with_table(dir.path().join("a"), FakeTable::with(100, "/opt/unifia/unifia-cli", 1));
    let mut second = Supervisor::with_table(dir.path().join("b"), FakeTable::with(200, "/opt/unifia/unifia-cli", 2));
    first.adopt(100).expect("adopt");
    second.adopt(200).expect("adopt");

    let report = first.recover_orphans().expect("recover");

    assert_eq!(report.terminated, vec![100]);
    assert!(second.table.live.contains_key(&200), "the other instance's child must survive");
}

#[test]
fn reclaiming_a_port_held_by_another_product_is_refused() {
    // llama-server listens on 14097 for both products; only the path differs.
    let (mut sup, _dir) = supervisor(FakeTable::with(31, "/opt/opencode/llama-server", 4));

    let verdict = sup.reclaim_port_from(14097, 31, Path::new("/opt/unifia/llama-server"));

    assert!(matches!(verdict, Verdict::Impostor { .. }));
    assert!(sup.table.force_kills.is_empty());
    assert!(sup.table.live.contains_key(&31), "the other product's server must keep the port");
}

#[test]
fn reclaiming_a_port_held_by_our_own_binary_succeeds() {
    let (mut sup, _dir) = supervisor(FakeTable::with(31, "/opt/unifia/llama-server", 4));

    let verdict = sup.reclaim_port_from(14097, 31, Path::new("/opt/unifia/llama-server"));

    assert_eq!(verdict, Verdict::Owned);
    assert_eq!(sup.table.stop_requests, vec![31]);
    assert!(!sup.table.live.contains_key(&31));
}

#[test]
fn reclaiming_a_port_nobody_holds_is_a_no_op() {
    let (mut sup, _dir) = supervisor(FakeTable::default());
    assert_eq!(sup.reclaim_port_from(14097, 31, Path::new("/opt/unifia/llama-server")), Verdict::Gone);
    assert!(sup.table.force_kills.is_empty());
}

#[test]
fn missing_lease_directory_recovers_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut sup = Supervisor::with_table(dir.path().join("never-created"), FakeTable::default());
    assert_eq!(sup.recover_orphans().expect("recover"), RecoveryReport::default());
}
