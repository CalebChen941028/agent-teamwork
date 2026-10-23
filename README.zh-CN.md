# agent-teamwork（多智能体团队协作大任务攻坚）

[![CI](https://github.com/CalebChen941028/agent-teamwork/actions/workflows/ci.yml/badge.svg)](https://github.com/CalebChen941028/agent-teamwork/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/)

**面向大型长周期工程任务的多智能体团队协作编排：范围访谈、里程碑并行施工、对抗验收挑战、停滞重规划与终局审计。**

用于推进复杂、多阶段的大型工程任务（整块新系统设计、大规模架构重构、深度课题研究）。通过动词化改写、文件互不重叠并行施工、逐里程碑结构化对抗挑战、停滞整体重规划与端到端终局审计，保障大型工程平稳交付。

---

## 核心流程

```
[范围访谈对齐]
      │
      ▼
1. 范围确认与动词化改写
   ├── 明确“目标背后的目标”、验收标准与非目标边界
   └── 编排者将任务名词转化为强动词，拆分出文件互不重叠的顺序里程碑
      │
      ▼
2. 逐里程碑推进（每个里程碑独立上下文）
   ├── 施工员限制在 allowedPaths 路径内并行开发（allSettled + 容错重试）
   ├── 质检验收员核对真实代码与测试状态
   └── 对抗挑战员输出结构化判定（{ foundIssue: boolean, evidence: string }）
      │
      ▼
3. 靶向返工与卡死重规划
   ├── 返工工程师在 allowedPaths 范围内最小化修复
   └── 3 轮返工仍卡死时触发整体重规划（原失败里程碑标记为 superseded，不污染终局指标）
      │
      ▼
4. 终局验收命令与全面审计
   ├── 终局命令合并保留末尾 2000 字符（精准捕获失败断言）
   ├── 验收失败时准确记录 verifyPassed = false 并计入未解决缺口
   └── 总审计员端到端核验交付物与范围说明书
      │
      ▼
5. 综合报告与客观结论文案
   └── 结论文案真实反映遗留缺口与验收命令状态，绝不盲目宣称“命令通过”
```

---

## v0.2.0 关键缺陷修复

- **C1 (终局验收命令状态与结论修复)**：彻底修复此前无论 `verifyCommand` 成功与否，结论文案一律声称“终局验收命令通过”的致命缺陷；现在精确记录 `verifyPassed`，失败时将其作为 high 级缺陷计入 `openGaps`。
- **C2 (重规划失效里程碑隔离)**：返工卡死触发重规划后，被替代的历史失败里程碑打上 `superseded: true` 标记，终局审计不再将其重复统计为活跃缺口。
- **C3 (保留失败输出尾部)**：合并两路输出并精准保留末尾 2000 字符，保留断言堆栈。
- **C4 (结构化对抗挑战判定)**：挑战员强制输出 `{ foundIssue: boolean, evidence: string }`，当“找不到实证”时不再盲目触发复核与返工。
- **C5 (里程碑独立上下文隔离)**：验收员、挑战员、返工员在每个里程碑新建独立上下文，避免超长历史造成的锚定偏差。
- **C6 (返工路径白名单硬约束)**：返工提示中显式传入待修复工作项的 `allowedPaths`，杜绝跨界修改。
- **C7 (容错与枚举校验)**：`Promise.allSettled` 并行施工 + 失败自动升级重试 + 严格校验 `integrityMode` 与 `teamProfile`。
- **C8 (清理重复未覆盖说明)**：删除 `notCovered` 列表中的重复项。

---

## 范围访谈指南

Teamwork 要求在启动任何大任务前与用户完成范围访谈。详见中英双语范围访谈规范：[`protocol/scoping-interview.md`](protocol/scoping-interview.md)。

---

## 安装说明

### ZCode 动态工作流
```bash
./install.sh --target zcode --lang zh
```

### Claude Code CLI / 通用环境
```bash
./install.sh --target claude
./install.sh --target generic --dest /path/to/project
```

---

## 单测执行

直接运行内置单元测试：

```bash
node --test tests/teamwork.test.mjs
```

---

## 致谢与参考

- **Magentic-One**：事实账本、外循环整体重规划与停滞处理思路。
- **claude-flow**：多智能体共享状态与上下文边界参考。
- **Felix Rieseberg**：动词化改写与跨领域工程方法借用。

---

## 商标与免责声明

Antigravity 是 Google LLC 的商标。本项目为独立开源社区作品，与 Google LLC 或 Anthropic 无任何关联，亦未获得其官方授权或背书。

---

## 许可证

[MIT](LICENSE) © 2026 Liangliang Chen
