#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const char *base_name(const char *path) {
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

// Diagnostic instrumentation, gated by OPENCODE_GIT_DISPATCH_DEBUG=1. Appends
// to <runtime>/home/dispatch-debug.log so real on-device argv can be
// inspected without a debugger (Android execve() failures are otherwise
// opaque — the parent only sees "not found"/"inaccessible"). Never active
// unless the env var is explicitly set; must stay a no-op in normal use.
static int debug_is_enabled(void) {
    const char *flag = getenv("OPENCODE_GIT_DISPATCH_DEBUG");
    return flag && flag[0] && strcmp(flag, "0") != 0;
}

// The rootfs dir is "<runtime>/rootfs"; the debug log lives in the sibling
// "<runtime>/home" dir so it survives even when rootfs gets purged/re-
// extracted between test runs.
static void resolve_debug_log_path(char *output, size_t size, const char *rootfs) {
    static const char suffix[] = "/rootfs";
    size_t suffix_len = sizeof(suffix) - 1;
    size_t rootfs_len = strlen(rootfs);
    char base[PATH_MAX];
    if (rootfs_len > suffix_len && strcmp(rootfs + rootfs_len - suffix_len, suffix) == 0) {
        size_t base_len = rootfs_len - suffix_len;
        if (base_len >= sizeof(base)) {
            base_len = sizeof(base) - 1;
        }
        memcpy(base, rootfs, base_len);
        base[base_len] = '\0';
    } else {
        snprintf(base, sizeof(base), "%s", rootfs);
    }
    snprintf(output, size, "%s/home/dispatch-debug.log", base);
}

static FILE *debug_log_open(const char *rootfs) {
    if (!debug_is_enabled() || !rootfs || !rootfs[0]) {
        return NULL;
    }
    char log_path[PATH_MAX];
    resolve_debug_log_path(log_path, sizeof(log_path), rootfs);
    FILE *log = fopen(log_path, "a");
    if (log) {
        setvbuf(log, NULL, _IONBF, 0);
    }
    return log;
}

static void debug_log_argv(FILE *log, const char *label, char *const list[], int count) {
    if (!log) {
        return;
    }
    time_t now = time(NULL);
    fprintf(log, "[pid=%d ts=%ld] %s (%d args):", (int)getpid(), (long)now, label, count);
    for (int index = 0; index < count; ++index) {
        fprintf(log, " [%d]=%s", index, list[index] ? list[index] : "(null)");
    }
    fputc('\n', log);
}

static int format_path(char *output, size_t size, const char *rootfs, const char *suffix) {
    int written = snprintf(output, size, "%s/%s", rootfs, suffix);
    return written >= 0 && (size_t)written < size;
}

static int derive_rootfs(char *output, size_t size, const char *invoked_as) {
    const char marker[] = "/usr/libexec/git-core/";
    const char *marker_start = strstr(invoked_as, marker);
    if (!marker_start || marker_start == invoked_as) return 0;
    size_t prefix_length = (size_t)(marker_start - invoked_as);
    if (prefix_length >= size) return 0;
    memcpy(output, invoked_as, prefix_length);
    output[prefix_length] = '\0';
    return 1;
}

static int derive_linker(char *output, size_t size) {
    ssize_t length = readlink("/proc/self/exe", output, size - 1);
    if (length <= 0 || (size_t)length >= size) return 0;
    output[length] = '\0';
    char *slash = strrchr(output, '/');
    if (!slash) return 0;
    size_t remaining = size - (size_t)(slash + 1 - output);
    int written = snprintf(slash + 1, remaining, "libmusl_linker.so");
    return written >= 0 && (size_t)written < remaining;
}

