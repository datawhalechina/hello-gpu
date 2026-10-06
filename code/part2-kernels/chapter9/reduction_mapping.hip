#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

#define HIP_CHECK(call)                                                       \
    do {                                                                      \
        const hipError_t error = (call);                                      \
        if (error != hipSuccess) {                                            \
            std::fprintf(stderr, "HIP error at %s:%d: %s\n", __FILE__,       \
                         __LINE__, hipGetErrorString(error));                  \
            std::exit(EXIT_FAILURE);                                          \
        }                                                                     \
    } while (false)

namespace {

struct Args {
    std::string version = "all";
    std::string input = "random";
    std::string measure = "both";
    std::string order = "rotate";
    std::string samples = "mapping_samples.csv";
    std::size_t size = 16777216;
    unsigned int block = 256;
    unsigned int warmup = 5;
    unsigned int repeat = 30;
    std::uint64_t seed = 20260919;
};

void usage() {
    std::puts(
        "Usage: reduction_mapping [--version all|interleaved|compacted|sequential]\n"
        "  [--size N] [--block N] [--input random|ones|weighted] [--seed N]\n"
        "  [--warmup N] [--repeat N] [--order rotate|fixed]\n"
        "  [--measure both|partial|two-stage] [--samples FILE]\n"
        "partial: one first-stage kernel; two-stage: first-stage + fixed final kernel.\n"
        "Each interval uses its own launch(es) and GPU events, with no memory copy.\n"
        "Pre/post correctness checks and warmup are outside measured intervals.\n"
        "A profiler also sees these unmeasured check/warmup launches.");
}

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
}

std::uint64_t integer(const std::string& value, const std::string& option) {
    if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos) {
        fail(option + " requires an unsigned decimal integer");
    }
    try {
        return std::stoull(value);
    } catch (const std::exception&) {
        fail(option + " is out of range");
    }
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string option = argv[index];
        if (option == "--help" || option == "-h") {
            usage();
            std::exit(EXIT_SUCCESS);
        }
        if (index + 1 == argc) fail("missing value for " + option);
        const std::string value = argv[++index];
        if (option == "--version") args.version = value;
        else if (option == "--input") args.input = value;
        else if (option == "--measure") args.measure = value;
        else if (option == "--order") args.order = value;
        else if (option == "--samples") args.samples = value;
        else if (option == "--seed") args.seed = integer(value, option);
        else if (option == "--size") {
            const auto number = integer(value, option);
            if (number == 0 || number > std::numeric_limits<std::size_t>::max() / sizeof(float)) {
                fail("--size must be positive and fit an FP32 allocation");
            }
            args.size = static_cast<std::size_t>(number);
        } else if (option == "--block" || option == "--warmup" || option == "--repeat") {
            const auto number = integer(value, option);
            if (number > std::numeric_limits<unsigned int>::max()) fail(option + " is out of range");
            if (option == "--block") args.block = static_cast<unsigned int>(number);
            else if (option == "--warmup") args.warmup = static_cast<unsigned int>(number);
            else args.repeat = static_cast<unsigned int>(number);
        } else fail("unknown option: " + option);
    }
    if (args.block == 0 || (args.block & (args.block - 1)) != 0) {
        fail("--block must be a positive power of two");
    }
    if (args.repeat == 0) fail("--repeat must be positive");
    if (args.version != "all" && args.version != "interleaved" &&
        args.version != "compacted" && args.version != "sequential") fail("unknown --version");
    if (args.input != "random" && args.input != "ones" && args.input != "weighted") fail("unknown --input");
    if (args.measure != "both" && args.measure != "partial" && args.measure != "two-stage") fail("unknown --measure");
    if (args.order != "rotate" && args.order != "fixed") fail("unknown --order");
    if (args.samples.empty()) fail("--samples cannot be empty");
    return args;
}

// All three first stages load the same elements and write one partial per block.
// The initial barrier and one barrier per reduction round are identical.
__global__ void mapping_interleaved_partial(const float* input, std::size_t size,
                                          float* partials) {
    extern __shared__ float shared[];
    const unsigned int thread = threadIdx.x;
    const std::size_t index = static_cast<std::size_t>(blockIdx.x) * blockDim.x + thread;
    shared[thread] = index < size ? input[index] : 0.0f;
    __syncthreads();
    for (unsigned int stride = 1; stride < blockDim.x; stride *= 2) {
        if (thread % (2 * stride) == 0) {
            shared[thread] += shared[thread + stride];
        }
        __syncthreads();
    }
    if (thread == 0) partials[blockIdx.x] = shared[0];
}

