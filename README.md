# Figma-To-PSD

Montry · PSD / PSB Bridge 最新版本：**0.1.6**（2026-10-27）。仓库名称保留为 Figma-To-PSD；插件方向是 **PSD / PSB → Figma**。

## 版本导航

| 入口 | 内容 |
|---|---|
| [下载 0.1.6 完整 ZIP](安装包/Montry-PSD-PSB-Bridge-0.1.6.zip) | 推荐：可安装插件、源码、合成样例、操作说明与测试记录 |
| [0.1.6 展开安装目录](安装包/Montry-PSD-PSB-Bridge-0.1.6/) | manifest、已编译 dist 与许可证，必须一起下载 |
| [当前源码与使用说明](源代码/) | 当前 0.1.6，源代码/dist 也已同步，不混用旧 UI／主程序 |
| [开发交接](HANDOFF-0.1.6.md) | 可移植交接、发布边界与下一步验收 |
| [测试报告](源代码/TEST_REPORT.md) | 本次实际执行结果及未验证范围 |
| [发布校验](安装包/RELEASE_VALIDATION-0.1.6.json) | ZIP SHA-256、大小与本地验证结论 |
| [历史 0.1.4 安装 ZIP](安装包/Montry-PSD-PSB-Bridge-0.1.4-install.zip) | 历史版本保留，不作为最新安装入口 |

0.1.5 是本次本机基线；其“不再创建额外原始合成预览对比画板”的行为已继承到 0.1.6。当前仓库历史中保留的安装版本是 0.1.4，不将不存在的远端 0.1.5 包列为下载入口。

## 0.1.6

- 一次拖入／多选多个 PSD、PSB 或每包含一个源文件的 ZIP，并发度固定为 **1**，自动逐个导入。
- 队列显示状态与总／当前进度，单文件失败继续、结束汇总、失败项重试。
- 取消当前与停止全部分开；等待当前导入及回滚终态确认后才继续，已成功内容保留，结果不确定时暂停／锁定。
- 同批字体映射复用，新缺失字体再确认；保留搜索、× 清除、源多画板、图片／蒙版／文字备份。
- 按文件名组织新可编辑画板，重名编号，不覆盖已有内容；不再创建额外对比画板。

每文件仍限 **1,500,000,000 字节（1.5 GB）**，小于上限不保证成功。待处理文件不同时解码，每文件结束释放可释放引用，但 Figma 已导入节点和图片缓存仍累积。插件必须保持打开，关闭插件或 Figma 后不会继续运行；没有无限文件数量保证。

## 安装与开发

完整解压最新 ZIP，在 Figma 桌面版 Plugins → Development → Import plugin from manifest… 选择根部 manifest.json，确认 LOCAL / 0.1.6。不要单独下载 manifest，也不要混用旧 dist。

开发需要 Node.js 20+：进入“源代码”，执行 npm ci、npm run typecheck、npm run build、npm test。浏览器回归另执行 npm run test:ui 与 npm run test:queue-ui，需要已有 Playwright 和 Chromium；详见[说明](源代码/README.md)。

最终本地验证：类型检查／构建、13 个离线脚本、13 组既有浏览器回归、15 组队列浏览器测试通过。**真实 Figma 导入／渲染、大文件与长队列压力测试尚未执行**；模拟通过不等于真实 Figma 验收。

本次发布复用已交付并验证的插件产物，不重新开发功能。公开ZIP仅对交接文档移除本机路径并更新包内清单，使用独立SHA-256；src、dist、测试脚本及结果与已测版本字节相同，原Library ZIP保持不变。源码和 ZIP 的来源关系见[仓库文件清单](RELEASE_FILES-0.1.6.json)。samples 仅为合成小样例。UNLICENSED 与第三方许可保持原样。

根部 ARCHIVE_CHECKSUMS.sha256 是 [0.1.4 原归档提交](https://github.com/montrydesigner-lab/Figma-To-PSD/commit/2b9cfce2bb6961d5b2b23c2f190ed3124ba32587) 的历史清单，不用于校验当前源代码；0.1.4 特有测试记录移至源代码/test-output/history-0.1.4/。
