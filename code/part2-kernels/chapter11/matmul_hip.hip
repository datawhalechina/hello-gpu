// Chapter 11: FP32 row-major matrix multiplication, HIP route.
//
// C[M, N] = A[M, K] @ B[K, N]. The two implementations keep identical
// semantics: naive assigns one output element to one thread; tiled stages
// Tile size is an explicit configuration (8/16/32), defaulting to 16.

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

constexpr double kAbsoluteTolerance = 1.0e-4;
constexpr double kRelativeTolerance = 1.0e-4;

__global__ void matmul_naive(const float* __restrict__ a,
                             const float* __restrict__ b,
                             float* __restrict__ c,
                             std::size_t m,
                             std::size_t n,
                             std::size_t k) {
    const std::size_t row =
        static_cast<std::size_t>(blockIdx.y) * blockDim.y + threadIdx.y;
    const std::size_t column =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (row >= m || column >= n) {
        return;
    }

    float accumulator = 0.0F;
    for (std::size_t inner = 0; inner < k; ++inner) {
        accumulator += a[row * k + inner] * b[inner * n + column];
    }
    c[row * n + column] = accumulator;
}

template <unsigned int Tile>
__global__ void matmul_tiled(const float* __restrict__ a,
                            const float* __restrict__ b,
                            float* __restrict__ c,
                            std::size_t m,
                            std::size_t n,
                            std::size_t k) {
    __shared__ float tile_a[Tile][Tile];
    __shared__ float tile_b[Tile][Tile];

    const std::size_t row =
        static_cast<std::size_t>(blockIdx.y) * Tile + threadIdx.y;
    const std::size_t column =
        static_cast<std::size_t>(blockIdx.x) * Tile + threadIdx.x;
    const std::size_t tile_count = k / Tile + (k % Tile != 0);
    float accumulator = 0.0F;

    for (std::size_t tile = 0; tile < tile_count; ++tile) {
        const std::size_t a_column = tile * Tile + threadIdx.x;
        const std::size_t b_row = tile * Tile + threadIdx.y;
        tile_a[threadIdx.y][threadIdx.x] =
            row < m && a_column < k ? a[row * k + a_column] : 0.0F;
        tile_b[threadIdx.y][threadIdx.x] =
            b_row < k && column < n ? b[b_row * n + column] : 0.0F;
        __syncthreads();

#pragma unroll
        for (unsigned int inner = 0; inner < Tile; ++inner) {
            accumulator +=
                tile_a[threadIdx.y][inner] * tile_b[inner][threadIdx.x];
        }
        __syncthreads();
    }

    if (row < m && column < n) {
        c[row * n + column] = accumulator;
    }
}

struct Args {
    std::string version = "all";
    std::size_t m = 512;
    std::size_t n = 512;
    std::size_t k = 512;
    int warmup = 5;
    int repeat = 20;
    std::uint64_t seed = 20260920;
    unsigned int tile = 16;
    std::string samples;
    std::string config_id;
    int process_id = 1;
};

struct Version {
    std::string name;
    enum class Kind { naive, tiled } kind;
};

struct Timing {
    double minimum_ms;
    double median_ms;
    double mean_ms;
    std::vector<double> samples;
};

struct Validation {
    bool correct;
    double max_absolute_error;
    double max_relative_error;
    std::size_t first_bad_index;
};

[[noreturn]] void usage_error(const std::string& message) {
    std::fprintf(
        stderr,
        "%s\nUsage: matmul_hip [--version all|naive|tiled] "
        "[--m M] [--n N] [--k K] [--tile 8|16|32] [--warmup N] [--repeat N] [--seed N] "
        "[--samples CSV] [--config-id ID] [--process-id N]\n",
        message.c_str());
    std::exit(EXIT_FAILURE);
}

std::uint64_t unsigned_value(const std::string& text) {
    if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos)
        usage_error("expected a non-negative integer: " + text);
    return std::stoull(text);
}

