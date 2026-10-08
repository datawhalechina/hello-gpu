// Chapter 13: row-wise FP32 RMSNorm, serial bridge and block LDS reduction.
#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#define HIP_CHECK(call)                                                        \
    do {                                                                      \
        const hipError_t error = (call);                                       \
        if (error != hipSuccess) {                                             \
            std::cerr << "HIP error: " << hipGetErrorString(error) << '\n';    \
            std::exit(1);                                                     \
        }                                                                     \
    } while (0)

constexpr double kAtol = 2.0e-5;
constexpr double kRtol = 2.0e-5;

__global__ void rmsnorm_serial_kernel(const float* input, const float* weight,
                                      float* output, int rows, int cols,
                                      float epsilon) {
    const std::size_t row =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (row >= static_cast<std::size_t>(rows)) return;
    const std::size_t base = row * cols;
    float square_sum = 0.0f;
    for (int col = 0; col < cols; ++col) {
        const float value = input[base + col];
        square_sum += value * value;
    }
    const float inverse_rms = rsqrtf(square_sum / cols + epsilon);
    for (int col = 0; col < cols; ++col)
        output[base + col] = input[base + col] * inverse_rms * weight[col];
}

__global__ void rmsnorm_block_kernel(const float* input, const float* weight,
                                     float* output, int rows, int cols,
                                     float epsilon) {
    extern __shared__ float shared[];
    const std::size_t row = blockIdx.x;
    if (row >= static_cast<std::size_t>(rows)) return;
    const std::size_t base = row * cols;
    const int tid = threadIdx.x;
    float square_sum = 0.0f;
    for (int col = tid; col < cols; col += blockDim.x) {
        const float value = input[base + col];
        square_sum += value * value;
    }
    shared[tid] = square_sum;
    __syncthreads();
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride) shared[tid] += shared[tid + stride];
        __syncthreads();
    }
    const float inverse_rms = rsqrtf(shared[0] / cols + epsilon);
    for (int col = tid; col < cols; col += blockDim.x)
        output[base + col] = input[base + col] * inverse_rms * weight[col];
}

struct Options {
    std::string version = "all";
    int rows = 1024;
    int cols = 4096;
    int block = 256;
    int warmup = 5;
    int repeat = 20;
    std::uint64_t seed = 20260920;
    float epsilon = 1e-5f;
    std::string input_mode = "normal";
    std::string samples;
    std::string config_id;
    int process_id = 1;
};

struct Validation {
    bool correct;
    double max_absolute_error;
    double max_relative_error;
};

struct Timing {
    double minimum_ms;
    double median_ms;
    double mean_ms;
    std::vector<double> samples;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::cerr << message << '\n'
              << "Usage: rmsnorm_hip --version all|serial|block [--rows N] [--cols N] "
              << "[--block N] [--epsilon F] [--input normal|zero|zero-weight|signed-weight] "
              << "[--seed N] [--warmup N] [--repeat N] [--samples CSV] "
              << "[--config-id ID] [--process-id N]\n";
    std::exit(2);
}

std::uint64_t unsigned_value(const std::string& value) {
    if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos)
        usage_error("expected a non-negative integer: " + value);
    return std::stoull(value);
}

int int_value(const std::string& value) {
    const auto parsed = unsigned_value(value);
    if (parsed > static_cast<std::uint64_t>(std::numeric_limits<int>::max()))
        usage_error("integer is too large: " + value);
    return static_cast<int>(parsed);
}

