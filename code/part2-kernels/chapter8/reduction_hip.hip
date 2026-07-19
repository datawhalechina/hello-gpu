#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <numeric>
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

constexpr float kTolerance = 1.0e-3f;

struct Args {
    std::string version = "all";
    std::size_t size = 16 * 1024 * 1024;
    int block = 256;
    unsigned int grid = 0;
    int warmup = 5;
    int repeat = 20;
    std::size_t seed = 20260719;
};

struct Timing {
    float minimum_ms;
    float median_ms;
    float mean_ms;
};

enum class Kind { Atomic, Lds, TwoStage };

struct Implementation {
    Kind kind;
    const char* name;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: reduction_hip [--version all|atomic|lds|two-stage] "
        "[--size N] [--block N] [--grid N] [--warmup N] [--repeat N] "
        "[--seed N]\n",
        message.c_str());
    std::exit(EXIT_FAILURE);
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        if (option == "--help" || option == "-h") {
            usage_error("Sum Reduction HIP teaching benchmark");
        }
        if (index + 1 >= argc) {
            usage_error("missing value for " + option);
        }
        const std::string value = argv[++index];
        try {
            if (option == "--version") {
                args.version = value;
            } else if (option == "--size") {
                args.size = std::stoull(value);
            } else if (option == "--block") {
                args.block = std::stoi(value);
            } else if (option == "--grid") {
                args.grid = static_cast<unsigned int>(std::stoul(value));
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
    if (args.block <= 0 || (args.block & (args.block - 1)) != 0) {
        usage_error("--block must be a positive power of two");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.version != "all" && args.version != "atomic" &&
        args.version != "lds" && args.version != "two-stage") {
        usage_error("unknown version: " + args.version);
    }
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& selection) {
    const std::vector<Implementation> all = {
        {Kind::Atomic, "hip-atomic"},
        {Kind::Lds, "hip-lds"},
        {Kind::TwoStage, "hip-two-stage"},
    };
    if (selection == "all") {
        return all;
    }
    for (const Implementation& implementation : all) {
        if ((selection == "atomic" && implementation.kind == Kind::Atomic) ||
            (selection == "lds" && implementation.kind == Kind::Lds) ||
            (selection == "two-stage" &&
             implementation.kind == Kind::TwoStage)) {
            return {implementation};
        }
    }
    usage_error("unknown version: " + selection);
}

__global__ void atomic_sum_kernel(const float* input, std::size_t size,
                                  float* output) {
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (index < size) {
        atomicAdd(output, input[index]);
    }
}

__global__ void lds_sum_kernel(const float* input, std::size_t size,
                               float* output) {
    extern __shared__ float shared[];
    const unsigned int thread = threadIdx.x;
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + thread;
    shared[thread] = index < size ? input[index] : 0.0f;
    __syncthreads();

    for (unsigned int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (thread < stride) {
            shared[thread] += shared[thread + stride];
        }
        __syncthreads();
    }
    if (thread == 0) {
        atomicAdd(output, shared[0]);
    }
}

__device__ float wave_reduce_sum(float value) {
    for (int offset = warpSize / 2; offset > 0; offset >>= 1) {
        value += __shfl_down(value, offset);
    }
    return value;
}

__global__ void local_wave_partial_kernel(const float* input,
                                          std::size_t size,
                                          float* partials) {
    extern __shared__ float wave_sums[];
    const unsigned int thread = threadIdx.x;
    const unsigned int lane = thread % warpSize;
    const unsigned int wave = thread / warpSize;
    const unsigned int wave_count = (blockDim.x + warpSize - 1) / warpSize;
    const std::size_t first =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + thread;
    const std::size_t grid_stride =
        static_cast<std::size_t>(gridDim.x) * blockDim.x;

    float local = 0.0f;
    for (std::size_t index = first; index < size; index += grid_stride) {
        local += input[index];
    }
    local = wave_reduce_sum(local);
    if (lane == 0) {
        wave_sums[wave] = local;
    }
    __syncthreads();

    if (wave == 0) {
        float block_sum = lane < wave_count ? wave_sums[lane] : 0.0f;
        block_sum = wave_reduce_sum(block_sum);
        if (lane == 0) {
            partials[blockIdx.x] = block_sum;
        }
    }
}

unsigned int full_grid(std::size_t size, int block) {
    const std::size_t blocks =
        (size + static_cast<std::size_t>(block) - 1) /
        static_cast<std::size_t>(block);
    if (blocks > std::numeric_limits<unsigned int>::max()) {
        usage_error("calculated grid does not fit in an unsigned int");
    }
    return static_cast<unsigned int>(blocks);
}

unsigned int grid_for(const Implementation& implementation, const Args& args,
                      const hipDeviceProp_t& properties) {
    const unsigned int needed = full_grid(args.size, args.block);
    if (implementation.kind != Kind::TwoStage) {
        return needed;
    }
    if (args.grid != 0) {
        return args.grid;
    }
    const unsigned int occupancy_start =
        static_cast<unsigned int>(std::max(1, properties.multiProcessorCount)) *
        8U;
    return std::max(1U, std::min(needed, occupancy_start));
}

std::size_t wave_shared_bytes(int block, int wave_size) {
    return static_cast<std::size_t>((block + wave_size - 1) / wave_size) *
           sizeof(float);
}

void launch(const Implementation& implementation, const Args& args,
            const hipDeviceProp_t& properties, const float* input,
            float* output, float* partials) {
    const unsigned int grid = grid_for(implementation, args, properties);
    HIP_CHECK(hipMemsetAsync(output, 0, sizeof(float)));
    if (implementation.kind == Kind::Atomic) {
        hipLaunchKernelGGL(atomic_sum_kernel, dim3(grid), dim3(args.block), 0, 0,
                           input, args.size, output);
    } else if (implementation.kind == Kind::Lds) {
        const std::size_t shared_bytes =
            static_cast<std::size_t>(args.block) * sizeof(float);
        hipLaunchKernelGGL(lds_sum_kernel, dim3(grid), dim3(args.block),
                           shared_bytes, 0, input, args.size, output);
    } else {
        const std::size_t shared_bytes =
            wave_shared_bytes(args.block, properties.warpSize);
        hipLaunchKernelGGL(local_wave_partial_kernel, dim3(grid),
                           dim3(args.block), shared_bytes, 0, input, args.size,
                           partials);
        hipLaunchKernelGGL(local_wave_partial_kernel, dim3(1), dim3(args.block),
                           shared_bytes, 0, partials,
                           static_cast<std::size_t>(grid), output);
    }
    HIP_CHECK(hipGetLastError());
}

Timing benchmark(const Implementation& implementation, const Args& args,
                 const hipDeviceProp_t& properties, const float* input,
                 float* output, float* partials) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(implementation, args, properties, input, output, partials);
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
        launch(implementation, args, properties, input, output, partials);
        HIP_CHECK(hipEventRecord(stop));
        HIP_CHECK(hipEventSynchronize(stop));
        float elapsed_ms = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&elapsed_ms, start, stop));
        times_ms.push_back(elapsed_ms);
    }
    HIP_CHECK(hipEventDestroy(start));
    HIP_CHECK(hipEventDestroy(stop));

    std::sort(times_ms.begin(), times_ms.end());
    const float median = args.repeat % 2 == 1
                             ? times_ms[args.repeat / 2]
                             : 0.5f * (times_ms[args.repeat / 2 - 1] +
                                       times_ms[args.repeat / 2]);
    const float mean =
        std::accumulate(times_ms.begin(), times_ms.end(), 0.0f) /
        static_cast<float>(args.repeat);
    return {times_ms.front(), median, mean};
}

