knowledge-layer:: wiki
topic:: 人工智能架构

- 核心概念
  source-url:: https://mp.weixin.qq.com/s/NRVA4sDsz6hgde4RB_DXeQ
  raw:: [[llm-wiki/raw/2026-04-24-openmythos-claude-mythos-架构的开源理论重建]]
  confidence-score:: 0.85
  status:: current
	- 循环深度Transformer（Recurrent-Depth Transformer, RDT），也称为循环Transformer（Looped Transformer, LT）。
- [[Claude Mythos]]
- [[自适应计算时间（ACT）]]
- 相关概念
	- [[Parcae架构]]
- **参数效率**：一个k层、循环L次的模型，能达到kL层非循环模型的质量，而只需k层的参数量。内存占用不随推理深度增长；推理时计算量随循环数而非模型大小扩展。
- **潜在思维作为隐式CoT**：每次循环迭代在功能上等价于链式思维的一步，但在连续潜在空间而非token空间中运行。运行T次循环的模型隐式模拟了T步CoT推理。
	- 连续潜在思维可以同时编码多个候选的下一步，使模型在收敛前能在推理空间中进行类似广度优先搜索的探索。
- **深度外推**：在5步推理链上训练，用10步推理链测试，普通Transformer失败，循环Transformer成功——通过在推理时运行更多循环来实现。推理时循环数更多 = 推理链更深 = 解决更难的问题。
- 优势
	- **系统性泛化**：普通Transformer无法以训练时从未见过的方式组合知识，而循环Transformer可以。这种能力通过一个三阶段grokking过程涌现：记忆 → 分布内泛化 → 系统性泛化（突然涌现，而非渐进式出现）。
- **Coda（尾声层）**：标准Transformer层，只运行一次。
- **Recurrent Block（循环块）**：被循环T次，每次迭代以隐藏状态h和输入注入e进行更新。
	- 更新规则：`h_{t+1} = A·h_t + B·e + Transformer(h_t, e)`
	- 将输入注入e在每一步注入，是防止模型“漂移”的机制，使原始输入信号在整个循环深度中保持存活。
- **Prelude（前奏层）**：标准Transformer层，只运行一次。
- 架构组成
	- 一个典型的循环深度Transformer结构分为三个功能模块：
- 所有推理都在**单次前向传播中静默完成**，在连续的潜在空间中进行。
- 没有中间token输出。
- 与链式思维（CoT）的区别
	- **不是**链式思维（Chain-of-Thought）。
- 权重相同，但循环更多，思考更深。
- 核心思想：不是通过堆叠数百个独立层来实现深度，而是**复用同一组层**，在每次前向传播中**运行多次**。