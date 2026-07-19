// Chapter 10: FP32 row-major matrix multiplication, HIP route.
//
// C[M, N] = A[M, K] @ B[K, N]. The two implementations keep identical
// semantics: naive assigns one output element to one thread; tiled stages
// 16x16 fragments of A and B in LDS before accumulating the same dot product.

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

constexpr unsigned int kTile = 16;
constexpr double kAbsoluteTolerance = 1.0e-3;
constexpr double kRelativeTolerance = 1.0e-3;

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

__global__ void matmul_tiled(const float* __restrict__ a,
                            const float* __restrict__ b,
                            float* __restrict__ c,
                            std::size_t m,
                            std::size_t n,
                            std::size_t k) {
    __shared__ float tile_a[kTile][kTile];
    __shared__ float tile_b[kTile][kTile];

    const std::size_t row =
        static_cast<std::size_t>(blockIdx.y) * kTile + threadIdx.y;
    const std::size_t column =
        static_cast<std::size_t>(blockIdx.x) * kTile + threadIdx.x;
    const std::size_t tile_count = (k + kTile - 1) / kTile;
    float accumulator = 0.0F;

    for (std::size_t tile = 0; tile < tile_count; ++tile) {
        const std::size_t a_column = tile * kTile + threadIdx.x;
        const std::size_t b_row = tile * kTile + threadIdx.y;
        tile_a[threadIdx.y][threadIdx.x] =
            row < m && a_column < k ? a[row * k + a_column] : 0.0F;
        tile_b[threadIdx.y][threadIdx.x] =
            b_row < k && column < n ? b[b_row * n + column] : 0.0F;
        __syncthreads();

#pragma unroll
        for (unsigned int inner = 0; inner < kTile; ++inner) {
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
    std::size_t seed = 20260719;
};

struct Version {
    std::string name;
    enum class Kind { naive, tiled } kind;
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
        "%s\nUsage: matmul_hip [--version all|naive|tiled] "
        "[--m M] [--n N] [--k K] [--warmup N] [--repeat N] [--seed N]\n",
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
            } else if (option == "--m") {
                args.m = std::stoull(next());
            } else if (option == "--n") {
                args.n = std::stoull(next());
            } else if (option == "--k") {
                args.k = std::stoull(next());
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

unsigned int checked_grid_dimension(std::size_t length) {
    const std::size_t grid = (length + kTile - 1) / kTile;
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
    const dim3 block(kTile, kTile);
    const dim3 grid(
        checked_grid_dimension(args.n), checked_grid_dimension(args.m));
    if (version.kind == Version::Kind::naive) {
        hipLaunchKernelGGL(matmul_naive, grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    } else {
        hipLaunchKernelGGL(matmul_tiled, grid, block, 0, 0,
                           a, b, c, args.m, args.n, args.k);
    }
    HIP_CHECK(hipGetLastError());
}

void make_inputs(std::vector<float>& a,
                 std::vector<float>& b,
                 std::size_t seed) {
    for (std::size_t index = 0; index < a.size(); ++index) {
        const long long value = static_cast<long long>(
            (index * 17ULL + seed) % 97ULL) - 48;
        a[index] = static_cast<float>(value) / 48.0F;
    }
    for (std::size_t index = 0; index < b.size(); ++index) {
        const long long value = static_cast<long long>(
            (index * 29ULL + seed * 3ULL) % 89ULL) - 44;
        b[index] = static_cast<float>(value) / 44.0F;
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
    std::size_t first_bad = reference.size();
    for (std::size_t index = 0; index < reference.size(); ++index) {
        const double actual = host_output[index];
        const double expected = reference[index];
        const double error = std::abs(actual - expected);
        const double tolerance =
            kAbsoluteTolerance + kRelativeTolerance * std::abs(expected);
        max_error = std::max(max_error, error);
        if ((!std::isfinite(actual) || error > tolerance) &&
            first_bad == reference.size()) {
            first_bad = index;
        }
    }
    return {first_bad == reference.size(), max_error, first_bad};
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
    std::sort(times_ms.begin(), times_ms.end());
    const std::size_t middle = times_ms.size() / 2;
    const double median = times_ms.size() % 2 == 0
        ? (times_ms[middle - 1] + times_ms[middle]) / 2.0
        : times_ms[middle];
    double sum = 0.0;
    for (const double time_ms : times_ms) {
        sum += time_ms;
    }
    return {times_ms.front(), median, sum / times_ms.size()};
}

bool run_version(const Version& version,
                 const Args& args,
                 const float* device_a,
                 const float* device_b,
                 float* device_c,
                 const std::vector<float>& reference,
                 std::vector<float>& host_output) {
    HIP_CHECK(hipMemset(
        device_c, 0xFF, host_output.size() * sizeof(float)));
    launch(version, device_a, device_b, device_c, args);
    HIP_CHECK(hipDeviceSynchronize());
    const Validation precheck = validate(device_c, reference, host_output);
    if (!precheck.correct) {
        std::fprintf(stderr,
                     "precheck failed for %s at flat index %zu\n",
                     version.name.c_str(), precheck.first_bad_index);
        std::printf(
            "RESULT operator=matmul implementation=%s runtime=hip "
            "shape=%zux%zux%zu dtype=float32 m=%zu n=%zu k=%zu "
            "tile=%u warmup=%d repeat=%d seed=%zu timed=0 correct=FAIL "
            "precheck=FAIL postcheck=NA min_ms=NA median_ms=NA mean_ms=NA tflops=NA "
            "max_abs_error=%.9g\n",
            version.name.c_str(), args.m, args.n, args.k, args.m, args.n, args.k, kTile,
            args.warmup, args.repeat, args.seed, precheck.max_absolute_error);
        return false;
    }

    const Timing timing = benchmark(version, device_a, device_b, device_c, args);
    const Validation postcheck = validate(device_c, reference, host_output);
    const double operations =
        2.0 * static_cast<double>(args.m) * static_cast<double>(args.n) *
        static_cast<double>(args.k);
    const double tflops = operations / (timing.median_ms * 1.0e-3) / 1.0e12;
    std::printf(
        "RESULT operator=matmul implementation=%s runtime=hip "
        "shape=%zux%zux%zu dtype=float32 m=%zu n=%zu k=%zu "
        "tile=%u warmup=%d repeat=%d seed=%zu timed=1 correct=%s "
        "precheck=OK postcheck=%s min_ms=%.6f median_ms=%.6f mean_ms=%.6f tflops=%.6f "
        "max_abs_error=%.9g\n",
        version.name.c_str(), args.m, args.n, args.k, args.m, args.n, args.k, kTile,
        args.warmup, args.repeat, args.seed, postcheck.correct ? "OK" : "FAIL",
        postcheck.correct ? "OK" : "FAIL",
        timing.minimum_ms, timing.median_ms, timing.mean_ms, tflops,
        postcheck.max_absolute_error);
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
        "ENV runtime=hip gpu=\"%s\" arch=%s m=%zu n=%zu k=%zu seed=%zu\n",
        properties.name, properties.gcnArchName,
        args.m, args.n, args.k, args.seed);

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
