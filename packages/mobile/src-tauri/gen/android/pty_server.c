/*
 * pty_server.c --- TCP PTY relay server for Android
 *
 * Compiled with Android NDK (bionic libc). Spawned from Java context via
 * ProcessBuilder inside LlamaService (Foreground Service), which gives this
 * process Seccomp: 0.  Children of forkpty() inherit Seccomp: 0, so bash
 * can freely fork()+exec() external commands (ls, cat, grep, etc.).
 *
 * This bypasses the Seccomp: 2 restriction that bun/musl processes inherit,
 * which blocks fork()/clone() syscalls and causes SIGSYS (exitCode=159).
 *
 * Protocol (TCP, one connection per action):
 *
 *   SPAWN:  Client sends JSON line:
 *     {"spawn":true,"cmdline":"bash -l","cwd":"/data/...","env":"K=V\n...","cols":80,"rows":24}
 *     Server responds: {"pid":N,"handle":H}\n
 *     Then raw bidirectional data relay until PTY exits (server closes socket).
 *
 *   RESIZE: Client sends: {"resize":H,"cols":C,"rows":R}\n
 *     Server responds: {"ok":true}\n, then closes.
 *
 *   KILL:   Client sends: {"kill":H}\n
 *     Server responds: {"ok":true}\n, then closes.
 *
 *   STATUS: Client sends: {"status":H}\n
 *     Server responds: {"exited":bool,"exitCode":N}\n, then closes.
 *
 * Usage: libpty_server.so <port> [port_file]
 *   port_file: if given, the port number is written there for bun to read.
 */

#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <pty.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define TAG "[PTY-Server] "
#define LOG(fmt, ...) fprintf(stderr, TAG fmt "\n", ##__VA_ARGS__)
#define ERR(fmt, ...) fprintf(stderr, TAG "ERROR: " fmt "\n", ##__VA_ARGS__)

#define MAX_SESSIONS 16
#define BUF_SIZE 8192

/* ── Session management ─────────────────────────────────────────────── */

typedef struct {
    int master_fd;
    int client_fd;
    pid_t child_pid;
    int exit_code;
    int exited;
    int active;
    pthread_t relay_thread;
} Session;

static Session sessions[MAX_SESSIONS];
static pthread_mutex_t sessions_lock = PTHREAD_MUTEX_INITIALIZER;

static void init_sessions(void) {
    memset(sessions, 0, sizeof(sessions));
    for (int i = 0; i < MAX_SESSIONS; i++) {
        sessions[i].master_fd = -1;
        sessions[i].client_fd = -1;
        sessions[i].child_pid = -1;
    }
}

static int alloc_session(void) {
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (!sessions[i].active) return i;
    }
    return -1;
}

/* ── Minimal JSON helpers (no library, protocol is simple) ──────────── */

static int json_extract_string(const char *json, const char *key,
                               char *out, int maxlen) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *p = strstr(json, needle);
    if (!p) return 0;
    p += strlen(needle);
    while (*p == ' ' || *p == '\t') p++;
    if (*p != '"') return 0;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < maxlen - 1) {
        if (*p == '\\' && *(p + 1)) {
            p++;
            switch (*p) {
            case 'n':  out[i++] = '\n'; break;
            case 't':  out[i++] = '\t'; break;
            case '\\': out[i++] = '\\'; break;
            case '"':  out[i++] = '"';  break;
            case '/':  out[i++] = '/';  break;
            default:   out[i++] = *p;   break;
            }
        } else {
            out[i++] = *p;
        }
        p++;
    }
    out[i] = '\0';
    return 1;
}

static int json_extract_int(const char *json, const char *key, int defval) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *p = strstr(json, needle);
    if (!p) return defval;
    p += strlen(needle);
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '"') return defval; /* string value, not int */
    return atoi(p);
}

static int json_has(const char *json, const char *key) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    return strstr(json, needle) != NULL;
}

/* Read one line (byte-by-byte to avoid over-buffering). */
static int read_line(int fd, char *buf, int maxlen) {
    int pos = 0;
    while (pos < maxlen - 1) {
        char c;
        ssize_t n = read(fd, &c, 1);
        if (n <= 0) return -1;
        if (c == '\n') break;
        if (c == '\r') continue; /* ignore CR */
        buf[pos++] = c;
    }
    buf[pos] = '\0';
    return pos;
}

/* ── Data relay (runs in a per-session thread) ──────────────────────── */

