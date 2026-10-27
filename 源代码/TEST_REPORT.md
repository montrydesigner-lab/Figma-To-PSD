# 0.1.6 串行多文件导入验证记录

日期：2026-10-27。基线为本机已交付的 0.1.5；开发目录为新的 task-2/Montry-PSD-PSB-Bridge-0.1.6。以下结果来自最终产品源码构建后的本次执行，不是沿用 0.1.5 记录。

## 最终命令结果

| 检查 | 结果 | 证据 |
|---|---|---|
| npm run typecheck | 通过 | final-typecheck-016.log |
| npm run build | 通过，更新 dist | final-build-016.log |
| npm test | 全部 13 个离线脚本通过 | final-offline-016.log |
| npm run test:ui | 13 组通过 | ui-tests.json / final-browser-016.log |
| npm run test:queue-ui | 15 组通过、0 失败 | queue-ui-tests.json / final-queue-browser-016.log |
| 实际 UI 审查 | 本地 Chromium 440×680，运行／字体确认／完成状态 | 内部截图，不随交付包上传 |
| 发布 ZIP | 逐文件散列、manifest 入口和 ZIP 解压字节校验 | PACKAGE_MANIFEST.json；包外 RELEASE_VALIDATION-0.1.6.json |

npm test 保留原 12 个离线脚本，新增 test-queue-host.mjs。原图片效果、文字路径、隐藏层、无对比画板等覆盖没有移除。部分旧 UI 预期按新语义调整：成功后不保留源树；预读取清除需等旧读取结束；取消需等最终回执；已成功项不因重试重复导入。

## 新增队列覆盖

- 新宿主模拟 **11 组**：单会话互斥；字体等待时取消；创建中回滚；回滚失败锁定；批次页固定／同名不重叠；成功后取消不误报；迟到 begin 防护；目标页删除；128 条轻量回执上限与淘汰；面板身份／递增序号校验；成功回执发送失败后恢复。
- 新浏览器队列模拟 **15 组**：单文件兼容／引用释放；多选只预读第一份／并发 1／重复点击；多文件拖放／同名；格式、空文件和超限元数据检查；损坏中间项失败后继续和只重试失败；字体搜索及跨文件映射；Auto 沿用原宿主算法且复用实际替代；取消等待回滚／迟到 ACK 和进度；不完整成功回执的终态核对；停止全部／重新开始；不确定回滚锁定；取消回执超时锁定；清空时读锁；pagehide 禁止后续；字体目录尚未返回时阻止过早启动。
- 既有浏览器套件新增真实小型 PSD/PSB parser 三文件流程：相同文件名、损坏中间项、后续继续、独立会话、字体映射复用。这里的“真实”仅指实际 PSD/PSB 文件字节和真实解析器；Figma 仍为模拟宿主。
- 不预读证明来自可控的未结束读取／转换／宿主请求及计数断言；引用释放证明来自 UI 状态和报告结构检查。不等同于真实浏览器堆内存曲线或即时 GC 测量。

## 继承覆盖

| 结果文件 | 分组数 |
|---|---:|
| fixture-tests.json | 4 |
| importer-tests.json | 8 |
| bridge-tests.json | 10 |
| ui-transport-tests.json | 10 |
| hidden-tests.json | 2 |
| diagnostics-tests.json | 7 |
| font-search-tests.json | 22 |
| source-reset-tests.json | 23 |
| input-guard-tests.json | 8 |
| no-reference-tests.json | 12 |

此外执行 test-raster-effects.mjs 和 test-text-paths.mjs，其成功输出保存在最终离线日志。0.1.5 的无对比画板 12 组回归继续通过：旧 includeReference:true 仍不建对比画板；图片、蒙版、文字备份、源多画板、已有用户内容保留；4 种小型 PSD/PSB／隐藏层配置下非合成图资产字节一致。

发布时核对 font-search、pipeline、normalize、png、raster、raster-effects、styles、text-paths、types 与 manifest 均和 0.1.5 字节相同，依赖图不变。importer 改动仅限目的页／画板名／提交边界、位置与回滚确认。原 0.1.5 ZIP、原 src 和 dist 另与原 ZIP 核对，保持不变。

## 执行环境与修复

使用 Windows 本地 Node.js、锁定依赖及已安装 Microsoft Edge 的 headless Chromium；浏览器测试只在进程内设置路径，不改系统环境或安全设置。esbuild 在文件沙箱内读取父目录曾报 Access denied；经工具自动审批允许本地构建／测试后通过，没有改 ACL、禁用安全机制或绕过拒绝。

测试期间修复了 FileList 在清空 input 时失效的问题、预读取清空的重叠读取风险、过早确认尚未返回字体目录、缺少终态的回执、旧回执淘汰后防重放以及成功回执发送失败的状态保留。最终日志里的 injected delivery failure 是刻意注入的通信失败断言，不是最终失败。

脚本原有自动寻找用户设计文件的分支已移除。test-fixtures/test-text-paths 只有显式 --source PATH 才读外部设计；inspect-source 必须明确给路径。本次未提供这些参数、未读取用户设计文件。

## 明确未验证

- 未安装插件、未操作真实 Figma 文档；未验证真实 Figma 渲染、真实字体服务、逐像素保真或桌面插件关闭瞬间的宿主行为。
- 未做 1.5 GB 实文件、大像素、多文件长队列压力测试；大小边界仅通过元数据和小 ZIP 声明测试，没有分配 1.5 GB。
- 关闭／清空测试验证事件和状态处理，不能保证进程被强制关闭时完成回滚。应先停止全部并等待终态再关闭。
- 释放引用不等于强制 GC，Figma 已导入图层和图像缓存持续累积。低于 1.5 GB 仍可能失败，未承诺无限文件数。
- 截图仅内部 QA；未把浏览器截图上传 Library 或加入 ZIP。Library 上传结果在主任务最终交付记录中单独确认。