Options parse_options(int argc, char** argv) {
    Options options;
    for (int index = 1; index < argc; ++index) {
        const std::string name = argv[index];
        if (index + 1 >= argc) usage_error("missing value for " + name);
        const std::string value = argv[++index];
        try {
            if (name == "--version") options.version = value;
            else if (name == "--rows") options.rows = int_value(value);
            else if (name == "--cols") options.cols = int_value(value);
            else if (name == "--block") options.block = int_value(value);
            else if (name == "--warmup") options.warmup = int_value(value);
            else if (name == "--repeat") options.repeat = int_value(value);
            else if (name == "--seed") options.seed = unsigned_value(value);
            else if (name == "--epsilon") {
                std::size_t end = 0;
                options.epsilon = std::stof(value, &end);
                if (end != value.size()) usage_error("invalid epsilon");
            } else if (name == "--input") options.input_mode = value;
            else if (name == "--samples") options.samples = value;
            else if (name == "--config-id") options.config_id = value;
            else if (name == "--process-id" || name == "--process")
                options.process_id = int_value(value);
            else usage_error("unknown option: " + name);
        } catch (const std::exception&) {
            usage_error("invalid value for " + name);
        }
    }
    const bool valid_version = options.version == "all" ||
        options.version == "serial" || options.version == "block";
    const bool power_of_two = options.block > 0 &&
        (options.block & (options.block - 1)) == 0;
    const bool valid_input = options.input_mode == "normal" ||
        options.input_mode == "zero" || options.input_mode == "zero-weight" ||
        options.input_mode == "signed-weight";
    if (!valid_version || !valid_input || options.rows <= 0 || options.cols <= 0 ||
        options.cols > 65536 || !power_of_two || options.block > 1024 ||
        options.repeat <= 0 || options.process_id <= 0 ||
        !std::isfinite(options.epsilon) || options.epsilon <= 0.0f)
        usage_error("invalid shape, configuration, input, epsilon, or repeat");
    if (!options.samples.empty() && options.version == "all")
        usage_error("--samples requires a single --version");
    if (options.config_id.find_first_not_of(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") != std::string::npos)
        usage_error("config-id must contain only letters, digits, '-', '_' or '.'");
    const std::size_t rows = options.rows;
    if (rows > std::numeric_limits<std::size_t>::max() / options.cols / sizeof(float))
        usage_error("matrix byte size overflows size_t");
    return options;
}

void make_inputs(std::vector<float>& input, std::vector<float>& weight,
                 const Options& options) {
    for (std::size_t index = 0; index < input.size(); ++index) {
        const long long value = static_cast<long long>(
            (17ULL * (index % 257ULL) + options.seed % 257ULL) % 257ULL) - 128;
        input[index] = options.input_mode == "zero" ? 0.0f : value / 128.0f;
    }
    for (std::size_t col = 0; col < weight.size(); ++col) {
        const long long value = static_cast<long long>(
            (29ULL * (col % 251ULL) + 3ULL * (options.seed % 251ULL)) % 251ULL) - 125;
        weight[col] = value / 128.0f;
        if (options.input_mode == "zero-weight") weight[col] = 0.0f;
        if (options.input_mode == "signed-weight")
            weight[col] = (col % 2 == 0 ? -1.0f : 1.0f) *
                          (0.5f + static_cast<float>(col % 9) / 16.0f);
    }
}

std::vector<float> reference_rmsnorm(const std::vector<float>& input,
                                     const std::vector<float>& weight,
                                     int rows, int cols, float epsilon) {
    std::vector<float> output(input.size());
    for (int row = 0; row < rows; ++row) {
        const std::size_t base = static_cast<std::size_t>(row) * cols;
        double square_sum = 0.0;
        for (int col = 0; col < cols; ++col) {
            const double value = input[base + col];
            square_sum += value * value;
        }
        const double inverse_rms =
            1.0 / std::sqrt(square_sum / cols + static_cast<double>(epsilon));
        for (int col = 0; col < cols; ++col)
            output[base + col] = static_cast<float>(
                static_cast<double>(input[base + col]) * inverse_rms *
                static_cast<double>(weight[col]));
    }
    return output;
}

Validation validate(const std::vector<float>& actual,
                    const std::vector<float>& reference) {
    bool correct = true;
    double max_absolute = 0.0, max_relative = 0.0;
    for (std::size_t index = 0; index < reference.size(); ++index) {
        const double value = actual[index], expected = reference[index];
        if (!std::isfinite(value) || !std::isfinite(expected)) {
            correct = false;
            max_absolute = max_relative = std::numeric_limits<double>::infinity();
            continue;
        }
        const double error = std::abs(value - expected);
        if (error > kAtol + kRtol * std::abs(expected)) correct = false;
        max_absolute = std::max(max_absolute, error);
        max_relative = std::max(max_relative, error / std::max(std::abs(expected), 1e-6));
    }
    return {correct, max_absolute, max_relative};
}

unsigned int grid_size(const std::string& version, const Options& options) {
    return version == "serial"
        ? options.rows / options.block + (options.rows % options.block != 0)
        : options.rows;
}

void launch(const std::string& version, const Options& options,
            const float* input, const float* weight, float* output) {
    if (version == "serial")
        hipLaunchKernelGGL(rmsnorm_serial_kernel, dim3(grid_size(version, options)),
                          dim3(options.block), 0, 0, input, weight, output,
                          options.rows, options.cols, options.epsilon);
    else
        hipLaunchKernelGGL(rmsnorm_block_kernel, dim3(options.rows),
                          dim3(options.block), options.block * sizeof(float), 0,
                          input, weight, output, options.rows, options.cols, options.epsilon);
    HIP_CHECK(hipGetLastError());
}

Timing benchmark(const std::string& version, const Options& options,
                 const float* input, const float* weight, float* output) {
    for (int i = 0; i < options.warmup; ++i) launch(version, options, input, weight, output);
    HIP_CHECK(hipDeviceSynchronize());
    std::vector<hipEvent_t> starts(options.repeat), stops(options.repeat);
    for (int i = 0; i < options.repeat; ++i) {
        HIP_CHECK(hipEventCreate(&starts[i]));
        HIP_CHECK(hipEventCreate(&stops[i]));
    }
    std::vector<double> samples(options.repeat);
    for (int i = 0; i < options.repeat; ++i) {
        HIP_CHECK(hipEventRecord(starts[i]));
        launch(version, options, input, weight, output);
        HIP_CHECK(hipEventRecord(stops[i]));
        HIP_CHECK(hipEventSynchronize(stops[i]));
        float elapsed = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&elapsed, starts[i], stops[i]));
        samples[i] = elapsed;
    }
    for (int i = 0; i < options.repeat; ++i) {
        HIP_CHECK(hipEventDestroy(starts[i]));
        HIP_CHECK(hipEventDestroy(stops[i]));
    }
    auto sorted = samples;
    std::sort(sorted.begin(), sorted.end());
    double sum = 0.0;
    for (const double sample : samples) sum += sample;
    const auto mid = sorted.size() / 2;
    const double median = sorted.size() % 2
        ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0;
    return {sorted.front(), median, sum / samples.size(), samples};
}