static void *relay_thread_fn(void *arg) {
    int handle = (int)(intptr_t)arg;
    Session *s = &sessions[handle];

    struct pollfd fds[2];
    fds[0].fd = s->client_fd;
    fds[0].events = POLLIN;
    fds[1].fd = s->master_fd;
    fds[1].events = POLLIN;

    char buf[BUF_SIZE];

    while (1) {
        int ret = poll(fds, 2, 500);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        /* Periodic check: did child exit? */
        if (!s->exited) {
            int status;
            pid_t w = waitpid(s->child_pid, &status, WNOHANG);
            if (w > 0) {
                if (WIFEXITED(status)) {
                    s->exited = 1;
                    s->exit_code = WEXITSTATUS(status);
                } else if (WIFSIGNALED(status)) {
                    s->exited = 1;
                    s->exit_code = 128 + WTERMSIG(status);
                }
                /* WIFSTOPPED: ignore (job control) */
            }
        }

        /* Client -> PTY */
        if (fds[0].revents & POLLIN) {
            ssize_t n = read(s->client_fd, buf, BUF_SIZE);
            if (n <= 0) {
                LOG("handle %d: client disconnected", handle);
                break;
            }
            /* Write all data to PTY master */
            ssize_t off = 0;
            while (off < n) {
                ssize_t w = write(s->master_fd, buf + off, n - off);
                if (w < 0) {
                    if (errno == EAGAIN || errno == EINTR) continue;
                    ERR("handle %d: write to PTY: %s", handle, strerror(errno));
                    break;
                }
                off += w;
            }
        }
        if (fds[0].revents & (POLLERR | POLLHUP)) {
            LOG("handle %d: client error/hangup", handle);
            break;
        }

        /* PTY -> Client */
        if (fds[1].revents & POLLIN) {
            ssize_t n = read(s->master_fd, buf, BUF_SIZE);
            if (n > 0) {
                ssize_t off = 0;
                while (off < n) {
                    ssize_t w = write(s->client_fd, buf + off, n - off);
                    if (w < 0) {
                        if (errno == EAGAIN || errno == EINTR) continue;
                        ERR("handle %d: write to client: %s", handle, strerror(errno));
                        goto relay_done;
                    }
                    off += w;
                }
            } else if (n == 0 || (n < 0 && errno == EIO)) {
                /* EOF or EIO on PTY master.
                 * This can be transient (bash forking a child), so only
                 * break if waitpid confirmed exit. */
                if (s->exited) {
                    LOG("handle %d: PTY EOF + child exited (code=%d)",
                        handle, s->exit_code);
                    break;
                }
                /* Transient --- continue polling */
            } else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
                ERR("handle %d: read from PTY: %s", handle, strerror(errno));
                if (s->exited) break;
            }
        }
        if (fds[1].revents & POLLHUP) {
            /* Drain any remaining data from PTY before closing */
            for (int drain = 0; drain < 100; drain++) {
                ssize_t n = read(s->master_fd, buf, BUF_SIZE);
                if (n > 0) {
                    write(s->client_fd, buf, n);
                } else {
                    break; /* EOF, EIO, or error --- done draining */
                }
            }
            if (!s->exited) {
                int status;
                waitpid(s->child_pid, &status, 0);
                s->exited = 1;
                s->exit_code = WIFEXITED(status)
                                   ? WEXITSTATUS(status)
                                   : (WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 1);
            }
            break;
        }
    }

relay_done:
    LOG("handle %d: relay ended (pid=%d exitCode=%d)",
        handle, s->child_pid, s->exit_code);

    /* Close client socket (signals EOF to bun) */
    if (s->client_fd >= 0) {
        shutdown(s->client_fd, SHUT_RDWR);
        close(s->client_fd);
        s->client_fd = -1;
    }
    /* Close PTY master */
    if (s->master_fd >= 0) {
        close(s->master_fd);
        s->master_fd = -1;
    }
    /* Kill child if still alive */
    if (s->child_pid > 0 && !s->exited) {
        kill(s->child_pid, SIGTERM);
        usleep(100000); /* 100ms grace */
        kill(s->child_pid, SIGKILL);
        waitpid(s->child_pid, NULL, 0);
    }

    s->active = 0;
    return NULL;
}

/* ── Command handlers ───────────────────────────────────────────────── */

