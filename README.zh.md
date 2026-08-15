# DSH-Plan-Graph

[English](README.md) | 中文

![DSH Plan Graph 预览](assets/plan-graph-preview.png)

DeepSeek Harness 轨迹视图的客制化版本：以交互式流程图展示会话中的工具调用和消息，并作为一个独立于主仓库的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件包进行分发。

该插件会在会话视图切换区中添加一个 **Plan Graph（计划图）** 标签页。其中包含支持平移和缩放的画布、按状态着色的节点卡片（检查、运行、等待、验证等类别，以及耗时和推理内容）、所选节点的详情面板，以及一组工具栏功能：**隐藏工具调用**、**按轮次分组**、**定位最新节点**和**合并到对话**（将图形渲染到对话页面真正的右侧边栏中）。

浏览器端沿用了原始的 Plan Graph 动态插件代码（pkg-20），并封装为 Web 模块加载器的交接格式。它使用纯 JavaScript 编写，不包含任何构建时依赖。通过 Git 安装后，`prepare` 会运行 `scripts/build-client.mjs`，根据 `client.body.js` 重新生成 `client.js`。

## 安装

在任意目录运行：

```sh
dsh plugin --profile demo add github:HR2AY/DSH-Plan-Graph#<sha>
dsh --profile demo
```

- **从 GitHub 安装**（本仓库）：pnpm 获取的是**源代码，而不是构建产物**，并且在明确加入允许列表之前，不会运行该包的 `prepare` 脚本。请将 pnpm 输出的准确包键复制到该配置档案的 `pnpm-workspace.yaml` 中：

  ```yaml
  allowBuilds:
    dsh-plan-graph: true
  ```

  然后重新运行 `add`。这项许可意味着允许该软件包在安装期间执行其代码。请固定到具体提交（`#<sha>`），并且只安装你信任的源代码。
- **从本地检出目录安装**：`dsh plugin --profile demo add ./DSH-Plan-Graph`
- **从压缩包安装**（不需要构建许可）：先在本目录运行 `pnpm pack`，然后运行 `dsh plugin --profile demo add ./dsh-plan-graph-0.1.0.tgz`
- **从 npm 安装**（发布后）：`dsh plugin --profile demo add dsh-plan-graph`

无需启动即可验证该层：运行 `dsh --profile demo --dump-config` 后，应能看到一个 `# == dsh-plan-graph` 层。

## 运行要求

- 浏览器端通过标准客户端插件服务（`slots`、`locale`、`layout`）注册到 `conversation.view` / `details`；这些服务均由 dsh Web 界面提供。
- “隐藏工具调用”功能提供了可选的 `chatNodeVisibility` 服务。目前随 dsh 提供的 `ui-conversation` 尚未使用该服务，因此在未打补丁的 dsh 中，此开关不会隐藏聊天页面上的内容（图形本身仍会遵循该设置）。如果部署所用的 `ui-conversation` 已使用此服务，则可以实时过滤聊天内容。
- 新会话仍默认显示 Chat 视图，只需点击一次即可切换到 Plan Graph。若部署方希望默认优先显示图形，需要自行提供上游的 `conversationDefaultView` 服务（`{ id: 'plan-graph' }`）。

## 重新生成客户端包

运行 `npm run prepare`（或 `node scripts/build-client.mjs`）会根据 `client.body.js` 重写 `client.js`。请始终编辑源文件 `client.body.js`，不要编辑生成的文件。

## 目录结构

```text
├── package.json            # dsh.bundle 和 dsh.client 清单
├── index.js                # 空的主机端部分（仅浏览器插件）
├── client.js               # 生成文件：加载器交接代码与插件主体
├── client.body.js          # 插件函数主体（唯一可信源）
├── cordis.patch.yml        # 配置档案列出本插件包时插入的层
├── scripts/build-client.mjs
├── README.md
└── README.zh.md
```
