#!/usr/bin/env bash
# -*- coding: utf-8 -*-
#
# ROCm / TheRock uv Project + Virtual Environment Installer
#
# 功能：
#   - 自动检测系统环境
#   - 自动检测 AMD GPU 和 GPU 架构
#   - 自动安装 / 检测 uv
#   - 自动安装 / 检测 fzf
#   - TUI 选择 GPU 架构
#   - 使用教程验证过的 ROCm 10.0.0 / PyTorch 版本组合
#   - TUI 选择安装模式
#   - TUI 选择 uv 项目目录 / 虚拟环境目录
#   - 使用 uv init 初始化项目
#   - 使用 uv venv 创建 .venv
#   - 从 AMD ROCm wheel 源安装 ROCm Python 包
#
# 注意：
#   这个脚本只负责 Python 虚拟环境和 ROCm wheel 包。
#   不负责安装 amdgpu-dkms / 内核驱动。
#
# 用法：
#   ./rocm-uv-env.sh
#   ./rocm-uv-env.sh --arch gfx1201
#   ./rocm-uv-env.sh --version 10.0.0 --arch gfx1201
#   ./rocm-uv-env.sh --project-dir ~/rocm-uv-projects/rocm-10.0-gfx1201
#   ./rocm-uv-env.sh --venv ~/rocm-venvs/rocm-10.0-gfx1201
#

set -euo pipefail

#######################################
# Basic Config
#######################################

SCRIPT_VERSION="2.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ROCM_WHL_BASE="https://stable.repo.amd.com/rocm/whl-next"

GPU_ARCH=""
ROCM_VERSION="10.0.0"
PYTHON_BIN="python3.12"

PROJECT_DIR=""
VENV_PATH=""
VENV_DIR_NAME=".venv"

NON_INTERACTIVE=false
FORCE_RECREATE=false
INSTALL_FZF=true
USE_UV_INIT=true

INSTALL_MODE="full"
# full: PyTorch + ROCm runtime + devel（教程默认，支持 HIP 编译）
# minimal: PyTorch + ROCm runtime（不含 HIP 开发工具）

# 区域 / PyPI 镜像
REGION=""           # cn | global；空表示走交互或自动判断
PYPI_MIRROR=""      # 显式指定时绕过镜像菜单

#######################################
# Colors
#######################################

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
MAGENTA=$'\033[0;35m'
BOLD=$'\033[1m'
NC=$'\033[0m'

#######################################
# Utils
#######################################

log() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
    exit 1
}

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

setup_user_path() {
    export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:/usr/local/bin:${PATH}"

    if [[ -n "${SUDO_USER:-}" ]] && [[ "$SUDO_USER" != "root" ]]; then
        local sudo_home
        sudo_home="$(eval echo "~${SUDO_USER}" 2>/dev/null || true)"
        if [[ -n "$sudo_home" && -d "$sudo_home" ]]; then
            export PATH="${sudo_home}/.local/bin:${sudo_home}/.cargo/bin:${PATH}"
        fi
    fi
}

http_get() {
    local url="$1"

    if has_cmd curl; then
        curl -fsSL --connect-timeout 15 "$url" 2>/dev/null || true
    elif has_cmd wget; then
        wget -qO- --timeout=15 "$url" 2>/dev/null || true
    else
        true
    fi
}

http_status() {
    local url="$1"

    if has_cmd curl; then
        curl -Ls -o /dev/null -w "%{http_code}" --connect-timeout 8 "$url" 2>/dev/null || echo "000"
    elif has_cmd wget; then
        wget -q --spider --timeout=8 "$url" 2>/dev/null && echo "200" || echo "000"
    else
        echo "000"
    fi
}

