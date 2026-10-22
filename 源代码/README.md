# Montry · PSD / PSB Bridge 0.1.4

将 PSD / PSB 导入为 Figma 图层的测试版插件。文件在插件面板内解析，不调用 AI、不需要 API Key、不向外部解析服务上传设计文件。点击导入后，转换后的图层与图片会写入当前 Figma 文档。

## 0.1.4 源素材清除

源文件卡片中「更换」右侧新增 ×。点击后回到拖入区，可直接拖入下一份素材，也可重新选择同名文件。

× 只清除插件当前素材、统计、警告、映射／搜索和还原报告，不删除磁盘原文件，不删除已导入 Figma 的图层。可用字体缓存、连接状态及还原选项保留。

读取中点击 × 会作废该次读取；迟到的进度、结果或错误不会把旧素材重新显示。File.arrayBuffer 已开始的读取、以及正在占用 UI 线程的同步解压／解析不能被强制即时中断；拿回控制后会丢弃旧结果，并在进入下一阶段前检查取消。

正在导入 Figma 时 × 禁用，并提示先取消或等待完成，避免清除素材时留下未受控的导入。完成或取消后恢复。

0.1.3 的逐行字体搜索、0.1.2 的通信修复及默认跳过隐藏层均保留。

## 为什么当前限制 1.5 GB

这是插件代码主动设置的保护阈值：1,500,000,000 字节；原文件及 ZIP 解压后所选 PSD/PSB 都检查。它不是 Figma 或 PSB 格式统一规定的硬上限，也不保证所有阈值以下的文件都能成功。本版未提高此限制。

当前实现需要整份文件读入 ArrayBuffer，并为 PSB 合成预览保留源字节。ZIP 解压期间可能同时存在压缩包及解压内容；图层和蒙版解码后还要生成 RGBA 像素、PNG 编码工作数组和消息数据。磁盘上的压缩体积不等于运行中的内存。

例如 10,000×10,000 的 8 位 RGBA 单层，光像素数组就是 400,000,000 字节（约 400 MB），还没有算其他图层和临时数据。现有 2048×2048 分块是在图层像素解码之后生成，不能代替流式读取。关闭隐藏层或原稿参考图可减少相应转换工作，但不会免除整文件读取。

因此更大文件需要降低峰值内存、分段读取或更独立的解码流程，而不是只改一个数字。具体能处理多大仍取决于文件结构、像素／位深、图层、运行环境和可用内存。