static int resolve_target(char *output, size_t size, const char *rootfs, const char *invoked_as, const char *command_override) {
    const char *command = command_override ? command_override : base_name(invoked_as);
    if (strcmp(command, "git") == 0) {
        return format_path(output, size, rootfs, "usr/bin/git");
    }

    char suffix[PATH_MAX];
    int written = snprintf(suffix, sizeof(suffix), "usr/libexec/git-core/%s.elf64", command);
    if (written < 0 || (size_t)written >= sizeof(suffix) ||
        !format_path(output, size, rootfs, suffix)) {
        return 0;
    }
    if (access(output, R_OK) == 0) {
        return 1;
    }

    char command_path[PATH_MAX];
    written = snprintf(suffix, sizeof(suffix), "usr/libexec/git-core/%s", command);
    if (written < 0 || (size_t)written >= sizeof(suffix) ||
        !format_path(command_path, sizeof(command_path), rootfs, suffix)) {
        return 0;
    }

    char link_target[PATH_MAX];
    ssize_t link_length = readlink(command_path, link_target, sizeof(link_target) - 1);
    if (link_length <= 0) {
        return 0;
    }
    link_target[link_length] = '\0';

    if (strcmp(base_name(link_target), "libgit_dispatch.so") == 0) {
        written = snprintf(
            suffix,
            sizeof(suffix),
            "usr/libexec/git-core/%s.elf64",
            command
        );
        if (written >= 0 && (size_t)written < sizeof(suffix) &&
            format_path(output, size, rootfs, suffix) && access(output, R_OK) == 0) {
            return 1;
        }
        if (strcmp(command, "git-index-pack") == 0 ||
            strcmp(command, "git-receive-pack") == 0 ||
            strcmp(command, "git-upload-pack") == 0 ||
            strcmp(command, "git-pack-objects") == 0 ||
            strcmp(command, "git-unpack-objects") == 0) {
            return format_path(output, size, rootfs, "usr/bin/git");
        }
        return 0;
    }
    if (strcmp(base_name(link_target), "git") == 0) {
        return format_path(output, size, rootfs, "usr/bin/git");
    }

    written = snprintf(
        suffix,
        sizeof(suffix),
        "usr/libexec/git-core/%s.elf64",
        base_name(link_target)
    );
    return written >= 0 && (size_t)written < sizeof(suffix) &&
           format_path(output, size, rootfs, suffix);
}

