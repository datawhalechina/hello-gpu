#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <numeric>
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
    // Finish every read of the maximum before reusing LDS for local sums.
    __syncthreads();
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

// Both runtimes use this element-wise contract against a CPU FP64 reference
// rounded once to FP32. NaN/Inf always fails, independently of the error value.
constexpr double kAtol = 2.0e-5;
constexpr double kRtol = 2.0e-4;

struct Options {
    std::string version = "all";
    std::string input = "dyadic";
    std::string samples;
    std::string config_id;
    int seq = 128;
    int dim = 64;
    int block = 256;
    int warmup = 10;
    int repeat = 50;
    std::uint64_t seed = 20260920;
    int process = 1;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::cerr << message << '\n';
    std::exit(2);
}

std::uint64_t unsigned_integer(const std::string& text) {
    if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos)
        usage_error("expected a non-negative integer: " + text);
    try {
        return std::stoull(text);
    } catch (const std::exception&) {
        usage_error("integer out of range: " + text);
    }
}

Options parse_options(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string name = argv[i];
        if (name == "--help") {
            std::cout << "--version all|materialized|online --seq S --dim D "
                         "--block THREADS --input dyadic|rising-max --seed UINT32 "
                         "--warmup N --repeat N --config-id ID --process N "
                         "--samples FILE\n";
            std::exit(0);
        }
        if (i + 1 >= argc) usage_error("missing value for " + name);
        const std::string value = argv[++i];
        if (name == "--version") options.version = value;
        else if (name == "--input") options.input = value;
        else if (name == "--samples") options.samples = value;
        else if (name == "--config-id") options.config_id = value;
        else if (name == "--seed") options.seed = unsigned_integer(value);
        else {
            const auto number = unsigned_integer(value);
            if (number > static_cast<std::uint64_t>(std::numeric_limits<int>::max()))
                usage_error("integer too large for " + name);
            const int integer = static_cast<int>(number);
            if (name == "--seq") options.seq = integer;
            else if (name == "--dim") options.dim = integer;
            else if (name == "--block") options.block = integer;
            else if (name == "--warmup") options.warmup = integer;
            else if (name == "--repeat") options.repeat = integer;
            else if (name == "--process") options.process = integer;
            else usage_error("unknown option: " + name);
        }
    }
    const bool valid_version = options.version == "all" ||
                              options.version == "materialized" ||
                              options.version == "online";
    const bool power_of_two = options.block > 0 &&
                             (options.block & (options.block - 1)) == 0;
    if (!valid_version || options.seq <= 0 || options.seq > 4096 ||
        options.dim <= 0 || options.dim > 256 || !power_of_two ||
        options.block > 1024 || options.repeat <= 0 || options.process <= 0 ||
        options.seed > 0xFFFFFFFFULL ||
        (options.input != "dyadic" && options.input != "rising-max"))
        usage_error("invalid arguments (1 <= seq <= 4096, 1 <= dim <= 256)");
    if (options.config_id.find_first_not_of(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") != std::string::npos)
        usage_error("invalid config-id");
    if (!options.samples.empty() &&
        (options.version == "all" || options.config_id.empty()))
        usage_error("--samples requires one version and a --config-id");
    return options;
}

struct Inputs {
    std::vector<float> q;
    std::vector<float> k;
    std::vector<float> value;
};

Inputs make_input(const Options& options) {
    const std::size_t size = static_cast<std::size_t>(options.seq) * options.dim;
    Inputs input{std::vector<float>(size), std::vector<float>(size),
                 std::vector<float>(size)};
    for (int row = 0; row < options.seq; ++row) {
        for (int d = 0; d < options.dim; ++d) {
            const std::size_t index = static_cast<std::size_t>(row) * options.dim + d;
            const auto r = static_cast<std::uint64_t>(row);
            const auto column = static_cast<std::uint64_t>(d);
            input.q[index] = (static_cast<int>((17 * r + 13 * column + options.seed) % 65) - 32) / 64.0f;
            input.k[index] = (static_cast<int>((29 * r + 7 * column + options.seed + 11) % 65) - 32) / 64.0f;
            input.value[index] = (static_cast<int>((11 * r + 19 * column + options.seed + 23) % 65) - 32) / 32.0f;
            if (options.input == "rising-max") {
                // Every later key has a larger score, including across tiles.
                input.q[index] = d == 0 ? 8.0f : 0.0f;
                input.k[index] = d == 0 ? (row - options.seq / 2) / 8.0f : 0.0f;
            }
        }
    }
    return input;
}

std::vector<float> reference_attention(const Inputs& input, int seq, int dim) {
    std::vector<float> output(static_cast<std::size_t>(seq) * dim);
    std::vector<double> weights(seq);
    const double scale = 1.0 / std::sqrt(static_cast<double>(dim));
    for (int row = 0; row < seq; ++row) {
        double maximum = -std::numeric_limits<double>::infinity();
        for (int col = 0; col < seq; ++col) {
            double score = 0.0;
            for (int d = 0; d < dim; ++d)
                score += static_cast<double>(input.q[row * dim + d]) * input.k[col * dim + d];
            weights[col] = score * scale;
            maximum = std::max(maximum, weights[col]);
        }
        double denominator = 0.0;
        for (double& weight : weights) {
            weight = std::exp(weight - maximum);
            denominator += weight;
        }
        for (int d = 0; d < dim; ++d) {
            double result = 0.0;
            for (int col = 0; col < seq; ++col)
                result += (weights[col] / denominator) * input.value[col * dim + d];
            output[row * dim + d] = static_cast<float>(result);
        }
    }
    return output;
}

struct Validation {
    bool correct = true;
    bool finite = true;
    double max_absolute_error = 0.0;
    double max_tolerance_ratio = 0.0;
};

Validation validate(const std::vector<float>& actual, const std::vector<float>& reference) {
    Validation result;
    for (std::size_t i = 0; i < actual.size(); ++i) {
        if (!std::isfinite(actual[i]) || !std::isfinite(reference[i])) {
            result.correct = false;
            result.finite = false;
            result.max_absolute_error = std::numeric_limits<double>::infinity();
            result.max_tolerance_ratio = std::numeric_limits<double>::infinity();
            continue;
        }
        const double error = std::abs(static_cast<double>(actual[i]) - reference[i]);
        const double tolerance = kAtol + kRtol * std::abs(static_cast<double>(reference[i]));
        result.max_absolute_error = std::max(result.max_absolute_error, error);
        result.max_tolerance_ratio = std::max(result.max_tolerance_ratio, error / tolerance);
        result.correct = result.correct && error <= tolerance;
    }
    return result;
}

struct Timing {
    double minimum_ms;
    double median_ms;
    double mean_ms;
    std::vector<double> samples;
};

template <typename Launch>
Timing benchmark(const Options& options, Launch launch) {
    for (int i = 0; i < options.warmup; ++i) launch();
    HIP_CHECK(hipDeviceSynchronize());
    hipEvent_t start, stop;
    HIP_CHECK(hipEventCreate(&start));
    HIP_CHECK(hipEventCreate(&stop));
    std::vector<double> samples;
    samples.reserve(options.repeat);
    for (int i = 0; i < options.repeat; ++i) {
        HIP_CHECK(hipEventRecord(start, nullptr));
        launch();
        HIP_CHECK(hipEventRecord(stop, nullptr));
        HIP_CHECK(hipEventSynchronize(stop));
        float elapsed = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&elapsed, start, stop));
        samples.push_back(elapsed);
    }
    HIP_CHECK(hipEventDestroy(start));
    HIP_CHECK(hipEventDestroy(stop));
    auto sorted = samples;
    std::sort(sorted.begin(), sorted.end());
    const std::size_t middle = sorted.size() / 2;
    const double median = sorted.size() % 2 == 0
        ? (sorted[middle - 1] + sorted[middle]) / 2.0 : sorted[middle];
    return {sorted.front(), median,
            std::accumulate(samples.begin(), samples.end(), 0.0) / samples.size(), samples};
}

