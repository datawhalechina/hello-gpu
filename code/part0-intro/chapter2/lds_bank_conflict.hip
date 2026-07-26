#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <numeric>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#define HIP_CHECK(call)                                                        \
    do {                                                                       \
        const hipError_t error = (call);                                       \
        if (error != hipSuccess) {                                             \
            std::fprintf(stderr, "HIP error at %s:%d: %s\n", __FILE__,       \
                         __LINE__, hipGetErrorString(error));                   \
            std::exit(EXIT_FAILURE);                                           \
        }                                                                      \
    } while (false)

namespace {

constexpr int kBlockSize = 256;
constexpr unsigned int kWaveSize = 32;
constexpr unsigned int kWavesPerBlock = kBlockSize / kWaveSize;
constexpr unsigned int kRegion = 1056;
constexpr unsigned int kReadIterations = 256;
constexpr std::size_t kPrecheckSize = kBlockSize;
constexpr std::size_t kSampleCount = 64;
constexpr float kTolerance = 1.0e-5f;
static_assert(kWavesPerBlock == 8, "the lab requires eight wave32 groups");
static_assert(31 * 33 + 31 < kRegion,
              "the stride-33 region must remain in bounds");

struct Args {
    std::string implementation = "all";
    std::size_t size = 16 * 1024 * 1024;
    int warmup = 5;
    int repeat = 20;
    std::size_t seed = 20260726;
};

struct Timing {
    float minimum_ms;
    float median_ms;
    float mean_ms;
};

struct Implementation {
    unsigned int stride;
    const char* name;
};

void print_usage(FILE* stream) {
    std::fprintf(
        stream,
        "Usage: lds_bank_conflict [--implementation "
        "all|stride-1|stride-32|stride-33] [--size N] [--warmup N] "
        "[--repeat N] [--seed N]\n");
}

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(stderr, "%s\n", message.c_str());
    print_usage(stderr);
    std::exit(EXIT_FAILURE);
}

std::size_t parse_unsigned(const std::string& value,
                           const std::string& option) {
    if (value.empty() || value.front() == '-') {
        usage_error("invalid value for " + option + ": " + value);
    }
    std::size_t parsed = 0;
    unsigned long long result = 0;
    try {
        result = std::stoull(value, &parsed, 10);
    } catch (const std::exception&) {
        usage_error("invalid value for " + option + ": " + value);
    }
    if (parsed != value.size() ||
        result > std::numeric_limits<std::size_t>::max()) {
        usage_error("invalid value for " + option + ": " + value);
    }
    return static_cast<std::size_t>(result);
}

int parse_integer(const std::string& value, const std::string& option) {
    std::size_t parsed = 0;
    long long result = 0;
    try {
        result = std::stoll(value, &parsed, 10);
    } catch (const std::exception&) {
        usage_error("invalid value for " + option + ": " + value);
    }
    if (parsed != value.size() ||
        result < std::numeric_limits<int>::min() ||
        result > std::numeric_limits<int>::max()) {
        usage_error("invalid value for " + option + ": " + value);
    }
    return static_cast<int>(result);
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        if (option == "--help" || option == "-h") {
            print_usage(stdout);
            std::exit(EXIT_SUCCESS);
        }
        if (index + 1 >= argc) {
            usage_error("missing value for " + option);
        }
        const std::string value = argv[++index];
        if (option == "--implementation") {
            args.implementation = value;
        } else if (option == "--size") {
            args.size = parse_unsigned(value, option);
        } else if (option == "--warmup") {
            args.warmup = parse_integer(value, option);
        } else if (option == "--repeat") {
            args.repeat = parse_integer(value, option);
        } else if (option == "--seed") {
            args.seed = parse_unsigned(value, option);
        } else {
            usage_error("unknown option: " + option);
        }
    }

    if (args.size == 0) {
        usage_error("--size must be positive");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.implementation != "all" &&
        args.implementation != "stride-1" &&
        args.implementation != "stride-32" &&
        args.implementation != "stride-33") {
        usage_error("unknown implementation: " + args.implementation);
    }
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& selection) {
    const Implementation stride_1{1, "stride-1"};
    const Implementation stride_32{32, "stride-32"};
    const Implementation stride_33{33, "stride-33"};
    if (selection == "all") {
        return {stride_1, stride_32, stride_33};
    }
    if (selection == stride_1.name) {
        return {stride_1};
    }
    if (selection == stride_32.name) {
        return {stride_32};
    }
    if (selection == stride_33.name) {
        return {stride_33};
    }
    usage_error("unknown implementation: " + selection);
}

