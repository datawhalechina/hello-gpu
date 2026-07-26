#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <numeric>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#if defined(__HIP_DEVICE_COMPILE__) && \
    !defined(__gfx1200__) && !defined(__gfx1201__)
#error rdna4_wmma.hip requires an AMD gfx12 target such as --offload-arch=gfx1201
#endif

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

using Half8 = _Float16 __attribute__((ext_vector_type(8)));
using Float8 = float __attribute__((ext_vector_type(8)));

constexpr int kValuBlockSize = 256;
constexpr int kWmmaBlockSize = 32;
constexpr int kMatrixElements = 16 * 16;
constexpr int kFragmentElements = 8;
constexpr std::size_t kPrecheckBatches = 2;
constexpr std::size_t kSampleCount = 64;
constexpr float kAbsoluteTolerance = 1.0e-4f;
constexpr float kRelativeTolerance = 1.0e-4f;

struct Args {
    std::string implementation = "all";
    std::size_t size = 4096;
    int warmup = 5;
    int repeat = 20;
    std::size_t seed = 20260726;
};

struct Timing {
    float minimum_ms;
    float median_ms;
    float mean_ms;
};

enum class MatrixPath { Valu, Wmma };

struct Implementation {
    MatrixPath path;
    const char* name;
};

void print_usage(FILE* stream) {
    std::fprintf(
        stream,
        "Usage: rdna4_wmma [--implementation all|valu|wmma] [--size N] "
        "[--warmup N] [--repeat N] [--seed N]\n");
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

    if (args.size == 0 ||
        args.size > std::numeric_limits<std::size_t>::max() /
                        static_cast<std::size_t>(kMatrixElements)) {
        usage_error("--size must be a positive batch count without overflow");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.implementation != "all" &&
        args.implementation != "valu" &&
        args.implementation != "wmma") {
        usage_error("unknown implementation: " + args.implementation);
    }
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& selection) {
    const Implementation valu{MatrixPath::Valu, "valu"};
    const Implementation wmma{MatrixPath::Wmma, "wmma"};
    if (selection == "all") {
        return {valu, wmma};
    }
    if (selection == valu.name) {
        return {valu};
    }
    if (selection == wmma.name) {
        return {wmma};
    }
    usage_error("unknown implementation: " + selection);
}

__global__ void valu_kernel(const _Float16* matrix_a_batches,
                            const _Float16* matrix_b_batches,
                            float* matrix_c_batches) {
    const std::size_t batch = blockIdx.x;
    const _Float16* matrix_a =
        matrix_a_batches + batch * kMatrixElements;
    const _Float16* matrix_b =
        matrix_b_batches + batch * kMatrixElements;
    float* matrix_c = matrix_c_batches + batch * kMatrixElements;
    const int row = threadIdx.x / 16;
    const int column = threadIdx.x % 16;
    float accumulator = 0.0f;
    for (int k = 0; k < 16; ++k) {
        accumulator += static_cast<float>(matrix_a[row * 16 + k]) *
                       static_cast<float>(matrix_b[k * 16 + column]);
    }
    matrix_c[row * 16 + column] = accumulator;
}

__global__ void wmma_kernel(const _Float16* matrix_a_batches,
                            const _Float16* matrix_b_batches,
                            float* matrix_c_batches) {
    const std::size_t batch = blockIdx.x;
    const _Float16* matrix_a =
        matrix_a_batches + batch * kMatrixElements;
    const _Float16* matrix_b =
        matrix_b_batches + batch * kMatrixElements;
    float* matrix_c = matrix_c_batches + batch * kMatrixElements;
    Half8 a_frag;
    Half8 b_frag;
    Float8 c_frag{};
    const int laneWrapped = threadIdx.x % 16;
    const int laneGroup = threadIdx.x / 16;
    for (int ele = 0; ele < kFragmentElements; ++ele) {
        a_frag[ele] = matrix_a[16 * laneWrapped +
                                   (ele + laneGroup * 8)];
        b_frag[ele] = matrix_b[16 * (ele + laneGroup * 8) +
                                   laneWrapped];
    }
    c_frag =
        __builtin_amdgcn_wmma_f32_16x16x16_f16_w32_gfx12(
            a_frag, b_frag, c_frag);
    for (int ele = 0; ele < kFragmentElements; ++ele) {
        matrix_c[16 * (ele + laneGroup * 8) + laneWrapped] =
            c_frag[ele];
    }
}