void print_result(const Options& options, const std::string& version,
                  const Validation& validation, const Timing* timing,
                  const char* precheck, const char* postcheck) {
    const std::size_t intermediate_bytes = 2ULL * options.seq * options.seq * sizeof(float);
    std::cout << std::setprecision(17)
              << "RESULT operator=attention implementation=hip-" << version
              << " runtime=hip config_id=" << options.config_id
              << " shape=" << options.seq << 'x' << options.dim
              << " seq=" << options.seq << " dim=" << options.dim
              << " dtype=float32 input_precision=fp32 block=" << options.block
              << " block_k=" << (version == "online" ? 1 : 0)
              << " block_d=0 num_warps=0 launches=" << (version == "materialized" ? 3 : 1)
              << " warmup=" << options.warmup << " repeat=" << options.repeat
              << " seed=" << options.seed << " process=" << options.process
              << " timing=gpu-event scope=gpu-event-full-operator input=" << options.input
              << " reference=fp64-attention-to-fp32 atol=" << kAtol << " rtol=" << kRtol
              << " intermediate_allocated_bytes=" << intermediate_bytes
              << " intermediate_used_bytes=" << (version == "materialized" ? intermediate_bytes : 0)
              << " output_finite=" << (validation.finite ? "OK" : "FAIL")
              << " timed=" << (timing != nullptr) << " correct=" << (validation.correct ? "OK" : "FAIL")
              << " precheck=" << precheck << " postcheck=" << postcheck;
    if (timing)
        std::cout << " min_ms=" << timing->minimum_ms << " median_ms=" << timing->median_ms
                  << " mean_ms=" << timing->mean_ms;
    else
        std::cout << " min_ms=NA median_ms=NA mean_ms=NA";
    std::cout << " max_abs_error=" << validation.max_absolute_error
              << " max_tolerance_ratio=" << validation.max_tolerance_ratio << '\n';
}

