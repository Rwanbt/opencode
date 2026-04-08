/**
 * LD_PRELOAD library that provides /etc/resolv.conf for musl on Android.
 *
 * musl's DNS resolver reads /etc/resolv.conf, which doesn't exist on Android.
 * This library intercepts open/openat and returns an in-memory file descriptor
 * with hardcoded public DNS servers (no env vars needed).
 *
 * MUST be compiled with musl cross-compiler (NOT NDK):
 *   aarch64-linux-musl-gcc -shared -fPIC -O2 -o libresolv_override.so resolv_override.c
 *
 * Usage: ld-musl-aarch64.so.1 --preload libresolv_override.so bun ...
 */

#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/syscall.h>
#include <fcntl.h>
#ifdef open64
#undef open64
#endif

#ifndef SYS_memfd_create
#define SYS_memfd_create 279
#endif

static const char resolv_content[] =
    "nameserver 8.8.8.8\n"
    "nameserver 8.8.4.4\n"
    "nameserver 1.1.1.1\n";

static int make_resolv_fd(void) {
    int fd = (int)syscall(SYS_memfd_create, "resolv.conf", 0);
    if (fd < 0) return -1;
    write(fd, resolv_content, sizeof(resolv_content) - 1);
    lseek(fd, 0, SEEK_SET);
    return fd;
}

int open(const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    if (path && strcmp(path, "/etc/resolv.conf") == 0) {
        int fd = make_resolv_fd();
        if (fd >= 0) return fd;
    }
    return (int)syscall(SYS_openat, AT_FDCWD, path, flags, mode);
}

int openat(int dirfd, const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    if (dirfd == AT_FDCWD && path && strcmp(path, "/etc/resolv.conf") == 0) {
        int fd = make_resolv_fd();
        if (fd >= 0) return fd;
    }
    return (int)syscall(SYS_openat, dirfd, path, flags, mode);
}
