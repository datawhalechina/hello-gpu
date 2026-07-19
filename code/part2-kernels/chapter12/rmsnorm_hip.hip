#include <hip/hip_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#include <vector>

#define HIP_CHECK(call)                                                        \
    do {                                                                       \
        hipError_t error = (call);                                             \
        if (error != hipSuccess) {                                             \
            std::cerr << "HIP error: " << hipGetErrorString(error) << '\n';   \
            std::exit(1);                                                      \
        }                                                                      \
    } while (0)

__global__ void rmsnorm_serial_kernel(const float* input, const float* weight,
                                      float* output, int rows, int cols,
                                      float epsilon) {
    int row = blockIdx.x * blockDim.x + threadIdx.x;
    if (row >= rows) return;
    float square_sum = 0.0f;
    for (int col = 0; col < cols; ++col) {
        float value = input[row * cols + col];
        square_sum += value * value;
    }
    float inverse_rms = rsqrtf(square_sum / cols + epsilon);
    for (int col = 0; col < cols; ++col) {
        output[row * cols + col] =
            input[row * cols + col] * inverse_rms * weight[col];
    }
}

__global__ void rmsnorm_block_kernel(const float* input, const float* weight,
                                     float* output, int rows, int cols,
                                     float epsilon) {
    extern __shared__ float shared[];
    int row = blockIdx.x;
    int tid = threadIdx.x;
    float square_sum = 0.0f;
    for (int col = tid; col < cols; col += blockDim.x) {
        float value = input[row * cols + col];
        square_sum += value * value;
    }
    shared[tid] = square_sum;
    __syncthreads();
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride) shared[tid] += shared[tid + stride];
        __syncthreads();
    }
    float inverse_rms = rsqrtf(shared[0] / cols + epsilon);
    for (int col = tid; col < cols; col += blockDim.x) {
        output[row * cols + col] =
            input[row * cols + col] * inverse_rms * weight[col];
    }
}

struct Options {
    std::string version = "all";
    int rows = 1024;
    int cols = 4096;
    int block = 256;
    int warmup = 5;
    int repeat = 20;
    int seed = 20260719;
    float epsilon = 1e-5f;
};

Options parse_options(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        std::string name = argv[i];
        if (i + 1 >= argc) {
            std::cerr << "missing value for " << name << '\n';
            std::exit(2);
        }
        std::string value = argv[++i];
        if (name == "--version") options.version = value;
        else if (name == "--rows") options.rows = std::stoi(value);
        else if (name == "--cols") options.cols = std::stoi(value);
        else if (name == "--block") options.block = std::stoi(value);
        else if (name == "--warmup") options.warmup = std::stoi(value);
        else if (name == "--repeat") options.repeat = std::stoi(value);
        else if (name == "--seed") options.seed = std::stoi(value);
        else if (name == "--epsilon") options.epsilon = std::stof(value);
        else {
            std::cerr << "unknown option: " << name << '\n';
            std::exit(2);
        }
    }
    bool valid_version = options.version == "all" ||
                         options.version == "serial" ||
                         options.version == "block";
    bool power_of_two = options.block > 0 &&
                        (options.block & (options.block - 1)) == 0;
    if (!valid_version || options.rows <= 0 || options.cols <= 0 ||
        !power_of_two || options.block > 1024 || options.warmup < 0 ||
        options.repeat <= 0 || options.epsilon <= 0.0f) {
        std::cerr << "invalid arguments\n";
        std::exit(2);
    }
    return options;
}

std::vector<float> reference_rmsnorm(const std::vector<float>& input,
                                     const std::vector<float>& weight,
                                     int rows, int cols, float epsilon) {
    std::vector<float> output(rows * cols);
    for (int row = 0; row < rows; ++row) {
        double square_sum = 0.0;
        for (int col = 0; col < cols; ++col) {
            double value = input[row * cols + col];
            square_sum += value * value;
        }
        float inverse_rms =
            1.0f / std::sqrt(static_cast<float>(square_sum / cols) + epsilon);
        for (int col = 0; col < cols; ++col) {
            output[row * cols + col] =
                input[row * cols + col] * inverse_rms * weight[col];
        }
    }
    return output;
}

