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
constexpr float kTolerance = 0.0f;

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

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: global_memory_access [--implementation "
        "all|stride-1|stride-17|stride-257] [--size N] [--warmup N] "
        "[--repeat N] [--seed N]\n",
        message.c_str());
    std::exit(EXIT_FAILURE);
}

bool is_power_of_two(std::size_t value) {
    return value != 0 && (value & (value - 1)) == 0;
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        if (option == "--help" || option == "-h") {
            usage_error("Global memory access HIP teaching benchmark");
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

    if (!is_power_of_two(args.size)) {
        usage_error("--size must be a positive power of two");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.implementation != "all" &&
        args.implementation != "stride-1" &&
        args.implementation != "stride-17" &&
        args.implementation != "stride-257") {
        usage_error("unknown implementation: " + args.implementation);
    }
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& selection) {
    const Implementation stride_1{1, "stride-1"};
    const Implementation stride_17{17, "stride-17"};
    const Implementation stride_257{257, "stride-257"};
    if (selection == "all") {
        return {stride_1, stride_17, stride_257};
    }
    for (const Implementation& implementation :
         {stride_1, stride_17, stride_257}) {
        if (selection == implementation.name) {
            return {implementation};
        }
    }
    usage_error("unknown implementation: " + selection);
}

template <unsigned Stride>
__global__ void gather_copy(
    const float* input, float* output, std::size_t n
) {
    std::size_t tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid < n) {
        std::size_t source = (tid * Stride) & (n - 1);
        output[tid] = input[source];
    }
}

unsigned int grid_for(std::size_t n) {
    return static_cast<unsigned int>(
        (n + static_cast<std::size_t>(kBlockSize) - 1) / kBlockSize);
}

void launch(unsigned int stride, const float* input, float* output,
            std::size_t n) {
    const dim3 grid(grid_for(n));
    const dim3 block(kBlockSize);
    if (stride == 1) {
        hipLaunchKernelGGL(
            HIP_KERNEL_NAME(gather_copy<1>),
            grid, block, 0, 0, input, output, n);
    } else if (stride == 17) {
        hipLaunchKernelGGL(
            HIP_KERNEL_NAME(gather_copy<17>),
            grid, block, 0, 0, input, output, n);
    } else {
        hipLaunchKernelGGL(
            HIP_KERNEL_NAME(gather_copy<257>),
            grid, block, 0, 0, input, output, n);
    }
    HIP_CHECK(hipGetLastError());
}

std::vector<float> make_reference(const std::vector<float>& input,
                                  unsigned int stride) {
    std::vector<float> reference(input.size());
    for (std::size_t tid = 0; tid < input.size(); ++tid) {
        const std::size_t source = (tid * stride) & (input.size() - 1);
        reference[tid] = input[source];
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
        launch(implementation.stride, device_input, device_output, args.size);
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
        launch(implementation.stride, device_input, device_output, args.size);
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

bool run_implementation(const Implementation& implementation,
                        const Args& args,
                        const float* device_input,
                        float* device_output,
                        const std::vector<float>& input,
                        std::vector<float>& output) {
    const std::vector<float> reference =
        make_reference(input, implementation.stride);
    launch(implementation.stride, device_input, device_output, args.size);
    HIP_CHECK(hipDeviceSynchronize());
    float precheck_error = 0.0f;
    const bool precheck_ok =
        validate(device_output, reference, output, &precheck_error);
    if (!precheck_ok) {
        std::printf(
            "RESULT experiment=global-memory implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=0 "
            "correct=FAIL precheck=FAIL postcheck=NA min_ms=0 median_ms=0 "
            "mean_ms=0 logical_bandwidth_gbs=0 tflops=0 "
            "max_abs_error=%.9g\n",
            implementation.name, args.size, args.warmup, args.repeat,
            args.seed, precheck_error);
        return false;
    }

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

    if (postcheck_ok) {
        std::printf(
            "RESULT experiment=global-memory implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=1 "
            "correct=OK precheck=OK postcheck=OK min_ms=%.6f "
            "median_ms=%.6f mean_ms=%.6f logical_bandwidth_gbs=%.6f "
            "tflops=0 max_abs_error=%.9g\n",
            implementation.name, args.size, args.warmup, args.repeat,
            args.seed, timing.minimum_ms, timing.median_ms, timing.mean_ms,
            logical_bandwidth_gbs, postcheck_error);
    } else {
        std::printf(
            "RESULT experiment=global-memory implementation=%s runtime=hip "
            "shape=N=%zu dtype=fp32 warmup=%d repeat=%d seed=%zu timed=1 "
            "correct=FAIL precheck=OK postcheck=FAIL min_ms=%.6f "
            "median_ms=%.6f mean_ms=%.6f logical_bandwidth_gbs=%.6f "
            "tflops=0 max_abs_error=%.9g\n",
            implementation.name, args.size, args.warmup, args.repeat,
            args.seed, timing.minimum_ms, timing.median_ms, timing.mean_ms,
            logical_bandwidth_gbs, postcheck_error);
    }
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
    std::vector<float> input(args.size);
    std::vector<float> output(args.size);
    for (float& value : input) {
        value = distribution(generator);
    }

    float* device_input = nullptr;
    float* device_output = nullptr;
    HIP_CHECK(hipMalloc(&device_input, args.size * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_output, args.size * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_input, input.data(),
                        args.size * sizeof(float), hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation : implementations) {
        all_correct =
            run_implementation(implementation, args, device_input,
                               device_output, input, output) &&
            all_correct;
    }

    HIP_CHECK(hipFree(device_input));
    HIP_CHECK(hipFree(device_output));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
