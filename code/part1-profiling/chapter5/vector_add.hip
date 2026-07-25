// code/part1-profiling/chapter5/vector_add.hip
// 第 5 章 profiling 主线程序：合并访存 vs 地址分散组合对照
//
// 用法：
//   hipcc --offload-arch=gfx1201 -O3 -std=c++17 vector_add.hip -o vector_add_bench
//   ./vector_add_bench --kernel coalesced --size 16777216 --block 256 \
//       --warmup 20 --repeat 100 --output-json logs/coalesced_size16777216.json
//   ./vector_add_bench --kernel linecross --size 16777216 --block 256 --stride 32 \
//       --warmup 20 --repeat 100 --output-json logs/linecross_stride32_size16777216.json
//
// 硬件上下文：Radeon RX 9070 XT（gfx1201）+ ROCm 7.13（原生 Ubuntu 24.04）

#include <hip/hip_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <numeric>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>

// ----------------- kernels -----------------

// 合并访存版：相邻线程访问相邻下标（连续地址）
__global__ void kernel_coalesced(const float* __restrict__ a,
                                 const float* __restrict__ b,
                                 float*       __restrict__ c,
                                 int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        c[idx] = a[idx] + b[idx];
    }
}

// wave 内地址置换对照：
//   - 每个 wave 仍读取同一个连续的 32 元素集合，只改变 lane 与元素的对应顺序；
//   - coalescer 关注整个 wave 的地址集合，因此这不是“非合并访存”反例；
//   - stride 必须与 32 互质，才能形成不重复的置换；尾 wave 不完整时不运行此版本。
// 该 kernel 仅保留为地址集合与 lane 顺序的对照，正文实验使用 coalesced/linecross。
__global__ void kernel_strided(const float* __restrict__ a,
                               const float* __restrict__ b,
                               float*       __restrict__ c,
                               int n,
                               int stride) {
    const int W = 32;                                   // wavefront 宽度（RDNA4）
    int waves_in_block = blockDim.x / W;                // 一个 block 含几个 wave
    int wave_in_block  = threadIdx.x / W;               // 本线程属于 block 内第几个 wave
    int lane           = threadIdx.x & (W - 1);         // 本线程在 wave 内的 lane
    int wave_id        = blockIdx.x * waves_in_block + wave_in_block;  // 全局 wave 编号
    int base           = wave_id * W;                   // 本 wave 输出区间起点（连续覆盖 0..n）
    int local_idx      = (lane * (stride & (W - 1))) & (W - 1);
    int a_idx          = base + local_idx;              // 读：跨步映射
    int c_idx          = base + lane;                   // 写：连续（合并写）
    if (c_idx < n && a_idx < n) {
        c[c_idx] = a[a_idx] + b[a_idx];
    }
}

// linecross：制造 wave 内分散地址的教学反例。
//   每个 wavefront 负责【连续】的 W*stride 个输出位置 [tile_base, tile_base+W*stride)，
//   把它们切成 W 段，每段 stride 个连续元素，交给一个 lane：
//     lane k 处理 [tile_base + k*stride, tile_base + (k+1)*stride) 这 stride 个元素。
//   这样相邻 lane 的起始地址相距 stride*4 字节；stride 越大，同一轮的
//   地址集合通常越分散。精确事务数和 cacheline 边界取决于目标架构。
//   每个元素仍按 c[i]=a[i]+b[i] 计算，但 stride 还会同时改变每线程循环次数和 grid。
//   因此它适合观察组合趋势，不是只改变访存合并度的严格单变量对照。
__global__ void kernel_linecross(const float* __restrict__ a,
                                 const float* __restrict__ b,
                                 float*       __restrict__ c,
                                 int n,
                                 int stride) {
    const int W = 32;
    int waves_in_block = blockDim.x / W;
    int wave_in_block  = threadIdx.x / W;
    int lane           = threadIdx.x & (W - 1);
    int wave_id        = blockIdx.x * waves_in_block + wave_in_block;
    int tile_base      = wave_id * W * stride;          // 本 wave 的连续 tile 起点
    int my_start       = tile_base + lane * stride;     // 本 lane 负责的连续 stride 个元素起点
    #pragma unroll
    for (int j = 0; j < stride; ++j) {
        int idx = my_start + j;
        if (idx < n) {
            c[idx] = a[idx] + b[idx];
        }
    }
}

#define HIP_CHECK(call) do { \
    hipError_t _e = (call); \
    if (_e != hipSuccess) { \
        fprintf(stderr, "HIP error %s at %s:%d: %s\n", \
                hipGetErrorString(_e), __FILE__, __LINE__, #call); \
        exit(1); \
    } \
} while (0)

struct Args {
    std::string kernel = "coalesced";
    int size     = 16 * 1024 * 1024;   // 16M elements
    int block    = 256;
    int stride   = 32;
    int warmup   = 20;
    int repeat   = 100;
    std::string output_json;           // 可选：把结果写成 JSON
};