int main(int argc, char **argv, char **envp) {
    char derived_rootfs[PATH_MAX];
    char derived_linker[PATH_MAX];
    const char *rootfs = getenv("OPENCODE_MOBILE_ROOTFS_DIR");
    const char *linker = getenv("OPENCODE_MOBILE_MUSL_LINKER");
    if (!linker || !linker[0]) {
        linker = getenv("MUSL_LINKER");
    }
    // Git sanitizes custom environment variables before launching remote
    // helpers. Derive both paths from stable Android filesystem locations so
    // HTTPS helpers do not depend on inherited OPENCODE_* variables.
    if ((!rootfs || !rootfs[0]) && argc > 0 && derive_rootfs(derived_rootfs, sizeof(derived_rootfs), argv[0])) {
        rootfs = derived_rootfs;
    }
    if ((!linker || !linker[0]) && derive_linker(derived_linker, sizeof(derived_linker))) {
        linker = derived_linker;
    }
    if (!rootfs || !rootfs[0] || !linker || !linker[0] || argc < 1) {
        fputs("git dispatcher: missing Android runtime environment\n", stderr);
        return 126;
    }

    FILE *debug_log = debug_log_open(rootfs);
    debug_log_argv(debug_log, "received", argv, argc);

    char helper_name[PATH_MAX];
    const char *command_override = NULL;
    int command_index = -1;
    // Whether the OS-level exec already used "git" as argv[0] (a real git
    // multicall re-exec, e.g. fetch-pack spawning "git --shallow-file <lock>
    // index-pack ..." or "git rev-list ..." for connectivity checks) as
    // opposed to a hyphenated helper symlink being invoked directly (e.g.
    // "git-upload-pack <path>" for the local/SSH transport). This is the
    // ONLY reliable signal for whether argv[1..] already contains a real
    // subcommand token that must be passed through verbatim.
    const int invoked_as_git = strcmp(base_name(argv[0]), "git") == 0;
    if (invoked_as_git) {
        for (int index = 1; index < argc; ++index) {
            const char *candidate = argv[index];
            if (strcmp(candidate, "index-pack") == 0 ||
                strcmp(candidate, "receive-pack") == 0 ||
                strcmp(candidate, "upload-pack") == 0 ||
                strcmp(candidate, "pack-objects") == 0 ||
                strcmp(candidate, "unpack-objects") == 0 ||
                strncmp(candidate, "remote-", 7) == 0) {
                int helper_length = snprintf(helper_name, sizeof(helper_name), "git-%s", candidate);
                if (helper_length < 0 || (size_t)helper_length >= sizeof(helper_name)) {
                    fputs("git dispatcher: helper name is too long\n", stderr);
                    return 126;
                }
                command_override = helper_name;
                command_index = index;
                break;
            }
        }
    }
    char target[PATH_MAX];
    if (!resolve_target(target, sizeof(target), rootfs, argv[0], command_override) ||
        access(target, R_OK) != 0) {
        if (debug_log) {
            fprintf(
                debug_log,
                "[pid=%d] resolve_target FAILED for argv0=%s command_override=%s target_attempt=%s\n",
                (int)getpid(),
                argv[0],
                command_override ? command_override : "(none)",
                target
            );
            fclose(debug_log);
        }
        fprintf(stderr, "git dispatcher: target unavailable for %s\n", argv[0]);
        return 127;
    }
    if (debug_log) {
        fprintf(
            debug_log,
            "[pid=%d] resolved target=%s command_override=%s command_index=%d\n",
            (int)getpid(),
            target,
            command_override ? command_override : "(none)",
            command_index
        );
    }

    char library_path[PATH_MAX * 3];
    int written = snprintf(
        library_path,
        sizeof(library_path),
        "%s/lib:%s/usr/lib:%s/usr/libexec/git-core",
        rootfs,
        rootfs,
        rootfs
    );
    if (written < 0 || (size_t)written >= sizeof(library_path)) {
        fputs("git dispatcher: runtime path is too long\n", stderr);
        return 126;
    }

    // +4 for [linker, --library-path, library_path, target] plus the
    // trailing NULL execve terminator; +1 more because the "invoked via a
    // hyphenated helper symlink" path below (see `subcommand` further down)
    // inserts a synthesized subcommand token that has no corresponding slot
    // in the original argv, growing the total element count by one.
    char **linker_argv = calloc((size_t)argc + 5, sizeof(char *));
    if (!linker_argv) {
        perror("git dispatcher: calloc");
        return 126;
    }
    linker_argv[0] = (char *)linker;
    linker_argv[1] = "--library-path";
    linker_argv[2] = library_path;
    linker_argv[3] = target;
    int linker_index = 4;
    const char *target_name = base_name(target);
    const int target_is_git = strcmp(target_name, "git") == 0;
    // Only synthesize and prepend a subcommand when this process was
    // exec'd directly via a hyphenated helper symlink (argv[0] basename !=
    // "git", e.g. "git-upload-pack <path>" for the local/SSH transport) AND
    // that resolved to the "git" multicall binary. When invoked_as_git is
    // true, argv[1..] was constructed by git itself and already IS the
    // correct subcommand + arguments (verbatim, in order) — inserting
    // anything here corrupts it. This was the confirmed Bug A root cause:
    // "git rev-list ..." (a re-exec not on the pack/remote-* whitelist
    // above) got a bogus extra "git" token spliced in, producing
    // "git: 'git' is not a git command".
    const char *subcommand = NULL;
    if (target_is_git && !invoked_as_git) {
        subcommand = base_name(argv[0]);
        if (strncmp(subcommand, "git-", 4) == 0) {
            subcommand += 4;
        }
    }
    for (int index = 1; index < argc; ++index) {
        if (index == command_index && !target_is_git) {
            // command_override matched a dashed token (e.g. "remote-https")
            // that resolved directly to its own real helper binary (e.g.
            // git-remote-http.elf64 via the readlink chain in
            // resolve_target) rather than to the "git" multicall binary.
            // That helper is invoked with its transport args only — the
            // dashed command name itself is not one of them — so drop it.
            continue;
        }
        linker_argv[linker_index++] = argv[index];
    }
    if (subcommand) {
        for (int index = linker_index; index > 4; --index) {
            linker_argv[index] = linker_argv[index - 1];
        }
        linker_argv[4] = (char *)subcommand;
        ++linker_index;
    }

    if (debug_log) {
        debug_log_argv(debug_log, "transmitted", linker_argv, linker_index);
        fclose(debug_log);
        debug_log = NULL;
    }

    execve(linker, linker_argv, envp);
    fprintf(stderr, "git dispatcher: execve failed: %s\n", strerror(errno));
    free(linker_argv);
    return 126;
}