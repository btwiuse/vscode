# build/next — 新构建管线

`build/next/index.ts` 是绕开 gulp + tsb 的全新构建管线，直接用 esbuild 从 TypeScript 源码 bundle，NLS 作为 esbuild plugin 实现。不再依赖 `typescript` npm 包做 emit 或 source map 生成。

## 基本用法

```bash
# transpile：单文件快速转译（esbuild）
npx tsx build/next/index.ts transpile [--out <dir>] [--watch] [--exclude-tests]

# bundle：从源码直接 bundle（esbuild）
npx tsx build/next/index.ts bundle --target <target> [--nls] [--minify] [--mangle-privates] [--out <dir>]
```

### Target 选项

| target | 说明 |
|---|---|
| `desktop` | Electron 桌面端（默认） |
| `server` | REH server（无 UI） |
| `server-web` | REH web server（含 browser shell + workbench） |
| `web` | CDN 部署（workbench + workers，无 browser shell） |
| `web-only` | 独立 web 构建（browser shell + workbench，等价于旧 `yarn gulp vscode-web-only`） |

## 实测耗时

在 M 系列 Mac 上，7040 个 TS 文件：

| 阶段 | 耗时 | 说明 |
|---|---|---|
| transpile | ~7s | esbuild 单文件转译 + 复制非 TS 资源 |
| bundle (web-only) | ~6s | 12 个 entry points，直接从 TS 源码 bundle |
| bundle (web, nls) | ~81s | 12 个 entry points，19386 条 NLS 消息 |
| bundle (web, nls, minify) | 更久 | 加上 terser minify |

对比旧管线：

| 旧管线 | 新管线 | 提速 |
|---|---|---|
| `yarn gulp vscode-web-only` ~22s（esbuild transpile + rspack bundle） | `bundle --target web-only` ~6s | **~3.5x** |

## 常用命令示例

```bash
# 等价于 yarn gulp vscode-web-only（推荐）
npx tsx build/next/index.ts bundle --target web-only --out ../vscode-web-only

# 带 NLS 的 web-only build
npx tsx build/next/index.ts bundle --target web-only --nls --out ../vscode-web-only

# 完整 production build（NLS + minify + source map CDN）
npx tsx build/next/index.ts bundle --target server-web --nls --minify \
  --source-map-base-url "https://main.vscode-cdn.net/sourcemaps/${commit}/core" \
  --out out-vscode-web-min

# Desktop build（含 NLS + mangling）
npx tsx build/next/index.ts bundle --target desktop --nls --mangle-privates

# Watch mode（transpile only）
npx tsx build/next/index.ts transpile --watch --out out
```

## 输出结构（`--target web-only`）

```
../vscode-web-only/
├── vs/
│   ├── code/browser/workbench/
│   │   ├── workbench.js              # browser shell bundle（34MB）
│   │   ├── workbench.js.map
│   │   ├── workbench.css
│   │   ├── workbench.html
│   │   ├── web-only.js               # web-only entry bundle
│   │   ├── web-only.js.map
│   │   ├── web-only.css
│   │   └── callback.html
│   ├── editor/common/services/editorWebWorkerMain.js
│   ├── workbench/api/worker/extensionHostWorkerMain.js
│   ├── workbench/contrib/webview/browser/pre/  # webview pre scripts + HTML
│   ├── workbench/services/extensions/worker/webWorkerExtensionHostIframe.html
│   ├── workbench/services/keybinding/browser/keyboardLayouts/  # keyboard maps
│   └── ...（其他 workers）
├── media/                                             # CSS, images 等
└── date
```

## 与旧管线的对应关系

| 旧 (gulp) | 新 (build/next) |
|---|---|
| `yarn gulp compile-client` | `npx tsx build/next/index.ts transpile --out out-build` |
| `yarn gulp vscode-web-only` | `npx tsx build/next/index.ts bundle --target web-only --out ../vscode-web-only` |
| `yarn gulp vscode-web` | `npx tsx build/next/index.ts bundle --target server-web --nls` |
| `yarn gulp vscode-web-min` | `npx tsx build/next/index.ts bundle --target server-web --nls --minify` |

## web-only target 实现细节

Entry points（与旧 `buildfile.codeWeb` + `buildfile.codeWebOnly` 一致）：
- `vs/code/browser/workbench/workbench` — browser shell
- `vs/code/browser/workbench/web-only` — web-only entry
- Workers（editor、extension host、notebook、language detection 等）
- Keyboard maps（linux、darwin、win）

资源复制（与旧 `bundleWebTask` 的 resources 一致）：
- `vs/code/browser/workbench/*.html`
- `vs/workbench/contrib/webview/browser/pre/*.{js,html}`
- `vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html`

## 关键文件

- `build/next/index.ts` — 新管线主入口
- `build/next/nls-plugin.ts` — NLS esbuild plugin
- `build/next/private-to-property.ts` — `#private` 字段转换
- `build/next/nls-sourcemap.test.ts` — NLS source map 测试
