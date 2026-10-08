// Chapter 10: numerically stable row-wise Softmax in HIP.
//
// The baseline deliberately exposes three global-memory stages. The fused
// version assigns one block to one row and keeps both reductions in LDS.

#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iomanip>
#include <limits>
#include <numeric>
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

constexpr float kDeviceNegativeInfinity = -std::numeric_limits<float>::infinity();
constexpr double kAbsoluteTolerance = 2.0e-5;
constexpr double kRowSumTolerance = 2.0e-5;

__global__ void row_max_serial(const float* __restrict__ input,
                               float* __restrict__ row_max,
                               std::size_t rows,
                               std::size_t columns) {
    const std::size_t row =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (row >= rows) {
        return;
    }

    float maximum = kDeviceNegativeInfinity;
    const std::size_t base = row * columns;
    for (std::size_t column = 0; column < columns; ++column) {
        maximum = fmaxf(maximum, input[base + column]);
    }
    row_max[row] = maximum;
}

__global__ void row_exp_sum_serial(const float* __restrict__ input,
                                   const float* __restrict__ row_max,
                                   float* __restrict__ exponentials,
                                   float* __restrict__ row_sum,
                                   std::size_t rows,
                                   std::size_t columns) {
    const std::size_t row =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (row >= rows) {
        return;
    }

    const std::size_t base = row * columns;
    float sum = 0.0F;
    for (std::size_t column = 0; column < columns; ++column) {
        const float value = expf(input[base + column] - row_max[row]);
        exponentials[base + column] = value;
        sum += value;
    }
    row_sum[row] = sum;
}

__global__ void normalize_rows(const float* __restrict__ exponentials,
                               const float* __restrict__ row_sum,
                               float* __restrict__ output,
                               std::size_t elements,
                               std::size_t columns) {
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (index < elements) {
        output[index] = exponentials[index] / row_sum[index / columns];
    }
}

// Bridge experiment: preserve three stages while assigning one block per row.
// The max/sum trees and column-stride mapping match softmax_fused_lds.
__global__ void row_max_block(const float* __restrict__ input,
                             float* __restrict__ row_max,
                             std::size_t columns) {
    extern __shared__ float shared[];
    const unsigned int lane = threadIdx.x;
    const std::size_t base = static_cast<std::size_t>(blockIdx.x) * columns;
    float local = kDeviceNegativeInfinity;
    for (std::size_t column = lane; column < columns; column += blockDim.x)
        local = fmaxf(local, input[base + column]);
    shared[lane] = local;
    __syncthreads();
    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (lane < stride) shared[lane] = fmaxf(shared[lane], shared[lane + stride]);
        __syncthreads();
    }
    if (lane == 0) row_max[blockIdx.x] = shared[0];
}

__global__ void row_exp_sum_block(const float* __restrict__ input,
                                 const float* __restrict__ row_max,
                                 float* __restrict__ exponentials,
                                 float* __restrict__ row_sum,
                                 std::size_t columns) {
    extern __shared__ float shared[];
    const unsigned int lane = threadIdx.x;
    const std::size_t base = static_cast<std::size_t>(blockIdx.x) * columns;
    const float maximum = row_max[blockIdx.x];
    float local = 0.0F;
    for (std::size_t column = lane; column < columns; column += blockDim.x) {
        const float value = expf(input[base + column] - maximum);
        exponentials[base + column] = value;
        local += value;
    }
    shared[lane] = local;
    __syncthreads();
    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (lane < stride) shared[lane] += shared[lane + stride];
        __syncthreads();
    }
    if (lane == 0) row_sum[blockIdx.x] = shared[0];
}

__global__ void normalize_block(const float* __restrict__ exponentials,
                               const float* __restrict__ row_sum,
                               float* __restrict__ output,
                               std::size_t columns) {
    const std::size_t base = static_cast<std::size_t>(blockIdx.x) * columns;
    const float denominator = row_sum[blockIdx.x];
    for (std::size_t column = threadIdx.x; column < columns; column += blockDim.x)
        output[base + column] = exponentials[base + column] / denominator;
}

