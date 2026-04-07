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
    android
    log
)