static void handle_spawn(int client_fd, const char *json) {
    char cmdline[4096]   = "bash";
    char cwd[4096]       = "/";
    char env_str[131072] = "";
    int cols = 80, rows = 24;

    json_extract_string(json, "cmdline", cmdline, sizeof(cmdline));
    json_extract_string(json, "cwd", cwd, sizeof(cwd));
    json_extract_string(json, "env", env_str, sizeof(env_str));
    cols = json_extract_int(json, "cols", 80);
    rows = json_extract_int(json, "rows", 24);

    LOG("spawn: cmdline='%.80s' cwd='%.80s' cols=%d rows=%d",
        cmdline, cwd, cols, rows);

    pthread_mutex_lock(&sessions_lock);
    int handle = alloc_session();
    if (handle < 0) {
        pthread_mutex_unlock(&sessions_lock);
        const char *resp = "{\"error\":\"no free session slot\"}\n";
        write(client_fd, resp, strlen(resp));
        close(client_fd);
        return;
    }
    /* Mark active while holding lock to prevent double-allocation */
    sessions[handle].active = 1;
    sessions[handle].master_fd = -1;
    sessions[handle].client_fd = -1;
    sessions[handle].child_pid = -1;
    sessions[handle].exit_code = 0;
    sessions[handle].exited = 0;
    pthread_mutex_unlock(&sessions_lock);

    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
    };

    int master_fd;
    pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);
    if (pid < 0) {
        ERR("spawn: forkpty failed: %s (errno=%d)", strerror(errno), errno);
        char resp[256];
        snprintf(resp, sizeof(resp),
                 "{\"error\":\"forkpty: %s\"}\n", strerror(errno));
        write(client_fd, resp, strlen(resp));
        close(client_fd);
        sessions[handle].active = 0;
        return;
    }

    if (pid == 0) {
        /* ── Child process ────────────────────────────────────────── */
        /* Apply environment variables (newline-separated KEY=VAL) */
        if (*env_str) {
            char *line = env_str;
            while (line && *line) {
                char *nl = strchr(line, '\n');
                if (nl) *nl = '\0';
                if (*line && strchr(line, '=')) {
                    putenv(strdup(line));
                }
                if (nl) line = nl + 1;
                else break;
            }
        }

        if (*cwd) chdir(cwd);

        /* Parse cmdline into argv (space-separated, strip quotes) */
        char *cmd_copy = strdup(cmdline);
        char *args[64];
        int argc = 0;
        char *tok = strtok(cmd_copy, " ");
        while (tok && argc < 63) {
            size_t tlen = strlen(tok);
            if (tlen >= 2 &&
                ((tok[0] == '\'' && tok[tlen - 1] == '\'') ||
                 (tok[0] == '"'  && tok[tlen - 1] == '"'))) {
                tok[tlen - 1] = '\0';
                tok++;
            }
            args[argc++] = tok;
            tok = strtok(NULL, " ");
        }
        args[argc] = NULL;

        if (argc > 0) {
            execvp(args[0], args);
            /* Only reached if exec fails */
            fprintf(stderr, TAG "child: execvp '%s' failed: %s\n",
                    args[0], strerror(errno));
        }
        _exit(127);
    }

    /* ── Parent process ───────────────────────────────────────────── */
    LOG("spawn: forkpty ok, pid=%d handle=%d master_fd=%d", pid, handle, master_fd);

    /* Set master fd to non-blocking */
    int flags = fcntl(master_fd, F_GETFL, 0);
    if (flags >= 0) fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    Session *s = &sessions[handle];
    s->master_fd  = master_fd;
    s->client_fd  = client_fd;
    s->child_pid  = pid;
    s->exit_code  = 0;
    s->exited     = 0;

    /* Send JSON response */
    char resp[256];
    snprintf(resp, sizeof(resp), "{\"pid\":%d,\"handle\":%d}\n", pid, handle);
    write(client_fd, resp, strlen(resp));

    /* Start relay thread (takes ownership of client_fd) */
    pthread_create(&s->relay_thread, NULL, relay_thread_fn,
                   (void *)(intptr_t)handle);
    pthread_detach(s->relay_thread);
}

static void handle_resize(int client_fd, const char *json) {
    int handle = json_extract_int(json, "resize", -1);
    int cols   = json_extract_int(json, "cols", 80);
    int rows   = json_extract_int(json, "rows", 24);

    pthread_mutex_lock(&sessions_lock);
    if (handle >= 0 && handle < MAX_SESSIONS && sessions[handle].active &&
        sessions[handle].master_fd >= 0) {
        struct winsize ws = {
            .ws_row = (unsigned short)rows,
            .ws_col = (unsigned short)cols,
        };
        int mfd = sessions[handle].master_fd;
        pid_t cpid = sessions[handle].child_pid;
        pthread_mutex_unlock(&sessions_lock);

        ioctl(mfd, TIOCSWINSZ, &ws);
        /* Also send SIGWINCH to the child process group */
        if (cpid > 0) {
            kill(-cpid, SIGWINCH);
        }
        LOG("resize: handle=%d cols=%d rows=%d", handle, cols, rows);
        const char *resp = "{\"ok\":true}\n";
        write(client_fd, resp, strlen(resp));
    } else {
        pthread_mutex_unlock(&sessions_lock);
        const char *resp = "{\"error\":\"invalid handle\"}\n";
        write(client_fd, resp, strlen(resp));
    }
    close(client_fd);
}

