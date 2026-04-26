- 工作树生命周期
  source-url:: https://github.com/gsd-build/gsd-2/blob/main/README.md
  raw:: [[llm-wiki/raw/2026-04-26-gsd-2-readme-md-at-main-gsd-build-gsd-2-github]]
  confidence-score:: 0.85
  status:: current
	- 工作树 (Worktree) 是 GSD 2 中管理隔离开发环境的概念，类似 Git 工作树但带有生命周期管理。
- **碰撞节奏控制**：通过 `git.collapse_cadence` 设置 `milestone` 或 `slice`，控制在验证后立即将切片合并到主干。
- **遥测事件**：记录 `worktree-created`、`worktree-merged`、`worktree-orphaned` 等事件，用于取证。
- **取证命令**：`/gsd forensics worktree` 显示孤儿分支、合并耗时、冲突等异常。
- 关键改进
	- **孤儿审计**：中断的里程碑如果已有提交，不再跳过，而是发出警告。
- **里程碑根目录解析**：验证器通过活动工作树读取状态，避免读取过时项目根。