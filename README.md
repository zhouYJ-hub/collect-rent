# 🏠 收房租（zyj-collect-rent）

一个移动端优先（H5）的房租收取记录应用，用于记录每月的 **房租、水费、电费、燃气费、垃圾清理费**，支持按月查看、按年统计、收款状态管理和本地持久化保存。

## 功能特性

- 📅 按月记录：每条记录包含月份、租客、五项费用、备注
- 💰 费用明细：房租 / 水费 / 电费 / 燃气费 / 垃圾清理费，自动合计
- ✅ 收款状态：一键切换「已收 / 未收」，月度汇总区分已收与未收
- 📊 年度统计：全年应收、各费用构成占比、12 个月明细条形图
- 🗑️ 记录管理：滑动卡片删除、点击卡片编辑、重复记录保存提醒
- 📤 分享账单：一键生成文字账单发给租客（系统分享 / 复制到微信）
- 📷 抄表拍照识别：水/电/气支持拍照上传，本地 OCR 自动识别读数，自动带出上月读数，按「(本次-上次)×单价」算费并显示公式
- 💾 数据持久化：Pinia + localStorage，数据保存在本机浏览器
- ☁️ 云同步：数据同步到你自己的 GitHub 私有仓库（打开自动拉取、增删改自动上传、多设备按最后修改时间合并）
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

## ☁️ 云同步（免费云端存储）

应用内置「GitHub 私有仓库」云同步：数据以 JSON 文件存在**你自己的私有仓库**里，
免费、无需自建服务器，与 GitHub Pages 部署天然搭配。

### 配置步骤

1. 在 GitHub 新建一个**私有仓库**（如 `rent-data`），专门存数据；
2. 创建 Fine-grained Personal Access Token：
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access：只勾选该私有仓库
   - Permissions → Repository permissions → **Contents：Read and write**
3. 打开 App 底部「云同步」页，填写用户名 / 仓库名 / 分支（默认 `main`）/
   文件路径（默认 `data/records.json`）/ Token，保存；
4. 点击「**立即同步**」，之后也可开启「修改后自动同步」。

### 同步规则（准实时双向）

- 同步 = 云端 ⇄ 本机**双向合并**：按记录 `id` 对齐，`updatedAt` 较新的一方胜出；
- **打开网页自动拉取**云端最新数据（静默合并，不弹提示）；
- **切回页面自动刷新**（5 分钟节流），多设备互取最新；
- 新增 / 修改 / 删除 / 标记收款后**自动上传**（开启「修改后自动同步」，3 秒防抖）；
- **删除可同步**：采用软删除墓碑机制，A 设备删除后 B 设备同步时同样删除，且不会被云端数据「复活」；
- 在新手机 / 新浏览器填入同一配置，打开即自动恢复全部数据；

### 常见报错排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 404 | Token 没勾选 `rent-data` 仓库 | 编辑 Token，Repository access 勾选 `rent-data` |
| 404 | `rent-data` 是空仓库（无 main 分支） | 打开仓库页点 “Add a README file”，或改配置里的分支名 |
| 401/403 | Token 过期或没给 Contents 读写权限 | 重新生成 Token 并在云同步页更新 |
| 409 | 云端刚被其他设备修改 | 再点一次同步（会自动合并） |
- Token 只保存在本机浏览器 localStorage，**不会打进网页代码**；建议只授权单个私有仓库，泄露影响可控；
- GitHub API 免费额度为认证后 5000 次/小时，个人记账场景绰绰有余。

### 其他免费云端方案对比

| 方案 | 免费额度 | 优点 | 注意 |
| --- | --- | --- | --- |
| **GitHub 私有仓库（本项目内置）** | 完全免费 | 零额外服务、配置简单、数据自主可控 | 非实时；需自建 Token；本质是文件存储 |
| Supabase | 500MB 数据库 + 认证 | 真正的数据库、SQL、多端实时 | 国内直连延迟较高 |
| Firebase Firestore | 1GB 存储 + 5万读/天 | 实时同步强、SDK 成熟 | 国内访问受限 |
| Cloudflare Workers + D1/KV | 10 万请求/天 | 边缘节点速度快 | 需自己写后端接口 |
| LeanCloud | 有限免费额度 | 国内访问稳定 | 免费额度小、需实名认证 |