template <typename T> std::string number(T value) {
    std::ostringstream stream;
    stream << std::setprecision(17) << value;
    return stream.str();
}

using Record = std::vector<std::pair<std::string, std::string>>;

Record metadata(const std::string& version, const Options& options) {
    return {
        {"config_id", options.config_id.empty()
            ? "hip-" + version + "-b" + number(options.block) : options.config_id},
        {"implementation", "hip-" + version}, {"runtime", "hip"},
        {"shape", number(options.rows) + "x" + number(options.cols)},
        {"dtype", "float32"}, {"rows", number(options.rows)}, {"cols", number(options.cols)},
        {"epsilon", number(options.epsilon)}, {"block", number(options.block)},
        {"block_threads", number(options.block)}, {"block_size", "NA"},
        {"rows_per_program", "NA"}, {"num_warps", "NA"},
        {"grid", number(grid_size(version, options))}, {"launches", "1"},
        {"input", "rmsnorm-dyadic-v1"}, {"input_mode", options.input_mode},
        {"input_precision", "fp32"}, {"reference", "cpu-fp64-to-fp32"},
        {"atol", number(kAtol)}, {"rtol", number(kRtol)}, {"seed", number(options.seed)},
        {"warmup", number(options.warmup)}, {"repeat", number(options.repeat)},
        {"process", number(options.process_id)}, {"process_id", number(options.process_id)},
        {"scope", "gpu-event-full-operator"},
    };
}

