# 设计系统 · Design system

适用于 AWS Broom 的 landing page 与应用本体。所有 token 的唯一来源是 `web/app/app.css`;本文说明每个 token 的角色和使用规则,改色先改 token,不在组件里写字面量。

## 原则

1. **墨色做动作,红色做警示,蓝色几乎不出现。** 主按钮、勾选框、当前步骤、品牌标记都用墨色(近黑 / 近白)。红色只给"确认清理"这类不可逆操作。蓝色只留在焦点环和图表里。
2. **层级靠留白和字重,不靠卡片。** 边框是 1px 细线,阴影只给真正浮起的面板(凭证表单、预览面板)。
3. **等宽字体承载 AWS 语义。** 资源 ID、区域代码、账号 ID、环境变量一律等宽,颜色比正文低一级。
4. **亮色是默认主题。** 应用不跟随系统偏好,首次打开一律亮色;用户可在页头切换暗色或跟随系统(`localStorage` 的 `broom-theme`)。每个 token 在 `:root` 与 `.dark` 各定义一次;组件只引用 token。

## 颜色

### 表面与文字

| Token | 角色 | Light | Dark |
|---|---|---|---|
| `--background` | 页面底色 | `oklch(0.9581 0 0)` | `oklch(0.1776 0 0)` |
| `--card` | 浮起面板、表单、导航 | `oklch(0.9774 0.0042 236.50)` | `oklch(0.2638 0.0024 247.92)` |
| `--muted` | 次级底色:输入框底、标签、代码内联 | `oklch(0.9209 0.0128 244.26)` | `oklch(0.2171 0.0025 247.94)` |
| `--foreground` | 正文 | `oklch(0.3134 0.0234 253.63)` | `oklch(0.7905 0.0126 259.82)` |
| `--card-foreground` | 标题与强调文字(墨色) | `oklch(0.2022 0.011 151.16)` | `oklch(0.9755 0.0045 258.32)` |
| `--muted-foreground` | 辅助说明、区域代码、页脚 | `oklch(0.55 0.008 220)` | `oklch(0.68 0.0125 239.97)` |
| `--border` | 分隔线、卡片描边、未选中勾选框 | `oklch(0.884 0.0067 208.78)` | `oklch(0.3306 0.0066 248.02)` |
| `--input` | 输入框描边(比 `--border` 略深一级,不再更深) | `oklch(0.85 0.009 240)` | `oklch(0.39 0.008 248)` |

### 动作与状态

| Token | 角色 | Light | Dark |
|---|---|---|---|
| `--primary` | 主动作:实心按钮、勾选、当前步骤、品牌标记、进度条 | `oklch(0.2022 0.011 151.16)` 墨 | `oklch(0.9755 0.0045 258.32)` 近白 |
| `--primary-foreground` | 主动作上的文字 | `oklch(0.9774 0.0042 236.50)` | `oklch(0.1776 0 0)` |
| `--destructive` | 不可逆操作、高风险标记、失败 | `oklch(0.55 0.19 27)` | `oklch(0.6368 0.2078 25.33)` |
| `--ok` | 成功、临时凭证指示点 | `oklch(0.52 0.13 150)` | `oklch(0.75 0.14 150)` |
| `--warn` | 警告、长期密钥指示点、中风险 | `oklch(0.6 0.13 70)` | `oklch(0.8 0.13 75)` |
| `--ring` | 键盘焦点环(唯一的蓝) | `oklch(0.6112 0.1217 248.96)` | `oklch(0.6576 0.1208 252.08)` |
| `--code` / `--code-foreground` | 代码块底 / 字(两种主题都是深色) | `oklch(0.2338 0.0067 258)` / `oklch(0.9 0.01 250)` | `oklch(0.14 0.004 250)` / `oklch(0.86 0.01 250)` |

半透明用法固定为三档:`/8` 做信息底色,`/12` 做状态徽标底色,`/15` 做已完成步骤底色。例:`bg-ok/12 text-ok`、`bg-destructive/12 text-destructive`。

### 不要做的事

- 不用 `text-primary` 给标签、eyebrow、链接上色。标签用 `text-muted-foreground`,链接用 `text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground`。
- 不引入第二个强调色。图表 `--chart-*` 是例外,仅用于数据。
- 不在组件里写 `#hex` 或 `oklch()` 字面量(地图底图的陆地色除外,见 `regions.tsx`)。

## 字体