draw_box() {
    local text="$1"
    local width=$(( ${#text} + 4 ))
    local border
    border=$(printf '═%.0s' $(seq 1 "$width"))

    echo -e "${BLUE}╔${border}╗${NC}"
    echo -e "${BLUE}║${NC}  ${BOLD}${text}${NC}  ${BLUE}║${NC}"
    echo -e "${BLUE}╚${border}╝${NC}"
}

print_header() {
    [[ ! -t 1 ]] || clear || true
    echo ""
    echo -e "${CYAN}  ██████╗  ██████╗  ██████╗███╗   ███╗     ██╗   ██╗██╗   ██╗${NC}"
    echo -e "${CYAN}  ██╔══██╗██╔═══██╗██╔════╝████╗ ████║     ██║   ██║██║   ██║${NC}"
    echo -e "${CYAN}  ██████╔╝██║   ██║██║     ██╔████╔██║     ██║   ██║██║   ██║${NC}"
    echo -e "${CYAN}  ██╔══██╗██║   ██║██║     ██║╚██╔╝██║     ██║   ██║╚██╗ ██╔╝${NC}"
    echo -e "${CYAN}  ██║  ██║╚██████╔╝╚██████╗██║ ╚═╝ ██║     ╚██████╔╝ ╚████╔╝ ${NC}"
    echo -e "${CYAN}  ╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝     ╚═╝      ╚═════╝   ╚═══╝  ${NC}"
    echo ""
    echo -e "  ${BOLD}ROCm / TheRock uv Project Installer v${SCRIPT_VERSION}${NC}"
    echo -e "  ${MAGENTA}Create ROCm Python environments with uv init + uv venv${NC}"
    echo ""
    echo -e "  ─────────────────────────────────────────────────────────────"
    echo ""
}

confirm() {
    local prompt="$1"
    local default="${2:-N}"

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        return 0
    fi

    local answer
    read -r -p "$prompt" answer

    if [[ -z "$answer" ]]; then
        answer="$default"
    fi

    [[ "$answer" =~ ^[Yy]$ ]]
}

expand_path() {
    local path="$1"

    if [[ "$path" == "~" ]]; then
        echo "$HOME"
    elif [[ "$path" == "~/"* ]]; then
        echo "${HOME}/${path#~/}"
    else
        echo "$path"
    fi
}

sanitize_name() {
    echo "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | tr '.' '-' \
        | tr '_' '-' \
        | tr '/' '-' \
        | tr ':' '-' \
        | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//'
}

#######################################
# Help / Arguments
#######################################

show_help() {
    cat <<EOF
ROCm / TheRock uv Project Installer v${SCRIPT_VERSION}

Usage:
  $0 [options]

Options:
  --version VERSION        Tutorial version: 10.0.0 (default)
  --arch ARCH             LLVM target, e.g. gfx1201, gfx942, gfx1151
  --gpu-arch ARCH         Same as --arch
  --python PYTHON         Python 3.12 binary, default: python3.12

  --project-dir PATH      uv project directory, venv will be PATH/.venv
  --venv PATH             Explicit virtual environment path

  --minimal               Install PyTorch + ROCm runtime (no HIP development tools)
  --full                  Install full package set, default
  --region cn|global      Region; affects PyPI mirror selection
  --pypi-mirror URL       Use this PyPI mirror as default index (overrides menu)
  --force                 Recreate venv if exists
  --non-interactive       Do not show menus (uses --region default = global)
  --no-fzf                Do not auto-install/use fzf
  --no-uv-init            Only create venv, do not run uv init
  --help, -h              Show help

Examples:
  $0
  $0 --arch gfx1201
  $0 --version 10.0.0 --arch gfx1201
  $0 --project-dir ~/rocm-uv-projects/rocm-10.0.0-gfx1201
  $0 --venv ~/rocm-venvs/rocm-10.0.0-gfx1201
  $0 --minimal --arch gfx1151

  # Non-interactive 全自动（推荐 CI / 脚本调用）
  $0 --non-interactive --version 10.0.0 --arch gfx1201 \\
     --region cn --pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple \\
     --project-dir /path/to/repo

GPU Architecture:
  gfx1201    RX 9070 XT / RX 9070
  gfx942    MI325X, MI300X, MI300A
  gfx950    MI355X, MI350X
  gfx1151         Ryzen AI Max / Strix Halo

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --version)
                ROCM_VERSION="${2:-}"
                shift 2
                ;;
            --arch|--gpu-arch)
                GPU_ARCH="${2:-}"
                shift 2
                ;;
            --python)
                PYTHON_BIN="${2:-}"
                shift 2
                ;;
            --project-dir)
                PROJECT_DIR="${2:-}"
                shift 2
                ;;
            --venv)
                VENV_PATH="${2:-}"
                shift 2
                ;;
            --minimal)
                INSTALL_MODE="minimal"
                shift
                ;;
            --full)
                INSTALL_MODE="full"
                shift
                ;;
            --region)
                REGION="${2:-}"
                shift 2
                ;;
            --pypi-mirror)
                PYPI_MIRROR="${2:-}"
                shift 2
                ;;
            --force)
                FORCE_RECREATE=true
                shift
                ;;
            --non-interactive)
                NON_INTERACTIVE=true
                shift
                ;;
            --no-fzf)
                INSTALL_FZF=false
                shift
                ;;
            --no-uv-init)
                USE_UV_INIT=false
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done
}

#######################################
# System Detection
#######################################

detect_os() {
    OS_ID="unknown"
    OS_VERSION="unknown"
    OS_NAME="unknown"

    if [[ -f /etc/os-release ]]; then
        # shellcheck source=/dev/null
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_VERSION="${VERSION_ID:-unknown}"
        OS_NAME="${PRETTY_NAME:-unknown}"
    fi

    ARCH="$(uname -m)"

    echo -e "  ${GREEN}✓${NC} OS:           ${OS_NAME}"
    echo -e "  ${GREEN}✓${NC} Kernel:       $(uname -r)"
    echo -e "  ${GREEN}✓${NC} Architecture: ${ARCH}"

    if [[ "$ARCH" != "x86_64" ]]; then
        warn "ROCm wheel 环境通常面向 x86_64；当前架构是 ${ARCH}"
    fi
}

detect_pkg_manager() {
    PKG_MGR=""

    if has_cmd apt-get; then
        PKG_MGR="apt"
    elif has_cmd dnf; then
        PKG_MGR="dnf"
    elif has_cmd yum; then
        PKG_MGR="yum"
    else
        PKG_MGR="unknown"
    fi

    echo -e "  ${GREEN}✓${NC} Package Mgr:  ${PKG_MGR}"
}