int main(int argc, char** argv) {
    Options options = parse_options(argc, argv);
    int elements = options.rows * options.cols;
    size_t bytes = elements * sizeof(float);
    size_t weight_bytes = options.cols * sizeof(float);
    std::mt19937 generator(options.seed);
    std::uniform_real_distribution<float> distribution(-1.0f, 1.0f);
    std::vector<float> input(elements), weight(options.cols);
    for (float& item : input) item = distribution(generator);
    for (float& item : weight) item = distribution(generator);
    std::vector<float> reference = reference_rmsnorm(
        input, weight, options.rows, options.cols, options.epsilon);

    float *d_input, *d_weight, *d_output;
    HIP_CHECK(hipMalloc(&d_input, bytes));
    HIP_CHECK(hipMalloc(&d_weight, weight_bytes));
    HIP_CHECK(hipMalloc(&d_output, bytes));
    HIP_CHECK(hipMemcpy(d_input, input.data(), bytes, hipMemcpyHostToDevice));
    HIP_CHECK(hipMemcpy(d_weight, weight.data(), weight_bytes,
                        hipMemcpyHostToDevice));

    auto launch = [&](const std::string& version) {
        if (version == "serial") {
            int grid = (options.rows + options.block - 1) / options.block;
            hipLaunchKernelGGL(rmsnorm_serial_kernel, dim3(grid),
                               dim3(options.block), 0, 0, d_input, d_weight,
                               d_output, options.rows, options.cols,
                               options.epsilon);
        } else {
            hipLaunchKernelGGL(rmsnorm_block_kernel, dim3(options.rows),
                               dim3(options.block),
                               options.block * sizeof(float), 0, d_input,
                               d_weight, d_output, options.rows, options.cols,
                               options.epsilon);
        }
        HIP_CHECK(hipGetLastError());
    };

    for (const std::string version : {"serial", "block"}) {
        if (options.version != "all" && options.version != version) continue;
        for (int i = 0; i < options.warmup; ++i) launch(version);
        HIP_CHECK(hipDeviceSynchronize());
        hipEvent_t start, stop;
        HIP_CHECK(hipEventCreate(&start));
        HIP_CHECK(hipEventCreate(&stop));
        HIP_CHECK(hipEventRecord(start));
        for (int i = 0; i < options.repeat; ++i) launch(version);
        HIP_CHECK(hipEventRecord(stop));
        HIP_CHECK(hipEventSynchronize(stop));
        float total_ms = 0.0f;
        HIP_CHECK(hipEventElapsedTime(&total_ms, start, stop));
        std::vector<float> actual(elements);
        HIP_CHECK(hipMemcpy(actual.data(), d_output, bytes,
                            hipMemcpyDeviceToHost));
        float max_error = 0.0f;
        for (int i = 0; i < elements; ++i) {
            max_error = std::max(max_error, std::abs(actual[i] - reference[i]));
        }
        bool correct = max_error < 2e-5f;
        std::cout << "RESULT operator=rmsnorm implementation=hip-" << version
                  << " runtime=hip rows=" << options.rows
                  << " cols=" << options.cols << " block=" << options.block
                  << " correct=" << (correct ? "OK" : "FAIL")
                  << " mean_ms=" << total_ms / options.repeat
                  << " max_abs_error=" << max_error << '\n';
        HIP_CHECK(hipEventDestroy(start));
        HIP_CHECK(hipEventDestroy(stop));
        if (!correct) return 1;
    }

    HIP_CHECK(hipFree(d_input));
    HIP_CHECK(hipFree(d_weight));
    HIP_CHECK(hipFree(d_output));
    return 0;
}
