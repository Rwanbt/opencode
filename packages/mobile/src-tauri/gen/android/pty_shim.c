/*
 * Minimal PTY shim for Android (bionic libc).
 * Implements the bun-pty FFI interface (8 functions) using forkpty().
 * Compiled with Android NDK for aarch64-linux-android.
 *
 * bionic provides forkpty() since API 23 in <pty.h>.
 */
#include <errno.h>
#include <fcntl.h>
#include <pty.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#define PTAG "[OpenCode-PTY] "
#define PLOG(fmt, ...) fprintf(stderr, PTAG fmt "\n", ##__VA_ARGS__)
#define PERR(fmt, ...) fprintf(stderr, PTAG "ERROR: " fmt "\n", ##__VA_ARGS__)
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define MAX_PTYS 64
#define CHILD_EXITED -2

typedef struct {
    int master_fd;
    pid_t child_pid;
    int exit_code;
    int exited;
} PtyHandle;

static PtyHandle ptys[MAX_PTYS];
static int pty_init = 0;

static void ensure_init(void) {
    if (!pty_init) {
        memset(ptys, 0, sizeof(ptys));
        for (int i = 0; i < MAX_PTYS; i++) {
            ptys[i].master_fd = -1;
            ptys[i].child_pid = -1;
        }
        /* Ignore SIGCHLD to avoid zombie processes and allow waitpid in read */
        signal(SIGPIPE, SIG_IGN);
        pty_init = 1;
    }
}

static int alloc_slot(void) {
    for (int i = 0; i < MAX_PTYS; i++) {
        if (ptys[i].master_fd == -1) return i;
    }
    return -1;
}

/* Parse null-separated "KEY=VAL\0KEY=VAL\0\0" env string into envp array */
static char **parse_env(const char *env_str) {
    if (!env_str || !*env_str) return NULL;
    /* Count entries */
    int count = 0;
    const char *p = env_str;
    while (*p) {
        count++;
        p += strlen(p) + 1;
    }
    char **envp = calloc(count + 1, sizeof(char *));
    p = env_str;
    for (int i = 0; i < count; i++) {
        envp[i] = (char *)p;
        p += strlen(p) + 1;
    }
    envp[count] = NULL;
    return envp;
}

/*
 * bun_pty_spawn(cmdline, cwd, env, cols, rows) -> handle (slot index) or -1
 *
 * cmdline: the shell path (e.g., "/data/.../bin/bash")
 * cwd: working directory
 * env: newline-separated "KEY=VAL\nKEY=VAL\n" string
 */
int bun_pty_spawn(const char *cmdline, const char *cwd,
                  const char *env_str, int cols, int rows) {
    ensure_init();
    PLOG("spawn: cmdline='%s' cwd='%s' cols=%d rows=%d", cmdline ? cmdline : "(null)", cwd ? cwd : "(null)", cols, rows);

    int slot = alloc_slot();
    if (slot < 0) {
        PERR("spawn: no free slot");
        return -1;
    }

    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
    };

    int master_fd;
    pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);
    if (pid < 0) {
        PERR("spawn: forkpty failed: %s (errno=%d)", strerror(errno), errno);
        return -1;
    }
    PLOG("spawn: forkpty ok, pid=%d master_fd=%d slot=%d", pid, master_fd, slot);

    if (pid == 0) {
        /* Child process */
        /* Set up environment from newline-separated string */
        if (env_str && *env_str) {
            /* Parse newline-separated env vars */
            char *env_copy = strdup(env_str);
            char *line = env_copy;
            while (line && *line) {
                char *nl = strchr(line, '\n');
                if (nl) *nl = '\0';
                if (*line && strchr(line, '=')) {
                    putenv(strdup(line));
                }
                if (nl) line = nl + 1;
                else break;
            }
            free(env_copy);
        }

        if (cwd && *cwd) {
            chdir(cwd);
        }

        /* Execute the shell */
        if (cmdline && *cmdline) {
            /* Split cmdline by spaces and strip surrounding quotes from each token */
            char *cmd_copy = strdup(cmdline);
            char *args[64];
            int argc = 0;
            char *tok = strtok(cmd_copy, " ");
            while (tok && argc < 63) {
                /* Strip surrounding single or double quotes */
                size_t tlen = strlen(tok);
                if (tlen >= 2 &&
                    ((tok[0] == '\'' && tok[tlen-1] == '\'') ||
                     (tok[0] == '"'  && tok[tlen-1] == '"'))) {
                    tok[tlen-1] = '\0';
                    tok++;
                }
                args[argc++] = tok;
                tok = strtok(NULL, " ");
            }
            args[argc] = NULL;

            if (argc > 0) {
                PLOG("child: execvp '%s' argc=%d", args[0], argc);
                execvp(args[0], args);
                /* Only reached if exec fails */
                PERR("child: execvp FAILED: %s (errno=%d)", strerror(errno), errno);
            }
        }
        /* If exec fails */
        _exit(127);
    }

    /* Parent process */
    /* Set master fd to non-blocking for read */
    int flags = fcntl(master_fd, F_GETFL, 0);
    if (flags >= 0) {
        fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);
    }

    ptys[slot].master_fd = master_fd;
    ptys[slot].child_pid = pid;
    ptys[slot].exit_code = 0;
    ptys[slot].exited = 0;

    return slot;
}

