// Chapter 7: Element-Wise Vector Add, HIP route.
//
// Performance results from this program are valid for the book only after it
// runs on the project baseline: Radeon RX 9070 XT, ROCm 7.13, native Ubuntu
// 24.04. The kernels deliberately keep the same c[i] = a[i] + b[i] semantics.

#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <limits>
#include <string>
#include <vector>

#define HIP_CHECK(call)                                                        \
    do {                                                                       \
        const hipError_t error = (call);                                       \
        if (error != hipSuccess) {                                             \
            std::fprintf(stderr, "HIP error at %s:%d: %s (%s)\n",             \
                         __FILE__, __LINE__, hipGetErrorString(error), #call);  \
            std::exit(EXIT_FAILURE);                                           \
        }                                                                      \
    } while (0)

namespace {

constexpr int kWaveSize = 32;
constexpr int kRoundsPerLane = 32;

__global__ void vector_add_v0(const float* __restrict__ input_a,
                              const float* __restrict__ input_b,
                              float* __restrict__ output,
                              std::size_t size) {
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (index < size) {
        output[index] = input_a[index] + input_b[index];
    }
}

// Each wave handles the same 32 x 32-element tile in both v1 kernels. Only
// the order in which lanes visit that tile changes, so grid size, loop count,
// arithmetic, and total logical bytes remain fixed.
__global__ void vector_add_v1_contiguous(const float* __restrict__ input_a,
                                         const float* __restrict__ input_b,
                                         float* __restrict__ output,
                                         std::size_t size) {
    const int waves_per_block = blockDim.x / kWaveSize;
    const int wave_in_block = threadIdx.x / kWaveSize;
    const int lane = threadIdx.x % kWaveSize;
    const std::size_t wave =
        static_cast<std::size_t>(blockIdx.x) * waves_per_block + wave_in_block;
    const std::size_t base = wave * kWaveSize * kRoundsPerLane;

#pragma unroll 1
    for (int round = 0; round < kRoundsPerLane; ++round) {
        const std::size_t index =
            base + static_cast<std::size_t>(round) * kWaveSize + lane;
        if (index < size) {
            output[index] = input_a[index] + input_b[index];
        }
    }
}

__global__ void vector_add_v1_strided(const float* __restrict__ input_a,
                                      const float* __restrict__ input_b,
                                      float* __restrict__ output,
                                      std::size_t size) {
    const int waves_per_block = blockDim.x / kWaveSize;
    const int wave_in_block = threadIdx.x / kWaveSize;
    const int lane = threadIdx.x % kWaveSize;
    const std::size_t wave =
        static_cast<std::size_t>(blockIdx.x) * waves_per_block + wave_in_block;
    const std::size_t base = wave * kWaveSize * kRoundsPerLane;

#pragma unroll 1
    for (int round = 0; round < kRoundsPerLane; ++round) {
        const std::size_t index =
            base + static_cast<std::size_t>(lane) * kRoundsPerLane + round;
        if (index < size) {
            output[index] = input_a[index] + input_b[index];
        }
    }
}

__global__ void vector_add_v2_grid_stride(const float* __restrict__ input_a,
                                          const float* __restrict__ input_b,
                                          float* __restrict__ output,
                                          std::size_t size) {
    const std::size_t thread =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    const std::size_t grid_stride =
        static_cast<std::size_t>(gridDim.x) * blockDim.x;

    for (std::size_t index = thread; index < size; index += grid_stride) {
        output[index] = input_a[index] + input_b[index];
    }
}

__global__ void vector_add_v3_float4(const float* __restrict__ input_a,
                                     const float* __restrict__ input_b,
                                     float* __restrict__ output,
                                     std::size_t size) {
    const auto* input_a4 = reinterpret_cast<const float4*>(input_a);
    const auto* input_b4 = reinterpret_cast<const float4*>(input_b);
    auto* output4 = reinterpret_cast<float4*>(output);

    const std::size_t thread =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    const std::size_t grid_stride =
        static_cast<std::size_t>(gridDim.x) * blockDim.x;
    const std::size_t vector_count = size / 4;

    for (std::size_t vector_index = thread;
         vector_index < vector_count;
         vector_index += grid_stride) {
        const float4 a = input_a4[vector_index];
        const float4 b = input_b4[vector_index];
        output4[vector_index] =
            make_float4(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
    }

    // hipMalloc returns suitably aligned base pointers. The scalar loop keeps
    // the final 0-3 values correct when size is not divisible by four.
    for (std::size_t index = vector_count * 4 + thread;
         index < size;
         index += grid_stride) {
        output[index] = input_a[index] + input_b[index];
    }
}

struct Args {
    std::string version = "all";
    std::size_t size = 16ULL * 1024 * 1024;
    int block = 256;
    int grid = 0;
    int warmup = 10;
    int repeat = 50;
    std::size_t seed = 20260716;
};

struct Version {
    std::string name;
    enum class Kind {
        v0,
        v1_contiguous,
        v1_strided,
        v2,
        v3,
    } kind;
};

struct Timing {
    double minimum_ms;
    double median_ms;
    double mean_ms;
};

struct Validation {
    bool correct;
    double max_absolute_error;
    std::size_t first_bad_index;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: vector_add_hip [--version all|v0|v1|v1-contiguous|"
        "v1-strided|v2|v3] [--size N] [--block N] [--grid N] "
        "[--warmup N] [--repeat N] [--seed N]\n",
        message.c_str());
    std::exit(EXIT_FAILURE);
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        auto next = [&]() -> std::string {
            if (index + 1 >= argc) {
                usage_error("missing value for " + option);
            }
            return argv[++index];
        };

        try {
            if (option == "--version") {
                args.version = next();
            } else if (option == "--size") {
                args.size = std::stoull(next());
            } else if (option == "--block") {
                args.block = std::stoi(next());
            } else if (option == "--grid") {
                args.grid = std::stoi(next());
            } else if (option == "--warmup") {
                args.warmup = std::stoi(next());
            } else if (option == "--repeat") {
                args.repeat = std::stoi(next());
            } else if (option == "--seed") {
                args.seed = std::stoull(next());
            } else {
                usage_error("unknown option: " + option);
            }
        } catch (const std::exception&) {
            usage_error("invalid value for " + option);
        }
    }

    if (args.size == 0) {
        usage_error("--size must be greater than zero");
    }
    if (args.block <= 0 || args.block > 1024 || args.block % kWaveSize != 0) {
        usage_error("--block must be a positive multiple of 32 and at most 1024");
    }
    if (args.grid < 0 || args.warmup < 0 || args.repeat <= 0) {
        usage_error("--grid/--warmup must be non-negative and --repeat positive");
    }
    return args;
}

std::vector<Version> selected_versions(const std::string& selection) {
    const Version v0{"hip-v0", Version::Kind::v0};
    const Version v1_contiguous{
        "hip-v1-contiguous", Version::Kind::v1_contiguous};
    const Version v1_strided{"hip-v1-strided", Version::Kind::v1_strided};
    const Version v2{"hip-v2", Version::Kind::v2};
    const Version v3{"hip-v3", Version::Kind::v3};

    if (selection == "all") {
        return {v0, v1_contiguous, v1_strided, v2, v3};
    }
    if (selection == "v0") {
        return {v0};
    }
    if (selection == "v1") {
        return {v1_contiguous, v1_strided};
    }
    if (selection == "v1-contiguous") {
        return {v1_contiguous};
    }
    if (selection == "v1-strided") {
        return {v1_strided};
    }
    if (selection == "v2") {
        return {v2};
    }
    if (selection == "v3") {
        return {v3};
    }
    usage_error("unknown version: " + selection);
}

std::size_t ceil_div(std::size_t numerator, std::size_t denominator) {
    return numerator / denominator + (numerator % denominator != 0);
}

unsigned int checked_grid(std::size_t grid) {
    if (grid == 0 || grid > std::numeric_limits<unsigned int>::max()) {
        usage_error("calculated grid is outside the supported range");
    }
    return static_cast<unsigned int>(grid);
}

unsigned int grid_for(const Version& version,
                      const Args& args,
                      const hipDeviceProp_t& properties) {
    if (version.kind == Version::Kind::v0) {
        return checked_grid(ceil_div(args.size, args.block));
    }
    if (version.kind == Version::Kind::v1_contiguous ||
        version.kind == Version::Kind::v1_strided) {
        return checked_grid(ceil_div(
            args.size,
            static_cast<std::size_t>(args.block) * kRoundsPerLane));
    }

    const std::size_t work_items = version.kind == Version::Kind::v3
        ? std::max<std::size_t>(1, args.size / 4)
        : args.size;
    const std::size_t full_grid = ceil_div(work_items, args.block);
    if (args.grid > 0) {
        return checked_grid(std::min<std::size_t>(args.grid, full_grid));
    }
    const std::size_t persistent_grid =
        std::max(1, properties.multiProcessorCount) * 8ULL;
    return checked_grid(std::min(full_grid, persistent_grid));
}

void launch(const Version& version,
            unsigned int grid,
            int block,
            const float* input_a,
            const float* input_b,
            float* output,
            std::size_t size) {
    const dim3 grid_dim(grid);
    const dim3 block_dim(static_cast<unsigned int>(block));
    switch (version.kind) {
        case Version::Kind::v0:
            hipLaunchKernelGGL(vector_add_v0, grid_dim, block_dim, 0, 0,
                               input_a, input_b, output, size);
            break;
        case Version::Kind::v1_contiguous:
            hipLaunchKernelGGL(vector_add_v1_contiguous,
                               grid_dim, block_dim, 0, 0,
                               input_a, input_b, output, size);
            break;
        case Version::Kind::v1_strided:
            hipLaunchKernelGGL(vector_add_v1_strided,
                               grid_dim, block_dim, 0, 0,
                               input_a, input_b, output, size);
            break;
        case Version::Kind::v2:
            hipLaunchKernelGGL(vector_add_v2_grid_stride,
                               grid_dim, block_dim, 0, 0,
                               input_a, input_b, output, size);
            break;
        case Version::Kind::v3:
            hipLaunchKernelGGL(vector_add_v3_float4,
                               grid_dim, block_dim, 0, 0,
                               input_a, input_b, output, size);
            break;
    }
    HIP_CHECK(hipGetLastError());
}

void make_inputs(std::vector<float>& input_a,
                 std::vector<float>& input_b,
                 std::vector<float>& reference,
                 std::size_t seed) {
    for (std::size_t index = 0; index < input_a.size(); ++index) {
        const long long a_integer = static_cast<long long>(
            (index * 17ULL + seed) % 2048ULL) - 1024;
        const long long b_integer = static_cast<long long>(
            (index * 29ULL + seed * 3ULL) % 4096ULL) - 2048;
        input_a[index] = static_cast<float>(a_integer) / 1024.0F;
        input_b[index] = static_cast<float>(b_integer) / 2048.0F;
        reference[index] = input_a[index] + input_b[index];
    }
}

Validation validate(const float* device_output,
                    const std::vector<float>& reference,
                    std::vector<float>& host_output) {
    HIP_CHECK(hipMemcpy(host_output.data(), device_output,
                        host_output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));

    double max_error = 0.0;
    std::size_t first_bad = reference.size();
    for (std::size_t index = 0; index < reference.size(); ++index) {
        const double error = std::abs(
            static_cast<double>(host_output[index]) - reference[index]);
        max_error = std::max(max_error, error);
        if ((!std::isfinite(host_output[index]) || error > 1.0e-6) &&
            first_bad == reference.size()) {
            first_bad = index;
        }
    }
    return {first_bad == reference.size(), max_error, first_bad};
}

Timing benchmark(const Version& version,
                 unsigned int grid,
                 const Args& args,
                 const float* input_a,
                 const float* input_b,
                 float* output) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(version, grid, args.block, input_a, input_b, output, args.size);
    }
    HIP_CHECK(hipDeviceSynchronize());

    std::vector<hipEvent_t> starts(args.repeat);
    std::vector<hipEvent_t> ends(args.repeat);
    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        HIP_CHECK(hipEventCreate(&starts[iteration]));
        HIP_CHECK(hipEventCreate(&ends[iteration]));
    }

    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        HIP_CHECK(hipEventRecord(starts[iteration]));
        launch(version, grid, args.block, input_a, input_b, output, args.size);
        HIP_CHECK(hipEventRecord(ends[iteration]));
    }
    HIP_CHECK(hipDeviceSynchronize());

    std::vector<double> times_ms(args.repeat);
    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        float elapsed_ms = 0.0F;
        HIP_CHECK(hipEventElapsedTime(
            &elapsed_ms, starts[iteration], ends[iteration]));
        times_ms[iteration] = elapsed_ms;
        HIP_CHECK(hipEventDestroy(starts[iteration]));
        HIP_CHECK(hipEventDestroy(ends[iteration]));
    }

    std::sort(times_ms.begin(), times_ms.end());
    const std::size_t middle = times_ms.size() / 2;
    const double median = times_ms.size() % 2 == 0
        ? (times_ms[middle - 1] + times_ms[middle]) / 2.0
        : times_ms[middle];
    double sum = 0.0;
    for (const double value : times_ms) {
        sum += value;
    }
    return {times_ms.front(), median, sum / times_ms.size()};
}

