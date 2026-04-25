knowledge-layer:: wiki
topic:: 大模型开源

- 模型概览
  source-url:: https://mp.weixin.qq.com/s/3YAHuPi3xmSVGQs6ZkaJ_Q
  raw:: [[llm-wiki/raw/2026-04-25-deepseek-v4-开源发布-这句荀子名言-可能是对质疑最好的回应]]
  confidence-score:: 0.85
  status:: current
	- **DeepSeek-V4 Pro**: 1.6万亿总参数，每次推理激活49B参数。
- **DeepSeek-V4 Flash**: 2840亿总参数，激活13B参数。
- 上下文窗口：1百万token。
- 开源权重：[[HuggingFace]] 和 [[ModelScope]]。
- 技术报告：[[DeepSeek_V4.pdf]]。
- 架构创新
	- 采用混合注意力架构 [[CSA与HCA混合注意力架构]]。
- 使用改进的 MoE，Pro版每层384个专家，激活6个。
- 引入流形约束超连接（mHC）、Muon优化器、预见性路由（Anticipatory Routing）等。
- 性能亮点
	- 百万token长文本推理计算量仅为 V3.2 的 27%，KV缓存占用为 10%。
- KV缓存尺寸仅为传统 BF16 GQA8 方案的约 2%。
- 在中文写作、编码等任务上表现优异，Codeforces 排名第23。
- 开源地址
	- https://huggingface.co/collections/deepseek-ai/deepseek-v4
- https://modelscope.cn/collections/deepseek-ai/DeepSeek-V4
- 模型概览
  source-url:: https://mp.weixin.qq.com/s/3YAHuPi3xmSVGQs6ZkaJ_Q
  raw:: [[llm-wiki/raw/2026-04-25-deepseek-v4-开源发布-这句荀子名言-可能是对质疑最好的回应]]
  confidence-score:: 0.85
  status:: current
	- **DeepSeek-V4 Pro**: 1.6万亿总参数，每次推理激活49B参数。
- **DeepSeek-V4 Flash**: 2840亿总参数，激活13B参数。
- 上下文窗口：1百万token。
- 开源权重：[[HuggingFace]] 和 [[ModelScope]]。
- 技术报告：[[DeepSeek_V4.pdf]]。
- 架构创新
	- 采用混合注意力架构 [[CSA与HCA混合注意力架构]]。
- 使用改进的 MoE，Pro版每层384个专家，激活6个。
- 引入流形约束超连接（mHC）、Muon优化器、预见性路由（Anticipatory Routing）等。
- 性能亮点
	- 百万token长文本推理计算量仅为 V3.2 的 27%，KV缓存占用为 10%。
- KV缓存尺寸仅为传统 BF16 GQA8 方案的约 2%。
- 在中文写作、编码等任务上表现优异，Codeforces 排名第23。
- 开源地址
	- https://huggingface.co/collections/deepseek-ai/deepseek-v4
- https://modelscope.cn/collections/deepseek-ai/DeepSeek-V4