bool run_one(const Implementation& implementation, const Args& args,
             const hipDeviceProp_t& properties, const float* input,
             float* output, float* partials, double reference) {
    const unsigned int grid = grid_for(implementation, args, properties);
    launch(implementation, args, properties, input, output, partials);
    HIP_CHECK(hipDeviceSynchronize());
    float actual = 0.0f;
    HIP_CHECK(hipMemcpy(&actual, output, sizeof(float), hipMemcpyDeviceToHost));
    const double pre_error = std::abs(static_cast<double>(actual) - reference);
    if (!std::isfinite(actual) || pre_error > kTolerance) {
        std::fprintf(stderr,
                     "precheck failed for %s: got=%.9g expected=%.17g\n",
                     implementation.name, actual, reference);
        std::printf(
            "RESULT operator=sum-reduction implementation=%s runtime=hip "
            "shape=%zu dtype=float32 block=%d grid=%u partials=%u stages=%d "
            "warmup=%d repeat=%d seed=%zu timed=0 correct=FAIL "
            "precheck=FAIL postcheck=NA min_ms=NA median_ms=NA mean_ms=NA "
            "logical_bandwidth_gbs=NA result=%.9g reference=%.17g "
            "max_abs_error=%.9g tolerance=%.9g\n",
            implementation.name, args.size, args.block, grid,
            implementation.kind == Kind::TwoStage ? grid : 1U,
            implementation.kind == Kind::TwoStage ? 2 : 1, args.warmup,
            args.repeat, args.seed, actual, reference, pre_error, kTolerance);
        return false;
    }

    const Timing timing = benchmark(implementation, args, properties, input,
                                    output, partials);
    HIP_CHECK(hipMemcpy(&actual, output, sizeof(float), hipMemcpyDeviceToHost));
    const double post_error = std::abs(static_cast<double>(actual) - reference);
    const bool correct = std::isfinite(actual) && post_error <= kTolerance;
    const double logical_bytes =
        static_cast<double>(args.size) * sizeof(float) + sizeof(float);
    const double bandwidth_gbs =
        logical_bytes / (static_cast<double>(timing.median_ms) * 1.0e-3) /
        1.0e9;
    std::printf(
        "RESULT operator=sum-reduction implementation=%s runtime=hip "
        "shape=%zu dtype=float32 block=%d grid=%u partials=%u stages=%d "
        "warmup=%d repeat=%d seed=%zu timed=1 correct=%s precheck=OK "
        "postcheck=%s min_ms=%.6f median_ms=%.6f mean_ms=%.6f "
        "logical_bandwidth_gbs=%.6f result=%.9g reference=%.17g "
        "max_abs_error=%.9g tolerance=%.9g\n",
        implementation.name, args.size, args.block, grid,
        implementation.kind == Kind::TwoStage ? grid : 1U,
        implementation.kind == Kind::TwoStage ? 2 : 1, args.warmup,
        args.repeat, args.seed, correct ? "OK" : "FAIL",
        correct ? "OK" : "FAIL", timing.minimum_ms, timing.median_ms,
        timing.mean_ms, bandwidth_gbs, actual, reference, post_error,
        kTolerance);
    return correct;
}

}  // namespace