int nonnegative_int(const std::string& text) {
    const auto value = unsigned_value(text);
    if (value > static_cast<std::uint64_t>(std::numeric_limits<int>::max()))
        usage_error("integer argument is too large: " + text);
    return static_cast<int>(value);
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
            } else if (option == "--m") {
                args.m = unsigned_value(next());
            } else if (option == "--n") {
                args.n = unsigned_value(next());
            } else if (option == "--k") {
                args.k = unsigned_value(next());
            } else if (option == "--warmup") {
                args.warmup = nonnegative_int(next());
            } else if (option == "--repeat") {
                args.repeat = nonnegative_int(next());
            } else if (option == "--seed") {
                args.seed = unsigned_value(next());
            } else if (option == "--tile") {
                const auto tile = unsigned_value(next());
                if (tile != 8 && tile != 16 && tile != 32)
                    usage_error("--tile must be 8, 16, or 32");
                args.tile = static_cast<unsigned int>(tile);
            } else if (option == "--samples") {
                args.samples = next();
            } else if (option == "--config-id") {
                args.config_id = next();
            } else if (option == "--process" || option == "--process-id") {
                args.process_id = nonnegative_int(next());
            } else {
                usage_error("unknown option: " + option);
            }
        } catch (const std::exception&) {
            usage_error("invalid value for " + option);
        }
    }

    if (args.m == 0 || args.n == 0 || args.k == 0) {
        usage_error("--m/--n/--k must be positive");
    }
    if (args.warmup < 0 || args.repeat <= 0) {
        usage_error("--warmup must be non-negative and --repeat positive");
    }
    if (args.version != "all" && args.version != "naive" &&
        args.version != "tiled") {
        usage_error("unknown version: " + args.version);
    }
    if (!args.samples.empty() && args.version == "all")
        usage_error("--samples requires a single --version");
    if (args.process_id <= 0 || args.config_id.find_first_not_of(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") != std::string::npos)
        usage_error("invalid process-id or config-id");
    return args;
}

std::vector<Version> selected_versions(const std::string& selection) {
    const Version naive{"hip-naive", Version::Kind::naive};
    const Version tiled{"hip-tiled", Version::Kind::tiled};
    if (selection == "all") {
        return {naive, tiled};
    }
    return selection == "naive" ? std::vector<Version>{naive}
                                 : std::vector<Version>{tiled};
}

std::size_t checked_elements(std::size_t rows, std::size_t columns) {
    if (columns != 0 && rows > std::numeric_limits<std::size_t>::max() / columns) {
        usage_error("matrix shape overflows size_t");
    }
    const std::size_t elements = rows * columns;
    if (elements > std::numeric_limits<std::size_t>::max() / sizeof(float)) {
        usage_error("matrix byte size overflows size_t");
    }
    return elements;
}

unsigned int checked_grid_dimension(std::size_t length, unsigned int tile) {
    const std::size_t grid = length / tile + (length % tile != 0);
    if (grid == 0 || grid > std::numeric_limits<unsigned int>::max()) {
        usage_error("matrix shape produces an unsupported grid dimension");
    }
    return static_cast<unsigned int>(grid);
}

void launch(const Version& version,
            const float* a,
            const float* b,
            float* c,
            const Args& args) {
    const dim3 block(args.tile, args.tile);
    const dim3 grid(
        checked_grid_dimension(args.n, args.tile), checked_grid_dimension(args.m, args.tile));
    if (version.kind == Version::Kind::naive) {
        hipLaunchKernelGGL(matmul_naive, grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    } else if (args.tile == 8) {
        hipLaunchKernelGGL((matmul_tiled<8>), grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    } else if (args.tile == 16) {
        hipLaunchKernelGGL((matmul_tiled<16>), grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    } else {
        hipLaunchKernelGGL((matmul_tiled<32>), grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    }
    HIP_CHECK(hipGetLastError());
}

void make_inputs(std::vector<float>& a,
                 std::vector<float>& b,
                 std::uint64_t seed) {
    for (std::size_t index = 0; index < a.size(); ++index) {
        const long long value = static_cast<long long>(
            (17ULL * (index % 257ULL) + seed % 257ULL) % 257ULL) - 128;
        a[index] = static_cast<float>(value) / 128.0F;
    }
    for (std::size_t index = 0; index < b.size(); ++index) {
        const long long value = static_cast<long long>(
            (29ULL * (index % 251ULL) + 3ULL * (seed % 251ULL)) % 251ULL) - 125;
        b[index] = static_cast<float>(value) / 128.0F;
    }
}

std::vector<float> cpu_reference(const std::vector<float>& a,
                                 const std::vector<float>& b,
                                 const Args& args) {
    std::vector<float> reference(checked_elements(args.m, args.n), 0.0F);
    for (std::size_t row = 0; row < args.m; ++row) {
        for (std::size_t column = 0; column < args.n; ++column) {
            double accumulator = 0.0;
            for (std::size_t inner = 0; inner < args.k; ++inner) {
                accumulator += static_cast<double>(a[row * args.k + inner]) *
                               static_cast<double>(b[inner * args.n + column]);
            }
            reference[row * args.n + column] = static_cast<float>(accumulator);
        }
    }
    return reference;
}

Validation validate(const float* device_output,
                    const std::vector<float>& reference,
                    std::vector<float>& host_output) {
    HIP_CHECK(hipMemcpy(host_output.data(), device_output,
                        host_output.size() * sizeof(float),
                        hipMemcpyDeviceToHost));
    double max_error = 0.0;
    double max_relative = 0.0;
    std::size_t first_bad = reference.size();
    for (std::size_t index = 0; index < reference.size(); ++index) {
        const double actual = host_output[index];
        const double expected = reference[index];
        if (!std::isfinite(actual) || !std::isfinite(expected)) {
            if (first_bad == reference.size()) first_bad = index;
            max_error = max_relative = std::numeric_limits<double>::infinity();
            continue;
        }
        const double error = std::abs(actual - expected);
        const double tolerance =
            kAbsoluteTolerance + kRelativeTolerance * std::abs(expected);
        max_error = std::max(max_error, error);
        max_relative = std::max(max_relative, error / std::max(std::abs(expected), 1.0e-6));
        if (error > tolerance &&
            first_bad == reference.size()) {
            first_bad = index;
        }
    }
    return {first_bad == reference.size(), max_error, max_relative, first_bad};
}

Timing benchmark(const Version& version,
                 const float* a,
                 const float* b,
                 float* c,
                 const Args& args) {
    for (int iteration = 0; iteration < args.warmup; ++iteration) {
        launch(version, a, b, c, args);
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
        launch(version, a, b, c, args);
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
    const std::vector<double> samples = times_ms;
    std::sort(times_ms.begin(), times_ms.end());
    const std::size_t middle = times_ms.size() / 2;
    const double median = times_ms.size() % 2 == 0
        ? (times_ms[middle - 1] + times_ms[middle]) / 2.0
        : times_ms[middle];
    double sum = 0.0;
    for (const double time_ms : times_ms) {
        sum += time_ms;
    }
    return {times_ms.front(), median, sum / times_ms.size(), samples};
}

std::string config_id(const Version& version, const Args& args) {
    return args.config_id.empty()
        ? version.name + "-t" + std::to_string(args.tile) : args.config_id;
}

void print_result(const Version& version, const Args& args,
                  const Validation& validation, const Timing* timing,
                  const char* precheck, const char* postcheck) {
    const auto id = config_id(version, args);
    const unsigned lds = version.kind == Version::Kind::tiled
        ? 2U * args.tile * args.tile * sizeof(float) : 0;
    std::printf(
        "RESULT operator=matmul config_id=%s implementation=%s runtime=hip "
        "shape=%zux%zux%zu dtype=float32 m=%zu n=%zu k=%zu "
        "tile=%u block_m=%u block_n=%u block_k=%u block_threads=%u "
        "group_m=0 num_warps=0 lds_bytes=%u launches=1 "
        "warmup=%d repeat=%d seed=%llu process=%d process_id=%d "
        "scope=gpu-event-full-operator input=dyadic-modular-v1 input_precision=fp32 "
        "reference=cpu-fp64-to-fp32 atol=%.9g rtol=%.9g timed=%d correct=%s "
        "precheck=%s postcheck=%s ",
        id.c_str(), version.name.c_str(), args.m, args.n, args.k,
        args.m, args.n, args.k, args.tile, args.tile, args.tile,
        version.kind == Version::Kind::tiled ? args.tile : 1U,
        args.tile * args.tile, lds, args.warmup, args.repeat,
        static_cast<unsigned long long>(args.seed), args.process_id, args.process_id,
        kAbsoluteTolerance, kRelativeTolerance, timing != nullptr,
        validation.correct ? "OK" : "FAIL", precheck, postcheck);
    if (timing) {
        const double operations = 2.0 * args.m * args.n * args.k;
        const double tflops = operations / (timing->median_ms * 1.0e-3) / 1.0e12;
        std::printf("min_ms=%.9f median_ms=%.9f mean_ms=%.9f tflops=%.9f ",
                    timing->minimum_ms, timing->median_ms, timing->mean_ms, tflops);
    } else {
        std::printf("min_ms=NA median_ms=NA mean_ms=NA tflops=NA ");
    }
    std::printf("max_abs_error=%.9g max_rel_error=%.9g\n",
                validation.max_absolute_error, validation.max_relative_error);
}

void save_samples(const Version& version, const Args& args, const Timing& timing) {
    if (args.samples.empty()) return;
    std::ofstream file(args.samples);
    if (!file) usage_error("cannot open sample file");
    file << "config_id,implementation,runtime,shape,dtype,m,n,k,tile,block_m,block_n,block_k,block_threads,group_m,num_warps,launches,input,input_precision,reference,atol,rtol,seed,warmup,repeat,process,process_id,scope,sample,ms\n";
    file << std::setprecision(17);
    for (std::size_t sample = 0; sample < timing.samples.size(); ++sample) {
        file << config_id(version, args) << ',' << version.name << ",hip,"
             << args.m << 'x' << args.n << 'x' << args.k << ",float32,"
             << args.m << ',' << args.n << ',' << args.k << ',' << args.tile << ','
             << args.tile << ',' << args.tile << ','
             << (version.kind == Version::Kind::tiled ? args.tile : 1U) << ','
             << args.tile * args.tile << ",0,0,1,dyadic-modular-v1,fp32,cpu-fp64-to-fp32,"
             << kAbsoluteTolerance << ',' << kRelativeTolerance << ','
             << args.seed << ',' << args.warmup << ',' << args.repeat << ','
             << args.process_id << ',' << args.process_id
             << ",gpu-event-full-operator," << sample << ',' << timing.samples[sample] << '\n';
    }
    if (!file) usage_error("failed writing sample file");
}

bool run_version(const Version& version,
                 const Args& args,
                 const float* device_a,
                 const float* device_b,
                 float* device_c,
                 const std::vector<float>& reference,
                 std::vector<float>& host_output) {
    HIP_CHECK(hipMemset(device_c, 0xFF, host_output.size() * sizeof(float)));
    launch(version, device_a, device_b, device_c, args);
    HIP_CHECK(hipDeviceSynchronize());
    const Validation precheck = validate(device_c, reference, host_output);
    if (!precheck.correct) {
        std::fprintf(stderr, "precheck failed for %s at flat index %zu\n",
                     version.name.c_str(), precheck.first_bad_index);
        print_result(version, args, precheck, nullptr, "FAIL", "NA");
        return false;
    }

    const Timing timing = benchmark(version, device_a, device_b, device_c, args);
    const Validation postcheck = validate(device_c, reference, host_output);
    print_result(version, args, postcheck, &timing, "OK", postcheck.correct ? "OK" : "FAIL");
    if (postcheck.correct) save_samples(version, args, timing);
    return postcheck.correct;
}

}  // namespace

int main(int argc, char** argv) {
    const Args args = parse_args(argc, argv);
    const std::vector<Version> versions = selected_versions(args.version);
    const std::size_t elements_a = checked_elements(args.m, args.k);
    const std::size_t elements_b = checked_elements(args.k, args.n);
    const std::size_t elements_c = checked_elements(args.m, args.n);

    int device = 0;
    hipDeviceProp_t properties{};
    HIP_CHECK(hipGetDevice(&device));
    HIP_CHECK(hipGetDeviceProperties(&properties, device));
    std::printf(
        "ENV runtime=hip gpu=\"%s\" arch=%s m=%zu n=%zu k=%zu seed=%llu "
        "input=dyadic-modular-v1 reference=cpu-fp64-to-fp32 input_precision=fp32\n",
        properties.name, properties.gcnArchName,
        args.m, args.n, args.k, static_cast<unsigned long long>(args.seed));

    if (args.tile * args.tile > static_cast<unsigned>(properties.maxThreadsPerBlock) ||
        args.tile > static_cast<unsigned>(properties.maxThreadsDim[0]) ||
        args.tile > static_cast<unsigned>(properties.maxThreadsDim[1]))
        usage_error("selected tile exceeds this device block limits");

    std::vector<float> host_a(elements_a);
    std::vector<float> host_b(elements_b);
    std::vector<float> host_output(elements_c);
    make_inputs(host_a, host_b, args.seed);
    const std::vector<float> reference = cpu_reference(host_a, host_b, args);

    float* device_a = nullptr;
    float* device_b = nullptr;
    float* device_c = nullptr;
    HIP_CHECK(hipMalloc(&device_a, elements_a * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_b, elements_b * sizeof(float)));
    HIP_CHECK(hipMalloc(&device_c, elements_c * sizeof(float)));
    HIP_CHECK(hipMemcpy(device_a, host_a.data(), elements_a * sizeof(float),
                        hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(device_b, host_b.data(), elements_b * sizeof(float),
                        hipMemcpyHostToDevice));

    bool all_correct = true;
    for (const Version& version : versions) {
        all_correct = run_version(
            version, args, device_a, device_b, device_c,
            reference, host_output) && all_correct;
    }

    HIP_CHECK(hipFree(device_a));
    HIP_CHECK(hipFree(device_b));
    HIP_CHECK(hipFree(device_c));
    return all_correct ? EXIT_SUCCESS : EXIT_FAILURE;
}
