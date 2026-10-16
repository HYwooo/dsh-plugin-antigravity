# dsh-plugin-antigravity

> DeepSeek Harness (dsh) 原生 Google Antigravity 专属用量无感桥接插件。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cordis Plugin](https://img.shields.io/badge/Cordis-Plugin-green.svg)](https://cordis.moe)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

`dsh-plugin-antigravity` 是为 **DeepSeek Harness** 开发的原生 Cordis 插件。它通过 Google 官方 OAuth 授权连接 Google Antigravity 底层模型服务，为 DeepSeek Harness 提供全自动生命周期管理与标准双协议转接，让你可以直接在 Harness 中调用 Gemini 与 Claude 等前沿模型。

---

## ✨ 特性

- 🔄 **自动伴随生命周期**：作为 Cordis 插件原生运行于 DeepSeek Harness 内部，随 DSH 启动而自动启动，随 DSH 关闭而安全释放，无需单独开窗口维护后台代理进程。
- 🔑 **一次登录，静默免登**：首次使用自动唤起浏览器进行 Google OAuth 一键授权；Refresh Token 持久化保存在本地（`~/.dsh/antigravity_tokens.json`），后续启动全自动静默续期。
- ⚡ **OpenAI / Anthropic 双协议支持**：
  - **OpenAI 兼容端点**：`POST /v1/chat/completions`，支持流式 SSE、`reasoning_content` 思维链输出。
  - **Anthropic 兼容端点**：`POST /v1/messages`，为 Claude 系列模型提供原生级别支持（Thinking 块、Tool Use 结构化调用）。
- 🚀 **动态模型透传**：支持全模型动态透传，支持 `gemini-2.5-pro`、`gemini-2.5-flash`、`claude-3-7-sonnet`、`claude-3-5-sonnet` 等，无需繁琐的模型名称映射。
- 📦 **零重型外部依赖**：基于现代 Node.js 原生 HTTP 和 Fetch API 构建，无庞大依赖链，极其轻量迅速。

---

## 🛠️ 安装与配置

### 1. 安装插件

克隆或下载到本地，并在你的 DSH 活动 profile（例如 `~/.dsh/profiles/desktop`）中链接本包：

```bash
git clone https://github.com/HYwooo/dsh-plugin-antigravity.git
cd ~/.dsh/profiles/desktop/node_modules
# 创建符号链接或目录联结（Windows PowerShell）
New-Item -ItemType Junction -Path "dsh-plugin-antigravity" -Target "C:\path\to\dsh-plugin-antigravity"
```

并在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 中添加：
```json
"dependencies": {
  "dsh-plugin-antigravity": "*"
}
```

### 2. 配置 Cordis Patch (`cordis.patch.yml`)

在你的 `~/.dsh/profiles/desktop/cordis.patch.yml` 中添加插件声明及模型提供商配置：

```yaml
# 挂载 Antigravity 桥接插件
- id: antigravity-bridge
  name: "dsh-plugin-antigravity"
  disabled: false

# 注册模型提供商 (可同时配置 OpenAI 协议与 Anthropic 协议)
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      antigravity:
        apiKey: "antigravity-local"
        api: openai-completions
        baseURL: "http://127.0.0.1:8317/v1"
        models:
          - id: gemini-2.5-pro
            name: "Gemini 2.5 Pro (Antigravity)"
          - id: gemini-2.5-flash
            name: "Gemini 2.5 Flash (Antigravity)"
          - id: claude-3-7-sonnet
            name: "Claude 3.7 Sonnet (Antigravity)"

      antigravity-claude:
        apiKey: "antigravity-local"
        api: anthropic-messages
        baseURL: "http://127.0.0.1:8317"
        models:
          - id: claude-3-7-sonnet
            name: "Claude 3.7 Sonnet (Native Messages)"
          - id: claude-3-5-sonnet
            name: "Claude 3.5 Sonnet"
```

---

## 💻 独立调试与预授权

如果你想在不启动 DSH 的情况下预先完成 Google 账号授权或作为独立代理使用，直接运行：

```bash
node index.js
```

服务将启动在 `http://127.0.0.1:8317`：
- OpenAI Chat: `POST http://127.0.0.1:8317/v1/chat/completions`
- Anthropic Messages: `POST http://127.0.0.1:8317/v1/messages`
- Model List: `GET http://127.0.0.1:8317/v1/models`

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 许可开源。
