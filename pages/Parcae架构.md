- 解决的问题
  source-url:: https://mp.weixin.qq.com/s/NRVA4sDsz6hgde4RB_DXeQ
  raw:: [[llm-wiki/raw/2026-04-24-openmythos-claude-mythos-架构的开源理论重建]]
  confidence-score:: 0.85
  status:: current
	- 训练循环模型（如[[循环深度Transformer]]）存在不稳定性问题，主要有两种失败模式：
- 与Claude Mythos的关系
	- Parcae架构（Prairie等人，2026）被认为是Anthropic使[[Claude Mythos]]可训练所采用的最可能的方案。
- 这确保 `ρ(A) < 1` 始终成立，无论学习率或批次噪声如何。
- 强制 `A := Diag(-exp(log_A))`，配合一个可学习的标量Δt。
- 使用ZOH/Euler离散化方案。
- 将A参数化为连续负对角矩阵。
- 解决方案
	- 通过构造来保证稳定性：
- 其稳定性完全由矩阵A的谱半径决定：
	- `ρ(A) < 1` → 稳定收敛
	- `ρ(A) ≥ 1` → 不稳定发散
- 核心思想
	- 将循环系统重新诠释为**离散线性时不变（LTI）动力学系统**。
- **损失突刺**：训练因注入参数的谱范数过大而突然发散。
- **残差爆炸**：隐藏状态跨循环无限增长。