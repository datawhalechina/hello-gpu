#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
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
constexpr std::size_t kPrecheckSize = 257;
constexpr float kTolerance = 1.0e-5f;

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

enum class BranchMode { WaveUniform, WaveDivergent };

struct Implementation {
    BranchMode mode;
    const char* name;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: branch_divergence [--implementation "
        "all|wave-uniform|wave-divergent] [--size N] [--warmup N] "
        "[--repeat N] [--seed N]\n",
        message.c_str());
    std::exit(EXIT_FAILURE);
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        if (option == "--help" || option == "-h") {
            usage_error("Branch divergence HIP teaching benchmark");
        }
        if (index + 1 >= argc) {
            usage_error("missing value for " + option);
        }
        const std::string value = argv[++index];
        try {
            if (option == "--implementation") {
                args.implementation = value;
            } else if (option == "--size") {
                args.size = std::stoull(value);
            } else if (option == "--warmup") {
                args.warmup = std::stoi(value);
            } else if (option == "--repeat") {
                args.repeat = std::stoi(value);
            } else if (option == "--seed") {
                args.seed = std::stoull(value);
            } else {
                usage_error("unknown option: " + option);
            }
        } catch (const std::exception&) {
            usage_error("invalid value for " + option + ": " + value);
        }
    }

    if (args.size == 0) {
        usage_error("--size must be positive");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.implementation != "all" &&
        args.implementation != "wave-uniform" &&
        args.implementation != "wave-divergent") {
        usage_error("unknown implementation: " + args.implementation);
    }
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& selection) {
    const Implementation uniform{
        BranchMode::WaveUniform, "wave-uniform"};
    const Implementation divergent{
        BranchMode::WaveDivergent, "wave-divergent"};
    if (selection == "all") {
        return {uniform, divergent};
    }
    if (selection == uniform.name) {
        return {uniform};
    }
    if (selection == divergent.name) {
        return {divergent};
    }
    usage_error("unknown implementation: " + selection);
}

template <BranchMode mode>
__global__ void branch_kernel(const float* input, float* output,
                              std::size_t n) {
    const std::size_t tid =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (tid >= n) {
        return;
    }

    bool take_a = mode == BranchMode::WaveUniform
        ? (((tid / warpSize) & 1u) == 0u)
        : ((tid & 1u) == 0u);
    float value = input[tid];
    if (take_a) {
        value = fmaf(value, 1.0001f, 0.125f);
        value = fmaf(value, 0.9997f, -0.250f);
        value = fmaf(value, 1.0003f, 0.500f);
        value = fmaf(value, 0.9999f, -0.375f);
    } else {
        value = fmaf(value, 0.9991f, -0.125f);
        value = fmaf(value, 1.0007f, 0.250f);
        value = fmaf(value, 0.9983f, -0.500f);
        value = fmaf(value, 1.0019f, 0.375f);
    }
    output[tid] = value;
}

unsigned int grid_for(std::size_t n) {
    return static_cast<unsigned int>(
        (n + static_cast<std::size_t>(kBlockSize) - 1) / kBlockSize);
}

void launch(BranchMode mode, const float* input, float* output,
            std::size_t n) {
    const dim3 grid(grid_for(n));
    const dim3 block(kBlockSize);
    if (mode == BranchMode::WaveUniform) {
        hipLaunchKernelGGL(
            HIP_KERNEL_NAME(branch_kernel<BranchMode::WaveUniform>),
            grid, block, 0, 0, input, output, n);
    } else {
        hipLaunchKernelGGL(
            HIP_KERNEL_NAME(branch_kernel<BranchMode::WaveDivergent>),
            grid, block, 0, 0, input, output, n);
    }
    HIP_CHECK(hipGetLastError());
}

float apply_path(float value, bool take_a) {
    if (take_a) {
        value = std::fma(value, 1.0001f, 0.125f);
        value = std::fma(value, 0.9997f, -0.250f);
        value = std::fma(value, 1.0003f, 0.500f);
        value = std::fma(value, 0.9999f, -0.375f);
    } else {
        value = std::fma(value, 0.9991f, -0.125f);
        value = std::fma(value, 1.0007f, 0.250f);
        value = std::fma(value, 0.9983f, -0.500f);
        value = std::fma(value, 1.0019f, 0.375f);
    }
    return value;
}

std::vector<float> make_reference(const std::vector<float>& input,
                                  BranchMode mode, int wave_size) {
    std::vector<float> reference(input.size());
    for (std::size_t tid = 0; tid < input.size(); ++tid) {
        const bool take_a = mode == BranchMode::WaveUniform
            ? (((tid / static_cast<std::size_t>(wave_size)) & 1u) == 0u)
            : ((tid & 1u) == 0u);
        reference[tid] = apply_path(input[tid], take_a);
    }
    return reference;
}