install_basic_tools() {
    local need_packages=()

    has_cmd curl || need_packages+=("curl")
    has_cmd wget || need_packages+=("wget")
    has_cmd lspci || need_packages+=("pciutils")

    if [[ ${#need_packages[@]} -eq 0 ]]; then
        return 0
    fi

    warn "Missing tools: ${need_packages[*]}"

    if [[ "$EUID" -ne 0 ]]; then
        if ! has_cmd sudo; then
            warn "没有 sudo，无法自动安装依赖：${need_packages[*]}"
            return 0
        fi
    fi

    case "$PKG_MGR" in
        apt)
            sudo apt-get update
            sudo apt-get install -y "${need_packages[@]}" || true
            ;;
        dnf|yum)
            sudo "$PKG_MGR" install -y "${need_packages[@]}" || true
            ;;
        *)
            warn "未知包管理器，请手动安装：${need_packages[*]}"
            ;;
    esac
}

install_apt_packages_best_effort() {
    if [[ "$PKG_MGR" != "apt" ]]; then
        return 0
    fi

    if [[ "$EUID" -ne 0 ]] && ! has_cmd sudo; then
        warn "没有 sudo，无法自动安装系统依赖：$*"
        return 0
    fi

    local sudo_cmd=()
    if [[ "$EUID" -ne 0 ]]; then
        sudo_cmd=(sudo)
    fi

    "${sudo_cmd[@]}" apt-get update || true
    local pkg
    for pkg in "$@"; do
        "${sudo_cmd[@]}" apt-get install -y "$pkg" || warn "自动安装 ${pkg} 失败，请手动安装"
    done
}

python_dev_header_path() {
    "$PYTHON_BIN" - <<'PY'
import sysconfig

include = sysconfig.get_path("include")
print(f"{include}/Python.h" if include else "")
PY
}

python_minor_version() {
    "$PYTHON_BIN" - <<'PY'
import sys

print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
}

check_system_build_deps() {
    echo ""
    draw_box "Checking system build deps"
    echo ""

    local missing=()

    if has_cmd g++; then
        echo -e "  ${GREEN}✓${NC} g++ found: $(command -v g++)"
    else
        warn "g++ not found; HIP/Triton native builds need a C++ compiler"
        missing+=("build-essential")
    fi

    if compgen -G "/usr/include/c++/*/cstdlib" >/dev/null; then
        echo -e "  ${GREEN}✓${NC} C++ standard headers found"
    else
        warn "C++ standard headers not found under /usr/include/c++"
        missing+=("build-essential" "libstdc++-14-dev")
    fi

    local py_header
    py_header="$(python_dev_header_path || true)"
    if [[ -n "$py_header" && -f "$py_header" ]]; then
        echo -e "  ${GREEN}✓${NC} Python.h found: ${py_header}"
    else
        local py_minor
        py_minor="$(python_minor_version || echo "3")"
        warn "Python.h not found for ${PYTHON_BIN}; Triton JIT will fail without Python dev headers"
        missing+=("python3-dev" "python${py_minor}-dev")
    fi

    if [[ ${#missing[@]} -eq 0 ]]; then
        return 0
    fi

    # Deduplicate while preserving order.
    local deduped=()
    local pkg seen
    for pkg in "${missing[@]}"; do
        seen=false
        for existing in "${deduped[@]}"; do
            [[ "$existing" == "$pkg" ]] && seen=true && break
        done
        [[ "$seen" == "false" ]] && deduped+=("$pkg")
    done

    warn "Missing system build deps: ${deduped[*]}"
    if [[ "$PKG_MGR" == "apt" ]]; then
        warn "尝试自动安装；如果 sudo 需要密码，请在实验机手动执行同一条命令"
        install_apt_packages_best_effort "${deduped[@]}"
    else
        warn "未知包管理器，请手动安装等价依赖。Ubuntu 24.04 示例："
        echo -e "    ${CYAN}sudo apt update && sudo apt install -y build-essential libstdc++-14-dev python3-dev${NC}"
    fi

    # Re-check Python.h because this is the common Triton JIT blocker.
    py_header="$(python_dev_header_path || true)"
    if [[ -z "$py_header" || ! -f "$py_header" ]]; then
        local py_minor
        py_minor="$(python_minor_version || echo "3")"
        warn "Python.h 仍未找到。请在实验机执行："
        echo -e "    ${CYAN}sudo apt update && sudo apt install -y python3-dev python${py_minor}-dev${NC}"
    else
        echo -e "  ${GREEN}✓${NC} Python.h found after install: ${py_header}"
    fi
}

detect_gpu() {
    echo ""
    draw_box "Detecting AMD GPU"
    echo ""

    GPU_LIST=""

    if has_cmd lspci; then
        GPU_LIST="$(lspci -nn | grep -iE 'VGA|Display|3D' | grep -iE 'AMD|ATI|Advanced Micro Devices' || true)"
    fi

    if [[ -z "$GPU_LIST" ]]; then
        warn "未检测到 AMD GPU"
        if has_cmd lspci; then
            echo ""
            echo "Detected display devices:"
            lspci -nn | grep -iE 'VGA|Display|3D' || true
            echo ""
        fi
    else
        while IFS= read -r line; do
            echo -e "  ${GREEN}✓${NC} ${line}"
        done <<< "$GPU_LIST"
    fi
}

detect_gpu_architecture() {
    local arch
    if has_cmd rocminfo; then
        while IFS= read -r arch; do
            if validate_gpu_arch "$arch"; then
                echo "$arch"
                return
            fi
        done < <(rocminfo 2>/dev/null | sed -nE 's/^[[:space:]]*Name:[[:space:]]*(gfx[0-9a-f]+)[[:space:]]*$/\1/p')
    fi
    # 不按 "Ryzen AI" 等产品系列猜架构：同一系列可能对应不同的 gfx 编号。
}

validate_gpu_arch() {
    case "$1" in
        gfx950|gfx942|gfx90a|gfx908|gfx1201|gfx1200|gfx1100|gfx1101|gfx1102|gfx1030|gfx1151|gfx1150|gfx1152|gfx1153|gfx1103) return 0 ;;
        *) return 1 ;;
    esac
}

#######################################
# uv / fzf Installation
#######################################

ensure_uv() {
    echo ""
    draw_box "Checking uv"
    echo ""

    setup_user_path

    if has_cmd uv; then
        echo -e "  ${GREEN}✓${NC} uv found: $(uv --version)"
        echo -e "  ${GREEN}✓${NC} uv path:  $(command -v uv)"
        return 0
    fi

    log "uv not found, installing uv..."

    if ! has_cmd curl; then
        error "curl not found. Please install curl first."
    fi

    curl -LsSf https://astral.sh/uv/install.sh | sh

    setup_user_path

    if ! has_cmd uv; then
        error "uv installed but not found in PATH. Try: export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi

    echo -e "  ${GREEN}✓${NC} uv installed: $(uv --version)"
    echo -e "  ${GREEN}✓${NC} uv path:      $(command -v uv)"
}

ensure_fzf() {
    if [[ "$INSTALL_FZF" != "true" ]]; then
        return 0
    fi

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        return 0
    fi

    if has_cmd fzf; then
        return 0
    fi

    echo ""
    draw_box "Checking fzf"
    echo ""

    log "fzf not found, trying to install fzf..."

    case "$PKG_MGR" in
        apt)
            sudo apt-get update
            sudo apt-get install -y fzf || true
            ;;
        dnf|yum)
            sudo "$PKG_MGR" install -y fzf || true
            ;;
        *)
            warn "未知包管理器，跳过 fzf 自动安装"
            ;;
    esac

    if has_cmd fzf; then
        echo -e "  ${GREEN}✓${NC} fzf installed"
    else
        warn "fzf 不可用，将使用普通 select 菜单"
    fi
}

