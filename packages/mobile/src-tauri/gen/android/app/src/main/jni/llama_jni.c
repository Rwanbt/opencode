#include <jni.h>
#include <string.h>
#include <stdlib.h>
#include <pthread.h>
#include <android/log.h>
#include "llama.h"
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#define TAG "LlamaJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Global state — single model + context at a time, protected by mutex
static struct llama_model *g_model = NULL;
static struct llama_context *g_ctx = NULL;
static volatile int g_abort = 0;
static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_setenv(JNIEnv *env, jobject thiz, jstring name, jstring value) {
    const char *n = (*env)->GetStringUTFChars(env, name, NULL);
    const char *v = (*env)->GetStringUTFChars(env, value, NULL);
    if (n && v) {
        setenv(n, v, 1);
        LOGI("setenv %s=%s", n, v);
    }
    if (n) (*env)->ReleaseStringUTFChars(env, name, n);
    if (v) (*env)->ReleaseStringUTFChars(env, value, v);
}

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_initBackend(JNIEnv *env, jobject thiz) {
    // Directly register the CPU backend from the already-loaded libggml-cpu.so
    // ggml_backend_load_all() can't find it as a plugin (missing ggml_backend_init export)
    // but ggml_backend_cpu_reg() is available since we link against libggml-cpu.so
    ggml_backend_reg_t cpu_reg = ggml_backend_cpu_reg();
    LOGI("CPU backend registered directly: %s", cpu_reg ? "OK" : "FAILED");

    // Log registered backends
    size_t n_reg = ggml_backend_reg_count();
    LOGI("Registered backends: %zu", n_reg);
    for (size_t i = 0; i < n_reg; i++) {
        ggml_backend_reg_t reg = ggml_backend_reg_get(i);
        LOGI("  Backend %zu: %s", i, ggml_backend_reg_name(reg));
    }

    LOGI("llama backend initialized");
}

JNIEXPORT jlong JNICALL
Java_ai_opencode_mobile_LlamaEngine_loadModel(JNIEnv *env, jobject thiz, jstring path, jint nCtx, jint nThreads, jint mainGpu) {
    const char *model_path = (*env)->GetStringUTFChars(env, path, NULL);
    if (!model_path) {
        LOGE("Failed to get model path string");
        return 0;
    }
    LOGI("Loading model: %s (ctx=%d, threads=%d)", model_path, nCtx, nThreads);

    struct llama_model_params model_params = llama_model_default_params();
    // GPU offload only for modern SoCs (mainGpu=0 means Vulkan-capable = modern)
    // Older SoCs (OpenCL/Adreno 6xx) are 80x slower than CPU for LLM inference
    int use_gpu = (mainGpu == 0);  // 0=Vulkan(modern), 1=OpenCL(old) → skip GPU
    model_params.n_gpu_layers = use_gpu ? 99 : 0;
    model_params.main_gpu = mainGpu;
    LOGI("GPU config: n_gpu_layers=%d, main_gpu=%d, use_gpu=%d", model_params.n_gpu_layers, mainGpu, use_gpu);

    struct llama_model *model = llama_model_load_from_file(model_path, model_params);
    (*env)->ReleaseStringUTFChars(env, path, model_path);

    if (!model) {
        LOGE("Failed to load model");
        return 0;
    }

    pthread_mutex_lock(&g_mutex);
    // Free previous model/context
    if (g_ctx) { llama_free(g_ctx); g_ctx = NULL; }
    if (g_model) { llama_model_free(g_model); g_model = NULL; }

    g_model = model;

    // Create context optimized per backend: CPU / OpenCL / Vulkan
    struct llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = nCtx > 0 ? nCtx : 2048;

    int gpu_active = (model_params.n_gpu_layers > 0);
    int is_vulkan = (mainGpu == 0 && gpu_active);  // mainGpu=0 → Vulkan preferred
    int is_opencl = (mainGpu == 1 && gpu_active);   // mainGpu=1 → OpenCL preferred

    if (is_vulkan) {
        // Vulkan: GPU does heavy lifting, F16 KV (native GPU format)
        ctx_params.n_threads = 2;
        ctx_params.n_threads_batch = 2;
        ctx_params.n_batch = 512;
        ctx_params.type_k = GGML_TYPE_F16;
        ctx_params.type_v = GGML_TYPE_F16;
        LOGI("Context [Vulkan]: n_ctx=%d, kv=f16, threads=2, n_batch=512", ctx_params.n_ctx);
    } else {
        // CPU-only: use big cores, default KV cache, no flash_attn (safest)
        ctx_params.n_threads = 4;       // SD865: 4x Cortex-A77 big cores
        ctx_params.n_threads_batch = 4;
        ctx_params.n_batch = 512;
        LOGI("Context [CPU]: n_ctx=%d, threads=4, n_batch=512", ctx_params.n_ctx);
    }

    g_ctx = llama_init_from_model(model, ctx_params);
    if (!g_ctx) {
        LOGE("Failed to create context");
        llama_model_free(model);
        g_model = NULL;
        pthread_mutex_unlock(&g_mutex);
        return 0;
    }
    pthread_mutex_unlock(&g_mutex);

    LOGI("Model loaded successfully");
    return (jlong)(intptr_t)model;
}

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_unloadModel(JNIEnv *env, jobject thiz) {
    pthread_mutex_lock(&g_mutex);
    if (g_ctx) { llama_free(g_ctx); g_ctx = NULL; }
    if (g_model) { llama_model_free(g_model); g_model = NULL; }
    pthread_mutex_unlock(&g_mutex);
    LOGI("Model unloaded");
}

