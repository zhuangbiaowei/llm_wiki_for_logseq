- 扩展框架
  source-url:: https://github.com/gsd-build/gsd-2/blob/main/README.md
  raw:: [[llm-wiki/raw/2026-04-26-gsd-2-readme-md-at-main-gsd-build-gsd-2-github]]
  confidence-score:: 0.85
  status:: current
	- **扩展生命周期命令**：
	- `gsd extensions install / update / uninstall / list / info / validate`
	- 支持 npm 包、Git 仓库和本地目录作为来源。
- **加载机制**：
	- 使用 [[Kahn 算法]] 进行拓扑排序，确保依赖顺序。
	- 加载警告被显式报告，而非静默失败。
- **解耦**：
	- `cmux` 和 `gsd` 之间的静态导入被替换为事件驱动架构。
- **参考扩展**：`@gsd-extensions/google-search` 作为第一个从核心分离的扩展。