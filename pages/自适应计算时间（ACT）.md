- 解决的问题
  source-url:: https://mp.weixin.qq.com/s/NRVA4sDsz6hgde4RB_DXeQ
  raw:: [[llm-wiki/raw/2026-04-24-openmythos-claude-mythos-架构的开源理论重建]]
  confidence-score:: 0.85
  status:: current
	- **过度思考问题**：在[[循环深度Transformer]]中，超过一定深度后，过多的循环反而会**降低预测质量**——隐藏状态漂过解并进入噪声。
- 在Claude Mythos中的推测应用
	- [[Claude Mythos]]几乎肯定有某种机制在答案收敛时停止循环，ACT是可能的实现方式之一。
- **理论意义**：ACT机制也使模型在某些假设下具有图灵完备性。
- 优势
	- **提升推理吞吐量**：通过连续深度批处理，模型可以在不同深度处对不同token或序列提前退出。简单输入快速处理，复杂输入运行更多迭代，理论上可提升2-3倍推理吞吐量。
- 使模型能够根据输入复杂度动态调整内部计算步数。
- 核心机制
	- 模型在答案收敛时**停止循环**。
- **计算效率**：不同复杂度的输入需要不同的思考深度。