__host__ __device__ float shared_value(unsigned int index) {
    return static_cast<float>((index % kRegion) + 1u) * (1.0f / 1024.0f);
}

template <unsigned int Stride>
__global__ void lds_kernel(const float* input, float* output, std::size_t n) {
    constexpr unsigned int kSharedElements = kWavesPerBlock * kRegion;
    volatile __shared__ float shared[kSharedElements];
    volatile float* shared_pointer = shared;
    for (unsigned int offset = threadIdx.x; offset < kSharedElements;
         offset += kBlockSize) {
        shared[offset] = shared_value(offset);
    }
    __syncthreads();

    const std::size_t tid =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (tid >= n) {
        return;
    }
    unsigned wave = threadIdx.x / kWaveSize;
    unsigned lane = threadIdx.x % kWaveSize;
    float accumulator = input[tid];
    for (unsigned int iteration = 0; iteration < kReadIterations;
         ++iteration) {
        unsigned index = wave * kRegion + lane * Stride +
                                 (iteration & 31);
        accumulator += shared_pointer[index];
    }
    output[tid] = accumulator;
}

unsigned int grid_for(std::size_t n) {
    const std::size_t blocks =
        n / static_cast<std::size_t>(kBlockSize) +
        (n % static_cast<std::size_t>(kBlockSize) != 0);
    if (blocks > std::numeric_limits<unsigned int>::max()) {
        usage_error("--size produces a grid that overflows unsigned int");
    }
    return static_cast<unsigned int>(blocks);
}

template <unsigned int Stride>
void launch_stride(const float* input, float* output, std::size_t n) {
    hipLaunchKernelGGL(
        HIP_KERNEL_NAME(lds_kernel<Stride>),
        dim3(grid_for(n)), dim3(kBlockSize), 0, 0, input, output, n);
}

void launch(unsigned int stride, const float* input, float* output,
            std::size_t n) {
    if (stride == 1) {
        launch_stride<1u>(input, output, n);
    } else if (stride == 32) {
        launch_stride<32u>(input, output, n);
    } else {
        launch_stride<33u>(input, output, n);
    }
    HIP_CHECK(hipGetLastError());
}

float reference_value(float input, std::size_t tid, unsigned int stride) {
    const unsigned int lane =
        static_cast<unsigned int>(tid % kBlockSize) % kWaveSize;
    float accumulator = input;
    for (unsigned int iteration = 0; iteration < kReadIterations;
         ++iteration) {
        const unsigned int index =
            lane * stride + (iteration & (kWaveSize - 1));
        accumulator += shared_value(index);
    }
    return accumulator;
}

