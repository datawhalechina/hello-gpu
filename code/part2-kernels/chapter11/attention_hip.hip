#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <random>
#include <string>
#include <vector>

#define HIP_CHECK(call)                                                        \
    do {                                                                       \
        hipError_t error = (call);                                             \
        if (error != hipSuccess) {                                             \
            std::cerr << "HIP error: " << hipGetErrorString(error) << '\n';   \
            std::exit(1);                                                      \
        }                                                                      \
    } while (0)

__global__ void scores_kernel(const float* q, const float* k, float* scores,
                              int seq, int dim, float scale) {
    int index = blockIdx.x * blockDim.x + threadIdx.x;
    if (index >= seq * seq) return;
    int row = index / seq;
    int col = index % seq;
    float value = 0.0f;
    for (int d = 0; d < dim; ++d) {
        value += q[row * dim + d] * k[col * dim + d];
    }
    scores[index] = value * scale;
}

__global__ void softmax_rows_kernel(const float* scores, float* probabilities,
                                    int seq) {
    extern __shared__ float shared[];
    int row = blockIdx.x;
    int tid = threadIdx.x;
    float local_max = -INFINITY;
    for (int col = tid; col < seq; col += blockDim.x) {
        local_max = fmaxf(local_max, scores[row * seq + col]);
    }
    shared[tid] = local_max;
    __syncthreads();
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride) shared[tid] = fmaxf(shared[tid], shared[tid + stride]);
        __syncthreads();
    }
    float row_max = shared[0];
    float local_sum = 0.0f;
    for (int col = tid; col < seq; col += blockDim.x) {
        local_sum += expf(scores[row * seq + col] - row_max);
    }
    shared[tid] = local_sum;
    __syncthreads();
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride) shared[tid] += shared[tid + stride];
        __syncthreads();
    }
    float denominator = shared[0];
    for (int col = tid; col < seq; col += blockDim.x) {
        probabilities[row * seq + col] =
            expf(scores[row * seq + col] - row_max) / denominator;
    }
}

__global__ void probability_value_kernel(const float* probabilities,
                                         const float* value, float* output,
                                         int seq, int dim) {
    int index = blockIdx.x * blockDim.x + threadIdx.x;
    if (index >= seq * dim) return;
    int row = index / dim;
    int d = index % dim;
    float result = 0.0f;
    for (int col = 0; col < seq; ++col) {
        result += probabilities[row * seq + col] * value[col * dim + d];
    }
    output[index] = result;
}

__global__ void online_attention_kernel(const float* q, const float* k,
                                        const float* value, float* output,
                                        int seq, int dim, float scale) {
    extern __shared__ float shared[];
    float* reduction = shared;
    float* numerator = reduction + blockDim.x;
    float* state = numerator + dim;  // m, l, alpha, beta
    int row = blockIdx.x;
    int tid = threadIdx.x;

    for (int d = tid; d < dim; d += blockDim.x) numerator[d] = 0.0f;
    if (tid == 0) {
        state[0] = -INFINITY;
        state[1] = 0.0f;
    }
    __syncthreads();

    for (int col = 0; col < seq; ++col) {
        float partial = 0.0f;
        for (int d = tid; d < dim; d += blockDim.x) {
            partial += q[row * dim + d] * k[col * dim + d];
        }
        reduction[tid] = partial;
        __syncthreads();
        for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
            if (tid < stride) reduction[tid] += reduction[tid + stride];
            __syncthreads();
        }
        if (tid == 0) {
            float score = reduction[0] * scale;
            float old_max = state[0];
            float new_max = fmaxf(old_max, score);
            float alpha = expf(old_max - new_max);
            float beta = expf(score - new_max);
            state[0] = new_max;
            state[1] = state[1] * alpha + beta;
            state[2] = alpha;
            state[3] = beta;
        }
        __syncthreads();
        for (int d = tid; d < dim; d += blockDim.x) {
            numerator[d] = numerator[d] * state[2] +
                           state[3] * value[col * dim + d];
        }
        __syncthreads();
    }
    for (int d = tid; d < dim; d += blockDim.x) {
        output[row * dim + d] = numerator[d] / state[1];
    }
}

struct Options {
    std::string version = "all";
    int seq = 128;
    int dim = 64;
    int block = 256;
    int warmup = 5;
    int repeat = 20;
    int seed = 20260719;
};

Options parse_options(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        std::string name = argv[i];
        if (i + 1 >= argc) {
            std::cerr << "missing value for " << name << '\n';
            std::exit(2);
        }
        std::string value = argv[++i];
        if (name == "--version") options.version = value;
        else if (name == "--seq") options.seq = std::stoi(value);
        else if (name == "--dim") options.dim = std::stoi(value);
        else if (name == "--block") options.block = std::stoi(value);
        else if (name == "--warmup") options.warmup = std::stoi(value);
        else if (name == "--repeat") options.repeat = std::stoi(value);
        else if (name == "--seed") options.seed = std::stoi(value);
        else {
            std::cerr << "unknown option: " << name << '\n';
            std::exit(2);
        }
    }
    bool valid_version = options.version == "all" ||
                         options.version == "materialized" ||
                         options.version == "online";
    bool power_of_two = options.block > 0 &&
                        (options.block & (options.block - 1)) == 0;
    if (!valid_version || options.seq <= 0 || options.dim <= 0 ||
        !power_of_two || options.block > 1024 || options.repeat <= 0 ||
        options.warmup < 0) {
        std::cerr << "invalid arguments\n";
        std::exit(2);
    }
    return options;
}

