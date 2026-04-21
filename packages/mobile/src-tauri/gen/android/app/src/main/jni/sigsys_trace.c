/*
 * sigsys_trace.c --- LD_PRELOAD shim that logs SIGSYS events to a FILE
 * (not stderr) so they survive forkpty redirection to the pseudo-TTY.
 *
 * Constructor opens /data/data/ai.opencode.mobile/tmp/sigsys.log in
 * O_CREAT|O_APPEND|O_WRONLY mode and stores the fd.  Both the ctor
 * (proof-of-load) and the SIGSYS handler (syscall number) write to
 * this fd.  Pull with `adb pull`.
 *
 * If the file doesn't exist after reproduction, LD_PRELOAD is not
 * being respected by the bionic linker for this binary — that is
 * itself a valuable data point (we'd then need ptrace from parent).
 */

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define LOG_DIR  "/data/data/ai.opencode.mobile/tmp"
#define LOG_PATH LOG_DIR "/sigsys.log"

static int log_fd = -1;

/* ── Async-signal-safe writers ──────────────────────────────────── */

static void write_s(const char *s) {
    if (log_fd < 0) return;
    size_t n = 0;
    while (s[n] != '\0') n++;
    (void)write(log_fd, s, n);
}

static void write_i(long v) {
    if (log_fd < 0) return;
    char buf[24];
    int i = 23;
    int neg = 0;
    buf[i--] = '\0';
    if (v < 0) { neg = 1; v = -v; }
    if (v == 0) { buf[i--] = '0'; }
    while (v > 0 && i >= 0) {
        buf[i--] = (char)('0' + (int)(v % 10));
        v /= 10;
    }
    if (neg && i >= 0) buf[i--] = '-';
    (void)write(log_fd, buf + i + 1, 23 - (i + 1));
}

static void write_h(unsigned long v) {
    if (log_fd < 0) return;
    char buf[24];
    int i = 23;
    buf[i--] = '\0';
    if (v == 0) { buf[i--] = '0'; }
    while (v > 0 && i >= 0) {
        int d = (int)(v & 0xf);
        buf[i--] = (char)(d < 10 ? ('0' + d) : ('a' + d - 10));
        v >>= 4;
    }
    (void)write(log_fd, "0x", 2);
    (void)write(log_fd, buf + i + 1, 23 - (i + 1));
}

/* ── SIGSYS handler (async-signal-safe) ─────────────────────────── */

static void sigsys_handler(int sig, siginfo_t *info, void *ctx) {
    (void)sig; (void)ctx;
    /* Re-open the log file in the handler because target binaries (toybox,
     * bash, busybox) often close all fds > 2 during init, which invalidates
     * our constructor-opened log_fd. open(2) is async-signal-safe. */
    int fd = open(LOG_PATH, O_CREAT | O_APPEND | O_WRONLY, 0644);
    if (fd < 0) {
        fd = open("/data/user/0/ai.opencode.mobile/runtime/sigsys.log",
                  O_CREAT | O_APPEND | O_WRONLY, 0644);
    }
    if (fd >= 0) {
        /* Temporarily swap log_fd so write_* helpers target this fresh fd. */
        int saved = log_fd;
        log_fd = fd;
        write_s("[sigsys] syscall=");
        write_i(info->si_syscall);
        write_s(" arch=");
        write_i((long)(unsigned)info->si_arch);
        write_s(" errno=");
        write_i(info->si_errno);
        write_s(" addr=");
        write_h((unsigned long)info->si_call_addr);
        write_s(" pid=");
        write_i(getpid());
        write_s("\n");
        close(fd);
        log_fd = saved;
    }
    /* Exit cleanly (159 = 128+31). */
    _exit(159);
}

/* ── Constructor (runs at .so load time, before target main()) ── */

__attribute__((constructor(101)))
static void install_sigsys_handler(void) {
    /* Ensure dir exists (ignore errors — racy with concurrent ctors). */
    (void)mkdir(LOG_DIR, 0755);

    /* Note: NO O_CLOEXEC — the fd must survive into the handler if the
     * target binary does any exec dance. Signal handlers fire in the same
     * process so fd stays valid regardless of CLOEXEC. */
    log_fd = open(LOG_PATH,
                  O_CREAT | O_APPEND | O_WRONLY,
                  0644);
    if (log_fd < 0) {
        log_fd = open("/data/user/0/ai.opencode.mobile/runtime/sigsys.log",
                      O_CREAT | O_APPEND | O_WRONLY,
                      0644);
    }

    /* Install SIGSYS handler FIRST — before the target's main() runs, before
     * any target code can install its own handler. Constructor priority 101
     * ensures we run early among user constructors. */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = sigsys_handler;
    sa.sa_flags = SA_SIGINFO | SA_NODEFER;
    sigemptyset(&sa.sa_mask);
    int rc = sigaction(SIGSYS, &sa, NULL);

    write_s("[ctor] pid=");
    write_i(getpid());
    write_s(" ppid=");
    write_i(getppid());
    write_s(" sigaction=");
    write_i(rc);

    char self_exe[256];
    ssize_t elen = readlink("/proc/self/exe", self_exe, sizeof(self_exe) - 1);
    if (elen > 0) {
        self_exe[elen] = '\0';
        write_s(" exe=");
        write_s(self_exe);
    }
    write_s("\n");

    /* Double-install after writing log — in case target main() calls
     * sigaction(SIGSYS, SIG_DFL) during startup. We re-arm after a short
     * yield to likely happen after target's init. Spawn a pthread for this. */
}

/* Re-install handler periodically via a pthread, defeating any target
 * binary that resets SIGSYS to SIG_DFL during init. This is crude but
 * effective for diagnostic purposes. */
static void *reinstaller_thread(void *arg) {
    (void)arg;
    for (int i = 0; i < 50; i++) {
        struct timespec ts = { .tv_sec = 0, .tv_nsec = 10 * 1000 * 1000 }; /* 10ms */
        nanosleep(&ts, NULL);
        struct sigaction sa;
        memset(&sa, 0, sizeof(sa));
        sa.sa_sigaction = sigsys_handler;
        sa.sa_flags = SA_SIGINFO | SA_NODEFER;
        sigemptyset(&sa.sa_mask);
        (void)sigaction(SIGSYS, &sa, NULL);
    }
    return NULL;
}

__attribute__((constructor(102)))
static void start_reinstaller(void) {
    pthread_t th;
    if (pthread_create(&th, NULL, reinstaller_thread, NULL) == 0) {
        pthread_detach(th);
    }
}
