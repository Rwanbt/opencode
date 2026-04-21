cmake_minimum_required(VERSION 3.22)
project(llama_jni C)

# Find the pre-built llama.cpp shared libraries in jniLibs
set(JNILIBS_DIR ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI})

# Import pre-built libraries
add_library(ggml SHARED IMPORTED)
set_target_properties(ggml PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libggml.so)

add_library(ggml-base SHARED IMPORTED)
set_target_properties(ggml-base PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libggml-base.so)

add_library(ggml-cpu SHARED IMPORTED)
set_target_properties(ggml-cpu PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libggml-cpu.so)

# Optional GPU backends — only link if the .so exists (device-dependent)
set(GPU_LIBS "")

if(EXISTS ${JNILIBS_DIR}/libggml-opencl.so)
    add_library(ggml-opencl SHARED IMPORTED)
    set_target_properties(ggml-opencl PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libggml-opencl.so)
    list(APPEND GPU_LIBS ggml-opencl)
endif()

if(EXISTS ${JNILIBS_DIR}/libggml-vulkan.so)
    add_library(ggml-vulkan SHARED IMPORTED)
    set_target_properties(ggml-vulkan PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libggml-vulkan.so)
    list(APPEND GPU_LIBS ggml-vulkan)
endif()

add_library(llama SHARED IMPORTED)
set_target_properties(llama PROPERTIES IMPORTED_LOCATION ${JNILIBS_DIR}/libllama.so)

# Build our JNI wrapper
add_library(llama_jni SHARED llama_jni.c)

# llama.cpp headers — jni/ -> main/ -> src/ -> app/ -> android/llama-headers
target_include_directories(llama_jni PRIVATE
    ${CMAKE_SOURCE_DIR}/../../../../llama-headers
)

target_link_libraries(llama_jni
    llama
    ggml
    ggml-base
    ggml-cpu
    ${GPU_LIBS}
    android
    log
)

# ─── PTY library for bun-pty (interactive terminal) ──────────────────
# Provides forkpty-based PTY support loaded by bun-pty via BUN_PTY_LIB
add_library(rust_pty SHARED rust_pty.c)
target_link_libraries(rust_pty android log)

# ─── SIGSYS trace shim ───────────────────────────────────────────────
# LD_PRELOAD into child processes spawned by pty_server to capture the
# exact seccomp-blocked syscall number. Diagnostic-only; remove once
# the blocking syscall is identified and worked around.
add_library(sigsys_trace SHARED sigsys_trace.c)
target_link_libraries(sigsys_trace log)

# pty_server.c is NOT built here — CMake add_library produces a .so that
# cannot be executed via ProcessBuilder (needs PIE executable). The pre-
# built binary in jniLibs/arm64-v8a/libpty_server.so (PIE) is used as-is.
# To instrument pty_server's children, set LD_PRELOAD in LlamaService.kt
# before ProcessBuilder.start() — children inherit env via fork+exec.

# NOTE: resolv_override.c is NOT built here. NDK compiles against Bionic,
# but bun uses musl — a Bionic .so cannot be LD_PRELOADed into a musl process.
# DNS is handled via dns.setServers() in mobile-entry.ts.
# TLS certs via SSL_CERT_FILE env var (concatenated Android CA certs).
