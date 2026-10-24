# agent-teamwork 官方 SWE-bench Verified 对接与实操指南

[![Version: 0.4.0](https://img.shields.io/badge/version-0.4.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![SWE-bench: Verified](https://img.shields.io/badge/SWE--bench-Verified%20(500%20Tasks)-purple.svg)](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified)

[English](SWEBENCH_GUIDE.md) | [简体中文](SWEBENCH_GUIDE.zh-CN.md)

---

## 1. 为什么接入 SWE-bench Verified？

在 `deepseek-v4.1-flash` 的 15 题实测中，前沿推理模型已在单/双模块代码生成上取得 100% Pass@1（顶格持平）。虽然引擎在**路径锁零越界（18 对 0）**与**零冒功虚假胜利（2 对 0）**上完全碾压 Solo 裸模型，但若要在**代码正确性（Pass@1）**维度拉开 30%～50% 的断层差距，必须迈向真实开源全仓大考：

1. **盲测机制（Holdout Test Evaluation）**：
   - 模型在执行期间**只能看到 GitHub Issue 标题与正文**，无法直接获取测试代码；
   - 依赖猜测的 Solo 单智能体在边界用例（Edge Cases）上极易遗漏，Pass@1 通常暴跌至 30%～50%；
   - `agent-teamwork` 的 **Challenger（反向挑刺）** 与 **`synthesizeMicroTestPlan`（微测试合成）** 能够在交付前自主推演反例，大幅提升首写鲁棒性。
2. **全仓多文件定位与级联修改（Repository-Scale Context）**：
   - 任务来自 12 个真实顶流 Python 仓库（`django/django`, `sympy/sympy`, `psf/requests`, `pytest-dev/pytest` 等），涵盖数十万行代码；
   - 物理路径锁防止智能体误伤既有核心模块或污染工作区。
3. **海量既有套件的零回归保证（PASS_TO_PASS）**：
   - 修复目标 Bug 时，必须确保成百上千个既有单元测试依然 100% 通过。

---

## 2. 架构设计与工具链

SWE-bench 适配器位于 [`benchmarks/swebench/`](../benchmarks/swebench/)，完全解耦且遵循零侵入架构：

```
benchmarks/swebench/
├── loader.py             # 官方 HuggingFace 500 题数据集拉取与本地缓存 (仅 2.1MB)
├── runner.mjs            # agent-teamwork 协议驱动器 (生成标准 predictions.jsonl)
├── eval.py               # 官方 Docker 评测桥接器 (调用 swebench.harness)
└── cache/                # 本地 Parquet 数据集缓存 (git-ignored)
```

---

## 3. 快速上手操作手册

### 前置环境要求
- **Python**: `>= 3.10`（支持 `pandas` 与 `pyarrow`）
- **Docker**: 已安装且 Docker Daemon 处于运行状态（用于最终官方容器裁判）
- **Node.js**: `>= 18.0.0`

---

### 第一步：检视与导出任务集（Dataset Loader）

无需注册或登录 HuggingFace，`loader.py` 自动从官方 Parquet 源直链下载并缓存：

```bash
# 查看 500 题全量统计与仓库分布
python3 benchmarks/swebench/loader.py --info

# 导出 psf/requests 的 8 道高代表性任务（过滤并隐藏黄金补丁，确保绝对盲测）
python3 benchmarks/swebench/loader.py --repo psf/requests --export /tmp/swe_requests.json

# 导出单道题目进行针对性攻关 (例如经典 requests-1142)
python3 benchmarks/swebench/loader.py --instance psf__requests-1142 --export /tmp/single_task.json
```

---

### 第二步：运行 agent-teamwork 求解（Runner）

使用引擎驱动模型针对目标仓库生成官方提交流水线文件 `predictions.jsonl`：

```bash
# 模式 A: agent-teamwork 护航求解 (开启路径锁、动态风险拓扑与对抗挑战)
node benchmarks/swebench/runner.mjs \
  --instances /tmp/swe_requests.json \
  --mode teamwork \
  --model deepseek-v4.1-flash \
  --out-predictions benchmarks/swebench/predictions-teamwork.jsonl

# 模式 B: Solo 裸模型基线对比 (无护栏直接裸跑)
node benchmarks/swebench/runner.mjs \
  --instances /tmp/swe_requests.json \
  --mode baseline \
  --model deepseek-v4.1-flash \
  --out-predictions benchmarks/swebench/predictions-solo.jsonl
```

生成的每行数据严格符合 SWE-bench 官方标准：
```json
{"instance_id": "psf__requests-1142", "model_name_or_path": "agent-teamwork-v0.4.0", "model_patch": "diff --git a/requests/models.py b/requests/models.py..."}
```

---

### 第三步：运行官方 Docker 裁判评估（Evaluator）

```bash
# 1. 安装官方评测包 (仅需一次)
pip install swebench

# 2. 离线快速校验 (检查 Patch 格式、空补丁与合法性)
python3 benchmarks/swebench/eval.py --predictions benchmarks/swebench/predictions-teamwork.jsonl --local-check-only

# 3. 触发真实 Docker 容器环境裁决 (自动拉取官方镜像并在沙箱中跑隐藏测试)
python3 benchmarks/swebench/eval.py \
  --predictions benchmarks/swebench/predictions-teamwork.jsonl \
  --dataset princeton-nlp/SWE-bench_Verified \
  --max-workers 4 \
  --run-id agent-teamwork-verified-run
```

---

## 4. 推荐实测分级演进路线

| 阶段 | 推荐范围 | 目标与期望现象 |
| :--- | :--- | :--- |
| **阶段 1：微型全仓探针** | `psf/requests`（全量 8 题） | 验证从 Issue 输入到 Docker 跑通完整的生命周期；观察盲测下 Solo 是否由于忽略 Content-Length 空 Body 导致失败。 |
| **阶段 2：系统并发代表作** | `pytest-dev/pytest`（19 题） | 深入测试复杂的异常捕获与级联文件修改，压测 Teamwork 挑战者机制的边界覆盖能力。 |
| **阶段 3：全量 500 题天梯对决** | 官方 `SWE-bench_Verified` 全量 | 直接生成对齐国际标准的权威测评报告，对标 Devin、Claude Code、Cursor 等业界顶级方案。 |
