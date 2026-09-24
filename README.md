# 🏠 收房租（zyj-collect-rent）

一个移动端优先（H5）的房租收取记录应用，用于记录每月的 **房租、水费、电费、燃气费、垃圾清理费**，支持按月查看、按年统计、收款状态管理和本地持久化保存。

## 功能特性

- 📅 按月记录：每条记录包含月份、租客、五项费用、备注
- 💰 费用明细：房租 / 水费 / 电费 / 燃气费 / 垃圾清理费，自动合计
- ✅ 收款状态：一键切换「已收 / 未收」，月度汇总区分已收与未收
- 📊 年度统计：全年应收、各费用构成占比、12 个月明细条形图
- 🗑️ 记录管理：滑动卡片删除、点击卡片编辑、重复记录保存提醒
- 💾 数据持久化：Pinia + localStorage，数据保存在本机浏览器
- 📱 H5 适配：Vant 组件库，手机端体验优先，桌面端自动居中显示

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 框架 | Vue 3（Composition API + `<script setup>`） |
| 语言 | TypeScript |
| 状态管理 | Pinia |
| 路由 | Vue Router（hash 模式） |
| UI 组件 | Vant 4 |
| 构建 | Vite |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（局域网内可用手机访问）
npm run dev

# 类型检查 + 生产构建
npm run build

# 本地预览构建产物
npm run preview
```

## 部署到 GitHub Pages

项目已内置 `base: './'` 相对路径 + hash 路由，因此无论部署到
`https://<用户名>.github.io/<仓库名>/` 还是自定义域名，都无需额外配置。

### 方式一：脚本一键部署（推荐）

1. 将代码推送到 GitHub 仓库；
2. 本地执行：

   ```bash
   npm run deploy
   # 或 ./deploy.sh
   ```

3. 到仓库 **Settings → Pages**，选择 `Deploy from a branch`，
   分支选 `gh-pages`，目录选 `/(root)`，保存后等待几分钟即可访问。

### 方式二：纯手动部署

1. 构建产物：

   ```bash
   npm run build
   ```

2. 将 `dist` 目录里的 **全部内容** 提交到 `gh-pages` 分支：

   ```bash
   git switch --orphan gh-pages
   git rm -rf . 2>/dev/null || true
   cp -r dist/* .
   git add .
   git commit -m "deploy"
   git push origin gh-pages
   git switch main   # 或 master
   ```

3. 同样在 **Settings → Pages** 里选择 `gh-pages /(root)`。

### 方式三：只上传静态文件

如果不想开分支，也可以把 `npm run build` 生成的 `dist` 目录内容
上传到任意静态托管（GitHub 仓库的 docs 目录、Gitee Pages、Vercel、Netlify 等）。

## 数据说明

- 数据保存在浏览器 `localStorage`（键名 `zyj-collect-rent:records:v1`）；
- 清除浏览器数据会删除记录，换设备/换浏览器数据不互通；
- 后续如需多端同步，可在 `src/stores/rent.ts` 基础上接入后端接口。

## 目录结构

```
├── deploy.sh              # GitHub Pages 一键部署脚本
├── index.html
├── src/
│   ├── main.ts            # 入口：注册 Pinia / Router / Vant
│   ├── App.vue            # 布局：路由视图 + 底部 Tabbar
│   ├── router/index.ts    # 路由（hash 模式）
│   ├── stores/rent.ts     # Pinia 核心业务（CRUD + 汇总 + 持久化）
│   ├── types/index.ts     # RentRecord 类型 + 费用项配置
│   ├── utils/             # 金额格式化、ID 生成
│   ├── styles/main.css    # 全局样式与主题变量
│   └── views/
│       ├── HomeView.vue       # 月度记录列表（汇总 + 滑动管理）
│       ├── RecordFormView.vue # 新增 / 编辑表单
│       └── StatsView.vue      # 年度统计
└── vite.config.ts         # base './'，适配 GitHub Pages
```