> 当前项目的数据层集中在 `src/stores/rent.ts`（读取/合并/写入）与
> `src/stores/sync.ts`（云端传输），想换成 Supabase 等方案时，
> 只需替换 `sync.ts` 里的 `fetchRemote` / `pushRemote` 实现。

## 部署到 GitHub Pages

项目已内置 `base: './'` 相对路径 + hash 路由，因此无论部署到
`https://<用户名>.github.io/<仓库名>/` 还是自定义域名，都无需额外配置。

线上地址：<https://zhouyj-hub.github.io/collect-rent/>

### 方式零：GitHub Actions 自动部署（推荐 ✅）

仓库已内置工作流 `.github/workflows/deploy.yml`，**只要把代码推送到 `main`
分支，就会自动构建并发布到 GitHub Pages**，无需任何手动操作。

```bash
git add .
git commit -m "xxx"
git push
# 推送后到仓库 Actions 页查看进度，完成后自动上线
```

- 也可在 **Actions → Deploy to GitHub Pages → Run workflow** 手动触发；
- **首次使用需手动开启一次**：到 **Settings → Pages**，在
  Build and deployment → Source 选择 **GitHub Actions** 并保存；
  之后每次推送全自动部署，无需再管；
- 若 Actions 报 `Resource not accessible by integration`，说明还没做上面这步
  （`GITHUB_TOKEN` 无权首次创建 Pages 站点，属正常限制）。

### 方式一：脚本一键部署

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

## 📷 抄表拍照识别说明

- 水/电/气费用支持两种模式：**直接填金额**（默认）或打开「**按读数计算**」开关；
- 抄表模式下：点「拍照识别」拍摄表盘 → 浏览器本地 OCR（Tesseract.js）识别数字并预填「本次读数」，
  **识别结果务必人工核对**；照片压缩后随记录保存，并同步到云端仓库；
- 「上次读数」「单价」会根据**同租客上一次记录**自动带出，也可点 ↻ 手动刷新；
- 费用公式实时展示：`🧮 (本次读数 - 上次读数) × 单价 = 金额`，分享给租客的账单也会附带公式；
- OCR 组件按需从 jsDelivr CDN 加载（仅首次），识别完全在本地完成，照片不会上传第三方；
  若网络不佳加载失败，手动输入读数即可，其余功能不受影响。

## 数据说明

- 本地数据保存在浏览器 `localStorage`（键名 `zyj-collect-rent:records:v1`）；
- 云同步配置与 Token 保存在 `zyj-collect-rent:sync:v1`；
- 建议开启「云同步」，避免清除浏览器数据导致记录丢失；
- 抄表照片已压缩（约 50~150KB/张）随记录存储，长期大量记录会占用 localStorage（约 5MB 上限）与云端文件体积，可按需删除旧照片；
- 换设备 / 换浏览器时，在新环境配置同一 GitHub 仓库并点同步即可恢复。

## 目录结构

```
├── deploy.sh              # GitHub Pages 一键部署脚本
├── index.html
├── src/
│   ├── main.ts            # 入口：注册 Pinia / Router / Vant
│   ├── App.vue            # 布局：路由视图 + 底部 Tabbar
│   ├── router/index.ts    # 路由（hash 模式）
│   ├── stores/rent.ts     # Pinia 核心业务（CRUD + 汇总 + 持久化）
│   ├── stores/sync.ts     # GitHub 私有仓库云同步（拉取/合并/上传）
│   ├── types/index.ts     # RentRecord 类型 + 费用项配置
│   ├── utils/             # 金额格式化、ID 生成、账单文案、剪贴板
│   ├── styles/main.css    # 全局样式与主题变量
│   └── views/
│       ├── HomeView.vue       # 月度记录列表（汇总 + 滑动管理）
│       ├── RecordFormView.vue # 新增 / 编辑表单
│       ├── StatsView.vue      # 年度统计
│       └── SyncView.vue       # 云同步配置与操作
└── vite.config.ts         # base './'，适配 GitHub Pages
```
