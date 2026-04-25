- 概述
  source-url:: https://mp.weixin.qq.com/s/3YAHuPi3xmSVGQs6ZkaJ_Q
  raw:: [[llm-wiki/raw/2026-04-25-deepseek-v4-开源发布-这句荀子名言-可能是对质疑最好的回应]]
  confidence-score:: 0.85
  status:: current
	- DeepSeek-V4 使用两种混合注意力机制：**压缩稀疏注意力（CSA）** 和 **重度压缩注意力（HCA）**，交替排列，配合滑动窗口保留局部依赖。
- 设计细节
	- CSA：将连续4个token的KV缓存压缩为一个，通过索引器让每个query关注top-k个压缩块。
- HCA：压缩率高达128，负责全局概览。
- 两者均使用共享KV的 MQA，输出投影采用分组策略。
- 位置编码：最后64维施加 RoPE，注意力输出再以位置-i的RoPE抵消。
- 异构KV缓存：两套缓存体系（经典KV缓存和状态缓存），协同稀疏注意力内核。
- 性能收益
	- 百万token上下文中，整个注意力模块KV缓存仅为传统方案的 2%。
- 推理计算量显著降低，使长文本高效处理成为可能。
- 概述
  source-url:: https://mp.weixin.qq.com/s/3YAHuPi3xmSVGQs6ZkaJ_Q
  raw:: [[llm-wiki/raw/2026-04-25-deepseek-v4-开源发布-这句荀子名言-可能是对质疑最好的回应]]
  confidence-score:: 0.85
  status:: current
	- DeepSeek-V4 使用两种混合注意力机制：**压缩稀疏注意力（CSA）** 和 **重度压缩注意力（HCA）**，交替排列，配合滑动窗口保留局部依赖。
- 设计细节
	- CSA：将连续4个token的KV缓存压缩为一个，通过索引器让每个query关注top-k个压缩块。
- HCA：压缩率高达128，负责全局概览。
- 两者均使用共享KV的 MQA，输出投影采用分组策略。
- 位置编码：最后64维施加 RoPE，注意力输出再以位置-i的RoPE抵消。
- 异构KV缓存：两套缓存体系（经典KV缓存和状态缓存），协同稀疏注意力内核。
- 性能收益
	- 百万token上下文中，整个注意力模块KV缓存仅为传统方案的 2%。
- 推理计算量显著降低，使长文本高效处理成为可能。