void save_samples(const Options& options, const std::string& version, const Timing& timing) {
    if (options.samples.empty()) return;
    std::ofstream file(options.samples);
    if (!file) usage_error("cannot open sample file: " + options.samples);
    file << "config_id,implementation,runtime,shape,dtype,block,block_k,block_d,num_warps,launches,warmup,repeat,seed,process,scope,input,input_precision,atol,rtol,intermediate_allocated_bytes,intermediate_used_bytes,sample,ms\n";
    file << std::setprecision(17);
    const std::size_t intermediate_bytes = 2ULL * options.seq * options.seq * sizeof(float);
    for (std::size_t i = 0; i < timing.samples.size(); ++i)
        file << options.config_id << ",hip-" << version << ",hip,"
             << options.seq << 'x' << options.dim << ",float32," << options.block << ','
             << (version == "online" ? 1 : 0) << ",0,0," << (version == "materialized" ? 3 : 1)
             << ',' << options.warmup << ',' << options.repeat << ',' << options.seed << ','
             << options.process << ",gpu-event-full-operator," << options.input << ",fp32,"
             << kAtol << ',' << kRtol << ',' << intermediate_bytes << ','
             << (version == "materialized" ? intermediate_bytes : 0) << ',' << i << ',' << timing.samples[i] << '\n';
    if (!file) usage_error("failed writing sample file: " + options.samples);
}