void print_result(const std::string& version, const Options& options,
                  const Validation& validation, const Timing* timing,
                  const char* precheck, const char* postcheck) {
    std::cout << "RESULT operator=rmsnorm";
    for (const auto& field : metadata(version, options))
        std::cout << ' ' << field.first << '=' << field.second;
    std::cout << " timed=" << (timing != nullptr)
              << " correct=" << (validation.correct ? "OK" : "FAIL")
              << " precheck=" << precheck << " postcheck=" << postcheck
              << " min_ms=" << (timing ? number(timing->minimum_ms) : "NA")
              << " median_ms=" << (timing ? number(timing->median_ms) : "NA")
              << " mean_ms=" << (timing ? number(timing->mean_ms) : "NA")
              << " max_abs_error=" << number(validation.max_absolute_error)
              << " max_rel_error=" << number(validation.max_relative_error) << '\n';
}

void save_samples(const std::string& version, const Options& options, const Timing& timing) {
    if (options.samples.empty()) return;
    std::ofstream file(options.samples);
    if (!file) usage_error("cannot open sample file");
    const auto record = metadata(version, options);
    for (const auto& field : record) file << field.first << ',';
    file << "sample,ms\n";
    for (std::size_t index = 0; index < timing.samples.size(); ++index) {
        for (const auto& field : record) file << field.second << ',';
        file << index << ',' << number(timing.samples[index]) << '\n';
    }
    if (!file) usage_error("failed writing sample file");
}

int main(int argc, char** argv) {
    const Options options = parse_options(argc, argv);
    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    if (options.block > properties.maxThreadsPerBlock || options.block > properties.maxThreadsDim[0])
        usage_error("block exceeds device limits");
    std::cout << "ENV runtime=hip gpu=\"" << properties.name << "\" architecture="
              << properties.gcnArchName << " input=rmsnorm-dyadic-v1"
              << " reference=cpu-fp64-to-fp32 timing=per-sample-event-sync\n";
    const std::size_t elements = static_cast<std::size_t>(options.rows) * options.cols;
    const std::size_t bytes = elements * sizeof(float);
    const std::size_t weight_bytes = static_cast<std::size_t>(options.cols) * sizeof(float);
    std::vector<float> input(elements), weight(options.cols);
    make_inputs(input, weight, options);
    const auto reference = reference_rmsnorm(input, weight, options.rows, options.cols, options.epsilon);
    std::vector<float> actual(elements), nan_output(elements, std::numeric_limits<float>::quiet_NaN());
    float *d_input = nullptr, *d_weight = nullptr, *d_output = nullptr;
    HIP_CHECK(hipMalloc(&d_input, bytes));
    HIP_CHECK(hipMalloc(&d_weight, weight_bytes));
    HIP_CHECK(hipMalloc(&d_output, bytes));
    HIP_CHECK(hipMemcpy(d_input, input.data(), bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_weight, weight.data(), weight_bytes, hipMemcpyHostToDevice));
    bool all_correct = true;
    for (const std::string version : {"serial", "block"}) {
        if (options.version != "all" && options.version != version) continue;
        HIP_CHECK(hipMemcpy(d_output, nan_output.data(), bytes, hipMemcpyHostToDevice));
        launch(version, options, d_input, d_weight, d_output);
        HIP_CHECK(hipDeviceSynchronize());
        HIP_CHECK(hipMemcpy(actual.data(), d_output, bytes, hipMemcpyDeviceToHost));
        const auto precheck = validate(actual, reference);
        if (!precheck.correct) {
            print_result(version, options, precheck, nullptr, "FAIL", "NA");
            all_correct = false;
            continue;
        }
        const auto timing = benchmark(version, options, d_input, d_weight, d_output);
        HIP_CHECK(hipMemcpy(actual.data(), d_output, bytes, hipMemcpyDeviceToHost));
        const auto postcheck = validate(actual, reference);
        print_result(version, options, postcheck, &timing, "OK", postcheck.correct ? "OK" : "FAIL");
        if (postcheck.correct) save_samples(version, options, timing);
        all_correct = postcheck.correct && all_correct;
    }
    HIP_CHECK(hipFree(d_input));
    HIP_CHECK(hipFree(d_weight));
    HIP_CHECK(hipFree(d_output));
    return all_correct ? 0 : 1;
}
