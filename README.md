# Figma-To-PSD

Montry · PSD / PSB Bridge **0.1.4** 归档。

> 仓库名称保留为 Figma-To-PSD；当前插件实际方向是 **PSD / PSB → Figma**，不是 Figma 导出 PSD。

## 两个分类

- [安装包](安装包/)：可直接下载的安装 ZIP，以及展开的 manifest.json、dist/code.js、dist/ui.html 与第三方许可证。无需 Node.js。
- [源代码](源代码/)：原归档的完整 55 个文件，包含源码、依赖锁文件、构建与测试脚本、预构建产物、合成测试样例及历史测试记录。

## 本地安装

下载「安装包」中的 ZIP 并完整解压，在 Figma 桌面版 Plugins → Development → Import plugin from manifest… 中选择 manifest.json。务必保留 dist 文件夹，不要只下载 manifest.json。

## 克隆与开发

需要 Node.js 20 或更高版本。克隆仓库后进入「源代码」目录：

```bash
git clone https://github.com/montrydesigner-lab/Figma-To-PSD.git
cd Figma-To-PSD/源代码
npm ci
npm run typecheck
npm run build
npm test
```

以上是原项目开发命令，本次归档没有重新执行。详细说明与限制见[原项目 README](源代码/README.md)。

## 归档范围与验证边界

- 保留 0.1.4 的原始代码、版本和文件内容，不新增功能。
- 原始来源：Montry-PSD-PSB-Bridge-0.1.4.zip；原包 SHA-256 见 ARCHIVE_CHECKSUMS.sha256。
- 源码中的 samples 为测试脚本生成的小型 PSD / PSB fixtures，不包含个人设计稿。
- TEST_REPORT.md 与 test-output 是原包的历史记录，不代表本次运行结果；本次未运行测试或进行真实 Figma 功能验收。
- 安装 ZIP 是从原始 manifest/dist/第三方许可重新整理的安装专用包，另附安装说明；不是原始完整源码 ZIP。
- 项目原有 UNLICENSED 声明保持不变；第三方许可证见源代码或安装目录的 THIRD_PARTY_LICENSES.txt。