参考：[Adobe 文件格式说明](https://helpx.adobe.com/photoshop/desktop/save-and-export/export-files-to-different-formats/photoshop-file-formats-overview.html)、[Blob.arrayBuffer](https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer)、[RGBA 像素数据](https://developer.mozilla.org/en-US/docs/Web/API/ImageData/data)。

## 安装与快速测试

1. 关闭旧插件，完整解压此包；Figma 桌面版 → Plugins → Development → Import plugin from manifest… → 选择本包 manifest.json
2. 打开后确认 LOCAL / 0.1.4，主程序与 UI 均为 0.1.4
3. 拖入包内的小 PSD，点击「更换」右侧 ×，确认回到拖入区；再次拖入同一个或另一个文件
4. 导入完成后再清除素材，已导入的画布内容应保留

包内包含完整源码、编译插件、小型 PSD/PSB 样例和测试记录。账号内的在线旧插件未更新，本包是本地开发插件。

## 使用

1. 在 Figma Design 中打开插件，选择或拖入一个 `.psd`、`.psb`，或只包含一个 PSD / PSB 的 `.zip`。
2. 查看画布尺寸、图层数和字体列表。电脑安装了源字体时优先自动匹配；找不到时可手动选择替代字体。
3. 默认跳过隐藏图层，保留文字像素备份和完整原稿对照。点击「导入到当前 Figma 页面」。
4. 对照「可编辑」和「原始合成预览」两个画板。下载还原报告，查看替换字体、兼容性警告和源图层参数。

不要把“原始合成预览”当作可编辑结果：它是 PSD 保存的完整合成图，单独锁定在旁边，用于核对。

## 本地安装

解压完整文件夹，在 Figma 桌面版的 **Plugins → Development → Import plugin from manifest…** 中选择根目录 `manifest.json`。`dist` 文件夹必须一起保留。安装包内已编译，无需 Node.js。

网页版如没有开发插件导入入口，使用桌面版，本包不会更新旧账号插件链接。

## 转译规则

| 内容 | 处理方式 |
|---|---|
| 整体画布、画板 | 保持 PSD 像素宽高与相对位置；画板保留裁切 |
| 分组、名称、显隐 | 重建图层树；默认跳过隐藏内容；可选择保留 |
| 文字 | 原生 Text / TextPath，可编辑；尽量映射字体、字重、字号、颜色、字距、行距、分段样式和旋转 |
| 文字效果 | 兼容的颜色叠加、渐变叠加、阴影和描边转换为原生属性；不能精确对应的参数写入报告 |
| 图片、智能对象 | 使用 PSD 内已渲染的图层缓存，编码为无损 PNG；保留当前画面像素尺寸 |
| 超大图片 | 自动拆为最大 2048×2048 的图片块，组合成一个图层容器，不缩小整张图片 |
| 普通渐变填充 | 尽量转原生渐变，也可选择以缓存图片导入；带矢量蒙版的形状优先缓存图片 |
| 位图蒙版、剪贴 | 重建图片透明度蒙版和剪贴关系；复杂交互可能近似 |
| 完整原稿 | 单独创建与源画布同尺寸的锁定对照画板 |

**Figma 没有 Photoshop 智能对象。** 导入的图片可移动、缩放和替换，但不能双击回到嵌入的 AI/PSB 内容，也不能继续编辑 Photoshop 智能滤镜。当前使用源图层在 PSD 中的缓存分辨率，不代表提取了嵌入对象内部更高分辨率的母版。

## 当前边界

- 这是 0.1.4 测试版，不能保证任意 PSD / PSB 逐像素相同。
- 缺失字体会替换；即使字体相同，Photoshop 与 Figma 的字形度量、换行和抗锯齿也可能不同。已支持连续贝塞尔文字路径；非等比文字变形、竖排、复杂基线偏移与路径区间排版仍可能近似。安装缺失源字体后，需要重新导入才能采用该字体。
- 斜面浮雕、图案叠加、复杂发光、调整图层、某些混合模式、部分描边／蒙版参数没有完整对应。警告不会被隐藏。
- 分组的颜色／渐变叠加会按组坐标传播给子层；重叠透明像素的最终合成与 Photoshop 可能不同。
- 隐藏的文字像素备份包含缓存字形和支持的烘焙叠加效果，不能替代完整原稿对照中的所有效果。
- 8 位 RGB 是主要目标。支持的 16/32 位输入会转换为 8 位 PNG，不能保留 HDR；ICC、CMYK、Lab 与其他色彩管理需要另行处理。CMYK / Lab 会明确提示先转 RGB。
- 文件安全上限 1.5 GB，单个解码图层上限 1 亿像素；实际可用大小受浏览器内存影响。PSB 格式支持不等于能处理任意尺寸的 PSB。
- 取消会撤销本轮正在创建的节点。已上传至 Figma 图片缓存的数据由 Figma 管理，不能通过插件单独清除；不会修改原 PSD / PSB。

## 开发

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run typecheck
npm run build
npm test
```

`src/pipeline.ts` 负责本地文件与 ZIP 读取；`normalize.ts` / `styles.ts` 映射源结构；`text-paths.ts` 恢复全局文字路径；`raster.ts` / `png.ts` 保留图片像素；`importer.ts` 在 Figma 中构建；`code.ts` 与 `ui.ts` 实现面板通信。

真实文件测试（在已获得该文件的机器上）：

```bash
node scripts/inspect-source.mjs /absolute/path/source.psb
node scripts/test-fixtures.mjs --source /absolute/path/source.psb
```

ag-psd 的延迟 PSB 合成图读取会丢失格式上下文。本项目保留源文件视图，使用原始上下文的第二次读取获取合成预览；回归测试覆盖此问题。

本项目用到的第三方许可证见 `THIRD_PARTY_LICENSES.txt`。依赖固定在 `package-lock.json`，发布包已内置运行所需代码。

技术参考：[Figma Plugin API](https://developers.figma.com/docs/plugins/)、[Figma 图像上限](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/)、[ag-psd 源码与版本记录](https://github.com/Agamnentzar/ag-psd)。