#######################################
# ROCm Wheel Index
#######################################

arch_index_url() {
    echo "${ROCM_WHL_BASE}/"
}

check_arch_index() {
    [[ "$(http_status "${ROCM_WHL_BASE}/rocm/")" == "200" ]]
}

select_gpu_arch() {
    if [[ -n "$GPU_ARCH" ]]; then
        if validate_gpu_arch "$GPU_ARCH"; then
            return 0
        else
            error "Invalid GPU arch: ${GPU_ARCH}"
        fi
    fi

    local detected_arch
    detected_arch="$(detect_gpu_architecture || true)"

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        if [[ -n "$detected_arch" ]]; then
            GPU_ARCH="$detected_arch"
            log "Auto-detected GPU arch: ${GPU_ARCH}"
            return 0
        fi

        error "Non-interactive mode requires --arch. Example: --arch gfx1201"
    fi

    echo ""
    draw_box "Select GPU Architecture"
    echo ""

    local options=()

    if [[ -n "$detected_arch" ]]; then
        options+=("${detected_arch}    Auto-detected")
    fi

    local arch
    for arch in gfx1201 gfx1200 gfx1151 gfx1150 gfx1152 gfx1153 gfx1100 gfx1101 gfx1102 gfx1103 gfx1030 gfx950 gfx942 gfx90a gfx908; do
        [[ "$arch" == "$detected_arch" ]] || options+=("${arch}    device-${arch}")
    done

    if has_cmd fzf; then
        local selection
        selection="$(printf '%s\n' "${options[@]}" | fzf \
            --layout=reverse \
            --border=rounded \
            --prompt="GPU Arch ❯ " \
            --header="Select target ROCm wheel architecture")"

        [[ -z "$selection" ]] && error "No GPU architecture selected"

        GPU_ARCH="$(echo "$selection" | awk '{print $1}')"
    else
        PS3=$'\n\033[0;36mYour choice: \033[0m'
        select opt in "${options[@]}"; do
            if [[ -n "$opt" ]]; then
                GPU_ARCH="$(echo "$opt" | awk '{print $1}')"
                break
            else
                echo "Invalid selection"
            fi
        done
    fi

    if ! validate_gpu_arch "$GPU_ARCH"; then
        error "Invalid GPU arch selected: ${GPU_ARCH}"
    fi

    log "Selected GPU arch: ${GPU_ARCH}"
}

select_rocm_version() {
    [[ "$ROCM_VERSION" == "10.0.0" ]] || error "本教程固定 ROCm 10.0.0；其他版本需要单独验证 PyTorch / torchvision 组合"
    log "ROCm version: ${ROCM_VERSION}"
}

