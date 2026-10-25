# agent-teamwork 官方 SWE-bench Verified 对接与实操指南

[![Version: 0.4.0](https://img.shields.io/badge/version-0.4.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen.svg)](../tests/)
[![SWE-bench: Verified](https://img.shields.io/badge/SWE--bench-Verified%20(500%20Tasks)-purple.svg)](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)

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

# 3. macOS / Apple Silicon 镜像预拉取 (官方镜像仅含 x86_64 架构):
# docker pull --platform=linux/amd64 swebench/sweb.eval.x86_64.psf_1776_requests-<task_id>:latest

# 4. 触发真实 Docker 容器环境裁决 (自动拉取官方镜像并在沙箱中跑隐藏测试)
python3 benchmarks/swebench/eval.py \
  --predictions benchmarks/swebench/predictions-teamwork.jsonl \
  --dataset SWE-bench/SWE-bench_Verified \
  --max-workers 4 \
  --run-id agent-teamwork-verified-run
```

---

## 4. 真实实测大考结果：`psf/requests`（8 题官方 Docker 裁决）

全流程三步大考已于 **2026-10-25** 使用 `deepseek-v4.1-flash` 在官方 SWE-bench Verified 数据集 `psf/requests` 全量 8 道题目上执行完成，并经由官方评测套件在隔离 Docker 容器中执行隐藏测试裁决（`swebench.harness.run_evaluation`）。

### 4.1 官方记分卡数据

| 指标 | Solo 裸模型基线（Track A） | + agent-teamwork（Track B） | 差值 |
| :--- | :---: | :---: | :---: |
| **补丁产出率** | 8/8（100%） | 8/8（100%） | — |
| **官方 Resolved（Pass@1 真实裁决）** | **4/8（50.0%）** | **5/8（62.5%）** | **+12.5 pts（多解出 1 题）** |
| **Unresolved（盲测未通过）** | 3（2317, 2931, 5414） | 3（2317, 2931, 5414） | — |
| **补丁损坏 / 无法应用（error）** | **1（`psf__requests-6028`）** | **0** | **−1 error** |
| **API 调用次数 / 回合消耗** | 21 次 | **17 次** | **−19.0%** |
| **总 Token 消耗** | 41.8 万 | **23.9 万** | **−42.8%（Solo 膨胀 +75%）** |

```
官方 SWE-bench Resolved（Pass@1, psf/requests, Docker 盲测裁决）
+ agent-teamwork                [████████████████████░░░░░░░░░░░░]  62.5% (5/8)
Solo (deepseek-v4.1-flash)      [████████████████░░░░░░░░░░░░░░░░]  50.0% (4/8)

效率与鲁棒性对比
Solo Token 膨胀税:     41.8 万 vs 23.9 万 (+75.0% 额外消耗)
Solo 补丁损坏率:       1 次 git apply 严重损坏 (error) vs Teamwork 0 次
```

### 4.2 逐题裁决明细

| 任务 ID | 问题简述 | Solo 裸模型 | + agent-teamwork | 关键裁决差异 |
| :--- | :--- | :---: | :---: | :--- |
| `psf__requests-1142` | GET 请求无 body 仍带 Content-Length | **RESOLVED** | **RESOLVED** | 双方均定位并移除冗余头 |
| `psf__requests-1724` | Unicode 重定向 URL 处理异常 | **RESOLVED** | **RESOLVED** | 双方均修复查询字符串归一化 |
| `psf__requests-1766` | Digest 认证双引号转义缺陷 | **RESOLVED** | **RESOLVED** | 双方均添加正则引号保护 |
| `psf__requests-1921` | 请求头中出现 None 值报错 | **RESOLVED** | **RESOLVED** | 双方均过滤空字典键值 |
| `psf__requests-2317` | 字节串解码回退失败 | UNRESOLVED | UNRESOLVED | 模型推理能力边界（共同失败） |
| `psf__requests-2931` | 分块传输编码修补失效 | UNRESOLVED | UNRESOLVED | 模型推理能力边界（共同失败） |
| `psf__requests-5414` | IDNA 编码缺失模块 | UNRESOLVED | UNRESOLVED | 模块解析环境异常（共同失败） |
| `psf__requests-6028` | 代理环境变量覆盖异常 | **ERROR** | **RESOLVED** | **535 字符手术补丁 vs 3 万字符全量重写** |

### 4.3 核心分水岭剖析：`psf__requests-6028`

两轨之间的胜负分水岭完全锁定在 **`psf__requests-6028`**：
- **Solo 基线轨**：耗时 332 秒，输出了长达 **30,348 字符的整文件重写**。由于修改波及了大量非目标代码，即使使用 `git apply --3way` 也产生大量冲突完全打不上，官方 Harness 直接判处致命 `error`。
- **Teamwork 护航轨**：借助多回合 `<read path="requests/utils.py"/>` 针对性检视以及物理路径锁限制，仅用 2 回合、**535 字符的手术式补丁**即精准命中病灶，补丁无缝应用并顺利通过 Docker 容器内全部隐藏测试，斩获 Resolved！

### 4.4 工程踩坑与实战经验总结

1. **数据集 HuggingFace 组织名**：`swebench.harness` 5.0.2 强制要求数据集元数据中包含 `image_name` 列。`princeton-nlp/SWE-bench_Verified` 缺少该列，需指定官方 `SWE-bench/SWE-bench_Verified`（题目 ID 与题干完全一致）。
2. **Apple Silicon Docker 跨架构模拟**：官方环境镜像仅发布了 `x86_64` 清单。在 macOS M 系列芯片上，先执行 `docker pull --platform=linux/amd64 swebench/sweb.eval.x86_64.psf_1776_requests-<id>:latest` 预拉取，Harness 检测到本地镜像后将通过 Rosetta 2 模拟平稳执行全部验证。
3. **多回合文件读取缓冲区扩容**：初始 14KB 的读取截断上限会让模型陷入“只读不写”的死循环（例如 `requests/models.py` 有 20.8KB）。将 `maxChars` 放宽到 60,000（60KB）并附带回合预算提示后，单题稳定在 2–3 回合收敛。
4. **零护栏损伤法则**：在 3 道共同失败的题目上（`2317`, `2931`, `5414`），两轨交付的逻辑完全一致。这证明失败源自模型本身的泛化能力上限，而非脚手架的干扰，验证了护航体系“保真无损”的工程底色。

### 4.5 权威审计产物索引

- **Teamwork 预测补丁集**：[`benchmarks/swebench/predictions-teamwork.jsonl`](../benchmarks/swebench/predictions-teamwork.jsonl)
- **Solo 基线预测补丁集**：[`benchmarks/swebench/predictions-solo.jsonl`](../benchmarks/swebench/predictions-solo.jsonl)
- **官方 Teamwork 记分卡**：[`benchmarks/swebench/results/agent-teamwork-v0.4.0+swebench (deepseek-v4.1-flash).agent-teamwork-verified-run.json`](../benchmarks/swebench/results/agent-teamwork-v0.4.0+swebench%20(deepseek-v4.1-flash).agent-teamwork-verified-run.json)
- **官方 Solo 记分卡**：[`benchmarks/swebench/results/deepseek-v4.1-flash-solo.solo-deepseek-verified-run.json`](../benchmarks/swebench/results/deepseek-v4.1-flash-solo.solo-deepseek-verified-run.json)

---

## 5. 阶段二实测大考结果：`pytest-dev/pytest`（19 题官方 Docker 裁决）

继阶段一（`psf/requests`）之后，我们于 **2026-10-25** 使用 `deepseek-v4.1-flash` 对官方 SWE-bench Verified 中 `pytest-dev/pytest` 的全量 19 道题目（`benchmarks/swebench/tasks-pytest-19.json`）完成了端到端 A/B 大考，并经由官方 `swebench.harness.run_evaluation` 在隔离 Docker 容器中执行隐藏测试裁决。

### 5.1 官方记分卡对比（`pytest-dev/pytest` · 19 题）

| 指标 | Solo 裸模型基线（Track A） | + agent-teamwork（Track B） | 差值与优势 |
| :--- | :---: | :---: | :---: |
| **补丁产出率** | 16/19（84.2%）* | 16/19（84.2%） | — |
| **官方 Resolved（Pass@1 真实裁决）** | **12/19（63.2%）** | **14/19（73.7%）** | **+10.5 pts（净胜 2 题）** |
| **Unresolved（有补丁但盲测未过）** | 3（`10356`, `7324`, `7490`） | 2（`5787`, `7324`） | −1 |
| **空补丁（回合耗尽未写入）** | 3（`5840`, `6197`, `7236`） | 3（`10356`, `5840`, `6197`） | — |
| **补丁损坏 / 无法应用（`error`）** | **1（`pytest-dev__pytest-7205`）** | **0** | **−1 error** |
| **环境异常（infra failure）** | 0 | 0 | — |
| **API 调用次数** | 58（另 1 次 429 重试 + 补跑 3 次） | 69 | +19.0% |
| **总 Token 消耗** | 1,707,827（1.35M / 362K） | 1,942,076（1.45M / 491K） | +13.7% |
| **平均补丁大小** | 2,182 字符（大 51%） | **1,442 字符** | **−33.9% 更具手术式精准度** |
| **累计解题墙钟** | 47.8 + 5.5 分钟（补跑） | 56.5 分钟 | — |

*\*关于 `pytest-dev__pytest-10356` 的公平性披露*：Solo 首轮为 15/19，其中 `10356` 首次尝试遭上游网关瞬时 HTTP 429（`ttft_admission_refused, cell at capacity`），属网关容量问题而非模型失败。按同预算同协议对该题单独补跑一次（3 回合、2,029 字符）并合并进 `predictions-pytest-baseline.jsonl`。补跑后官方 Docker 仍判定为 `unresolved`（`no_tests_collected`），不改变比分，仅还原绝对公平。

**如实披露的 Token 趋势反转**：在 `requests-8` 大考中 Teamwork 节省了 42.8% Token，而在 `pytest-19` 中反而多消耗 13.7% Token。原因是 `pytest` 仓库体量更大，Teamwork 每回合携带文件树与读取协议使 Prompt 侧开销上升；但这 +13.7% 的 Token 投入换来了 **+10.5% Pass@1（净胜 2 题 Resolved）**、**缩小 33.9% 的手术式补丁体积**以及 **0 次补丁损坏错误**。

### 5.2 胜负手与分水岭实例剖析

- **Teamwork 独得 3 题**：
  - **`pytest-dev__pytest-7205`**（决定性一题，与 `requests-6028` 同型）：Teamwork 用 2 回合产出 606 字符手术式补丁，应用通过、隐藏测试转绿。Solo 同样用 2 回合，但重写了 3,421 字符的 `setuponly.py`，补丁在第 100 行发生格式断裂（`patch: **** malformed patch at line 100`），官方容器直接拒绝应用并判 `error`。大改重写在 diff 提取环节的脆弱性再次暴露。
  - **`pytest-dev__pytest-7236`**：Teamwork 3 回合写出 2,036 字符补丁并 **Resolved**；Solo 6 个回合全部用于读代码，一字符未写，空补丁收场。
  - **`pytest-dev__pytest-7490`**：Teamwork 939 字符补丁 **Resolved**；Solo 2,638 字符补丁虽能应用，但官方隐藏测试报 `no_tests_collected` 判定失败。
- **Solo 独得 1 题**：
  - **`pytest-dev__pytest-5787`**：Solo 2 回合 7,348 字符补丁 **Resolved**；Teamwork 3 回合 6,421 字符补丁应用后同样触发 `no_tests_collected`，为本次 Teamwork 的唯一净亏损点。
- **共同失败 4 题归因**：
  - `5840`、`6197`：两轨均用满 6 回合未写入。`deepseek-v4.1-flash` 在高难题上把全部预算耗在读代码与推理上，属固定 6 回合协议下的模型能力边界（停滞提醒正常触发、0 次误中止、两轨 0 越界写入、0 虚假胜利）。
  - `10356`：Teamwork 未写入；Solo 补丁可应用但 `no_tests_collected`。
  - `7324`：两轨补丁均能干净应用（1,791 与 2,056 字符），但隐藏测试未过，属典型的未命中根因。

### 5.3 SWE-bench Verified 双阶段总计看板（Tier 1 + Tier 2 · 累计 27 题）

| 评测批次 | 题数 | Solo 基线 Resolved | + agent-teamwork Resolved | 净胜分差 | 致命补丁损坏 (`error`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Tier 1：`psf/requests`** | 8 | 4/8（50.0%） | **5/8（62.5%）** | **+12.5 pts** | 1（`requests-6028`）对 **0** |
| **Tier 2：`pytest-dev/pytest`** | 19 | 12/19（63.2%） | **14/19（73.7%）** | **+10.5 pts** | 1（`pytest-7205`）对 **0** |
| **两场官方盲测合计** | **27** | **16/27（59.3%）** | **19/27（70.4%）** | **+11.1 pts（净胜 3 题）** | **2 对 0** |

### 5.4 阶段二权威审计产物索引

- **Teamwork 预测补丁集**：[`benchmarks/swebench/predictions-pytest-teamwork.jsonl`](../benchmarks/swebench/predictions-pytest-teamwork.jsonl)
- **Solo 基线预测补丁集**：[`benchmarks/swebench/predictions-pytest-baseline.jsonl`](../benchmarks/swebench/predictions-pytest-baseline.jsonl)
- **双轨逐题遥测报告**：[`benchmarks/swebench/report-pytest-ab.json`](../benchmarks/swebench/report-pytest-ab.json)
- **官方 Teamwork 记分卡（14/19）**：[`benchmarks/swebench/results/agent-teamwork-v0.4.0+swebench (deepseek-v4.1-flash).pytest-teamwork-verified-run.json`](../benchmarks/swebench/results/agent-teamwork-v0.4.0+swebench%20(deepseek-v4.1-flash).pytest-teamwork-verified-run.json)
- **官方 Solo 记分卡（12/19）**：[`benchmarks/swebench/results/deepseek-v4.1-flash-solo.pytest-solo-verified-run.json`](../benchmarks/swebench/results/deepseek-v4.1-flash-solo.pytest-solo-verified-run.json)

---

## 6. 推荐实测分级演进路线

| 阶段 | 推荐范围 | 目标与期望现象 | 当前状态 |
| :--- | :--- | :--- | :---: |
| **阶段 1：微型全仓探针** | `psf/requests`（全量 8 题） | 验证从 Issue 输入到 Docker 跑通完整生命周期；实测手术式补丁 vs 破坏性全仓重写。 | **已完成（62.5% 对 50.0%）** |
| **阶段 2：系统并发代表作** | `pytest-dev/pytest`（全量 19 题） | 深入测试复杂的异常捕获与级联文件修改，压测 Teamwork 挑战者机制的边界覆盖能力。 | **已完成（73.7% 对 63.2%）** |
| **阶段 3：全量 500 题天梯对决** | 官方 `SWE-bench_Verified` 全量 | 直接生成对齐国际标准的权威测评报告，对标 Devin、Claude Code、Cursor 等业界顶级方案。 | 支持 `--max-workers` 并发 |