int main(int argc, char** argv) {
    const Options options = parse_options(argc, argv);
    const int qkv_elements = options.seq * options.dim;
    const int score_elements = options.seq * options.seq;
    const std::size_t qkv_bytes = static_cast<std::size_t>(qkv_elements) * sizeof(float);
    const std::size_t score_bytes = static_cast<std::size_t>(score_elements) * sizeof(float);
    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    std::cout << "ENV runtime=hip gpu=\"" << properties.name << "\" arch="
              << properties.gcnArchName << " wave_size=" << properties.warpSize << '\n';

    const Inputs input = make_input(options);
    const std::vector<float> reference = reference_attention(input, options.seq, options.dim);
    std::vector<float> actual(qkv_elements);
    float *d_q, *d_k, *d_value, *d_output, *d_scores, *d_probabilities;
    HIP_CHECK(hipMalloc(&d_q, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_k, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_value, qkv_bytes));
    HIP_CHECK(hipMalloc(&d_output, qkv_bytes));
    // Both paths keep the same host allocation plan. Online avoids accessing
    // scores/P, but this executable does not demonstrate a lower allocation peak.
    HIP_CHECK(hipMalloc(&d_scores, score_bytes));
    HIP_CHECK(hipMalloc(&d_probabilities, score_bytes));
    HIP_CHECK(hipMemcpy(d_q, input.q.data(), qkv_bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_k, input.k.data(), qkv_bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_value, input.value.data(), qkv_bytes, hipMemcpyHostToDevice));
    const float scale = static_cast<float>(1.0 / std::sqrt(static_cast<double>(options.dim)));
    const int score_grid = (score_elements + options.block - 1) / options.block;
    const int output_grid = (qkv_elements + options.block - 1) / options.block;
    const std::size_t online_shared = (options.block + options.dim + 4) * sizeof(float);
    auto launch = [&](const std::string& version) {
        if (version == "materialized") {
            hipLaunchKernelGGL(scores_kernel, dim3(score_grid), dim3(options.block), 0, 0,
                               d_q, d_k, d_scores, options.seq, options.dim, scale);
            HIP_CHECK(hipGetLastError());
            hipLaunchKernelGGL(softmax_rows_kernel, dim3(options.seq), dim3(options.block),
                               options.block * sizeof(float), 0,
                               d_scores, d_probabilities, options.seq);
            HIP_CHECK(hipGetLastError());
            hipLaunchKernelGGL(probability_value_kernel, dim3(output_grid), dim3(options.block), 0, 0,
                               d_probabilities, d_value, d_output, options.seq, options.dim);
        } else {
            hipLaunchKernelGGL(online_attention_kernel, dim3(options.seq), dim3(options.block),
                               online_shared, 0, d_q, d_k, d_value, d_output,
                               options.seq, options.dim, scale);
        }
        HIP_CHECK(hipGetLastError());
    };
    bool all_correct = true;
    for (const std::string version : {"materialized", "online"}) {
        if (options.version != "all" && options.version != version) continue;
        HIP_CHECK(hipMemset(d_output, 0xFF, qkv_bytes));
        HIP_CHECK(hipMemset(d_scores, 0xFF, score_bytes));
        HIP_CHECK(hipMemset(d_probabilities, 0xFF, score_bytes));
        launch(version);
        HIP_CHECK(hipDeviceSynchronize());
        HIP_CHECK(hipMemcpy(actual.data(), d_output, qkv_bytes, hipMemcpyDeviceToHost));
        const Validation precheck = validate(actual, reference);
        if (!precheck.correct) {
            print_result(options, version, precheck, nullptr, "FAIL", "NA");
            all_correct = false;
            continue;
        }
        const Timing timing = benchmark(options, [&] { launch(version); });
        HIP_CHECK(hipMemcpy(actual.data(), d_output, qkv_bytes, hipMemcpyDeviceToHost));
        const Validation postcheck = validate(actual, reference);
        print_result(options, version, postcheck, &timing, "OK", postcheck.correct ? "OK" : "FAIL");
        all_correct = all_correct && postcheck.correct;
        if (postcheck.correct) save_samples(options, version, timing);
    }
    HIP_CHECK(hipFree(d_q));
    HIP_CHECK(hipFree(d_k));
    HIP_CHECK(hipFree(d_value));
    HIP_CHECK(hipFree(d_output));
    HIP_CHECK(hipFree(d_scores));
    HIP_CHECK(hipFree(d_probabilities));
    return all_correct ? 0 : 1;
}
