# 空当接龙（FreeCell）网页版

纯 HTML + CSS + JavaScript，无需安装任何依赖。

## 运行

**在线玩**：https://clintsun1977.github.io/freecell/

本地玩：直接双击 `index.html` 用浏览器打开即可。

**iPad / iPhone 全屏玩**：在 Safari 里点"分享" → "添加到主屏幕"，之后从主屏幕的"空当接龙"图标打开，就是全屏的。
（不要用 Safari 自带的网页全屏：它会对频繁点击弹出"网站可能在诱导你输入密码"的安全警告。）

## 功能

- 经典局号发牌（与 Windows 空当接龙局号一致），可按局号选局
- 单击牌自动移到最合适的位置（收牌区 → 能接上的列 → 空列 → 空当），也可拖拽到指定位置
- 空当里的牌可以点击放回原处（前提是它原来那一列之后没被动过）
- 收牌区最上面的牌可以拿回牌局（点击接到能接的列或空列，或拖到空当）；拿回的牌不会被自动收回
- 多张连续牌一次移动（张数受空当和空列数量限制）
- 安全牌自动收到收牌区
- 无限撤销、提示、计时、步数、得分（收一张牌 +10，拿回 -10）
- 自动播放：一键把能收的牌全部收到右上角
- 右侧竖排圆形工具栏：游戏、新、撤销、提示、自动播放、得分、菜单；右上角全屏按钮
- 可添加到主屏幕，像 App 一样全屏打开（含图标与 Web App 配置）
- 胜率、最快用时、连胜统计（保存在浏览器本地）
- 音效（浏览器实时合成，无音频文件），可用顶栏按钮或 M 键静音
- 快捷键：Ctrl+Z 撤销、H 提示、A 自动播放、M 音效开关、F2 新游戏

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 页面结构 |
| `style.css` | 牌桌与牌面样式（支持深色模式） |
| `freecell.js` | 发牌、规则、拖拽、撤销、提示、统计 |
| `cards/` | 牌面素材（见下） |
| `manifest.webmanifest`、`icons/` | 添加到主屏幕用的配置和图标 |

## 牌面素材与协议

牌面来自 [SVG-cards 4.0.2](https://github.com/htdebeer/SVG-cards)（© 2005 David Bellot，© 2016–2017 Huub de Beer），采用 **LGPL-2.1** 协议，协议全文见 `cards/LICENSE`。

- `cards/svg-cards.svg`：原始素材文件
- `cards/svg-cards.js`：由上面的 SVG 打包成的 JS，使双击打开 `index.html` 时也能显示牌面

牌面点数字体为 [Playfair Display](https://fonts.google.com/specimen/Playfair+Display)（OFL 协议），通过 Google Fonts 在线加载；离线时自动退回系统衬线字体。

公开发布本游戏时，请保留 `cards/` 目录中的协议文件和本说明。