bool run_version(const Version& version,
                 const Args& args,
                 const hipDeviceProp_t& properties,
                 const float* device_a,
                 const float* device_b,
                 float* device_output,
                 const std::vector<float>& reference,
                 std::vector<float>& host_output) {
    const unsigned int grid = grid_for(version, args, properties);
    const std::size_t bytes = args.size * sizeof(float);

    HIP_CHECK(hipMemset(device_output, 0xFF, bytes));
    launch(version, grid, args.block,
           device_a, device_b, device_output, args.size);
    HIP_CHECK(hipDeviceSynchronize());
    const Validation precheck =
        validate(device_output, reference, host_output);
    if (!precheck.correct) {
        std::fprintf(
            stderr,
            "precheck failed for %s at index %zu: got=%g expected=%g\n",
            version.name.c_str(), precheck.first_bad_index,
            host_output[precheck.first_bad_index],
            reference[precheck.first_bad_index]);
        std::printf(
            "RESULT operator=vector-add implementation=%s runtime=hip "
            "shape=%zu dtype=float32 "
            "block=%d grid=%u warmup=%d repeat=%d seed=%zu timed=0 "
            "correct=FAIL precheck=FAIL postcheck=NA min_ms=NA "
            "median_ms=NA mean_ms=NA effective_bandwidth_gbs=NA "
            "max_abs_error=%.9g\n",
            version.name.c_str(), args.size, args.block, grid,
            args.warmup, args.repeat, args.seed,
            precheck.max_absolute_error);
        return false;
    }

    const Timing timing = benchmark(
        version, grid, args, device_a, device_b, device_output);
    const Validation postcheck =
        validate(device_output, reference, host_output);
    const double logical_bytes =
        3.0 * static_cast<double>(args.size) * sizeof(float);
    const double effective_bandwidth_gbs =
        logical_bytes / (timing.median_ms * 1.0e-3) / 1.0e9;

    std::printf(
        "RESULT operator=vector-add implementation=%s runtime=hip "
        "shape=%zu dtype=float32 "
        "block=%d grid=%u warmup=%d repeat=%d seed=%zu timed=1 "
        "correct=%s precheck=OK postcheck=%s min_ms=%.6f "
        "median_ms=%.6f mean_ms=%.6f effective_bandwidth_gbs=%.6f "
        "max_abs_error=%.9g\n",
        version.name.c_str(), args.size, args.block, grid,
        args.warmup, args.repeat, args.seed,
        postcheck.correct ? "OK" : "FAIL",
        postcheck.correct ? "OK" : "FAIL",
        timing.minimum_ms, timing.median_ms, timing.mean_ms,
        effective_bandwidth_gbs, postcheck.max_absolute_error);
    return postcheck.correct;
}

}  // namespace