| 角色 | 字体 | 说明 |
|---|---|---|
| 正文 / 界面 | Inter Variable,回退 PingFang SC / Noto Sans SC | `letter-spacing: -0.011em` |
| 标题 | 同 Inter,`font-semibold`(600),不用 700 | `letter-spacing: -0.02em ~ -0.03em`,`text-wrap: balance` |
| 数据 / 代码 | ui-monospace(应用)· JetBrains Mono(landing) | 资源 ID、区域、账号、命令 |

型号(landing 用满,应用取前半):

| 用途 | 大小 | 行高 |
|---|---|---|
| Hero 标题 | `clamp(38px, 5.6vw, 64px)` | 1.08 |
| 段落标题 | `clamp(28px, 3.4vw, 40px)` | 1.15 |
| 页面标题(应用) | 36px | 1.12 |
| 导语 | 17–20px | 1.6 |
| 正文 | 15–16px | 1.65 |
| 辅助 | 13–14px | 1.55 |
| 等宽数据 | 12–13px | 1.5 |

数字对齐一律 `tabular-nums`(`@utility tabular`)。

## 间距与形状

| Token | 值 | 用途 |
|---|---|---|
| `--radius` | `0.625rem`(10px) | 按钮、输入框(`rounded-lg`) |
| `rounded-md` | 8px | 徽标、小控件 |
| `rounded-xl` | 14px | 代码块 |
| `rounded-2xl` | 18px | 浮起面板 |
| 段落间距(landing) | 140px | 段与段 |
| 段落间距(应用) | 40px | 向导步骤内的分组 |
| 内容列宽 | 1120px(landing)· 1440px(应用) | 两侧 24px / 20px 内边距 |
| 正文列宽 | ≤ 34em | 导语与说明文字 |

## 阴影

| Token | 用途 |
|---|---|
| `--shadow-xs` | 品牌标记、账号胶囊 |
| `--shadow-sm` | 导航切换、下拉菜单 |
| `--shadow-md` | 地图上的浮层、弹出层 |
| `--shadow-lg` | 凭证表单、Review 预览面板 |
| `--shadow-xl` / `2xl` | 对话框 |

两层结构:1px 贴地线 + 大半径、负 spread 的柔和投影。暗色主题只加深 alpha,不改结构。

## 组件规则

- **按钮**:`default` 实心墨色;`outline` 卡片底 + 输入框描边;`ghost` 无底;`destructive` 红底 12% 的柔和样式,只有最终"确认清理"用实心红。高度 36 / 40 / 48。
- **链接**:正文色 + 细线下划线,hover 时下划线变深;不用蓝色。
- **勾选框**:未选 `border-border`;选中墨底白勾。不可勾选项整行降为 `muted-foreground`,并加"当前身份"胶囊。
- **步骤条**:已完成 `bg-primary/15 text-primary`,当前 `bg-primary text-primary-foreground`,最后一步(清理)当前时改用 `destructive`。
- **徽标**:状态色 `/12` 底 + 同色字;风险 低 `ok` / 中 `warn` / 高 `destructive`。
- **代码块**:`bg-code text-code-foreground`,`rounded-xl`,右上角复制按钮;注释行用 60% 亮度。
- **面板**(表单、预览):`bg-card border-border rounded-2xl shadow-lg`;内部行用 1px `border-border` 分隔,不用嵌套卡片。
- **导航**:`bg-background/82 backdrop-blur`,高 56–68px,右侧只放语言切换与一个主按钮。

## 图标与标签

- **可选择的单位是服务分组,分组名永远是文字标签。** 图标不承担识别职责,只作为分组成员的预览:最多叠放 4 个官方 AWS 图标,多出的用 `+N`。
- **展开即学习。** 点击分组头部展开成员列表,每行 = 服务图标 + 服务名 + 该服务下的资源类型 slug。新用户在需要做决定的地方看到图标与名称的对应关系,而不是靠 tooltip 猜。
- **没有官方图标的资源类型归到它所属的服务图标下**(如 `launch-template` 归 EC2 Auto Scaling)。真正没有图标的服务用双字母 monogram 方块(`--muted` 底、等宽字体),保持行结构一致。
- 图标一律带 `title` / `alt`,鼠标悬停可见名称;不使用只有图标没有任何文字的控件。

## 动效

只有 hover / focus 的 150ms 颜色过渡,以及进度条 300ms 宽度过渡。不做入场动画、打字效果或循环演示;`prefers-reduced-motion` 时进度条条纹也停止。