unsigned int grid_for(std::size_t n) {
    if (n > std::numeric_limits<unsigned int>::max()) {
        usage_error("--size produces a grid that overflows unsigned int");
    }
    return static_cast<unsigned int>(n);
}

void launch(MatrixPath path, const _Float16* matrix_a,
            const _Float16* matrix_b, float* matrix_c,
            std::size_t batches) {
    const dim3 grid(grid_for(batches));
    if (path == MatrixPath::Valu) {
        hipLaunchKernelGGL(
            valu_kernel, grid, dim3(kValuBlockSize), 0, 0,
            matrix_a, matrix_b, matrix_c);
    } else {
        hipLaunchKernelGGL(
            wmma_kernel, grid, dim3(kWmmaBlockSize), 0, 0,
            matrix_a, matrix_b, matrix_c);
    }
    HIP_CHECK(hipGetLastError());
}

float cpu_reference_value(const std::vector<_Float16>& matrix_a_batches,
                          const std::vector<_Float16>& matrix_b_batches,
                          std::size_t output_index) {
    const std::size_t batch = output_index / kMatrixElements;
    const std::size_t element = output_index % kMatrixElements;
    const std::size_t row = element / 16;
    const std::size_t column = element % 16;
    const std::size_t base = batch * kMatrixElements;
    float accumulator = 0.0f;
    for (std::size_t k = 0; k < 16; ++k) {
        accumulator +=
            static_cast<float>(matrix_a_batches[base + row * 16 + k]) *
            static_cast<float>(matrix_b_batches[base + k * 16 + column]);
    }
    return accumulator;
}

std::vector<float> make_cpu_reference(
    const std::vector<_Float16>& matrix_a_batches,
    const std::vector<_Float16>& matrix_b_batches) {
    std::vector<float> reference(matrix_a_batches.size());
    for (std::size_t index = 0; index < reference.size(); ++index) {
        reference[index] = cpu_reference_value(
            matrix_a_batches, matrix_b_batches, index);
    }
    return reference;
}

bool close_enough(float actual, float expected, float* max_error) {
    const float error = std::abs(actual - expected);
    *max_error = std::max(*max_error, error);
    const float limit =
        kAbsoluteTolerance + kRelativeTolerance * std::abs(expected);
    return std::isfinite(actual) && error <= limit;
}