select_install_mode() {
    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        return 0
    fi

    echo ""
    draw_box "Select Install Mode"
    echo ""

    local options=(
        "full       PyTorch + ROCm runtime + devel    Recommended"
        "minimal    PyTorch + ROCm runtime           No HIP compiler"
    )

    if has_cmd fzf; then
        local selection
        selection="$(printf '%s\n' "${options[@]}" | fzf \
            --layout=reverse \
            --border=rounded \
            --prompt="Install Mode ❯ " \
            --header="Choose ROCm package set")"

        if [[ -n "$selection" ]]; then
            INSTALL_MODE="$(echo "$selection" | awk '{print $1}')"
        fi
    else
        PS3=$'\n\033[0;36mYour choice: \033[0m'
        select opt in "${options[@]}"; do
            if [[ -n "$opt" ]]; then
                INSTALL_MODE="$(echo "$opt" | awk '{print $1}')"
                break
            else
                echo "Invalid selection"
            fi
        done
    fi

    log "Selected install mode: ${INSTALL_MODE}"
}

#######################################
# Region / PyPI Mirror Selection
#######################################

# 国内 PyPI 镜像候选（顺序无所谓，会按测速排序）
CN_PYPI_MIRRORS=(
    "https://pypi.tuna.tsinghua.edu.cn/simple|Tsinghua TUNA"
    "https://mirrors.aliyun.com/pypi/simple/|Aliyun"
    "https://pypi.mirrors.ustc.edu.cn/simple/|USTC"
    "https://mirrors.cloud.tencent.com/pypi/simple/|Tencent Cloud"
    "https://mirrors.bfsu.edu.cn/pypi/web/simple|BFSU"
)

normalize_region() {
    case "$1" in
        cn|china|CN|China) echo "cn" ;;
        global|intl|international|GLOBAL) echo "global" ;;
        *) echo "" ;;
    esac
}

select_region() {
    if [[ -n "$REGION" ]]; then
        local norm
        norm="$(normalize_region "$REGION")"
        [[ -z "$norm" ]] && error "Invalid --region: ${REGION} (expected cn|global)"
        REGION="$norm"
        log "Using region: ${REGION}"
        return 0
    fi

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        REGION="global"
        log "Non-interactive: defaulting region to global"
        return 0
    fi

    echo ""
    draw_box "Select Region"
    echo ""

    local options=(
        "cn        中国大陆（使用国内 PyPI 镜像）"
        "global    海外 / 直连官方 PyPI"
    )

    if has_cmd fzf; then
        local selection
        selection="$(printf '%s\n' "${options[@]}" | fzf \
            --layout=reverse --border=rounded \
            --prompt="Region ❯ " \
            --header="Choose your region (affects PyPI mirror, NOT the AMD ROCm index)")"
        [[ -z "$selection" ]] && error "No region selected"
        REGION="$(echo "$selection" | awk '{print $1}')"
    else
        PS3=$'\n\033[0;36mYour choice: \033[0m'
        select opt in "${options[@]}"; do
            if [[ -n "$opt" ]]; then
                REGION="$(echo "$opt" | awk '{print $1}')"
                break
            else
                echo "Invalid selection"
            fi
        done
    fi

    log "Selected region: ${REGION}"
}

probe_mirror_latency() {
    # 输出格式："<latency> <url> <name>"，按 latency 升序
    local entry url name latency tmp
    tmp="$(mktemp)"

    for entry in "${CN_PYPI_MIRRORS[@]}"; do
        url="${entry%%|*}"
        name="${entry##*|}"
        (
            local t
            t="$(curl -o /dev/null -s -w "%{time_total}" \
                --connect-timeout 3 --max-time 5 "$url" 2>/dev/null || echo "999")"
            # 把 999/异常值规整成可排序数字
            [[ -z "$t" ]] && t="999"
            printf '%s %s %s\n' "$t" "$url" "$name"
        ) >> "$tmp" &
    done
    wait

    sort -n "$tmp"
    rm -f "$tmp"
}

select_pypi_mirror() {
    if [[ -n "$PYPI_MIRROR" ]]; then
        log "Using explicit PyPI mirror: ${PYPI_MIRROR}"
        return 0
    fi

    if [[ "$REGION" != "cn" ]]; then
        log "Region=global, no PyPI mirror configured (uses default PyPI)"
        return 0
    fi

    echo ""
    draw_box "Probing CN PyPI Mirrors"
    echo ""
    log "Testing latency to ${#CN_PYPI_MIRRORS[@]} mirrors (~5s)..."

    local probed
    probed="$(probe_mirror_latency)"

    echo ""
    echo -e "  ${CYAN}Latency results (sorted):${NC}"
    while IFS= read -r line; do
        local lat url name
        lat="$(echo "$line" | awk '{print $1}')"
        url="$(echo "$line" | awk '{print $2}')"
        name="$(echo "$line" | cut -d' ' -f3-)"
        printf "    %-7s  %-50s  %s\n" "${lat}s" "$url" "$name"
    done <<< "$probed"
    echo ""

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        PYPI_MIRROR="$(echo "$probed" | head -n1 | awk '{print $2}')"
        log "Non-interactive: auto-picked fastest mirror: ${PYPI_MIRROR}"
        return 0
    fi

    # 取最快的 3 个进菜单
    local top3
    top3="$(echo "$probed" | head -n3)"

    local options=()
    while IFS= read -r line; do
        local lat url name
        lat="$(echo "$line" | awk '{print $1}')"
        url="$(echo "$line" | awk '{print $2}')"
        name="$(echo "$line" | cut -d' ' -f3-)"
        options+=("${url}|[${lat}s] ${name}")
    done <<< "$top3"

    if has_cmd fzf; then
        local selection
        selection="$(
            printf '%s\n' "${options[@]}" \
                | awk -F'|' '{printf "%-55s  %s\n", $1, $2}' \
                | fzf --layout=reverse --border=rounded \
                    --prompt="PyPI Mirror ❯ " \
                    --header="Top 3 fastest CN mirrors"
        )"
        [[ -z "$selection" ]] && error "No mirror selected"
        PYPI_MIRROR="$(echo "$selection" | awk '{print $1}')"
    else
        echo "Top 3 fastest:"
        local i=1 opt
        for opt in "${options[@]}"; do
            echo "  $i) $(echo "$opt" | awk -F'|' '{printf "%-55s  %s", $1, $2}')"
            i=$((i+1))
        done
        echo ""
        read -r -p "Your choice [1-3]: " choice
        case "$choice" in
            1|"") PYPI_MIRROR="$(echo "${options[0]}" | awk -F'|' '{print $1}')" ;;
            2)    PYPI_MIRROR="$(echo "${options[1]}" | awk -F'|' '{print $1}')" ;;
            3)    PYPI_MIRROR="$(echo "${options[2]}" | awk -F'|' '{print $1}')" ;;
            *)    PYPI_MIRROR="$(echo "${options[0]}" | awk -F'|' '{print $1}')" ;;
        esac
    fi

    log "Selected PyPI mirror: ${PYPI_MIRROR}"
}