static Args parse_args(int argc, char** argv) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        std::string s = argv[i];
        auto next = [&](const std::string& key) -> std::string {
            if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", key.c_str()); exit(1); }
            return argv[++i];
        };
        if      (s == "--kernel")     a.kernel = next(s);
        else if (s == "--size")       a.size   = std::atoi(next(s).c_str());
        else if (s == "--block")      a.block  = std::atoi(next(s).c_str());
        else if (s == "--stride")     a.stride = std::atoi(next(s).c_str());
        else if (s == "--warmup")     a.warmup = std::atoi(next(s).c_str());
        else if (s == "--repeat")     a.repeat = std::atoi(next(s).c_str());
        else if (s == "--output-json") a.output_json = next(s);
        else { fprintf(stderr, "unknown arg: %s\n", s.c_str()); exit(1); }
    }
    const bool valid_kernel = a.kernel == "coalesced" ||
                              a.kernel == "strided" ||
                              a.kernel == "linecross";
    if (!valid_kernel) {
        fprintf(stderr, "--kernel must be coalesced, strided, or linecross\n");
        exit(2);
    }
    if (a.size <= 0 || a.block < 32 || a.block > 1024 ||
        a.block % 32 != 0 || a.warmup < 0 || a.repeat <= 0) {
        fprintf(stderr,
                "--size/--repeat must be positive, --warmup non-negative, "
                "and --block a multiple of 32 in [32, 1024]\n");
        exit(2);
    }
    if ((a.kernel == "strided" || a.kernel == "linecross") &&
        a.stride <= 0) {
        fprintf(stderr, "--stride must be positive for this kernel\n");
        exit(2);
    }
    if (a.kernel == "linecross" && a.stride > a.size) {
        fprintf(stderr, "linecross requires --stride <= --size\n");
        exit(2);
    }
    if (a.kernel == "strided" &&
        (std::gcd(a.stride, 32) != 1 || a.size % 32 != 0)) {
        fprintf(stderr,
                "strided requires stride coprime with 32 and size divisible by 32\n");
        exit(2);
    }
    return a;
}