__global__ void softmax_fused_lds(const float* __restrict__ input,
                                  float* __restrict__ output,
                                  std::size_t rows,
                                  std::size_t columns) {
    const std::size_t row = blockIdx.x;
    if (row >= rows) {
        return;
    }

    extern __shared__ float shared[];
    const unsigned int lane = threadIdx.x;
    const std::size_t base = row * columns;

    float local_maximum = kDeviceNegativeInfinity;
    for (std::size_t column = lane; column < columns; column += blockDim.x) {
        local_maximum = fmaxf(local_maximum, input[base + column]);
    }
    shared[lane] = local_maximum;
    __syncthreads();

    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (lane < stride) {
            shared[lane] = fmaxf(shared[lane], shared[lane + stride]);
        }
        __syncthreads();
    }
    const float maximum = shared[0];
    // Every thread must read the maximum before LDS is reused for the sum.
    __syncthreads();

    float local_sum = 0.0F;
    for (std::size_t column = lane; column < columns; column += blockDim.x) {
        local_sum += expf(input[base + column] - maximum);
    }
    shared[lane] = local_sum;
    __syncthreads();

    for (unsigned int stride = blockDim.x / 2; stride > 0; stride /= 2) {
        if (lane < stride) {
            shared[lane] += shared[lane + stride];
        }
        __syncthreads();
    }
    const float denominator = shared[0];

    for (std::size_t column = lane; column < columns; column += blockDim.x) {
        output[base + column] =
            expf(input[base + column] - maximum) / denominator;
    }
}

struct Args {
    std::string version = "all";
    std::size_t rows = 4096;
    std::size_t columns = 1024;
    int block = 256;
    int warmup = 10;
    int repeat = 50;
    std::uint64_t seed = 20260920;
    std::string samples;
    std::string config_id;
    int process = 1;
};

enum class Kind { baseline, cooperative, fused };

struct Implementation {
    const char* name;
    Kind kind;
    int launches;
};

struct Validation {
    bool correct;
    bool finite;
    double max_absolute_error;
    double max_row_sum_error;
    std::size_t first_bad_index;
};

struct Timing {
    double minimum_ms;
    double median_ms;
    double mean_ms;
    std::vector<double> samples;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: softmax_hip [--version all|baseline|cooperative|fused] "
        "[--rows N] [--cols N] [--block N] [--warmup N] "
        "[--repeat N] [--seed N] [--samples CSV] [--config-id ID] [--process N]\n",
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
            } else if (option == "--rows") {
                args.rows = std::stoull(next());
            } else if (option == "--cols") {
                args.columns = std::stoull(next());
            } else if (option == "--block") {
                args.block = std::stoi(next());
            } else if (option == "--warmup") {
                args.warmup = std::stoi(next());
            } else if (option == "--repeat") {
                args.repeat = std::stoi(next());
            } else if (option == "--seed") {
                args.seed = std::stoull(next());
            } else if (option == "--samples") {
                args.samples = next();
            } else if (option == "--config-id") {
                args.config_id = next();
            } else if (option == "--process") {
                args.process = std::stoi(next());
            } else {
                usage_error("unknown option: " + option);
            }
        } catch (const std::exception&) {
            usage_error("invalid value for " + option);
        }
    }

    if (args.rows == 0 || args.columns == 0) {
        usage_error("--rows and --cols must be positive");
    }
    if (args.rows > std::numeric_limits<unsigned int>::max()) {
        usage_error("--rows is too large for the fused grid");
    }
    if (args.columns > std::numeric_limits<std::size_t>::max() / args.rows) {
        usage_error("rows * columns overflows size_t");
    }
    if (args.rows * args.columns >
        std::numeric_limits<std::size_t>::max() / sizeof(float)) {
        usage_error("the FP32 tensor byte size overflows size_t");
    }
    if (args.block <= 0 || args.block > 1024 ||
        (args.block & (args.block - 1)) != 0) {
        usage_error("--block must be a power of two between 1 and 1024");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.version != "all" && args.version != "baseline" &&
        args.version != "cooperative" && args.version != "fused") {
        usage_error("unknown version: " + args.version);
    }
    if (!args.samples.empty() && (args.version == "all" || args.config_id.empty()))
        usage_error("--samples requires one version and a --config-id");
    if (args.seed > UINT32_MAX) usage_error("seed must fit uint32");
    if (args.process <= 0 || args.config_id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") != std::string::npos)
        usage_error("invalid process or config-id");
    return args;
}

