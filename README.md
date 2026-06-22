# CS2 Demo Viewer — 本地 2D 小地图回放

**双击启动，无需浏览器。** 解析 CS2 .dem 比赛录像，在原生桌面窗口中用 2D 小地图回放选手位置、移动轨迹和道具使用。

## 🚀 启动方式

### 方式 1：双击启动（推荐）

在 Finder 中双击 **`CS2 Demo Viewer.command`**

首次打开会弹出终端窗口，自动启动后台服务和原生桌面窗口。

### 方式 2：命令行

```bash
source venv/bin/activate
python launcher.py                           # 普通启动
python launcher.py /path/to/your-demo.dem    # 启动时自动加载 demo
```

### 方式 3：命令行（浏览器模式，不需要 pywebview）

```bash
source venv/bin/activate
cd backend && uvicorn main:app --port 8765
# 浏览器打开 http://127.0.0.1:8765
```

## 功能

- 🗺️ **2D 小地图回放** — 加载雷达图背景，实时显示玩家位置和移动轨迹
- 💣 **道具追踪** — 烟雾弹覆盖范围、手雷爆炸点、闪光弹位置、燃烧瓶区域
- 💀 **击杀标记** — 红色 X 标记，渐隐效果
- ⏯️ **播放控制** — 播放/暂停、0.25x–8x 调速、逐帧、回合跳转
- ⌨️ **快捷键** — Space 播放暂停、←→ 逐帧、↑↓ 回合
- 📋 **事件日志** — 点击跳转到事件时刻

## 安装

```bash
cd cs2-demo-viewer

# Python 3.11+ 环境
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

## 支持的地图

de_mirage · de_inferno · de_dust2 · de_nuke · de_ancient · de_anubis · de_overpass · de_vertigo

## 获取 Demo 文件

职业比赛 Demo 可从 [HLTV.org](https://www.hltv.org/) 下载 GOTV demo，或使用自己的比赛录像。

## 技术栈

| 层 | 技术 |
|---|---|
| Demo 解析 | awpy 2.0 (Python) |
| 后端 | FastAPI + uvicorn |
| 桌面窗口 | pywebview (macOS Cocoa WebKit) |
| 前端 | 原生 HTML/CSS/JS + Canvas |

## 项目结构

```
cs2-demo-viewer/
├── CS2 Demo Viewer.command   # 双击启动
├── launcher.py               # 原生桌面启动器
├── backend/
│   ├── main.py               # FastAPI (7 个 API 端点)
│   ├── parser.py             # awpy 封装
│   ├── map_config.py         # 8 张地图坐标
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js            # 应用控制器
│       ├── minimap.js        # Canvas 渲染引擎
│       ├── timeline.js       # 时间轴
│       └── controls.js       # 播放控制
└── maps/                     # 雷达图 PNG
```
