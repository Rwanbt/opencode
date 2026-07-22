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

static int resolve_target(char *output, size_t size, const char *rootfs, const char *invoked_as) {
    const char *command = base_name(invoked_as);
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
    const char *rootfs = getenv("OPENCODE_MOBILE_ROOTFS_DIR");
    const char *linker = getenv("OPENCODE_MOBILE_MUSL_LINKER");
    if (!linker || !linker[0]) {
        linker = getenv("MUSL_LINKER");
    }
    if (!rootfs || !rootfs[0] || !linker || !linker[0] || argc < 1) {
        fputs("git dispatcher: missing Android runtime environment\n", stderr);
        return 126;
    }

    char target[PATH_MAX];
    if (!resolve_target(target, sizeof(target), rootfs, argv[0]) ||
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
    for (int index = 1; index < argc; ++index) {
        linker_argv[index + 3] = argv[index];
    }

    execve(linker, linker_argv, envp);
    fprintf(stderr, "git dispatcher: execve failed: %s\n", strerror(errno));
    free(linker_argv);
    return 126;
}