bool validate_precheck(const float* device_output,
                       const std::vector<float>& reference,
                       std::vector<float>& output,
                       float* max_error) {
    HIP_CHECK(hipMemcpy(output.data(), device_output,
                        output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    *max_error = 0.0f;
    for (std::size_t index = 0; index < reference.size(); ++index) {
        if (!close_enough(output[index], reference[index], max_error)) {
            return false;
        }
    }
    return true;
}

bool validate_samples(
    const float* device_output,
    const std::vector<_Float16>& matrix_a_batches,
    const std::vector<_Float16>& matrix_b_batches,
    std::vector<float>& output,
    float* max_error) {
    HIP_CHECK(hipMemcpy(output.data(), device_output,
                        output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    *max_error = 0.0f;
    const std::size_t samples = std::min(kSampleCount, output.size());
    for (std::size_t sample = 0; sample < samples; ++sample) {
        const std::size_t index =
            sample * (output.size() - 1) /
            std::max<std::size_t>(samples - 1, 1);
        const float reference = cpu_reference_value(
            matrix_a_batches, matrix_b_batches, index);
        if (!close_enough(output[index], reference, max_error)) {
            return false;
        }
    }
    return true;
}

Timing benchmark(const Implementation& implementation, const Args& args,
                 const _Float16* device_matrix_a,
                 const _Float16* device_matrix_b,
                 float* device_matrix_c) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(implementation.path, device_matrix_a, device_matrix_b,
               device_matrix_c, args.size);
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
        launch(implementation.path, device_matrix_a, device_matrix_b,
               device_matrix_c, args.size);
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
            "RESULT experiment=matrix-path implementation=%s runtime=hip "
            "shape=batch=%zu,M=16,N=16,K=16 dtype=fp16-fp32 warmup=%d "
            "repeat=%d seed=%zu timed=%d correct=OK precheck=OK "
            "postcheck=OK min_ms=%.6f median_ms=%.6f mean_ms=%.6f "
            "logical_bandwidth_gbs=%.6f tflops=%.6f max_abs_error=%.9g\n";
    } else if (!precheck_ok) {
        format =
            "RESULT experiment=matrix-path implementation=%s runtime=hip "
            "shape=batch=%zu,M=16,N=16,K=16 dtype=fp16-fp32 warmup=%d "
            "repeat=%d seed=%zu timed=%d correct=FAIL precheck=FAIL "
            "postcheck=NA min_ms=%.6f median_ms=%.6f mean_ms=%.6f "
            "logical_bandwidth_gbs=%.6f tflops=%.6f max_abs_error=%.9g\n";
    } else {
        format =
            "RESULT experiment=matrix-path implementation=%s runtime=hip "
            "shape=batch=%zu,M=16,N=16,K=16 dtype=fp16-fp32 warmup=%d "
            "repeat=%d seed=%zu timed=%d correct=FAIL precheck=OK "
            "postcheck=FAIL min_ms=%.6f median_ms=%.6f mean_ms=%.6f "
            "logical_bandwidth_gbs=%.6f tflops=%.6f max_abs_error=%.9g\n";
    }
    std::printf(format, implementation.name, args.size, args.warmup,
                args.repeat, args.seed, timed ? 1 : 0, timing.minimum_ms,
                timing.median_ms, timing.mean_ms, bandwidth_gbs, tflops,
                max_error);
}

bool run_implementation(
    const Implementation& implementation,
    const Args& args,
    const _Float16* device_precheck_matrix_a,
    const _Float16* device_precheck_matrix_b,
    float* device_precheck_matrix_c,
    const std::vector<float>& precheck_reference,
    std::vector<float>& precheck_output,
    const _Float16* device_matrix_a,
    const _Float16* device_matrix_b,
    float* device_matrix_c,
    const std::vector<_Float16>& matrix_a,
    const std::vector<_Float16>& matrix_b,
    std::vector<float>& matrix_c) {
    launch(implementation.path, device_precheck_matrix_a,
           device_precheck_matrix_b, device_precheck_matrix_c,
           kPrecheckBatches);
    HIP_CHECK(hipDeviceSynchronize());
    float precheck_error = 0.0f;
    const bool precheck_ok = validate_precheck(
        device_precheck_matrix_c, precheck_reference, precheck_output,
        &precheck_error);

    Timing timing{0.0f, 0.0f, 0.0f};
    bool postcheck_ok = false;
    float postcheck_error = 0.0f;
    double bandwidth_gbs = 0.0;
    double tflops = 0.0;
    if (precheck_ok) {
        timing = benchmark(
            implementation, args, device_matrix_a, device_matrix_b,
            device_matrix_c);
        postcheck_ok = validate_samples(
            device_matrix_c, matrix_a, matrix_b, matrix_c,
            &postcheck_error);
        const double elapsed_seconds =
            static_cast<double>(timing.median_ms) * 1.0e-3;
        const double logical_bytes =
            static_cast<double>(args.size) * kMatrixElements *
            (2.0 * sizeof(_Float16) + sizeof(float));
        bandwidth_gbs = logical_bytes / elapsed_seconds / 1.0e9;
        tflops =
            2.0 * static_cast<double>(args.size) * 16.0 * 16.0 * 16.0 /
            elapsed_seconds / 1.0e12;
    }

    emit_result(
        implementation, args, precheck_ok, precheck_ok, postcheck_ok, timing,
        bandwidth_gbs, tflops,
        precheck_ok ? postcheck_error : precheck_error);
    return precheck_ok && postcheck_ok;
}

void fill_matrix(std::vector<_Float16>& values,
                 std::mt19937_64& generator) {
    std::uniform_real_distribution<float> distribution(-0.25f, 0.25f);
    for (_Float16& value : values) {
        value = static_cast<_Float16>(distribution(generator));
    }
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
    if (properties.warpSize != kWmmaBlockSize ||
        std::strncmp(properties.gcnArchName, "gfx12", 5) != 0) {
        usage_error("rdna4_wmma requires an RDNA4 gfx12 wave32 device");
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

    const std::size_t precheck_elements =
        kPrecheckBatches * kMatrixElements;
    const std::size_t elements = args.size * kMatrixElements;
    std::mt19937_64 generator(
        static_cast<std::mt19937_64::result_type>(args.seed));
    std::vector<_Float16> precheck_matrix_a(precheck_elements);
    std::vector<_Float16> precheck_matrix_b(precheck_elements);
    std::vector<float> precheck_output(precheck_elements);
    std::vector<_Float16> matrix_a(elements);
    std::vector<_Float16> matrix_b(elements);
    std::vector<float> matrix_c(elements);
    fill_matrix(precheck_matrix_a, generator);
    fill_matrix(precheck_matrix_b, generator);
    fill_matrix(matrix_a, generator);
    fill_matrix(matrix_b, generator);
    const std::vector<float> precheck_reference =
        make_cpu_reference(precheck_matrix_a, precheck_matrix_b);

    _Float16* device_precheck_matrix_a = nullptr;
    _Float16* device_precheck_matrix_b = nullptr;
    float* device_precheck_matrix_c = nullptr;
    _Float16* device_matrix_a = nullptr;
    _Float16* device_matrix_b = nullptr;
    float* device_matrix_c = nullptr;
    HIP_CHECK(hipMalloc(&device_precheck_matrix_a,
                        precheck_elements * sizeof(_Float16)));
    HIP_CHECK(hipMalloc(&device_precheck_matrix_b,
                        precheck_elements * sizeof(_Float16)));
    HIP_CHECK(hipMalloc(&device_precheck_matrix_c,
                        precheck_elements * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_matrix_a, elements * sizeof(_Float16)));
    HIP_CHECK(hipMalloc(&device_matrix_b, elements * sizeof(_Float16)));
    HIP_CHECK(hipMalloc(&device_matrix_c, elements * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_precheck_matrix_a, precheck_matrix_a.data(),
                        precheck_elements * sizeof(_Float16),
                        hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_precheck_matrix_b, precheck_matrix_b.data(),
                        precheck_elements * sizeof(_Float16),
                        hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_matrix_a, matrix_a.data(),
                        elements * sizeof(_Float16), hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_matrix_b, matrix_b.data(),
                        elements * sizeof(_Float16), hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation : implementations) {
        all_correct =
            run_implementation(
                implementation, args, device_precheck_matrix_a,
                device_precheck_matrix_b, device_precheck_matrix_c,
                precheck_reference, precheck_output, device_matrix_a,
                device_matrix_b, device_matrix_c, matrix_a, matrix_b,
                matrix_c) &&
            all_correct;
    }

    HIP_CHECK(hipFree(device_precheck_matrix_a));
    HIP_CHECK(hipFree(device_precheck_matrix_b));
    HIP_CHECK(hipFree(device_precheck_matrix_c));
    HIP_CHECK(hipFree(device_matrix_a));
    HIP_CHECK(hipFree(device_matrix_b));
    HIP_CHECK(hipFree(device_matrix_c));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
