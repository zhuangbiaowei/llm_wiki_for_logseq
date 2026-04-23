# llm_wiki_for_logseq

[English](./README.en.md)

一个基于 Logseq 的 LLM Wiki 实验仓库。

这个仓库同时包含三部分内容：

- `pages/` 和 `journals/`：Logseq 图谱中的页面与日志内容
- `plugins/llm-wiki/`：Logseq 插件源码，用来把笔记整理成可链接、可扩展的 wiki 结构
- GitHub Pages 静态站点生成配置：把当前图谱渲染成可直接浏览的网页

当前示例内容以“苏联海军”主题为主，包含舰队、人物、兵种和相关原始资料页。

## 目录结构

```text
.
├─ pages/                  Logseq 页面
├─ journals/               Logseq 日志
├─ logseq/                 Logseq 本地配置
├─ plugins/llm-wiki/       Logseq 插件源码
├─ template/               GitHub Pages 模板
├─ assets/                 静态站点资源
├─ gen.rb                  站点生成入口
└─ logseq.toml             站点生成配置
```

## 本地开发

### 1. 开发 Logseq 插件

进入插件目录：

```bash
cd plugins/llm-wiki
npm install
npm run dev
```

可用命令：

```bash
npm run build
npm run test
npm run lint
```

### 2. 本地生成静态站点

在仓库根目录执行：

```bash
bundle install
bundle exec ruby gen.rb
```

生成后的文件位于：

```text
site/
```

## GitHub Pages

仓库已经包含 GitHub Actions 工作流：

```text
.github/workflows/gh-pages.yml
```

工作流会在 `main` 分支更新后自动：

1. 安装 Ruby 依赖
2. 执行 `bundle exec ruby gen.rb`
3. 将生成结果发布到 `gh-pages` 分支

第一次启用时，需要在 GitHub 仓库中确认：

- `Settings` -> `Actions` -> `General` 中允许工作流写入仓库
- `Settings` -> `Pages` 中启用 Pages

## 说明

- `site/` 是生成产物，不提交到仓库
- `plugins/llm-wiki/dist/` 和 `node_modules/` 已被忽略
- 站点模板目前是轻量实现，重点是稳定渲染 Logseq 内容和页面关系

## License

MIT