std::vector<Implementation> selected_implementations(
    const std::string& version) {
    const Implementation baseline{"hip-baseline-3kernel", Kind::baseline, 3};
    const Implementation cooperative{"hip-cooperative-3kernel", Kind::cooperative, 3};
    const Implementation fused{"hip-fused-block-lds", Kind::fused, 1};
    if (version == "all") {
        return {baseline, cooperative, fused};
    }
    if (version == "cooperative") return {cooperative};
    return version == "baseline" ? std::vector<Implementation>{baseline}
                                 : std::vector<Implementation>{fused};
}

std::size_t ceil_div(std::size_t numerator, std::size_t denominator) {
    return numerator / denominator + (numerator % denominator != 0);
}

unsigned int checked_grid(std::size_t blocks) {
    if (blocks == 0 || blocks > std::numeric_limits<unsigned int>::max()) {
        usage_error("calculated grid is outside the supported range");
    }
    return static_cast<unsigned int>(blocks);
}

void launch(const Implementation& implementation,
            const Args& args,
            const float* input,
            float* output,
            float* exponentials,
            float* row_max,
            float* row_sum) {
    const dim3 block(static_cast<unsigned int>(args.block));
    const std::size_t elements = args.rows * args.columns;

    if (implementation.kind == Kind::baseline) {
        const dim3 row_grid(checked_grid(ceil_div(args.rows, args.block)));
        const dim3 element_grid(checked_grid(ceil_div(elements, args.block)));
        hipLaunchKernelGGL(row_max_serial, row_grid, block, 0, 0,
                           input, row_max, args.rows, args.columns);
        hipLaunchKernelGGL(row_exp_sum_serial, row_grid, block, 0, 0,
                           input, row_max, exponentials, row_sum,
                           args.rows, args.columns);
        hipLaunchKernelGGL(normalize_rows, element_grid, block, 0, 0,
                           exponentials, row_sum, output,
                           elements, args.columns);
    } else if (implementation.kind == Kind::cooperative) {
        const dim3 row_grid(static_cast<unsigned int>(args.rows));
        const std::size_t lds_bytes = static_cast<std::size_t>(args.block) * sizeof(float);
        hipLaunchKernelGGL(row_max_block, row_grid, block, lds_bytes, 0,
                           input, row_max, args.columns);
        hipLaunchKernelGGL(row_exp_sum_block, row_grid, block, lds_bytes, 0,
                           input, row_max, exponentials, row_sum, args.columns);
        hipLaunchKernelGGL(normalize_block, row_grid, block, 0, 0,
                           exponentials, row_sum, output, args.columns);
    } else {
        const dim3 row_grid(static_cast<unsigned int>(args.rows));
        const std::size_t lds_bytes =
            static_cast<std::size_t>(args.block) * sizeof(float);
        hipLaunchKernelGGL(softmax_fused_lds, row_grid, block, lds_bytes, 0,
                           input, output, args.rows, args.columns);
    }
    HIP_CHECK(hipGetLastError());
}

std::vector<float> make_input(const Args& args) {
    std::vector<float> input(args.rows * args.columns);
    for (std::size_t row = 0; row < args.rows; ++row) {
        const float shift = row % 3 == 0 ? 1000.0F
                           : row % 3 == 1 ? -1000.0F
                                          : 0.0F;
        for (std::size_t column = 0; column < args.columns; ++column) {
            const std::uint64_t mixed =
                static_cast<std::uint64_t>(column) * 17ULL +
                static_cast<std::uint64_t>(row) * 131ULL + args.seed;
            const int centered = static_cast<int>(mixed % 4096ULL) - 2048;
            input[row * args.columns + column] =
                shift + static_cast<float>(centered) / 128.0F;
        }
    }
    return input;
}

std::vector<float> cpu_reference(const std::vector<float>& input,
                                 std::size_t rows,
                                 std::size_t columns) {
    std::vector<float> reference(input.size());
    std::vector<double> exponentials(columns);
    for (std::size_t row = 0; row < rows; ++row) {
        const std::size_t base = row * columns;
        double maximum = -std::numeric_limits<double>::infinity();
        for (std::size_t column = 0; column < columns; ++column) {
            maximum = std::max(maximum, double(input[base + column]));
        }

        double sum = 0.0;
        for (std::size_t column = 0; column < columns; ++column) {
            const double value = std::exp(double(input[base + column]) - maximum);
            exponentials[column] = value;
            sum += value;
        }
        for (std::size_t column = 0; column < columns; ++column) {
            reference[base + column] = float(exponentials[column] / sum);
        }
    }
    return reference;
}