int main(int argc, char** argv) {
    Args args = parse_args(argc, argv);
    const int n = args.size;
    const size_t bytes = (size_t)n * sizeof(float);

    // 打印环境
    int dev = 0;
    hipDeviceProp_t prop;
    HIP_CHECK(hipGetDeviceProperties(&prop, dev));
    if (args.block > prop.maxThreadsPerBlock) {
        fprintf(stderr, "--block exceeds the device maxThreadsPerBlock\n");
        return 2;
    }
    printf("GPU: %s (gfx arch: %s)\n", prop.name, prop.gcnArchName);
    printf("kernel=%s size=%d block=%d stride=%d warmup=%d repeat=%d\n",
           args.kernel.c_str(), n, args.block, args.stride, args.warmup, args.repeat);

    // 分配 + 初始化
    float *d_a, *d_b, *d_c;
    HIP_CHECK(hipMalloc(&d_a, bytes));
    HIP_CHECK(hipMalloc(&d_b, bytes));
    HIP_CHECK(hipMalloc(&d_c, bytes));

    std::vector<float> ha(n), hb(n), hc(n);
    for (int i = 0; i < n; ++i) { ha[i] = 0.1f * i; hb[i] = 0.2f * i; }
    HIP_CHECK(hipMemcpy(d_a, ha.data(), bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_b, hb.data(), bytes, hipMemcpyHostToDevice));

    // grid 计算：
    //   coalesced / strided（wave 内地址置换）：每个线程一个输出位置 → grid = n/block
    //   linecross（wave 内地址分散）：每个 wave 覆盖 W*stride 个位置
    size_t grid_size;
    if (args.kernel == "linecross") {
        const size_t waves_per_block = static_cast<size_t>(args.block) / 32;
        const size_t per_block =
            waves_per_block * 32 * static_cast<size_t>(args.stride);
        grid_size = (static_cast<size_t>(n) + per_block - 1) / per_block;
    } else {
        grid_size =
            (static_cast<size_t>(n) + args.block - 1) / args.block;
    }
    if (grid_size == 0 ||
        grid_size > static_cast<size_t>(prop.maxGridSize[0])) {
        fprintf(stderr, "calculated grid exceeds the device limit\n");
        return 2;
    }
    const unsigned int grid = static_cast<unsigned int>(grid_size);

    auto launch = [&](hipEvent_t, hipEvent_t) {
        if (args.kernel == "coalesced")
            hipLaunchKernelGGL(kernel_coalesced, grid, args.block, 0, 0, d_a, d_b, d_c, n);
        else if (args.kernel == "strided")
            hipLaunchKernelGGL(kernel_strided, grid, args.block, 0, 0, d_a, d_b, d_c, n, args.stride);
        else if (args.kernel == "linecross")
            hipLaunchKernelGGL(kernel_linecross, grid, args.block, 0, 0, d_a, d_b, d_c, n, args.stride);
        else { fprintf(stderr, "unknown kernel: %s\n", args.kernel.c_str()); exit(1); }
    };

    // warmup
    for (int i = 0; i < args.warmup; ++i) launch((hipEvent_t)0, (hipEvent_t)0);
    HIP_CHECK(hipDeviceSynchronize());

    // 计时：每次 launch 使用一对 event，再汇总 min / median / avg。
    std::vector<hipEvent_t> starts(args.repeat), ends(args.repeat);
    for (int i = 0; i < args.repeat; ++i) {
        HIP_CHECK(hipEventCreate(&starts[i]));
        HIP_CHECK(hipEventCreate(&ends[i]));
    }
    for (int i = 0; i < args.repeat; ++i) {
        HIP_CHECK(hipEventRecord(starts[i]));
        launch(starts[i], ends[i]);
        HIP_CHECK(hipGetLastError());
        HIP_CHECK(hipEventRecord(ends[i]));
    }
    HIP_CHECK(hipDeviceSynchronize());

    std::vector<float> times(args.repeat);
    for (int i = 0; i < args.repeat; ++i) {
        HIP_CHECK(hipEventElapsedTime(&times[i], starts[i], ends[i]));
    }
    std::sort(times.begin(), times.end());
    float min_ms    = times.front();
    float median_ms = times[times.size() / 2];
    float avg_ms    = 0; for (float t : times) avg_ms += t; avg_ms /= times.size();

    // 有效带宽：vector add = 读 a + 读 b + 写 c = 3n floats（三版都处理 n 个元素）
    double eff_bw_gbs = (3.0 * bytes) / (min_ms * 1e-3) / 1e9;

    // 正确性校验在计时区间外执行，覆盖完整输出。
    HIP_CHECK(hipMemcpy(hc.data(), d_c, bytes, hipMemcpyDeviceToHost));
    int errors = 0;
    for (int i = 0; i < n; ++i) {
        // 三版都写了所有 c[0..n)，但 a 的读取下标随 kernel/stride 不同：
        //   coalesced : a_idx = i
        //   strided   : a_idx = (i & ~31) + ((i & 31) * stride & 31)
        //               （wave 内置换同一连续 32 元素集合）
        //   linecross : a_idx = i                                          （读写都跨步，下标恒等 i，只是 wave 内 lane 顺序跨步）
        int a_idx;
        if (args.kernel == "strided") {
            int lane = i & 31;
            int base = i & ~31;
            a_idx = base + ((lane * (args.stride & 31)) & 31);
        } else {
            a_idx = i;   // coalesced 与 linecross 都满足 c[i]=a[i]+b[i]
        }
        float expected = ha[a_idx] + hb[a_idx];
        if (!std::isfinite(hc[i]) || !std::isfinite(expected) ||
            std::fabs(hc[i] - expected) > 1e-3f) {
            if (errors < 5) printf("MISMATCH %s idx=%d got=%.4f exp=%.4f (a_idx=%d)\n",
                                   args.kernel.c_str(), i, hc[i], expected, a_idx);
            errors++;
        }
    }

    // 输出
    printf("grid=%u block=%d\n", grid, args.block);
    printf("min_ms=%.4f  median_ms=%.4f  avg_ms=%.4f\n", min_ms, median_ms, avg_ms);
    printf("eff_bandwidth=%.2f GB/s  (3*n*4 / min_ms, n=%d)\n", eff_bw_gbs, n);
    printf("correctness=%s (errors=%d in all %d elems)\n",
           errors == 0 ? "OK" : "FAIL", errors, n);

    if (!args.output_json.empty()) {
        FILE* f = fopen(args.output_json.c_str(), "w");
        if (f) {
            fprintf(f, "{\n");
            fprintf(f, "  \"gpu\": \"%s\", \"arch\": \"%s\",\n", prop.name, prop.gcnArchName);
            fprintf(f, "  \"kernel\": \"%s\", \"size\": %d, \"block\": %d, \"stride\": %d,\n",
                    args.kernel.c_str(), n, args.block, args.stride);
            fprintf(f, "  \"warmup\": %d, \"repeat\": %d,\n", args.warmup, args.repeat);
            fprintf(f, "  \"min_ms\": %.6f, \"median_ms\": %.6f, \"avg_ms\": %.6f,\n",
                    min_ms, median_ms, avg_ms);
            fprintf(f, "  \"eff_bandwidth_gbs\": %.4f,\n", eff_bw_gbs);
            fprintf(f, "  \"correctness\": \"%s\"\n", errors == 0 ? "OK" : "FAIL");
            fprintf(f, "}\n");
            fclose(f);
            printf("json written to %s\n", args.output_json.c_str());
        }
    }

    for (int i = 0; i < args.repeat; ++i) {
        HIP_CHECK(hipEventDestroy(starts[i]));
        HIP_CHECK(hipEventDestroy(ends[i]));
    }
    HIP_CHECK(hipFree(d_a));
    HIP_CHECK(hipFree(d_b));
    HIP_CHECK(hipFree(d_c));
    return errors == 0 ? 0 : 1;
}