int main(int argc, char** argv) {
    const Args args = parse_args(argc, argv);
    const std::vector<Version> versions = selected_versions(args.version);

    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    std::printf(
        "ENV runtime=hip gpu=\"%s\" arch=%s compute_units=%d wave_size=%d\n",
        properties.name, properties.gcnArchName,
        properties.multiProcessorCount, properties.warpSize);

    const std::size_t bytes = args.size * sizeof(float);
    std::vector<float> host_a(args.size);
    std::vector<float> host_b(args.size);
    std::vector<float> reference(args.size);
    std::vector<float> host_output(args.size);
    make_inputs(host_a, host_b, reference, args.seed);

    float* device_a = nullptr;
    float* device_b = nullptr;
    float* device_output = nullptr;
    HIP_CHECK(hipMalloc(&device_a, bytes));
    HIP_CHECK(hipMalloc(&device_b, bytes));
    HIP_CHECK(hipMalloc(&device_output, bytes));
    HIP_CHECK(hipMemcpy(
        device_a, host_a.data(), bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(
        device_b, host_b.data(), bytes, hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Version& version : versions) {
        all_correct = run_version(
            version, args, properties,
            device_a, device_b, device_output,
            reference, host_output) && all_correct;
    }

    HIP_CHECK(hipFree(device_a));
    HIP_CHECK(hipFree(device_b));
    HIP_CHECK(hipFree(device_output));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
