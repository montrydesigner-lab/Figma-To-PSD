# 0.1.6 GitHub 发布与开发交接

最新源码位于[源代码](源代码/)，展开安装入口位于[安装包/Montry-PSD-PSB-Bridge-0.1.6](安装包/Montry-PSD-PSB-Bridge-0.1.6/)。

[下载公开ZIP](安装包/Montry-PSD-PSB-Bridge-0.1.6.zip)，大小373366字节；SHA-256：

`bb8cf8257503a5c795deb028e6c3dd27a8f3c6f29901a84b04de20b1b7b8c4af`

公开ZIP仅脱敏HANDOFF-0.1.6.md并更新PACKAGE_MANIFEST.json，其他所有文件（包括src、dist、manifest、依赖锁、脚本与测试结果）和已交付版本完全相同。原Library包373388字节、SHA-256为3aa243b112462a402f1b3ed32cc70080428abef638a125a3c4a347c995a6b39b，保持不变，勿混淆两个ZIP散列。

## 功能与限制

- 多选／拖放后并发度1串行导入，失败跳过汇总、失败项重试、同批字体映射复用，新缺失字体待确认。
- 不创建额外原始合成预览对比画板；可编辑内容、源图片／蒙版／文字备份和多画板保留。
- 取消当前与停止全部等待当前会话和回滚终态后再继续；已成功内容保留，不确定终态锁定队列。
- 每文件1,500,000,000字节，低于阈值也可能失败；插件必须保持打开。实际Figma内容和缓存会累积，不保证无限数量或即时GC。
- 最终本地typecheck/build、13个离线脚本、13组既有浏览器、15组队列浏览器测试通过。真实Figma导入／渲染、真实大文件和长队列压力未验证。

## 开发入口

详见[可移植技术交接](源代码/HANDOFF-0.1.6.md)、[使用和开发说明](源代码/README.md)、[测试报告](源代码/TEST_REPORT.md)。源代码/dist均为当前0.1.6，不要混入历史安装目录的0.1.4产物。源码目录可执行npm ci、npm run typecheck、npm run build、npm test；浏览器回归需Playwright/Chromium。

本次从main的2b9cfce2bb6961d5b2b23c2f190ed3124ba32587正常追加；保留旧安装包，旧独有测试日志按原blob移动到history-0.1.4。校验入口：[文件清单](RELEASE_FILES-0.1.6.json)、[ZIP校验](安装包/SHA256SUMS-0.1.6.txt)、[发布验证](安装包/RELEASE_VALIDATION-0.1.6.json)。CI状态以提交后实际检查为准。

下一步：获得明确测试文档和样例授权后，再做真实Figma三文件、同名、字体、取消、切页验收；大文件和有限长队列另行测峰值内存，不以磁盘体积承诺成功。
