"""Teaching online-attention kernels for Chapter 11."""

from __future__ import annotations

import argparse
import math

import torch
import triton
import triton.language as tl


@triton.jit
def online_attention_kernel(
    q_ptr,
    k_ptr,
    v_ptr,
    output_ptr,
    scale,
    SEQ: tl.constexpr,
    DIM: tl.constexpr,
    BLOCK_K: tl.constexpr,
    BLOCK_D: tl.constexpr,
):
    row = tl.program_id(0)
    d = tl.arange(0, BLOCK_D)
    q = tl.load(q_ptr + row * DIM + d, mask=d < DIM, other=0.0)
    running_max = -float("inf")
    running_sum = 0.0
    accumulator = tl.zeros((BLOCK_D,), tl.float32)

    for key_start in range(0, SEQ, BLOCK_K):
        keys = key_start + tl.arange(0, BLOCK_K)
        key_mask = keys < SEQ
        k = tl.load(
            k_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM),
            other=0.0,
        )
        scores = tl.sum(k * q[None, :], axis=1) * scale
        scores = tl.where(key_mask, scores, -float("inf"))
        tile_max = tl.max(scores, axis=0)
        next_max = tl.maximum(running_max, tile_max)
        history_scale = tl.exp(running_max - next_max)
        probabilities = tl.exp(scores - next_max)
        v = tl.load(
            v_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM),
            other=0.0,
        )
        accumulator = accumulator * history_scale + tl.sum(
            probabilities[:, None] * v, axis=0
        )
        running_sum = running_sum * history_scale + tl.sum(probabilities, axis=0)
        running_max = next_max

    tl.store(
        output_ptr + row * DIM + d,
        accumulator / running_sum,
        mask=d < DIM,
    )


def launch(q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, block_k: int) -> torch.Tensor:
    seq, dim = q.shape
    block_d = triton.next_power_of_2(dim)
    output = torch.empty_like(q)
    online_attention_kernel[(seq,)](
        q,
        k,
        v,
        output,
        1.0 / math.sqrt(dim),
        SEQ=seq,
        DIM=dim,
        BLOCK_K=block_k,
        BLOCK_D=block_d,
        num_warps=4 if block_d <= 128 else 8,
    )
    return output


def time_launch(q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, block_k: int,
                warmup: int, repeat: int) -> tuple[torch.Tensor, float]:
    for _ in range(warmup):
        output = launch(q, k, v, block_k)
    torch.cuda.synchronize()
    start = torch.cuda.Event(enable_timing=True)
    stop = torch.cuda.Event(enable_timing=True)
    start.record()
    for _ in range(repeat):
        output = launch(q, k, v, block_k)
    stop.record()
    stop.synchronize()
    return output, start.elapsed_time(stop) / repeat


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--seq", type=int, default=128)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()
    if args.seq <= 0 or args.dim <= 0 or args.dim > 256 or args.repeat <= 0:
        raise SystemExit("seq and dim must be positive, dim <= 256, repeat > 0")

    torch.manual_seed(args.seed)
    q = torch.randn((args.seq, args.dim), device="cuda", dtype=torch.float32) * 0.5
    k = torch.randn_like(q) * 0.5
    v = torch.randn_like(q) * 0.5
    reference = torch.softmax(q @ k.T / math.sqrt(args.dim), dim=1) @ v
    configurations = {"t0": 16, "t1": 32}
    for version, block_k in configurations.items():
        if args.version not in ("all", version):
            continue
        output, mean_ms = time_launch(
            q, k, v, block_k, args.warmup, args.repeat
        )
        max_error = (output - reference).abs().max().item()
        correct = max_error < 2e-4
        print(
            "RESULT operator=attention "
            f"implementation=triton-{version} runtime=triton seq={args.seq} "
            f"dim={args.dim} block_k={block_k} correct={'OK' if correct else 'FAIL'} "
            f"mean_ms={mean_ms:.6f} max_abs_error={max_error:.8g}"
        )
        if not correct:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