/*
 * bun_pty_read(handle, buf, len) -> bytes read, 0 if no data, -2 if exited, -1 on error
 *
 * CRITICAL: On a PTY, read(master) can return 0 (EOF) or EIO transiently when
 * bash forks a child process. This does NOT mean bash exited. We must ONLY
 * return CHILD_EXITED when waitpid confirms bash is truly dead.
 */
int bun_pty_read(int handle, char *buf, int len) {
    if (handle < 0 || handle >= MAX_PTYS || ptys[handle].master_fd < 0)
        return -1;

    PtyHandle *h = &ptys[handle];

    /* Fast path: try to read data */
    ssize_t n = read(h->master_fd, buf, len);
    if (n > 0) return (int)n;

    /* No data — check if child actually exited (non-blocking) */
    if (!h->exited) {
        int status;
        pid_t w = waitpid(h->child_pid, &status, WNOHANG);
        if (w > 0) {
            if (WIFEXITED(status)) {
                h->exited = 1;
                h->exit_code = WEXITSTATUS(status);
            } else if (WIFSIGNALED(status)) {
                h->exited = 1;
                h->exit_code = 128 + WTERMSIG(status);
            }
            /* WIFSTOPPED: ignore — bash job control during fork */
        }
    }

    /* If bash confirmed dead, report exit */
    if (h->exited)
        return CHILD_EXITED;

    /* bash is alive — any read error is transient:
     * - n == 0 (EOF): slave temporarily closed during fork
     * - EIO: normal on PTY when last slave fd closes briefly
     * - EAGAIN/EWOULDBLOCK: non-blocking, no data yet
     * All cases: return 0 (no data), caller retries after 8ms */
    return 0;
}

int bun_pty_write(int handle, const char *buf, int len) {
    if (handle < 0 || handle >= MAX_PTYS || ptys[handle].master_fd < 0) return -1;
    ssize_t n = write(ptys[handle].master_fd, buf, len);
    return (n >= 0) ? (int)n : -1;
}

int bun_pty_resize(int handle, int cols, int rows) {
    if (handle < 0 || handle >= MAX_PTYS || ptys[handle].master_fd < 0) return -1;
    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
    };
    return ioctl(ptys[handle].master_fd, TIOCSWINSZ, &ws);
}

int bun_pty_kill(int handle) {
    if (handle < 0 || handle >= MAX_PTYS || ptys[handle].child_pid < 0) return -1;
    return kill(ptys[handle].child_pid, SIGKILL);
}

int bun_pty_get_pid(int handle) {
    if (handle < 0 || handle >= MAX_PTYS) return -1;
    return (int)ptys[handle].child_pid;
}

int bun_pty_get_exit_code(int handle) {
    if (handle < 0 || handle >= MAX_PTYS) return -1;
    /* Don't do our own waitpid here — bun_pty_read already handles it.
     * Doing a second waitpid risks racing with the read loop. */
    return ptys[handle].exit_code;
}

void bun_pty_close(int handle) {
    if (handle < 0 || handle >= MAX_PTYS) return;
    PtyHandle *h = &ptys[handle];
    if (h->master_fd >= 0) {
        close(h->master_fd);
        h->master_fd = -1;
    }
    if (h->child_pid > 0 && !h->exited) {
        kill(h->child_pid, SIGTERM);
        waitpid(h->child_pid, NULL, 0);
    }
    h->child_pid = -1;
    h->exited = 0;
    h->exit_code = 0;
}