__global__ void mapping_compacted_partial(const float* input, std::size_t size,
                                        float* partials) {
    extern __shared__ float shared[];
    const unsigned int thread = threadIdx.x;
    const std::size_t index = static_cast<std::size_t>(blockIdx.x) * blockDim.x + thread;
    shared[thread] = index < size ? input[index] : 0.0f;
    __syncthreads();
    for (unsigned int stride = 1; stride < blockDim.x; stride *= 2) {
        const unsigned int j = 2 * stride * thread;
        if (j < blockDim.x) {
            shared[j] += shared[j + stride];
        }
        __syncthreads();
    }
    if (thread == 0) partials[blockIdx.x] = shared[0];
}

__global__ void mapping_sequential_partial(const float* input, std::size_t size,
                                         float* partials) {
    extern __shared__ float shared[];
    const unsigned int thread = threadIdx.x;
    const std::size_t index = static_cast<std::size_t>(blockIdx.x) * blockDim.x + thread;
    shared[thread] = index < size ? input[index] : 0.0f;
    __syncthreads();
    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (thread < stride) {
            shared[thread] += shared[thread + stride];
        }
        __syncthreads();
    }
    if (thread == 0) partials[blockIdx.x] = shared[0];
}

// The final merge is deliberately fixed: no contended global atomic operation.
__global__ void mapping_final_sum(const float* partials, std::size_t count,
                                  float* output) {
    extern __shared__ float shared[];
    const unsigned int thread = threadIdx.x;
    float value = 0.0f;
    for (std::size_t index = thread; index < count; index += blockDim.x) {
        value += partials[index];
    }
    shared[thread] = value;
    __syncthreads();
    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (thread < stride) shared[thread] += shared[thread + stride];
        __syncthreads();
    }
    if (thread == 0) *output = shared[0];
}

struct Implementation {
    std::string name;
    float* partials = nullptr;
    float* output = nullptr;
    std::vector<float> partial_times;
    std::vector<float> complete_times;
};

void launch_partial(const Implementation& implementation, const Args& args,
                    unsigned int grid, const float* input) {
    const auto bytes = static_cast<std::size_t>(args.block) * sizeof(float);
    if (implementation.name == "interleaved") {
        hipLaunchKernelGGL(mapping_interleaved_partial, dim3(grid), dim3(args.block), bytes, 0,
                           input, args.size, implementation.partials);
    } else if (implementation.name == "compacted") {
        hipLaunchKernelGGL(mapping_compacted_partial, dim3(grid), dim3(args.block), bytes, 0,
                           input, args.size, implementation.partials);
    } else {
        hipLaunchKernelGGL(mapping_sequential_partial, dim3(grid), dim3(args.block), bytes, 0,
                           input, args.size, implementation.partials);
    }
    HIP_CHECK(hipGetLastError());
}

void launch_final(const Implementation& implementation, const Args& args, unsigned int grid) {
    hipLaunchKernelGGL(mapping_final_sum, dim3(1), dim3(args.block),
                       static_cast<std::size_t>(args.block) * sizeof(float), 0,
                       implementation.partials, static_cast<std::size_t>(grid), implementation.output);
    HIP_CHECK(hipGetLastError());
}