bool validate(const float* device_output,
              const std::vector<float>& reference,
              std::vector<float>& host_output,
              float* max_error) {
    HIP_CHECK(hipMemcpy(host_output.data(), device_output,
                        host_output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    *max_error = 0.0f;
    for (std::size_t index = 0; index < reference.size(); ++index) {
        const float error = std::abs(host_output[index] - reference[index]);
        *max_error = std::max(*max_error, error);
        if (!std::isfinite(host_output[index]) || error > kTolerance) {
            return false;
        }
    }
    return true;
}

Timing benchmark(const Implementation& implementation, const Args& args,
                 const float* device_input, float* device_output) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(implementation.mode, device_input, device_output, args.size);
    }
    HIP_CHECK(hipDeviceSynchronize());

    hipEvent_t start{};
    hipEvent_t stop{};
    HIP_CHECK(hipEventCreate(&start));
    HIP_CHECK(hipEventCreate(&stop));
    std::vector<float> times_ms;
    times_ms.reserve(args.repeat);

    // BEGIN_TIMED_LOOP
    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        HIP_CHECK(hipEventRecord(start));
        launch(implementation.mode, device_input, device_output, args.size);
        HIP_CHECK(hipEventRecord(stop));
        HIP_CHECK(hipEventSynchronize(stop));
        float elapsed_ms = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&elapsed_ms, start, stop));
        times_ms.push_back(elapsed_ms);
    }
    // END_TIMED_LOOP

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

bool run_implementation(
    const Implementation& implementation,
    const Args& args,
    int wave_size,
    const float* device_precheck_input,
    float* device_precheck_output,
    const std::vector<float>& precheck_input,
    std::vector<float>& precheck_output,
    const float* device_input,
    float* device_output,
    const std::vector<float>& input,
    std::vector<float>& output) {
    const std::vector<float> precheck_reference =
        make_reference(precheck_input, implementation.mode, wave_size);
    launch(implementation.mode, device_precheck_input, device_precheck_output,
           kPrecheckSize);
    HIP_CHECK(hipDeviceSynchronize());
    float precheck_error = 0.0f;
    const bool precheck_ok = validate(
        device_precheck_output, precheck_reference, precheck_output,
        &precheck_error);
    if (!precheck_ok) {
        std::printf(
            "RESULT experiment=branch-divergence implementation=%s "
            "runtime=hip shape=N=%zu dtype=fp32 warmup=%d repeat=%d "
            "seed=%zu timed=0 correct=FAIL precheck=FAIL postcheck=NA "
            "min_ms=0 median_ms=0 mean_ms=0 logical_bandwidth_gbs=0 "
            "tflops=0 max_abs_error=%.9g\n",
            implementation.name, args.size, args.warmup, args.repeat,
            args.seed, precheck_error);
        return false;
    }

    const std::vector<float> reference =
        make_reference(input, implementation.mode, wave_size);
    const Timing timing =
        benchmark(implementation, args, device_input, device_output);
    float postcheck_error = 0.0f;
    const bool postcheck_ok =
        validate(device_output, reference, output, &postcheck_error);
    const double elapsed_seconds =
        static_cast<double>(timing.median_ms) * 1.0e-3;
    const double logical_bytes =
        2.0 * static_cast<double>(args.size) * sizeof(float);
    const double logical_bandwidth_gbs =
        logical_bytes / elapsed_seconds / 1.0e9;
    const double tflops =
        (8.0 * static_cast<double>(args.size)) / elapsed_seconds / 1.0e12;

    std::printf(
        "RESULT experiment=branch-divergence implementation=%s runtime=hip "
        "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=1 "
        "correct=%s precheck=OK postcheck=%s min_ms=%.6f median_ms=%.6f "
        "mean_ms=%.6f logical_bandwidth_gbs=%.6f tflops=%.6f "
        "max_abs_error=%.9g\n",
        implementation.name, args.size, args.warmup, args.repeat, args.seed,
        postcheck_ok ? "OK" : "FAIL", postcheck_ok ? "OK" : "FAIL",
        timing.minimum_ms, timing.median_ms, timing.mean_ms,
        logical_bandwidth_gbs, tflops, postcheck_error);
    return postcheck_ok;
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
    if (grid_for(args.size) >
        static_cast<unsigned int>(properties.maxGridSize[0])) {
        usage_error("--size produces a grid larger than the device limit");
    }
    std::printf(
        "ENV runtime=hip gpu=\"%s\" arch=%s compute_units=%d wave_size=%d\n",
        properties.name, properties.gcnArchName,
        properties.multiProcessorCount, properties.warpSize);

    std::mt19937 generator(static_cast<std::mt19937::result_type>(args.seed));
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
    HIP_CHECK(hipMalloc(
        &device_precheck_input, kPrecheckSize * sizeof(float)));
    HIP_CHECK(hipMalloc(
        &device_precheck_output, kPrecheckSize * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_input, args.size * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_output, args.size * sizeof(float)));
    HIP_CHECK(hipMemcpy(
        device_precheck_input, precheck_input.data(),
        kPrecheckSize * sizeof(float), hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_input, input.data(),
                        args.size * sizeof(float), hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation : implementations) {
        all_correct =
            run_implementation(
                implementation, args, properties.warpSize,
                device_precheck_input, device_precheck_output,
                precheck_input, precheck_output, device_input, device_output,
                input, output) &&
            all_correct;
    }

    HIP_CHECK(hipFree(device_precheck_input));
    HIP_CHECK(hipFree(device_precheck_output));
    HIP_CHECK(hipFree(device_input));
    HIP_CHECK(hipFree(device_output));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
