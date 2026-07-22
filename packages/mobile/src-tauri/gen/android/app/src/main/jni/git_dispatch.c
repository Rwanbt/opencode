#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *base_name(const char *path) {
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
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

    char helper_name[PATH_MAX];
    const char *command_override = NULL;
    int command_index = -1;
    if (strcmp(base_name(argv[0]), "git") == 0) {
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
        fprintf(stderr, "git dispatcher: target unavailable for %s\n", argv[0]);
        return 127;
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

    char **linker_argv = calloc((size_t)argc + 4, sizeof(char *));
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
    const char *subcommand = NULL;
    if (target_is_git) {
        subcommand = command_override ? argv[command_index] : base_name(argv[0]);
        if (!command_override && strncmp(subcommand, "git-", 4) == 0) {
            subcommand += 4;
        }
    }
    for (int index = 1; index < argc; ++index) {
        if (index == command_index) {
            if (target_is_git) {
                linker_argv[linker_index++] = (char *)subcommand;
            }
            continue;
        }
        linker_argv[linker_index++] = argv[index];
    }
    if (target_is_git && command_index < 0) {
        linker_argv[3] = target;
        for (int index = linker_index; index > 4; --index) {
            linker_argv[index] = linker_argv[index - 1];
        }
        linker_argv[4] = (char *)subcommand;
    }

    execve(linker, linker_argv, envp);
    fprintf(stderr, "git dispatcher: execve failed: %s\n", strerror(errno));
    free(linker_argv);
    return 126;
}