static void handle_kill(int client_fd, const char *json) {
    int handle = json_extract_int(json, "kill", -1);

    pthread_mutex_lock(&sessions_lock);
    if (handle >= 0 && handle < MAX_SESSIONS && sessions[handle].active &&
        sessions[handle].child_pid > 0) {
        pid_t cpid = sessions[handle].child_pid;
        pthread_mutex_unlock(&sessions_lock);

        kill(cpid, SIGKILL);
        LOG("kill: handle=%d pid=%d", handle, cpid);
        const char *resp = "{\"ok\":true}\n";
        write(client_fd, resp, strlen(resp));
    } else {
        pthread_mutex_unlock(&sessions_lock);
        const char *resp = "{\"error\":\"invalid handle\"}\n";
        write(client_fd, resp, strlen(resp));
    }
    close(client_fd);
}

static void handle_status(int client_fd, const char *json) {
    int handle = json_extract_int(json, "status", -1);
    char resp[256];

    pthread_mutex_lock(&sessions_lock);
    if (handle >= 0 && handle < MAX_SESSIONS) {
        Session *s = &sessions[handle];
        /* Do a non-blocking waitpid in case relay thread hasn't caught it yet */
        if (s->active && !s->exited && s->child_pid > 0) {
            int status;
            pid_t w = waitpid(s->child_pid, &status, WNOHANG);
            if (w > 0) {
                s->exited = 1;
                s->exit_code = WIFEXITED(status)
                    ? WEXITSTATUS(status)
                    : (WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 1);
            }
        }
        int exited = s->exited;
        int exit_code = s->exit_code;
        pthread_mutex_unlock(&sessions_lock);

        snprintf(resp, sizeof(resp),
                 "{\"exited\":%s,\"exitCode\":%d}\n",
                 exited ? "true" : "false", exit_code);
    } else {
        pthread_mutex_unlock(&sessions_lock);
        snprintf(resp, sizeof(resp), "{\"exited\":true,\"exitCode\":-1}\n");
    }
    write(client_fd, resp, strlen(resp));
    close(client_fd);
}

/* ── Connection dispatcher ──────────────────────────────────────────── */

static void *connection_handler(void *arg) {
    int client_fd = (int)(intptr_t)arg;

    char line[131072];
    int len = read_line(client_fd, line, sizeof(line));
    if (len <= 0) {
        close(client_fd);
        return NULL;
    }

    if (json_has(line, "spawn")) {
        handle_spawn(client_fd, line); /* takes ownership of fd */
    } else if (json_has(line, "resize")) {
        handle_resize(client_fd, line);
    } else if (json_has(line, "kill")) {
        handle_kill(client_fd, line);
    } else if (json_has(line, "status")) {
        handle_status(client_fd, line);
    } else {
        const char *resp = "{\"error\":\"unknown command\"}\n";
        write(client_fd, resp, strlen(resp));
        close(client_fd);
    }

    return NULL;
}

/* ── Main ───────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    int port = argc > 1 ? atoi(argv[1]) : 14098;

    signal(SIGPIPE, SIG_IGN);
    signal(SIGCHLD, SIG_DFL); /* let waitpid work */

    init_sessions();

    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        ERR("socket: %s", strerror(errno));
        return 1;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* 127.0.0.1 only */
    addr.sin_port        = htons(port);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        ERR("bind port %d: %s", port, strerror(errno));
        close(server_fd);
        return 1;
    }

    if (listen(server_fd, 8) < 0) {
        ERR("listen: %s", strerror(errno));
        close(server_fd);
        return 1;
    }

    LOG("listening on 127.0.0.1:%d (pid=%d)", port, getpid());

    /* Write port to file so bun can discover it */
    if (argc > 2) {
        FILE *f = fopen(argv[2], "w");
        if (f) {
            fprintf(f, "%d", port);
            fclose(f);
            LOG("port written to %s", argv[2]);
        }
    }

    /* Accept loop */
    while (1) {
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd < 0) {
            if (errno == EINTR) continue;
            ERR("accept: %s", strerror(errno));
            continue;
        }

        /* Disable Nagle for low-latency terminal I/O */
        int nodelay = 1;
        setsockopt(client_fd, IPPROTO_TCP, TCP_NODELAY,
                   &nodelay, sizeof(nodelay));

        pthread_t th;
        pthread_create(&th, NULL, connection_handler,
                       (void *)(intptr_t)client_fd);
        pthread_detach(th);
    }

    close(server_fd);
    return 0;
}
