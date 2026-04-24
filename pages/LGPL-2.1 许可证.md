knowledge-layer:: wiki
topic:: 开源合规

- 主要要求
  source-url:: https://mp.weixin.qq.com/s/a0kW5Pjo83adkrBDINdprg
  raw:: [[llm-wiki/raw/2026-04-24-开源合规场景100问-第1问-使用lgpl代码被审计出风险-应如何规避风险]]
  confidence-score:: 0.85
  status:: current
	- LGPL 属于 Copyleft 类许可证，但相对于 GPL 的强 Copyleft，LGPL 是弱 Copyleft 许可证。
- 在商业软件的终端用户协议中，删除禁止用户逆向工程的条款，或增设例外情形（满足 LGPL 2.1 第 6 条）。
- 其他合规要求
	- 以显著方式声明商业软件使用了该开源库，展示版权声明、提供许可证副本。
- 具体区分三种使用场景：
	- **复制、合并或修改源代码**：该部分代码须适用 LGPL。
	- **动态链接**：专有软件部分及整个商业软件无需适用 LGPL。
	- **静态链接**：需提供“最小源代码”，分发应用程序代码（源码或目标码），并确保用户修改 LGPL 库后仍可与应用程序重新组合（重新链接）。
- 允许商业软件通过“类库引用”的方式使用 LGPL 库，而不强制整个软件适用 LGPL。