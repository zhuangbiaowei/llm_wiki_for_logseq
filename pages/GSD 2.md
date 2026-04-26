knowledge-layer:: wiki
topic:: GSD 2 编码智能体 CLI

- 概述
  source-url:: https://github.com/gsd-build/gsd-2/blob/main/README.md
  raw:: [[llm-wiki/raw/2026-04-26-gsd-2-readme-md-at-main-gsd-build-gsd-2-github]]
  confidence-score:: 0.85
  status:: current
	- GSD 2 是 [[GSD]] 的演进版本，从提示框架升级为独立的命令行工具，基于 Pi SDK 构建。
- 提供直接访问智能体 harness 的 TypeScript 接口，实现上下文管理、文件注入、Git 分支管理、成本跟踪、循环检测、崩溃恢复和里程碑自动推进。
- 安装：`npm install -g gsd-pi@latest`
- 核心特性
	- **自动里程碑执行**：一条命令执行整个里程碑，自动处理上下文、Git 操作和验证。
- **工作树系统**：支持分支工作流，自动合并、碰撞检测和恢复。
- **组件系统**：技能、代理、流水线和市场统一模型。
- **扩展框架**：支持 npm、Git 和本地扩展安装。
- **可靠性**：原子状态写入、空轮恢复、Git 安全加固。