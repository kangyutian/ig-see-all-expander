# IG See All Expander

Windows 桌面版 Instagram `Suggested for you -> See all` 全量 handle 抓取工具。

程序连接本机已经登录 Instagram 的 AllweTouch、YunBrowser 或专用 Chrome，逐个处理种子账号，滚动 `Suggested for you` 弹窗到底，并导出 TXT 和 Excel。

## Windows 桌面版

普通用户推荐从 GitHub Releases 下载以下任一文件：

- `IG-See-All-Expander-Setup-x.x.x.exe`：安装版，可在安装向导中选择盘符和目录，并创建桌面和开始菜单快捷方式。
- `IG-See-All-Expander-Portable-x.x.x.exe`：免安装便携版，双击即可运行。

两个版本都已经包含运行环境，目标电脑不需要安装 Node.js，也不需要运行 `start.bat`。

第一版未使用商业代码签名证书。如果 Windows SmartScreen 显示“未知发布者”，请确认文件来自本仓库的 Releases 页面，然后点击“更多信息 -> 仍要运行”。

## 浏览器连接

### AllweTouch / YunBrowser

1. 打开 AllweTouch 或 YunBrowser。
2. 在其中登录 Instagram，并保留一个 Instagram 标签页。
3. 打开本软件，点击 `Scan`。
4. 选择显示已检测到 Session Cookie 的浏览器会话。

### 专用 Chrome

1. 点击软件中的 `Launch Chrome`。
2. 在新打开的 Chrome 窗口中登录 Instagram。
3. 回到软件点击 `Scan`。
4. 选择该 Chrome 会话后开始任务。

普通方式打开的 Chrome 默认没有调试接口，软件无法直接控制。请使用 `Launch Chrome` 启动专用窗口，或者自行使用 `--remote-debugging-port` 启动 Chrome。

软件不会保存 Instagram 密码。专用 Chrome 的 Cookie 和登录状态保存在当前 Windows 用户的本地数据目录中。

## 输入与抓取规则

支持 handle、`@handle`、Instagram profile URL、逗号、空格和换行混合输入：

```text
katenamedsue
@irainamancini
https://www.instagram.com/the_vintage_tourists/
richardheeps, kait.holt
```

每个种子账号严格执行：

```text
打开 profile
点击 Similar accounts
点击 Suggested for you 区域的 See all
确认进入 Suggested for you 弹窗
只滚动弹窗内部列表，直到滚动位置和新增 handle 都停止变化
抓取弹窗中的 profile handle
排除种子账号和 Instagram 保留路径
全局去重
导出 TXT
补充粉丝量和 bio 邮箱
导出 Excel
```

程序不会点击 `Follow`，也不会发送私信。单个账号失败时会记录日志并继续处理后续账号。

## 输出文件

- TXT：只包含 handle，每行一个，没有表头、来源或重复项。
- Excel：只包含 `handle`、`followers`、`email` 三列。
- `followers` 抓不到时写 `未知`。
- `email` 只从 Instagram bio 提取，没有时写 `没有`；多个邮箱使用 `; ` 分隔。

软件右上角提供“打开输出文件夹”和“打开日志文件夹”按钮。

桌面版数据保存在：

```text
%LOCALAPPDATA%\IG See All Expander\
├─ chrome-profile\
├─ outputs\
├─ logs\
└─ config.json
```

升级或重新安装软件不会删除这些文件。第一次从旧源码版切换到桌面版时，专用 Chrome 需要重新登录一次；AllweTouch/YunBrowser 的登录状态不受影响。

## 源码开发

源码模式需要 Node.js 22 或更高版本：

```powershell
npm install
npm run build
npm start
```

也可以双击 `start.bat`。服务启动后会生成一次性本地令牌并自动打开页面。

常用命令：

```powershell
npm test
npm run desktop
npm run pack:win
npm run dist:win
```

- `npm run desktop`：构建前端并用 Electron 启动。
- `npm run pack:win`：生成未安装的测试目录。
- `npm run dist:win`：在 `release/` 生成 Windows 安装版和便携版。

## GitHub 发布

推送 `v*` 标签时，`.github/workflows/windows-release.yml` 会在 Windows 构建机上运行测试、生成两个 `.exe` 文件和 `SHA256SUMS.txt`，并上传到对应 GitHub Release。

示例：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

也可以在 GitHub Actions 页面手动运行工作流，只生成可下载的 Workflow Artifact，不创建正式 Release。

## 常见问题

### 扫描不到浏览器

确认浏览器中已经打开 Instagram 页面。AllweTouch/YunBrowser 可以直接扫描；普通 Chrome 请使用软件中的 `Launch Chrome`。

### 某个账号抓取为 0

可能是该 profile 没有 Similar accounts、Instagram 没有展示 `See all`、页面加载受限或登录状态失效。软件会在日志中记录具体失败原因。

### 安装版提示未知发布者

这是因为第一版没有商业代码签名证书，不代表软件需要联网安装其他运行环境。请只从本仓库的 GitHub Release 下载，并可使用 `SHA256SUMS.txt` 校验文件完整性。
