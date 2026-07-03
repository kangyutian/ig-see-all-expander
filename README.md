# IG See All Expander

本地 Instagram `Suggested for you -> See all` 全量 handle 抓取小程序。

## 启动方式

双击 `start.bat`。网页打开后访问：

```text
http://127.0.0.1:4761
```

首次启动会自动安装依赖、构建前端并启动本地服务。

## 浏览器连接

程序支持两种浏览器来源：

1. `AllweTouch / YunBrowser`
   - 打开 AllweTouch / YunBrowser。
   - 在里面登录 Instagram。
   - 回到小程序点击 `Scan`。
   - 程序会自动读取 `DevToolsActivePort` 并识别可控制的 Instagram 会话。

2. `Chrome`
   - 普通已经打开的 Chrome 默认没有调试接口，程序不能直接接管。
   - 推荐点击小程序里的 `Launch Chrome`。
   - 程序会打开一个专用 Chrome 窗口，并自动配置调试端口。
   - 在这个新 Chrome 窗口里登录 Instagram，然后回到小程序点击 `Scan`。

专用 Chrome 的登录状态会保存在小程序目录下的 `chrome-profile/`。程序不会保存 Instagram 密码，只保存浏览器自己的 Cookie 和登录状态。

如果你已经手动用 `--remote-debugging-port` 启动了 Chrome，小程序也会在扫描时自动识别。

## 输入格式

支持 handle、`@handle`、Instagram profile URL、逗号、空格和换行混合输入：

```text
katenamedsue
@irainamancini
https://www.instagram.com/the_vintage_tourists/
richardheeps, kait.holt
```

## 抓取规则

程序会逐个种子账号执行：

```text
打开 profile
点击 Similar accounts
点击 Suggested for you 区域的 See all
进入 Suggested for you 弹窗
滚动弹窗内部列表到底
抓取弹窗中的 profile handle
全局去重
导出 TXT
补充粉丝量和 bio 邮箱
导出 Excel
```

程序不会点击 `Follow`，不会发送私信，也不会接管登录密码。

## 输出文件

网页完成后会出现两个下载按钮：

- `TXT`：只包含 handle list，每行一个，没有表头。
- `Excel`：包含三列：

```text
handle | followers | email
```

Excel 默认只包含拓展出来的账号，不包含输入的种子账号。

- `followers`：优先从 Instagram profile API 获取；抓不到时写 `未知`。
- `email`：只从 Instagram bio 文本提取；没有邮箱时写 `没有`。
- 如果 bio 里有多个邮箱，会用 `; ` 分隔。

服务端也会在 `outputs/` 目录保留同一份 TXT 和 Excel 文件。

## 换电脑使用

复制整个 `ig-see-all-expander` 文件夹到另一台 Windows 电脑。

目标电脑需要：

- 已安装 Node.js LTS。
- 已安装 AllweTouch / YunBrowser 或 Google Chrome。
- 在对应浏览器里登录 Instagram。

换电脑后直接双击 `start.bat`。如果使用 Chrome，点击 `Launch Chrome` 后需要在新窗口重新登录 Instagram。

## 常见问题

### 扫描不到 AllweTouch

确认 AllweTouch / YunBrowser 已打开，并且里面有已登录的 Instagram 页面。然后回到小程序点击 `Scan`。

### 普通 Chrome 为什么扫描不到

普通 Chrome 默认不会开放 CDP 调试端口，所以小程序不能直接控制。请点击 `Launch Chrome`，使用程序启动的专用 Chrome 窗口。

### 扫描到了 9222 但不是 Chrome

有些 Electron 软件也会占用 9222 端口。小程序会显示浏览器类型和 Instagram 标签页数量，默认优先选择已登录 Instagram 的 AllweTouch/YunBrowser/Chrome 会话。

### 某个账号抓取为 0

常见原因：

- 该 profile 没有 Similar accounts 入口。
- Instagram 没有展示 `See all`。
- 页面加载慢或被限制。
- 当前登录状态失效。

程序会记录日志并继续跑后面的账号。