JNIEXPORT jboolean JNICALL
Java_ai_opencode_mobile_LlamaEngine_isLoaded(JNIEnv *env, jobject thiz) {
    return g_model != NULL && g_ctx != NULL;
}

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_abort(JNIEnv *env, jobject thiz) {
    g_abort = 1;
}

// Text generation with streaming callback
JNIEXPORT jstring JNICALL
Java_ai_opencode_mobile_LlamaEngine_generate(
    JNIEnv *env, jobject thiz,
    jstring prompt_str, jint maxTokens, jfloat temperature, jobject callback
) {
    pthread_mutex_lock(&g_mutex);
    if (!g_model || !g_ctx) {
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Model not loaded");
    }

    g_abort = 0;
    const char *prompt = (*env)->GetStringUTFChars(env, prompt_str, NULL);
    if (!prompt) {
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Failed to get prompt string");
    }
    LOGI("Generating (max_tokens=%d, temp=%.2f, prompt_len=%d)", maxTokens, temperature, (int)strlen(prompt));

    // Tokenize — first call returns -n_tokens needed (negative)
    const struct llama_vocab *vocab = llama_model_get_vocab(g_model);
    int n_prompt_tokens = -llama_tokenize(vocab, prompt, strlen(prompt), NULL, 0, true, true);
    if (n_prompt_tokens <= 0) {
        LOGE("Tokenization failed: returned %d", -n_prompt_tokens);
        (*env)->ReleaseStringUTFChars(env, prompt_str, prompt);
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Tokenization failed");
    }
    llama_token *tokens = (llama_token *)malloc(sizeof(llama_token) * n_prompt_tokens);
    if (!tokens) {
        (*env)->ReleaseStringUTFChars(env, prompt_str, prompt);
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Memory allocation failed");
    }
    n_prompt_tokens = llama_tokenize(vocab, prompt, strlen(prompt), tokens, n_prompt_tokens, true, true);
    (*env)->ReleaseStringUTFChars(env, prompt_str, prompt);

    if (n_prompt_tokens < 0) {
        free(tokens);
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Tokenization failed");
    }

    LOGI("Prompt tokenized: %d tokens", n_prompt_tokens);

    // Detect active backend from env vars set by Kotlin
    const char *dis_vulkan = getenv("GGML_DISABLE_VULKAN");
    const char *dis_opencl = getenv("GGML_DISABLE_OPENCL");
    int has_vulkan = (dis_vulkan == NULL || dis_vulkan[0] != '1');
    int has_opencl = (dis_opencl == NULL || dis_opencl[0] != '1');
    int need_recreate = (has_vulkan && !has_opencl);  // Only Vulkan needs context recreation

    if (need_recreate) {
        // Vulkan: must recreate context (llama_memory_clear crashes on Adreno Vulkan)
        if (g_ctx) { llama_free(g_ctx); g_ctx = NULL; }
        struct llama_context_params ctx_params = llama_context_default_params();
        ctx_params.n_ctx = 2048;
        ctx_params.n_threads = 2;
        ctx_params.n_threads_batch = 2;
        ctx_params.n_batch = 512;
        ctx_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
        ctx_params.type_k = GGML_TYPE_F16;
        ctx_params.type_v = GGML_TYPE_F16;
        g_ctx = llama_init_from_model(g_model, ctx_params);
        if (!g_ctx) {
            free(tokens);
            LOGE("Failed to recreate Vulkan context");
            pthread_mutex_unlock(&g_mutex);
            return (*env)->NewStringUTF(env, "[ERROR] Context creation failed");
        }
    } else {
        // OpenCL / CPU: reuse context, just clear KV cache (fast!)
        llama_memory_clear(llama_get_memory(g_ctx), true);
    }

    // Process prompt in batch
    struct llama_batch batch = llama_batch_init(n_prompt_tokens, 0, 1);
    for (int i = 0; i < n_prompt_tokens; i++) {
        batch.token[i] = tokens[i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == n_prompt_tokens - 1);
    }
    batch.n_tokens = n_prompt_tokens;
    free(tokens);

    if (llama_decode(g_ctx, batch) != 0) {
        llama_batch_free(batch);
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Decode failed");
    }

    // Get callback method (with JNI exception check)
    jclass cbClass = NULL;
    jmethodID cbMethod = NULL;
    if (callback) {
        cbClass = (*env)->GetObjectClass(env, callback);
        if (cbClass) {
            cbMethod = (*env)->GetMethodID(env, cbClass, "onToken", "(Ljava/lang/String;)V");
            if ((*env)->ExceptionCheck(env)) {
                (*env)->ExceptionClear(env);
                cbMethod = NULL;
                LOGE("Failed to find onToken callback method");
            }
        }
    }

    // Generate tokens — buffer sized for worst case (256 bytes per token)
    int max = maxTokens > 0 ? maxTokens : 512;
    int buf_size = max * 256 + 1;
    char *result = (char *)calloc(buf_size, 1);
    if (!result) {
        llama_batch_free(batch);
        pthread_mutex_unlock(&g_mutex);
        return (*env)->NewStringUTF(env, "[ERROR] Memory allocation failed");
    }
    int result_len = 0;
    int n_cur = n_prompt_tokens;

    struct llama_sampler *sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    // Sampler chain order matters: penalties → top_k → top_p → min_p → temp → dist
    llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.95f, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_min_p(0.05f, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature > 0 ? temperature : 0.7f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(0));

    for (int i = 0; i < max && !g_abort; i++) {
        llama_token new_token = llama_sampler_sample(sampler, g_ctx, -1);

        if (llama_vocab_is_eog(vocab, new_token)) break;

        // Convert token to text
        char buf[256];
        int n = llama_token_to_piece(vocab, new_token, buf, sizeof(buf) - 1, 0, true);
        if (n > 0 && result_len + n < buf_size - 1) {
            buf[n] = 0;
            memcpy(result + result_len, buf, n);
            result_len += n;

            // Stream callback (with exception safety)
            if (callback && cbMethod) {
                jstring token_str = (*env)->NewStringUTF(env, buf);
                if (token_str) {
                    (*env)->CallVoidMethod(env, callback, cbMethod, token_str);
                    (*env)->DeleteLocalRef(env, token_str);
                    if ((*env)->ExceptionCheck(env)) {
                        (*env)->ExceptionClear(env);
                        LOGE("Callback exception, stopping generation");
                        break;
                    }
                }
            }
        }

        // Prepare next batch
        llama_batch_free(batch);
        batch = llama_batch_init(1, 0, 1);
        batch.token[0] = new_token;
        batch.pos[0] = n_cur;
        batch.n_seq_id[0] = 1;
        batch.seq_id[0][0] = 0;
        batch.logits[0] = 1;
        batch.n_tokens = 1;
        n_cur++;

        if (llama_decode(g_ctx, batch) != 0) break;
    }

    llama_sampler_free(sampler);
    llama_batch_free(batch);
    pthread_mutex_unlock(&g_mutex);

    result[result_len] = 0;
    jstring jresult = (*env)->NewStringUTF(env, result);
    free(result);

    LOGI("Generation complete: %d tokens", n_cur - n_prompt_tokens);
    return jresult;
}
