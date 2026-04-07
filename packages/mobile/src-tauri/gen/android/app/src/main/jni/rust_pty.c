/**
 * Minimal PTY implementation for Android — bun-pty compatible API.
 *
 * bun-pty expects a shared library with these symbols:
 *   bun_pty_spawn, bun_pty_write, bun_pty_read, bun_pty_resize,
 *   bun_pty_kill, bun_pty_get_pid, bun_pty_get_exit_code, bun_pty_close
 *
 * On Android, forkpty() is available in <pty.h> since API 23.
 */

#include <errno.h>
#include <fcntl.h>
#include <pty.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define MAX_SESSIONS 64

typedef struct {
    int master_fd;
    pid_t pid;
    int exit_code;
    int exited;
    int active;
} PtySession;

static PtySession sessions[MAX_SESSIONS];
static int initialized = 0;

static void ensure_init(void) {
    if (!initialized) {
        memset(sessions, 0, sizeof(sessions));
        for (int i = 0; i < MAX_SESSIONS; i++) {
            sessions[i].master_fd = -1;
            sessions[i].pid = -1;
        }
        initialized = 1;
    }
}

static int alloc_slot(void) {
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (!sessions[i].active) return i;
    }
    return -1;
}

/**
 * bun_pty_spawn(cmdline, cwd, env_str, cols, rows) -> handle
 *
 * cmdline: space-separated command (shell-quoted)
 * cwd: working directory (null-terminated)
 * env_str: null-separated KEY=VALUE pairs, double-null terminated
 * cols, rows: initial terminal size
 *
 * Returns: handle >= 0 on success, -1 on failure
 */
int bun_pty_spawn(const char *cmdline, const char *cwd, const char *env_str,
                  int cols, int rows) {
    ensure_init();
    int slot = alloc_slot();
    if (slot < 0) return -1;

    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
    };

    int master_fd;
    pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);

    if (pid < 0) {
        return -1;
    }

    if (pid == 0) {
        /* Child process */

        /* Change directory */
        if (cwd && cwd[0] != '\0') {
            if (chdir(cwd) != 0) {
                /* If cwd fails, try HOME or / */
                const char *home = getenv("HOME");
                if (!home || chdir(home) != 0) {
                    chdir("/");
                }
            }
        }

        /* Set environment variables from null-separated string */
        if (env_str && env_str[0] != '\0') {
            const char *p = env_str;
            while (*p) {
                putenv((char *)p);
                p += strlen(p) + 1;
            }
        }

        /* Parse command — use /bin/sh -c for simplicity */
        if (cmdline && cmdline[0] != '\0') {
            /* Try to find bash first, then sh */
            const char *shell = getenv("SHELL");
            if (!shell) {
                if (access("/system/bin/sh", X_OK) == 0)
                    shell = "/system/bin/sh";
                else
                    shell = "/bin/sh";
            }
            execl(shell, shell, "-c", cmdline, (char *)NULL);
        } else {
            const char *shell = getenv("SHELL");
            if (!shell) shell = "/system/bin/sh";
            execl(shell, shell, "-l", (char *)NULL);
        }
        _exit(127);
    }

    /* Parent process */
    /* Set master fd to non-blocking for reads */
    int flags = fcntl(master_fd, F_GETFL, 0);
    if (flags >= 0) {
        fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);
    }

    sessions[slot].master_fd = master_fd;
    sessions[slot].pid = pid;
    sessions[slot].exit_code = -1;
    sessions[slot].exited = 0;
    sessions[slot].active = 1;

    return slot;
}

int bun_pty_write(int handle, const void *data, int len) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;
    return (int)write(sessions[handle].master_fd, data, (size_t)len);
}

int bun_pty_read(int handle, void *buf, int len) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;

    /* Check if child has exited */
    if (!sessions[handle].exited) {
        int status;
        pid_t result = waitpid(sessions[handle].pid, &status, WNOHANG);
        if (result > 0) {
            sessions[handle].exited = 1;
            sessions[handle].exit_code = WIFEXITED(status)
                ? WEXITSTATUS(status)
                : (WIFSIGNALED(status) ? 128 + WTERMSIG(status) : -1);
        }
    }

    int n = (int)read(sessions[handle].master_fd, buf, (size_t)len);
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
        return 0; /* No data available */
    }
    return n;
}

int bun_pty_resize(int handle, int cols, int rows) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;
    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
    };
    return ioctl(sessions[handle].master_fd, TIOCSWINSZ, &ws);
}

int bun_pty_kill(int handle) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;
    return kill(sessions[handle].pid, SIGKILL);
}

int bun_pty_get_pid(int handle) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;
    return (int)sessions[handle].pid;
}

int bun_pty_get_exit_code(int handle) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return -1;

    if (!sessions[handle].exited) {
        int status;
        pid_t result = waitpid(sessions[handle].pid, &status, WNOHANG);
        if (result > 0) {
            sessions[handle].exited = 1;
            sessions[handle].exit_code = WIFEXITED(status)
                ? WEXITSTATUS(status)
                : (WIFSIGNALED(status) ? 128 + WTERMSIG(status) : -1);
        }
    }

    return sessions[handle].exited ? sessions[handle].exit_code : -1;
}

void bun_pty_close(int handle) {
    if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].active)
        return;

    close(sessions[handle].master_fd);

    if (!sessions[handle].exited) {
        kill(sessions[handle].pid, SIGTERM);
        usleep(100000); /* 100ms grace */
        kill(sessions[handle].pid, SIGKILL);
        int status;
        waitpid(sessions[handle].pid, &status, 0);
    }

    sessions[handle].master_fd = -1;
    sessions[handle].pid = -1;
    sessions[handle].active = 0;
}