bool validate_precheck(const float* device_output,
                       const std::vector<float>& input,
                       std::vector<float>& output,
                       unsigned int stride,
                       float* max_error) {
    HIP_CHECK(hipMemcpy(output.data(), device_output,
                        output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    *max_error = 0.0f;
    for (std::size_t tid = 0; tid < input.size(); ++tid) {
        const float reference = reference_value(input[tid], tid, stride);
        const float error = std::abs(output[tid] - reference);
        *max_error = std::max(*max_error, error);
        if (!std::isfinite(output[tid]) || error > kTolerance) {
            return false;
        }
    }
    return true;
}

bool validate_samples(const float* device_output,
                      const std::vector<float>& input,
                      std::vector<float>& output,
                      unsigned int stride,
                      float* max_error) {
    HIP_CHECK(hipMemcpy(output.data(), device_output,
                        output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    *max_error = 0.0f;
    const std::size_t samples = std::min(kSampleCount, input.size());
    for (std::size_t sample = 0; sample < samples; ++sample) {
        const std::size_t tid =
            sample * (input.size() - 1) / std::max<std::size_t>(samples - 1, 1);
        const float reference = reference_value(input[tid], tid, stride);
        const float error = std::abs(output[tid] - reference);
        *max_error = std::max(*max_error, error);
        if (!std::isfinite(output[tid]) || error > kTolerance) {
            return false;
        }
    }
    return true;
}

Timing benchmark(const Implementation& implementation, const Args& args,
                 const float* device_input, float* device_output) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(implementation.stride, device_input, device_output, args.size);
    }
    HIP_CHECK(hipDeviceSynchronize());

    hipEvent_t start{};
    hipEvent_t stop{};
    HIP_CHECK(hipEventCreate(&start));
    HIP_CHECK(hipEventCreate(&stop));
    std::vector<float> times_ms;
    times_ms.reserve(args.repeat);

    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        HIP_CHECK(hipEventRecord(start));
        launch(implementation.stride, device_input, device_output, args.size);
        HIP_CHECK(hipEventRecord(stop));
        HIP_CHECK(hipEventSynchronize(stop));
        float elapsed_ms = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&elapsed_ms, start, stop));
        times_ms.push_back(elapsed_ms);
    }

    HIP_CHECK(hipEventDestroy(start));
    HIP_CHECK(hipEventDestroy(stop));
    std::sort(times_ms.begin(), times_ms.end());
    const std::size_t middle = times_ms.size() / 2;
    const float median = times_ms.size() % 2 == 0
        ? 0.5f * (times_ms[middle - 1] + times_ms[middle])
        : times_ms[middle];
    const float mean =
        std::accumulate(times_ms.begin(), times_ms.end(), 0.0f) /
        static_cast<float>(times_ms.size());
    return {times_ms.front(), median, mean};
}

void emit_result(const Implementation& implementation, const Args& args,
                 bool timed, bool precheck_ok, bool postcheck_ok,
                 const Timing& timing, double bandwidth_gbs,
                 double tflops, float max_error) {
    const char* format = nullptr;
    if (precheck_ok && postcheck_ok) {
        format =
            "RESULT experiment=lds-banks implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=%d "
            "correct=OK precheck=OK postcheck=OK min_ms=%.6f "
            "median_ms=%.6f mean_ms=%.6f logical_bandwidth_gbs=%.6f "
            "tflops=%.6f max_abs_error=%.9g\n";
    } else if (!precheck_ok) {
        format =
            "RESULT experiment=lds-banks implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=%d "
            "correct=FAIL precheck=FAIL postcheck=NA min_ms=%.6f "
            "median_ms=%.6f mean_ms=%.6f logical_bandwidth_gbs=%.6f "
            "tflops=%.6f max_abs_error=%.9g\n";
    } else {
        format =
            "RESULT experiment=lds-banks implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=%d "
            "correct=FAIL precheck=OK postcheck=FAIL min_ms=%.6f "
            "median_ms=%.6f mean_ms=%.6f logical_bandwidth_gbs=%.6f "
            "tflops=%.6f max_abs_error=%.9g\n";
    }
    std::printf(format, implementation.name, args.size, args.warmup,
                args.repeat, args.seed, timed ? 1 : 0, timing.minimum_ms,
                timing.median_ms, timing.mean_ms, bandwidth_gbs, tflops,
                max_error);
}

