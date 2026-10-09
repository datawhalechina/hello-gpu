
#include <torch/extension.h>
torch::Tensor launch(torch::Tensor a, torch::Tensor b, torch::Tensor out, int64_t block, int64_t grid_limit);
void validate(torch::Tensor a, torch::Tensor b, torch::Tensor out, int64_t block, int64_t grid_limit);
PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
    m.def("validate", &validate, "Check arguments without launching a kernel");
    m.def("launch", &launch, "Launch the notebook HIP kernel on PyTorch's current stream");
}
