# 当前 Web Demo 归档说明

## 目的

把当前 Web Demo 作为可回溯的原始版本保留，不在归档副本中做 Unity 迁移改造。后续 Unity 版本与 Web Demo 分开演进。

## 当前已知原始目录

公开仓库的 README 指向 `trainee-deity/`，其内部包含 `index.html`、`styles.css`、`js/`、`vendor/three@0.161.0/`、`docs/`、`test/`、`package.json` 等内容。

## 推荐目标结构

在仓库根目录中将原 `trainee-deity/` **整体移动**为 `01_WebDemo/`，保持其内部文件和相对路径完全不变。移动前先提交 Git，并确认 GitHub Pages / 静态托管配置是否依赖原路径。

```text
interim_deity/
├── 01_WebDemo/                 # 原 trainee-deity 完整原样归档
├── 02_剧情文档/                 # 剧情总纲、序章、五时代剧情
├── 03_设计文档/
│   └── Unity移植/
├── 04_仓库整理工具/
├── README.md
└── .git/
```

如果线上地址或 CI 固定依赖 `trainee-deity/` 路径，则不要直接移动；先把部署工作流改为新路径，或先采用保留旧路径的过渡方案。

## 归档原则

1. 原 Demo 的 `js/`、`index.html`、`styles.css`、`vendor/`、`test/` 和配置文件全部保留。
2. 不把剧情文档、Unity C# 源码或 Unity 资源混入 Demo 目录。
3. 不把 Web Demo 宣称为 Unity 版本；两者应有独立的启动与验收说明。
4. 归档前执行 `npm run verify`，如有浏览器测试则执行对应浏览器回归，并记录结果。
5. 移动后再次执行测试和部署验证，确认相对路径、CI 和静态托管均正常。
6. 不要把 `node_modules/`、临时压测产物、个人存档或密钥纳入归档。