bool run_implementation(
    const Implementation& implementation,
    const Args& args,
    const float* device_precheck_input,
    float* device_precheck_output,
    const std::vector<float>& precheck_input,
    std::vector<float>& precheck_output,
    const float* device_input,
    float* device_output,
    const std::vector<float>& input,
    std::vector<float>& output) {
    launch(implementation.stride, device_precheck_input,
           device_precheck_output, kPrecheckSize);
    HIP_CHECK(hipDeviceSynchronize());
    float precheck_error = 0.0f;
    const bool precheck_ok = validate_precheck(
        device_precheck_output, precheck_input, precheck_output,
        implementation.stride, &precheck_error);

    Timing timing{0.0f, 0.0f, 0.0f};
    bool postcheck_ok = false;
    float postcheck_error = 0.0f;
    double bandwidth_gbs = 0.0;
    double tflops = 0.0;
    if (precheck_ok) {
        timing = benchmark(
            implementation, args, device_input, device_output);
        postcheck_ok = validate_samples(
            device_output, input, output, implementation.stride,
            &postcheck_error);
        const double elapsed_seconds =
            static_cast<double>(timing.median_ms) * 1.0e-3;
        const double logical_bytes =
            static_cast<double>(args.size) *
            (kReadIterations + 2u) * sizeof(float);
        bandwidth_gbs = logical_bytes / elapsed_seconds / 1.0e9;
        tflops =
            static_cast<double>(args.size) * kReadIterations /
            elapsed_seconds / 1.0e12;
    }

    emit_result(
        implementation, args, precheck_ok, precheck_ok, postcheck_ok, timing,
        bandwidth_gbs, tflops,
        precheck_ok ? postcheck_error : precheck_error);
    return precheck_ok && postcheck_ok;
}

}  // namespace

int main(int argc, char** argv) {
    const Args args = parse_args(argc, argv);
    const std::vector<Implementation> implementations =
        selected_implementations(args.implementation);

    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    if (properties.warpSize != static_cast<int>(kWaveSize)) {
        usage_error("lds_bank_conflict requires wave size 32");
    }
    if (grid_for(args.size) >
        static_cast<unsigned int>(properties.maxGridSize[0])) {
        usage_error("--size produces a grid larger than the device limit");
    }
    std::printf(
        "ENV runtime=hip gpu=\"%s\" arch=%s "
        "hip_multiprocessor_count=%d wave_size=%d\n",
        properties.name, properties.gcnArchName,
        properties.multiProcessorCount, properties.warpSize);

    std::mt19937_64 generator(
        static_cast<std::mt19937_64::result_type>(args.seed));
    std::uniform_real_distribution<float> distribution(-1.0f, 1.0f);
    std::vector<float> precheck_input(kPrecheckSize);
    std::vector<float> precheck_output(kPrecheckSize);
    std::vector<float> input(args.size);
    std::vector<float> output(args.size);
    for (float& value : precheck_input) {
        value = distribution(generator);
    }
    for (float& value : input) {
        value = distribution(generator);
    }

    float* device_precheck_input = nullptr;
    float* device_precheck_output = nullptr;
    float* device_input = nullptr;
    float* device_output = nullptr;
    HIP_CHECK(hipMalloc(&device_precheck_input,
                        kPrecheckSize * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_precheck_output,
                        kPrecheckSize * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_input, args.size * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_output, args.size * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_precheck_input, precheck_input.data(),
                        kPrecheckSize * sizeof(float),
                        hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_input, input.data(),
                        args.size * sizeof(float), hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation : implementations) {
        all_correct =
            run_implementation(
                implementation, args, device_precheck_input,
                device_precheck_output, precheck_input, precheck_output,
                device_input, device_output, input, output) &&
            all_correct;
    }

    HIP_CHECK(hipFree(device_precheck_input));
    HIP_CHECK(hipFree(device_precheck_output));
    HIP_CHECK(hipFree(device_input));
    HIP_CHECK(hipFree(device_output));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