int main(int argc, char** argv) {
    const Args args = parse_args(argc, argv);

    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    if (args.block > properties.maxThreadsPerBlock ||
        args.block % properties.warpSize != 0) {
        usage_error("--block must fit the device and be a multiple of wave size");
    }
    const unsigned int largest_grid = full_grid(args.size, args.block);
    if (largest_grid > static_cast<unsigned int>(properties.maxGridSize[0])) {
        usage_error("atomic/LDS grid exceeds the device limit");
    }
    if (args.grid > static_cast<unsigned int>(properties.maxGridSize[0])) {
        usage_error("--grid exceeds the device limit");
    }

    std::printf(
        "ENV runtime=hip gpu=\"%s\" arch=%s compute_units=%d wave_size=%d\n",
        properties.name, properties.gcnArchName,
        properties.multiProcessorCount, properties.warpSize);

    std::vector<float> host_input(args.size);
    const float first = (args.seed & 1U) != 0 ? 1.0f : -1.0f;
    for (std::size_t index = 0; index < args.size; ++index) {
        host_input[index] = (index & 1U) != 0 ? -first : first;
    }
    const double reference =
        std::accumulate(host_input.begin(), host_input.end(), 0.0);

    float* device_input = nullptr;
    float* device_output = nullptr;
    float* device_partials = nullptr;
    HIP_CHECK(hipMalloc(&device_input, args.size * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_output, sizeof(float)));
    const Implementation two_stage{Kind::TwoStage, "hip-two-stage"};
    const unsigned int partial_count = grid_for(two_stage, args, properties);
    HIP_CHECK(hipMalloc(&device_partials,
                        static_cast<std::size_t>(partial_count) * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_input, host_input.data(),
                        args.size * sizeof(float), hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation :
         selected_implementations(args.version)) {
        all_correct = run_one(implementation, args, properties, device_input,
                              device_output, device_partials, reference) &&
                      all_correct;
    }

    HIP_CHECK(hipFree(device_partials));
    HIP_CHECK(hipFree(device_output));
    HIP_CHECK(hipFree(device_input));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
