knowledge-layer:: wiki
topic:: GSD 2 编码智能体 CLI

- v2.78 更新要点
  source-url:: https://github.com/gsd-build/gsd-2/blob/main/README.md
  raw:: [[llm-wiki/raw/2026-04-26-gsd-2-readme-md-at-main-gsd-build-gsd-2-github]]
  confidence-score:: 0.85
  status:: current
	- **工作树生命周期 & 取证**：
	- [[GSD 2 工作树]] 新增碰撞节奏控制、遥测事件和取证命令。
	- 孤儿审计：中断的里程碑不再被跳过。
- **自动流水线 & 组件系统**：
	- 统一组件系统取代之前的独立层。
	- 单写者控制面，防止并发写入冲突。
- **扩展框架**：
	- [[GSD 2 扩展框架]] 引入扩展生命周期命令和拓扑加载顺序。
- **模型、代理 & UX**：
	- 支持 GPT-5.5 Codex。
	- 权限粒度选择器、无头自动模式。
- **可靠性 & 安全性**：
	- 大规模 Git 安全加固。
	- 原子状态写入、压缩正确性修复。