Validation validate(const std::vector<float>& output,
                    const std::vector<float>& reference,
                    std::size_t rows,
                    std::size_t columns) {
    Validation result{true, true, 0.0, 0.0, output.size()};
    for (std::size_t row = 0; row < rows; ++row) {
        double row_sum = 0.0;
        for (std::size_t column = 0; column < columns; ++column) {
            const std::size_t index = row * columns + column;
            result.finite = result.finite && std::isfinite(output[index]);
            row_sum += output[index];
            const double error =
                std::abs(static_cast<double>(output[index]) - reference[index]);
            result.max_absolute_error =
                std::max(result.max_absolute_error, error);
            if ((!std::isfinite(output[index]) ||
                 error > kAbsoluteTolerance) &&
                result.first_bad_index == output.size()) {
                result.first_bad_index = index;
                result.correct = false;
            }
        }
        result.max_row_sum_error =
            std::max(result.max_row_sum_error, std::abs(row_sum - 1.0));
    }
    result.correct = result.correct &&
                     result.max_row_sum_error <= kRowSumTolerance;
    return result;
}

Timing benchmark(const Implementation& implementation,
                 const Args& args,
                 const float* input,
                 float* output,
                 float* exponentials,
                 float* row_max,
                 float* row_sum) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(implementation, args, input, output,
               exponentials, row_max, row_sum);
    }
    HIP_CHECK(hipDeviceSynchronize());

    hipEvent_t start;
    hipEvent_t end;
    HIP_CHECK(hipEventCreate(&start));
    HIP_CHECK(hipEventCreate(&end));
    std::vector<double> times_ms;
    times_ms.reserve(args.repeat);
    for (int iteration = 0; iteration < args.repeat; ++iteration) {
        HIP_CHECK(hipEventRecord(start, nullptr));
        launch(implementation, args, input, output,
               exponentials, row_max, row_sum);
        HIP_CHECK(hipEventRecord(end, nullptr));
        HIP_CHECK(hipEventSynchronize(end));
        float elapsed_ms = 0.0F;
        HIP_CHECK(hipEventElapsedTime(&elapsed_ms, start, end));
        times_ms.push_back(elapsed_ms);
    }
    HIP_CHECK(hipEventDestroy(start));
    HIP_CHECK(hipEventDestroy(end));

    const std::vector<double> samples = times_ms;
    std::sort(times_ms.begin(), times_ms.end());
    const double median = times_ms.size() % 2 == 0
        ? (times_ms[times_ms.size() / 2 - 1] +
           times_ms[times_ms.size() / 2]) / 2.0
        : times_ms[times_ms.size() / 2];
    return Timing{
        times_ms.front(),
        median,
        std::accumulate(times_ms.begin(), times_ms.end(), 0.0) /
            times_ms.size(),
        samples,
    };
}

void print_result(const Implementation& implementation,
                  const Args& args,
                  const Timing* timing,
                  const Validation& validation,
                  const char* precheck,
                  const char* postcheck) {
    const char* status = validation.correct ? "OK" : "FAIL";
    std::printf(
        "RESULT operator=softmax implementation=%s runtime=hip "
        "shape=%zux%zu dtype=float32 block=%d launches=%d lds_bytes=%zu "
        "warmup=%d repeat=%d seed=%llu timing=gpu-event "
        "scope=gpu-event-full-operator input=shifted-dyadic reference=fp64-softmax-to-fp32 "
        "timed=%d correct=%s precheck=%s postcheck=%s ",
        implementation.name, args.rows, args.columns, args.block,
        implementation.launches,
        implementation.kind != Kind::baseline
            ? static_cast<std::size_t>(args.block) * sizeof(float)
            : 0,
        args.warmup, args.repeat,
        static_cast<unsigned long long>(args.seed), timing != nullptr,
        status, precheck, postcheck);
    std::printf("config_id=%s num_warps=0 output_finite=%s ", args.config_id.c_str(), validation.finite ? "OK" : "FAIL");
    if (timing == nullptr) {
        std::printf("min_ms=NA median_ms=NA mean_ms=NA ");
    } else {
        std::printf("min_ms=%.9f median_ms=%.9f mean_ms=%.9f ",
                    timing->minimum_ms, timing->median_ms, timing->mean_ms);
    }
    std::printf("max_abs_error=%.9g max_row_sum_error=%.9g\n",
                validation.max_absolute_error,
                validation.max_row_sum_error);
}