std::vector<float> reference_attention(const std::vector<float>& q,
                                       const std::vector<float>& k,
                                       const std::vector<float>& value,
                                       int seq, int dim) {
    std::vector<float> output(seq * dim, 0.0f);
    std::vector<float> scores(seq);
    float scale = 1.0f / std::sqrt(static_cast<float>(dim));
    for (int row = 0; row < seq; ++row) {
        float maximum = -std::numeric_limits<float>::infinity();
        for (int col = 0; col < seq; ++col) {
            float score = 0.0f;
            for (int d = 0; d < dim; ++d) {
                score += q[row * dim + d] * k[col * dim + d];
            }
            scores[col] = score * scale;
            maximum = std::max(maximum, scores[col]);
        }
        float denominator = 0.0f;
        for (float& score : scores) {
            score = std::exp(score - maximum);
            denominator += score;
        }
        for (int col = 0; col < seq; ++col) {
            float probability = scores[col] / denominator;
            for (int d = 0; d < dim; ++d) {
                output[row * dim + d] += probability * value[col * dim + d];
            }
        }
    }
    return output;
}

int main(int argc, char** argv) {
    Options options = parse_options(argc, argv);
    int qkv_elements = options.seq * options.dim;
    int score_elements = options.seq * options.seq;
    size_t qkv_bytes = qkv_elements * sizeof(float);
    size_t score_bytes = score_elements * sizeof(float);

    std::mt19937 generator(options.seed);
    std::uniform_real_distribution<float> distribution(-0.5f, 0.5f);
    std::vector<float> q(qkv_elements), k(qkv_elements), value(qkv_elements);
    for (float& item : q) item = distribution(generator);
    for (float& item : k) item = distribution(generator);
    for (float& item : value) item = distribution(generator);
    std::vector<float> reference =
        reference_attention(q, k, value, options.seq, options.dim);

    float *d_q, *d_k, *d_value, *d_output, *d_scores, *d_probabilities;
    HIP_CHECK(hipMalloc(&d_q, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_k, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_value, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_output, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_scores, score_bytes));
    HIP_CHECK(hipMalloc(&d_probabilities, score_bytes));
    HIP_CHECK(hipMemcpy(d_q, q.data(), qkv_bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_k, k.data(), qkv_bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_value, value.data(), qkv_bytes, hipMemcpyHostToDevice));

    float scale = 1.0f / std::sqrt(static_cast<float>(options.dim));
    int score_grid = (score_elements + options.block - 1) / options.block;
    int output_grid = (qkv_elements + options.block - 1) / options.block;
    size_t online_shared =
        (options.block + options.dim + 4) * sizeof(float);

    auto launch = [&](const std::string& version) {
        if (version == "materialized") {
            hipLaunchKernelGGL(scores_kernel, dim3(score_grid),
                               dim3(options.block), 0, 0, d_q, d_k, d_scores,
                               options.seq, options.dim, scale);
            hipLaunchKernelGGL(softmax_rows_kernel, dim3(options.seq),
                               dim3(options.block),
                               options.block * sizeof(float), 0, d_scores,
                               d_probabilities, options.seq);
            hipLaunchKernelGGL(probability_value_kernel, dim3(output_grid),
                               dim3(options.block), 0, 0, d_probabilities,
                               d_value, d_output, options.seq, options.dim);
        } else {
            hipLaunchKernelGGL(online_attention_kernel, dim3(options.seq),
                               dim3(options.block), online_shared, 0, d_q, d_k,
                               d_value, d_output, options.seq, options.dim,
                               scale);
        }
        HIP_CHECK(hipGetLastError());
    };

    for (const std::string version : {"materialized", "online"}) {
        if (options.version != "all" && options.version != version) continue;
        for (int i = 0; i < options.warmup; ++i) launch(version);
        HIP_CHECK(hipDeviceSynchronize());
        hipEvent_t start, stop;
        HIP_CHECK(hipEventCreate(&start));
        HIP_CHECK(hipEventCreate(&stop));
        HIP_CHECK(hipEventRecord(start));
        for (int i = 0; i < options.repeat; ++i) launch(version);
        HIP_CHECK(hipEventRecord(stop));
        HIP_CHECK(hipEventSynchronize(stop));
        float total_ms = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&total_ms, start, stop));
        std::vector<float> actual(qkv_elements);
        HIP_CHECK(hipMemcpy(actual.data(), d_output, qkv_bytes,
                            hipMemcpyDeviceToHost));
        float max_error = 0.0f;
        for (int i = 0; i < qkv_elements; ++i) {
            max_error = std::max(max_error, std::abs(actual[i] - reference[i]));
        }
        bool correct = max_error < 2e-4f;
        std::cout << "RESULT operator=attention implementation=hip-" << version
                  << " runtime=hip seq=" << options.seq
                  << " dim=" << options.dim << " block=" << options.block
                  << " correct=" << (correct ? "OK" : "FAIL")
                  << " mean_ms=" << total_ms / options.repeat
                  << " max_abs_error=" << max_error << '\n';
        HIP_CHECK(hipEventDestroy(start));
        HIP_CHECK(hipEventDestroy(stop));
        if (!correct) return 1;
    }

    HIP_CHECK(hipFree(d_q));
    HIP_CHECK(hipFree(d_k));
    HIP_CHECK(hipFree(d_value));
    HIP_CHECK(hipFree(d_output));
    HIP_CHECK(hipFree(d_scores));
    HIP_CHECK(hipFree(d_probabilities));
    return 0;
}
