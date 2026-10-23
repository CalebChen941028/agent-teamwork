# Contributing to agent-teamwork

[English](#english) | [中文](#中文)

---

## English

Thank you for contributing to `agent-teamwork`!

### Guidelines
1. **Verification Logic**: Keep all gate, conclusion, and signature logic in `shared/verify-gate.ts` strictly tested.
2. **Context Isolation**: Preserve per-milestone agent instantiation to avoid anchor bias across long horizons.
3. **Tests**:
   ```bash
   node --test tests/teamwork.test.mjs
   ```

---

## 中文

感谢参与 `agent-teamwork` 项目建设！

### 贡献准则
1. **验收关卡逻辑**：确保 `shared/verify-gate.ts` 及各里程碑判定逻辑零外部依赖并通过全部测试。
2. **上下文隔离**：保持每个里程碑新建把关角色的独立性，杜绝跨里程碑锚定偏差。
3. **测试命令**：
   ```bash
   node --test tests/teamwork.test.mjs
   ```
