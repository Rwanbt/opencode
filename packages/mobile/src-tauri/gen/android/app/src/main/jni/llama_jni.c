#include <jni.h>
#include <string.h>
#include <stdlib.h>
#include <android/log.h>
#include "llama.h"
#include "ggml.h"

#define TAG "LlamaJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Global state — single model + context at a time
static struct llama_model *g_model = NULL;
static struct llama_context *g_ctx = NULL;
static volatile int g_abort = 0;

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_initBackend(JNIEnv *env, jobject thiz) {
    ggml_backend_load_all();
    LOGI("llama backend initialized");
}

JNIEXPORT jlong JNICALL
Java_ai_opencode_mobile_LlamaEngine_loadModel(JNIEnv *env, jobject thiz, jstring path, jint nCtx, jint nThreads) {
    const char *model_path = (*env)->GetStringUTFChars(env, path, NULL);
    LOGI("Loading model: %s (ctx=%d, threads=%d)", model_path, nCtx, nThreads);

    struct llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0; // CPU only for now

    struct llama_model *model = llama_model_load_from_file(model_path, model_params);
    (*env)->ReleaseStringUTFChars(env, path, model_path);

    if (!model) {
        LOGE("Failed to load model");
        return 0;
    }

    // Free previous model/context
    if (g_ctx) { llama_free(g_ctx); g_ctx = NULL; }
    if (g_model) { llama_model_free(g_model); g_model = NULL; }

    g_model = model;

    // Create context
    struct llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = nCtx > 0 ? nCtx : 4096;
    ctx_params.n_threads = nThreads > 0 ? nThreads : 4;
    ctx_params.n_threads_batch = ctx_params.n_threads;

    g_ctx = llama_init_from_model(model, ctx_params);
    if (!g_ctx) {
        LOGE("Failed to create context");
        llama_model_free(model);
        g_model = NULL;
        return 0;
    }

    LOGI("Model loaded successfully");
    return (jlong)(intptr_t)model;
}

JNIEXPORT void JNICALL
Java_ai_opencode_mobile_LlamaEngine_unloadModel(JNIEnv *env, jobject thiz) {
    if (g_ctx) { llama_free(g_ctx); g_ctx = NULL; }
    if (g_model) { llama_model_free(g_model); g_model = NULL; }
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

// Simple text generation with streaming callback
JNIEXPORT jstring JNICALL
Java_ai_opencode_mobile_LlamaEngine_generate(
    JNIEnv *env, jobject thiz,
    jstring prompt_str, jint maxTokens, jfloat temperature, jobject callback
) {
    if (!g_model || !g_ctx) {
        return (*env)->NewStringUTF(env, "[ERROR] Model not loaded");
    }

    g_abort = 0;
    const char *prompt = (*env)->GetStringUTFChars(env, prompt_str, NULL);
    LOGI("Generating (max_tokens=%d, temp=%.2f)", maxTokens, temperature);

    // Tokenize
    const struct llama_vocab *vocab = llama_model_get_vocab(g_model);
    int n_prompt_tokens = llama_tokenize(vocab, prompt, strlen(prompt), NULL, 0, true, true);
    llama_token *tokens = (llama_token *)malloc(sizeof(llama_token) * (n_prompt_tokens + 1));
    n_prompt_tokens = llama_tokenize(vocab, prompt, strlen(prompt), tokens, n_prompt_tokens + 1, true, true);
    (*env)->ReleaseStringUTFChars(env, prompt, prompt);

    if (n_prompt_tokens < 0) {
        free(tokens);
        return (*env)->NewStringUTF(env, "[ERROR] Tokenization failed");
    }

    // Clear KV cache
    llama_memory_clear(llama_get_memory(g_ctx), true);

    // Process prompt in batch
    struct llama_batch batch = llama_batch_init(n_prompt_tokens, 0, 1);
    for (int i = 0; i < n_prompt_tokens; i++) {
        batch.token[i] = tokens[i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == n_prompt_tokens - 1); // only compute logits for last token
    }
    batch.n_tokens = n_prompt_tokens;
    free(tokens);

    if (llama_decode(g_ctx, batch) != 0) {
        llama_batch_free(batch);
        return (*env)->NewStringUTF(env, "[ERROR] Decode failed");
    }

    // Get callback method
    jclass cbClass = NULL;
    jmethodID cbMethod = NULL;
    if (callback) {
        cbClass = (*env)->GetObjectClass(env, callback);
        cbMethod = (*env)->GetMethodID(env, cbClass, "onToken", "(Ljava/lang/String;)V");
    }

    // Generate tokens
    int max = maxTokens > 0 ? maxTokens : 512;
    char *result = (char *)calloc(max * 16, 1); // generous buffer
    int result_len = 0;
    int n_cur = n_prompt_tokens;

    struct llama_sampler *sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature > 0 ? temperature : 0.7f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(42));

    for (int i = 0; i < max && !g_abort; i++) {
        llama_token new_token = llama_sampler_sample(sampler, g_ctx, -1);

        if (llama_vocab_is_eog(vocab, new_token)) break;

        // Convert token to text
        char buf[256];
        int n = llama_token_to_piece(vocab, new_token, buf, sizeof(buf), 0, true);
        if (n > 0) {
            buf[n] = 0;
            memcpy(result + result_len, buf, n);
            result_len += n;

            // Stream callback
            if (callback && cbMethod) {
                jstring token_str = (*env)->NewStringUTF(env, buf);
                (*env)->CallVoidMethod(env, callback, cbMethod, token_str);
                (*env)->DeleteLocalRef(env, token_str);
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

    result[result_len] = 0;
    jstring jresult = (*env)->NewStringUTF(env, result);
    free(result);

    LOGI("Generation complete: %d tokens", n_cur - n_prompt_tokens);
    return jresult;
}