#######################################
# Python / Project / Venv Path
#######################################

ensure_python() {
    if ! has_cmd "$PYTHON_BIN"; then
        has_cmd python3 || error "需要 Python 3.12；Ubuntu 24.04 可使用系统 python3"
        PYTHON_BIN="python3"
    fi
    "$PYTHON_BIN" -c 'import sys; sys.exit(sys.version_info[:2] != (3, 12))' || error "本教程使用 Python 3.12，请用 --python 指定对应解释器"
    log "Python: $($PYTHON_BIN --version)"
}

default_project_dir() {
    local safe_ver
    safe_ver="$(echo "$ROCM_VERSION" | tr '/' '_' | tr ':' '_')"

    echo "${HOME}/rocm-uv-projects/rocm-${safe_ver}-${GPU_ARCH}"
}

default_venv_path() {
    echo "$(default_project_dir)/${VENV_DIR_NAME}"
}

select_project_and_venv_path() {
    if [[ -n "$PROJECT_DIR" ]]; then
        PROJECT_DIR="$(expand_path "$PROJECT_DIR")"
        VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
        log "Using project dir: ${PROJECT_DIR}"
        log "Using venv path: ${VENV_PATH}"
        return 0
    fi

    if [[ -n "$VENV_PATH" ]]; then
        VENV_PATH="$(expand_path "$VENV_PATH")"
        PROJECT_DIR="$(dirname "$VENV_PATH")"
        log "Using explicit venv path: ${VENV_PATH}"
        log "Inferred project dir: ${PROJECT_DIR}"
        return 0
    fi

    local default_dir
    default_dir="$(default_project_dir)"

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        PROJECT_DIR="$default_dir"
        VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
        log "Non-interactive: using project dir: ${PROJECT_DIR}"
        log "Non-interactive: using venv path: ${VENV_PATH}"
        return 0
    fi

    echo ""
    draw_box "Select uv Project / Virtual Environment Path"
    echo ""

    local home_dir="${HOME}/rocm-uv-projects/rocm-${ROCM_VERSION}-${GPU_ARCH}"
    local opt_dir="/opt/rocm-uv-projects/rocm-${ROCM_VERSION}-${GPU_ARCH}"

    local options=(
        "default    ${default_dir}"
        "home       ${home_dir}"
        "opt        ${opt_dir}"
        "custom     Enter custom project dir"
        "venv       Enter explicit venv path"
    )

    if has_cmd fzf; then
        local selection
        selection="$(printf '%s\n' "${options[@]}" | fzf \
            --layout=reverse \
            --border=rounded \
            --prompt="Project Dir ❯ " \
            --header="Choose uv project dir. Default venv will be .venv")"

        [[ -z "$selection" ]] && error "No project dir selected"

        local choice
        choice="$(echo "$selection" | awk '{print $1}')"

        case "$choice" in
            default)
                PROJECT_DIR="$default_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            home)
                PROJECT_DIR="$home_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            opt)
                PROJECT_DIR="$opt_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            custom)
                echo ""
                read -r -p "Enter custom uv project dir: " custom_dir
                [[ -z "$custom_dir" ]] && error "Custom project dir cannot be empty"
                PROJECT_DIR="$(expand_path "$custom_dir")"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            venv)
                echo ""
                read -r -p "Enter explicit venv path: " custom_venv
                [[ -z "$custom_venv" ]] && error "Custom venv path cannot be empty"
                VENV_PATH="$(expand_path "$custom_venv")"
                PROJECT_DIR="$(dirname "$VENV_PATH")"
                ;;
            *)
                PROJECT_DIR="$default_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
        esac
    else
        echo "1) Default project: ${default_dir}"
        echo "2) Home project:    ${home_dir}"
        echo "3) Opt project:     ${opt_dir}"
        echo "4) Custom project dir"
        echo "5) Explicit venv path"
        echo ""

        read -r -p "Your choice [1-5]: " choice

        case "$choice" in
            1|"")
                PROJECT_DIR="$default_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            2)
                PROJECT_DIR="$home_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            3)
                PROJECT_DIR="$opt_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            4)
                echo ""
                read -r -p "Enter custom uv project dir: " custom_dir
                [[ -z "$custom_dir" ]] && error "Custom project dir cannot be empty"
                PROJECT_DIR="$(expand_path "$custom_dir")"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
            5)
                echo ""
                read -r -p "Enter explicit venv path: " custom_venv
                [[ -z "$custom_venv" ]] && error "Custom venv path cannot be empty"
                VENV_PATH="$(expand_path "$custom_venv")"
                PROJECT_DIR="$(dirname "$VENV_PATH")"
                ;;
            *)
                warn "Invalid choice, using default project dir"
                PROJECT_DIR="$default_dir"
                VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
                ;;
        esac
    fi

    PROJECT_DIR="$(expand_path "$PROJECT_DIR")"
    VENV_PATH="$(expand_path "$VENV_PATH")"

    log "Selected project dir: ${PROJECT_DIR}"
    log "Selected venv path: ${VENV_PATH}"
}