std::uint64_t next_random(std::uint64_t& state) {
    // SplitMix64: stable across standard-library implementations, including seed 0.
    std::uint64_t value = (state += UINT64_C(0x9e3779b97f4a7c15));
    value = (value ^ (value >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

struct Reference {
    std::vector<double> partials;
    double total = 0.0;
    float final_fp32 = 0.0f;
};

Reference make_input(const Args& args, unsigned int grid, std::vector<float>& input) {
    Reference reference;
    reference.partials.resize(grid, 0.0);
    std::uint64_t state = args.seed;
    for (std::size_t index = 0; index < input.size(); ++index) {
        if (args.input == "ones") input[index] = 1.0f;
        else if (args.input == "weighted") input[index] = static_cast<float>(index % 16 + 1) / 16.0f;
        else input[index] = static_cast<float>(static_cast<int>(next_random(state) % 33) - 16) / 32.0f;
        reference.partials[index / args.block] += static_cast<double>(input[index]);
        reference.total += static_cast<double>(input[index]);
    }

    // Small dyadic inputs make each block's sum exactly representable in FP32.
    // For the longer final merge, retain both an FP64 sum and a CPU FP32 tree.
    std::vector<float> final_tree(args.block, 0.0f);
    for (std::size_t index = 0; index < reference.partials.size(); ++index) {
        final_tree[index % args.block] += static_cast<float>(reference.partials[index]);
    }
    for (unsigned int stride = args.block / 2; stride > 0; stride /= 2) {
        for (unsigned int thread = 0; thread < stride; ++thread) {
            final_tree[thread] += final_tree[thread + stride];
        }
    }
    reference.final_fp32 = final_tree[0];
    return reference;
}

void validate(const Implementation& implementation, const Args& args,
              unsigned int grid, const Reference& reference, const char* phase,
              bool merge_partials) {
    // The postcheck inspects the buffers left by timing without rerunning the
    // first stage. Partial-only timing needs an unmeasured final merge as well.
    std::vector<float> partials(grid);
    HIP_CHECK(hipMemcpy(partials.data(), implementation.partials,
                        partials.size() * sizeof(float), hipMemcpyDeviceToHost));
    double max_partial_error = 0.0;
    for (std::size_t index = 0; index < partials.size(); ++index) {
        const double error = std::abs(static_cast<double>(partials[index]) - reference.partials[index]);
        if (!std::isfinite(partials[index]) || error != 0.0) {
            fail(implementation.name + " " + phase + " partial mismatch at block " + std::to_string(index));
        }
        max_partial_error = std::max(max_partial_error, error);
    }
    if (merge_partials) launch_final(implementation, args, grid);
    float actual = 0.0f;
    HIP_CHECK(hipMemcpy(&actual, implementation.output, sizeof(float), hipMemcpyDeviceToHost));
    const double error = std::abs(static_cast<double>(actual) - reference.total);
    // Check the exact fixed FP32 tree, and separately report its error against
    // FP64. A permissive relative tolerance could hide a missing partial.
    if (!std::isfinite(actual) || actual != reference.final_fp32) {
        fail(implementation.name + " " + phase + " final sum mismatch");
    }
    std::printf("CHECK version=%s phase=%s correct=OK partials=%u partial_max_abs_error=%.9g "
                "partial_tolerance=0 result=%.9g reference_fp64=%.17g expected_fp32=%.9g "
                "final_abs_error=%.9g final_tree_match=OK\n",
                implementation.name.c_str(), phase, grid, max_partial_error, actual,
                reference.total, reference.final_fp32, error);
}

void print_result(const Implementation& implementation, const Args& args, unsigned int grid,
                  const char* interval, std::vector<float> times) {
    if (times.empty()) return;
    std::sort(times.begin(), times.end());
    const auto middle = times.size() / 2;
    const float median = times.size() % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2.0f;
    const double mean = std::accumulate(times.begin(), times.end(), 0.0) / times.size();
    std::printf("RESULT operator=reduction-mapping version=%s interval=%s shape=%zu dtype=float32 "
                "block=%u grid=%u input=%s seed=%llu warmup=%u repeat=%u order=%s "
                "correct=OK precheck=OK postcheck=OK min_ms=%.6f median_ms=%.6f mean_ms=%.6f\n",
                implementation.name.c_str(), interval, args.size, args.block, grid, args.input.c_str(),
                static_cast<unsigned long long>(args.seed), args.warmup, args.repeat, args.order.c_str(),
                times.front(), median, mean);
}

int run(const Args& args) {
    int device = 0;
    hipDeviceProp_t properties{};
    int runtime_version = 0;
    int driver_version = 0;
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    HIP_CHECK(hipRuntimeGetVersion(&runtime_version));
    HIP_CHECK(hipDriverGetVersion(&driver_version));
    if (args.block > static_cast<unsigned int>(properties.maxThreadsPerBlock) ||
        properties.warpSize <= 0 || args.block % properties.warpSize != 0) {
        fail("--block must fit the device and be a multiple of its wave size");
    }
    const auto grid_size = (args.size - 1) / args.block + 1;
    if (grid_size > static_cast<std::size_t>(properties.maxGridSize[0])) fail("grid exceeds device limit");
    const auto grid = static_cast<unsigned int>(grid_size);
    std::printf("ENV gpu=\"%s\" arch=%s compute_units=%d wave_size=%d hip_compile=%d.%d.%d "
                "hip_runtime=%d hip_driver=%d\n", properties.name, properties.gcnArchName,
                properties.multiProcessorCount, properties.warpSize, HIP_VERSION_MAJOR,
                HIP_VERSION_MINOR, HIP_VERSION_PATCH, runtime_version, driver_version);
    std::printf("CONFIG size=%zu block=%u grid=%u input=%s seed=%llu warmup=%u repeat=%u "
                "order=%s measure=%s samples=%s\n", args.size, args.block, grid, args.input.c_str(),
                static_cast<unsigned long long>(args.seed), args.warmup, args.repeat,
                args.order.c_str(), args.measure.c_str(), args.samples.c_str());
    std::puts("TIMING method=gpu-events partial=first-stage-only two-stage=first-stage-plus-fixed-final "
              "copies=excluded checks=excluded cache=reused order=rotated-by-round-when-enabled");

    std::ofstream samples(args.samples);
    if (!samples) fail("cannot open samples file: " + args.samples);
    samples << "round,position,interval_position,version,interval,size,block,input,seed,event_ms\n" << std::setprecision(9);
    std::vector<float> host_input(args.size);
    const Reference reference = make_input(args, grid, host_input);
    float* device_input = nullptr;
    HIP_CHECK(hipMalloc(&device_input, args.size * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_input, host_input.data(), args.size * sizeof(float), hipMemcpyHostToDevice));
    std::vector<Implementation> implementations;
    for (const std::string name : {"interleaved", "compacted", "sequential"}) {
        if (args.version != "all" && args.version != name) continue;
        Implementation implementation{name};
        HIP_CHECK(hipMalloc(&implementation.partials, grid_size * sizeof(float)));
        HIP_CHECK(hipMalloc(&implementation.output, sizeof(float)));
        implementations.push_back(implementation);
    }
    for (const auto& implementation : implementations) {
        launch_partial(implementation, args, grid, device_input);
        validate(implementation, args, grid, reference, "pre", true);
    }
    for (unsigned int iteration = 0; iteration < args.warmup; ++iteration) {
        for (const auto& implementation : implementations) {
            launch_partial(implementation, args, grid, device_input);
            launch_final(implementation, args, grid);
        }
    }
    HIP_CHECK(hipDeviceSynchronize());
    hipEvent_t start{}, stop{};
    HIP_CHECK(hipEventCreate(&start));
    HIP_CHECK(hipEventCreate(&stop));
    for (unsigned int round = 0; round < args.repeat; ++round) {
        for (std::size_t position = 0; position < implementations.size(); ++position) {
            const auto offset = args.order == "rotate" ? round % implementations.size() : 0;
            auto& implementation = implementations[(position + offset) % implementations.size()];
            std::vector<std::string> intervals;
            if (args.measure != "two-stage") intervals.push_back("partial");
            if (args.measure != "partial") intervals.push_back("two-stage");
            if (args.order == "rotate" && round % 2) std::reverse(intervals.begin(), intervals.end());
            for (std::size_t interval_position = 0; interval_position < intervals.size(); ++interval_position) {
                const auto& interval = intervals[interval_position];
                HIP_CHECK(hipEventRecord(start));
                launch_partial(implementation, args, grid, device_input);
                if (interval == "two-stage") launch_final(implementation, args, grid);
                HIP_CHECK(hipEventRecord(stop));
                HIP_CHECK(hipEventSynchronize(stop));
                float elapsed_ms = 0.0f;
                HIP_CHECK(hipEventElapsedTime(&elapsed_ms, start, stop));
                if (!std::isfinite(elapsed_ms) || elapsed_ms <= 0.0f) fail("invalid GPU event interval");
                (interval == "partial" ? implementation.partial_times : implementation.complete_times).push_back(elapsed_ms);
                samples << round << ',' << position << ',' << interval_position << ',' << implementation.name << ','
                        << interval << ',' << args.size << ',' << args.block << ',' << args.input << ',' << args.seed << ','
                        << elapsed_ms << '\n';
            }
        }
        samples.flush();
        if (!samples) fail("failed to write samples file");
    }
    for (const auto& implementation : implementations) {
        validate(implementation, args, grid, reference, "post", args.measure == "partial");
        print_result(implementation, args, grid, "partial", implementation.partial_times);
        print_result(implementation, args, grid, "two-stage", implementation.complete_times);
        HIP_CHECK(hipFree(implementation.output));
        HIP_CHECK(hipFree(implementation.partials));
    }
    HIP_CHECK(hipEventDestroy(start));
    HIP_CHECK(hipEventDestroy(stop));
    HIP_CHECK(hipFree(device_input));
    return EXIT_SUCCESS;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        return run(parse_args(argc, argv));
    } catch (const std::exception& error) {
        std::fprintf(stderr, "ERROR %s\n", error.what());
        return EXIT_FAILURE;
    }
}