void save_samples(const Implementation& implementation, const Args& args,
                  const Timing& timing) {
    if (args.samples.empty()) return;
    std::ofstream file(args.samples);
    if (!file) usage_error("cannot open sample file");
    file << "config_id,implementation,runtime,shape,dtype,block,num_warps,launches,warmup,repeat,seed,process,scope,input,sample,ms\n";
    file << std::setprecision(17);
    for (std::size_t i = 0; i < timing.samples.size(); ++i)
        file << args.config_id << ',' << implementation.name << ",hip,"
             << args.rows << 'x' << args.columns << ",float32," << args.block
             << ",0," << implementation.launches << ',' << args.warmup << ','
             << args.repeat << ',' << args.seed << ',' << args.process << ",gpu-event-full-operator,shifted-dyadic,"
             << i << ',' << timing.samples[i] << '\n';
    if (!file) usage_error("failed writing sample file");
}

}  // namespace

int main(int argc, char** argv) {
    const Args args = parse_args(argc, argv);
    const std::size_t elements = args.rows * args.columns;
    const std::size_t bytes = elements * sizeof(float);
    const std::size_t row_bytes = args.rows * sizeof(float);

    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    std::printf("ENV runtime=hip gpu=\"%s\" arch=%s wave_size=%d rows=%zu cols=%zu\n",
                properties.name, properties.gcnArchName, properties.warpSize, args.rows, args.columns);

    const std::vector<float> host_input = make_input(args);
    const std::vector<float> reference =
        cpu_reference(host_input, args.rows, args.columns);
    std::vector<float> host_output(elements);

    float* device_input = nullptr;
    float* device_output = nullptr;
    float* device_exponentials = nullptr;
    float* device_row_max = nullptr;
    float* device_row_sum = nullptr;
    HIP_CHECK(hipMalloc(&device_input, bytes));
    HIP_CHECK(hipMalloc(&device_output, bytes));
    HIP_CHECK(hipMalloc(&device_exponentials, bytes));
    HIP_CHECK(hipMalloc(&device_row_max, row_bytes));
    HIP_CHECK(hipMalloc(&device_row_sum, row_bytes));
    HIP_CHECK(hipMemcpy(device_input, host_input.data(), bytes,
                        hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Implementation& implementation :
         selected_implementations(args.version)) {
        HIP_CHECK(hipMemset(device_output, 0xFF, bytes));
        HIP_CHECK(hipMemset(device_exponentials, 0xFF, bytes));
        HIP_CHECK(hipMemset(device_row_max, 0xFF, row_bytes));
        HIP_CHECK(hipMemset(device_row_sum, 0xFF, row_bytes));
        launch(implementation, args, device_input, device_output,
               device_exponentials, device_row_max, device_row_sum);
        HIP_CHECK(hipDeviceSynchronize());
        HIP_CHECK(hipMemcpy(host_output.data(), device_output, bytes,
                            hipMemcpyDeviceToHost));
        const Validation precheck =
            validate(host_output, reference, args.rows, args.columns);
        if (!precheck.correct) {
            print_result(implementation, args, nullptr, precheck,
                         "FAIL", "NA");
            all_correct = false;
            continue;
        }

        const Timing timing = benchmark(
            implementation, args, device_input, device_output,
            device_exponentials, device_row_max, device_row_sum);
        HIP_CHECK(hipMemcpy(host_output.data(), device_output, bytes,
                            hipMemcpyDeviceToHost));
        const Validation postcheck =
            validate(host_output, reference, args.rows, args.columns);
        print_result(implementation, args, &timing, postcheck,
                     "OK", postcheck.correct ? "OK" : "FAIL");
        all_correct = all_correct && postcheck.correct;
        if (postcheck.correct) save_samples(implementation, args, timing);
    }

    HIP_CHECK(hipFree(device_row_sum));
    HIP_CHECK(hipFree(device_row_max));
    HIP_CHECK(hipFree(device_exponentials));
    HIP_CHECK(hipFree(device_output));
    HIP_CHECK(hipFree(device_input));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