ensure_project_permission() {
    PROJECT_DIR="$(expand_path "$PROJECT_DIR")"
    VENV_PATH="$(expand_path "$VENV_PATH")"

    if [[ "$PROJECT_DIR" == /opt/* ]] && [[ "$EUID" -ne 0 ]]; then
        warn "You selected a project dir under /opt, but current user is not root."
        warn "Project dir: ${PROJECT_DIR}"
        echo ""
        echo -e "Re-run with sudo, for example:"
        echo -e "  ${CYAN}sudo env \"PATH=\$PATH\" $0 --version ${ROCM_VERSION} --arch ${GPU_ARCH} --project-dir ${PROJECT_DIR}${NC}"
        echo ""

        if [[ "$NON_INTERACTIVE" == "true" ]]; then
            error "Cannot create project under /opt without root in non-interactive mode"
        fi

        read -r -p "Use home project dir instead? (Y/n): " use_home
        if [[ -z "$use_home" || "$use_home" =~ ^[Yy]$ ]]; then
            PROJECT_DIR="${HOME}/rocm-uv-projects/rocm-${ROCM_VERSION}-${GPU_ARCH}"
            VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
            log "Changed project dir to: ${PROJECT_DIR}"
            log "Changed venv path to: ${VENV_PATH}"
        else
            error "Please re-run with sudo or choose another path"
        fi
    fi

    local parent_dir
    parent_dir="$(dirname "$PROJECT_DIR")"

    mkdir -p "$parent_dir"

    if [[ ! -w "$parent_dir" ]]; then
        error "Parent directory is not writable: ${parent_dir}"
    fi
}

#######################################
# uv init / venv / install
#######################################

init_uv_project() {
    echo ""
    draw_box "Initializing uv Project"
    echo ""

    if [[ "$USE_UV_INIT" != "true" ]]; then
        warn "uv init skipped by --no-uv-init"
        mkdir -p "$PROJECT_DIR"
        return 0
    fi

    ensure_project_permission

    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"

    local package_name
    package_name="$(basename "$PROJECT_DIR")"
    package_name="$(sanitize_name "$package_name")"

    if [[ -f "pyproject.toml" ]]; then
        warn "pyproject.toml already exists, skipping uv init"
        "$PYTHON_BIN" - "pyproject.toml" "$package_name" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
package_name = sys.argv[2]
text = path.read_text()

pattern = re.compile(r'(?m)^(\[project\]\n(?:[^\[]*?\n)?name\s*=\s*)"[^"]+"')
new_text, count = pattern.subn(rf'\1"{package_name}"', text, count=1)

if count:
    path.write_text(new_text)
PY
    else
        log "Running uv init in ${PROJECT_DIR}"

        uv init \
            --name "$package_name" \
            --bare \
            --no-readme \
            --no-workspace \
            .
    fi

    if [[ ! -f ".python-version" ]]; then
        "$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' > .python-version
    fi

    echo -e "  ${GREEN}✓${NC} uv project dir: ${PROJECT_DIR}"
}

create_rocm_venv() {
    echo ""
    draw_box "Creating ROCm uv Environment"
    echo ""

    if [[ -z "$PROJECT_DIR" ]]; then
        PROJECT_DIR="$(default_project_dir)"
    fi

    if [[ -z "$VENV_PATH" ]]; then
        VENV_PATH="${PROJECT_DIR}/${VENV_DIR_NAME}"
    fi

    PROJECT_DIR="$(expand_path "$PROJECT_DIR")"
    VENV_PATH="$(expand_path "$VENV_PATH")"

    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"

    if [[ -d "$VENV_PATH" ]]; then
        if [[ "$FORCE_RECREATE" == "true" ]]; then
            warn "Removing existing venv: ${VENV_PATH}"
            rm -rf "$VENV_PATH"
        else
            warn "Venv already exists: ${VENV_PATH}"
            if [[ "$NON_INTERACTIVE" != "true" ]] && confirm "Recreate it? (y/N): " "N"; then
                rm -rf "$VENV_PATH"
            else
                log "Using existing venv"
            fi
        fi
    fi

    if [[ ! -d "$VENV_PATH" ]]; then
        log "Creating venv: ${VENV_PATH}"
        uv venv "$VENV_PATH" --python "$PYTHON_BIN"
    fi

    echo -e "  ${GREEN}✓${NC} Venv path: ${VENV_PATH}"
}

#######################################
# Configure indexes in pyproject.toml
# (PyPI mirror as default + ROCm AMD index)
#######################################

configure_pyproject_indexes() {
    local args=("${PROJECT_DIR}/pyproject.toml" --arch "$GPU_ARCH" --mode "$INSTALL_MODE")
    [[ -z "${PYPI_MIRROR:-}" ]] || args+=(--pypi-mirror "$PYPI_MIRROR")
    "$PYTHON_BIN" "${SCRIPT_DIR}/configure-rocm-env.py" "${args[@]}"
    log "Configured ROCm 10.0: device-${GPU_ARCH}, ${ROCM_WHL_BASE}/"
}

#######################################
# Sync the recorded dependencies and update uv.lock.
#######################################

add_rocm_packages() {
    cd "$PROJECT_DIR"
    export UV_PROJECT_ENVIRONMENT="$VENV_PATH"
    # uv sync 会按新 pyproject 更新已有 uv.lock；解析失败就停止，保留错误。
    uv sync --python "$PYTHON_BIN"
}

write_activation_helper() {
    cp "${SCRIPT_DIR}/activate-rocm.sh" "${PROJECT_DIR}/activate-rocm.sh"
    # 显式 --venv 也使用同一份模板，只替换环境目录。
    "$PYTHON_BIN" - "$PROJECT_DIR" "$VENV_PATH" <<'PY_HELPER'
from pathlib import Path
import shlex
import sys
project, venv = map(Path, sys.argv[1:])
if venv != project / ".venv":
    path = project / "activate-rocm.sh"
    path.write_text(path.read_text().replace('ROCM_VENV="${ROCM_PROJECT_DIR}/.venv"', "ROCM_VENV=" + shlex.quote(str(venv))))
PY_HELPER
    chmod +x "${PROJECT_DIR}/activate-rocm.sh"
}

verify_env() {
    "${VENV_PATH}/bin/python" --version
    "${VENV_PATH}/bin/rocm-sdk" version
    if [[ "$INSTALL_MODE" == "full" ]]; then
        "${VENV_PATH}/bin/rocm-sdk" init --quiet
        "${VENV_PATH}/bin/hipcc" --version
    fi
    if [[ -e /dev/kfd ]]; then
        log "/dev/kfd present；GPU 运算请继续执行本章的 smoke test"
    else
        warn "/dev/kfd missing；请检查宿主机驱动与设备权限"
    fi
}

print_summary() {
    echo ""
    draw_box "Done"
    echo ""

    echo -e "  ${GREEN}ROCm uv project environment created successfully.${NC}"
    echo ""
    echo -e "  ${BOLD}Environment:${NC}"
    echo -e "    Project dir:  ${CYAN}${PROJECT_DIR}${NC}"
    echo -e "    Venv path:    ${CYAN}${VENV_PATH}${NC}"
    echo -e "    GPU arch:     ${CYAN}${GPU_ARCH}${NC}"
    echo -e "    ROCm version: ${CYAN}${ROCM_VERSION}${NC}"
    echo -e "    Install mode: ${CYAN}${INSTALL_MODE}${NC}"
    echo ""
    echo -e "  ${BOLD}Activate:${NC}"
    echo -e "    ${CYAN}source ${VENV_PATH}/bin/activate${NC}"
    echo ""
    echo -e "  ${BOLD}Or use helper:${NC}"
    echo -e "    ${CYAN}source ${PROJECT_DIR}/activate-rocm.sh${NC}"
    echo ""
    echo -e "  ${BOLD}Check packages:${NC}"
    echo -e "    ${CYAN}uv pip list --python ${VENV_PATH}/bin/python | grep -i rocm${NC}"
    echo ""
    echo -e "  ${BOLD}Check ROCm version in venv:${NC}"
    echo -e "    ${CYAN}${VENV_PATH}/bin/rocm-sdk version${NC}"
    echo ""
}

#######################################
# Main
#######################################

main() {
    parse_args "$@"

    setup_user_path

    print_header

    draw_box "Detecting System"
    echo ""
    detect_os
    detect_pkg_manager
    install_basic_tools

    detect_gpu

    ensure_uv
    ensure_fzf
    ensure_python
    if [[ "${INSTALL_MODE}" != "minimal" ]]; then
        check_system_build_deps
    fi

    select_gpu_arch

    if ! check_arch_index "$GPU_ARCH"; then
        error "AMD wheel index not available for arch: ${GPU_ARCH}, URL: $(arch_index_url "$GPU_ARCH")"
    fi

    select_rocm_version
    select_install_mode
    select_region
    select_pypi_mirror
    select_project_and_venv_path
    PROJECT_DIR="$("$PYTHON_BIN" -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$PROJECT_DIR")"
    VENV_PATH="$("$PYTHON_BIN" -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$VENV_PATH")"

    init_uv_project
    create_rocm_venv
    configure_pyproject_indexes
    add_rocm_packages
    write_activation_helper
    verify_env
    print_summary
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
