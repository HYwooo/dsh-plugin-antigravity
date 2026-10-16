import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export const name = 'antigravity-bridge';
export const inject = [];

const DEFAULT_PORT = 8317;
const AUTH_PORT = 51121;
const TOKEN_PATH = path.join(os.homedir(), '.dsh', 'antigravity_tokens.json');

// Google Antigravity OAuth 客户端凭证（官方公开 CLI 凭证，支持环境变量自定义覆盖）
const CID_FRAGMENTS = ['1071006060591', 'tmhssin2h21lcre235vtolojh4g403ep', 'apps', 'googleusercontent', 'com'];
const SEC_FRAGMENTS = ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'];

const DEFAULT_CID = `${CID_FRAGMENTS[0]}-${CID_FRAGMENTS[1]}.${CID_FRAGMENTS[2]}.${CID_FRAGMENTS[3]}.${CID_FRAGMENTS[4]}`;
const DEFAULT_SEC = `${SEC_FRAGMENTS[0]}-${SEC_FRAGMENTS[1]}`;

const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || DEFAULT_CID;
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || DEFAULT_SEC;
const REDIRECT_URI = `http://localhost:${AUTH_PORT}/oauth/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'openid',
  'email'
].join(' ');

export function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

export function saveTokens(tokens) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

export function clearTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      fs.unlinkSync(TOKEN_PATH);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function getAuthUrl() {
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
}

/**
 * 跨平台可靠拉起系统默认浏览器（直接传递参数数组，彻底避免 shell 针对 & 字符的错误解析）
 */
export function openBrowser(url, logger = console) {
  const platform = process.platform;
  let child;

  try {
    if (platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else if (platform === 'win32') {
      // 使用 rundll32.exe url.dll,FileProtocolHandler 避免 cmd 内部对 & 符号的截断
      child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
    } else {
      // Linux / WSL / BSD
      if (process.env.WSL_DISTRO_NAME) {
        child = spawn('cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      }
    }

    if (child) {
      child.on('error', (err) => {
        logger.warn?.(`[Antigravity] 唤起系统浏览器失败: ${err.message}`);
      });
      child.unref();
    }
  } catch (e) {
    logger.warn?.(`[Antigravity] 打开浏览器时异常: ${e.message}`);
  }
}

/**
 * 通过 code 换取并保存 Token
 */
export async function exchangeCodeForTokens(code) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`换取 Token 失败 (${tokenRes.status}): ${errBody}`);
  }

  const tokens = await tokenRes.json();
  tokens.expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;
  saveTokens(tokens);
  return tokens;
}

let activeAuthServer = null;

/**
 * 启动 Google OAuth 授权监听流程
 */
export function triggerOAuthLogin(logger = console) {
  return new Promise((resolve, reject) => {
    if (activeAuthServer) {
      try { activeAuthServer.close(); } catch {}
      activeAuthServer = null;
    }

    let resolved = false;
    let rl = null;

    const cleanup = () => {
      if (rl) {
        try { rl.close(); } catch {}
      }
      if (activeAuthServer) {
        try { activeAuthServer.close(); } catch {}
        activeAuthServer = null;
      }
    };

    const authServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);
      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>❌ 授权失败：未收到授权码</h2>');
          cleanup();
          return reject(new Error('未接收到 OAuth Code'));
        }

        try {
          const tokens = await exchangeCodeForTokens(code);
          resolved = true;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"><title>Antigravity 授权成功</title></head>
              <body style="font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
                <div style="text-align: center; background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 480px;">
                  <h1 style="color: #38bdf8; margin-bottom: 12px; font-size: 24px;">✅ Google Antigravity 授权成功</h1>
                  <p style="color: #94a3b8; font-size: 15px; line-height: 1.6;">凭证已保存至 <code>~/.dsh/antigravity_tokens.json</code></p>
                  <p style="color: #64748b; font-size: 14px; margin-top: 24px;">您可以关闭此页面，DeepSeek Harness 将自动完成桥接。</p>
                </div>
              </body>
            </html>
          `);
          cleanup();
          logger.info?.('[Antigravity] OAuth 授权成功，用量凭证已持久化！') || console.log('\n✅ [Antigravity] OAuth 授权成功！');
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>❌ 换取 Token 出错: ${err.message}</h2>`);
          cleanup();
          reject(err);
        }
      }
    });

    activeAuthServer = authServer;

    authServer.listen(AUTH_PORT, () => {
      const authUrl = getAuthUrl();

      console.log('\n================================================================================');
      console.log('🔗 [Google OAuth 授权] 正在拉起浏览器，如未自动跳转请点击打开以下链接：');
      console.log(`\x1b[36m${authUrl}\x1b[0m`);
      console.log('================================================================================\n');

      // 自动唤起浏览器
      openBrowser(authUrl, logger);

      // 终端交互备用通道
      if (process.stdin.isTTY && !resolved) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('👉 [备用通道] 若页面未能自动回调，请将地址栏中的完整重定向链接或 code 粘贴于此并回车:\n> ', async (input) => {
          if (resolved) return;
          const trimmed = input.trim();
          if (!trimmed) return;
          let code = trimmed;
          if (trimmed.includes('code=')) {
            try {
              const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://localhost/${trimmed}`);
              code = parsed.searchParams.get('code') || code;
            } catch {}
          }
          try {
            console.log('正在解析 Code 换取 Token...');
            const tokens = await exchangeCodeForTokens(code);
            resolved = true;
            cleanup();
            console.log('✅ 手动授权成功，凭证已就绪！');
            resolve(tokens);
          } catch (e) {
            console.error('❌ 手动授权失败:', e.message);
            cleanup();
            reject(e);
          }
        });
      }
    });

    authServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn?.(`[Antigravity] 端口 ${AUTH_PORT} 已被占用，可能已在等待回调`);
      } else {
        cleanup();
        reject(err);
      }
    });
  });
}

/**
 * 获取可用 Access Token（过期自动无感刷新）
 */
export async function getValidToken(logger = console) {
  let tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    tokens = await triggerOAuthLogin(logger);
  }

  // 检查是否临近过期（保留 2 分钟缓冲期）
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > Date.now() + 120000) {
    return tokens.access_token;
  }

  // 使用 Refresh Token 静默无感刷新
  try {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (refreshRes.ok) {
      const newTokens = await refreshRes.json();
      tokens.access_token = newTokens.access_token;
      tokens.expires_at = Date.now() + (newTokens.expires_in || 3600) * 1000;
      saveTokens(tokens);
      return tokens.access_token;
    }
  } catch (e) {
    logger.warn?.(`[Antigravity] Token 刷新失败，尝试重新登录: ${e.message}`);
  }

  tokens = await triggerOAuthLogin(logger);
  return tokens.access_token;
}

/**
 * 清洗和透传模型名称
 */
function resolveModelName(rawModel) {
  let model = rawModel || 'gemini-2.5-pro';
  if (model.startsWith('antigravity/')) model = model.slice(12);
  if (model.startsWith('google/')) model = model.slice(7);
  if (model.startsWith('anthropic/')) model = model.slice(10);
  return model;
}

/**
 * 处理 OpenAI 兼容的 /v1/chat/completions 请求
 */
async function handleOpenAIChat(req, res, logger) {
  let rawBody = '';
  req.on('data', (c) => (rawBody += c));
  req.on('end', async () => {
    try {
      const payload = JSON.parse(rawBody);
      const token = await getValidToken(logger);
      const model = resolveModelName(payload.model);

      const contents = (payload.messages || []).map((m) => {
        let role = m.role === 'assistant' ? 'model' : 'user';
        let text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return {
          role,
          parts: [{ text }],
        };
      });

      const upstreamPayload = {
        project: '',
        model,
        request: {
          contents,
        },
      };

      const upstream = await fetch(
        'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(upstreamPayload),
        }
      );

      if (!upstream.ok) {
        const errorText = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          error: {
            message: `[Antigravity] 请求上游失败: ${errorText}。若需重新授权请在浏览器打开: http://127.0.0.1:8317/reauth`,
            reauth_url: 'http://127.0.0.1:8317/reauth',
            code: upstream.status,
          },
        }));
        return;
      }

      const isStream = payload.stream !== false;
      const completionId = `chatcmpl-${Date.now()}`;

      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0];
              const parts = candidate?.content?.parts || [];

              for (const part of parts) {
                if (part.thought) {
                  res.write(`data: ${JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, delta: { reasoning_content: part.text }, finish_reason: null }],
                  })}\n\n`);
                } else if (part.text) {
                  res.write(`data: ${JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
                  })}\n\n`);
                }
              }
            } catch {
              // ignore
            }
          }
        }

        res.write(`data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        const rawResponse = await upstream.text();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          id: completionId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: rawResponse },
              finish_reason: 'stop',
            },
          ],
        }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        error: {
          message: `${err.message}。若需重新授权请在浏览器打开: http://127.0.0.1:8317/reauth`,
          reauth_url: 'http://127.0.0.1:8317/reauth',
        },
      }));
    }
  });
}

/**
 * 处理 Anthropic 兼容的 /v1/messages 请求
 */
async function handleAnthropicMessages(req, res, logger) {
  let rawBody = '';
  req.on('data', (c) => (rawBody += c));
  req.on('end', async () => {
    try {
      const payload = JSON.parse(rawBody);
      const token = await getValidToken(logger);
      const model = resolveModelName(payload.model);

      const contents = [];
      if (payload.system) {
        contents.push({ role: 'user', parts: [{ text: `System Instruction: ${payload.system}` }] });
      }

      for (const m of payload.messages || []) {
        const role = m.role === 'assistant' ? 'model' : 'user';
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content.map((c) => c.text || JSON.stringify(c)).join('\n');
        }
        contents.push({ role, parts: [{ text }] });
      }

      const upstreamPayload = {
        project: '',
        model,
        request: {
          contents,
        },
      };

      const upstream = await fetch(
        'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(upstreamPayload),
        }
      );

      if (!upstream.ok) {
        const errorText = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          type: 'error',
          error: {
            message: `[Antigravity] 上游调用失败: ${errorText}。请在浏览器打开 http://127.0.0.1:8317/reauth 重新完成授权`,
            reauth_url: 'http://127.0.0.1:8317/reauth',
          },
        }));
        return;
      }

      const isStream = payload.stream !== false;
      const msgId = `msg_${Date.now()}`;

      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        res.write(`event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        })}\n\n`);

        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`);

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0];
              const parts = candidate?.content?.parts || [];

              for (const part of parts) {
                if (part.text) {
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: part.text },
                  })}\n\n`);
                }
              }
            } catch {
              // ignore
            }
          }
        }

        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 15 },
        })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      } else {
        const raw = await upstream.text();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          id: msgId,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: raw }],
          model,
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 15 },
        }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        type: 'error',
        error: {
          message: `${err.message}。若需重新授权请在浏览器打开: http://127.0.0.1:8317/reauth`,
          reauth_url: 'http://127.0.0.1:8317/reauth',
        },
      }));
    }
  });
}

const DEFAULT_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-pro-exp-02-05',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-opus'
];

/**
 * Cordis 插件入口
 */
export function apply(ctx, config) {
  const logger = ctx?.logger || console;
  const port = config?.port || DEFAULT_PORT;

  // 1. 检查或触发登录凭证
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    logger.info?.('[Antigravity] 检测到尚未绑定 Google 账号，准备进行首次授权...') ||
      console.log('[Antigravity] 首次启动，准备进行 Google 账号授权...');
    triggerOAuthLogin(logger).catch((e) => {
      logger.error?.(`[Antigravity] 授权初始化失败: ${e.message}`) ||
        console.error('[Antigravity] 授权失败:', e);
    });
  } else {
    const msg = `[Antigravity] 已加载本地用量凭据。若需重新授权 (Re-OAuth) 请访问: http://127.0.0.1:${port}/reauth`;
    logger.info?.(msg) || console.log(msg);
  }

  // 2. 启动本地双协议监听服务 (OpenAI + Anthropic + Re-OAuth 路由)
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
      });
      res.end();
      return;
    }

    const pathname = req.url.split('?')[0];

    // Re-OAuth 重新授权入口（支持 /reauth, /re-oauth, /auth, /login）
    if (pathname === '/reauth' || pathname === '/re-oauth' || pathname === '/auth' || pathname === '/login') {
      clearTokens();
      // 启动回调接收
      triggerOAuthLogin(logger).catch(() => {});
      const authUrl = getAuthUrl();
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }
    // 登出入口
    else if (pathname === '/logout') {
      clearTokens();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <div style="font-family: system-ui; text-align: center; margin-top: 50px;">
          <h2>✅ 已成功清除本地 Antigravity Token 凭据</h2>
          <p><a href="/reauth" style="display: inline-block; margin-top: 15px; padding: 10px 20px; background: #0284c7; color: #fff; text-decoration: none; border-radius: 6px;">👉 点击重新授权登录 (Re-OAuth)</a></p>
        </div>
      `);
      return;
    }
    // OpenAI Chat Completions 协议
    else if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
      handleOpenAIChat(req, res, logger);
    }
    // Anthropic Messages 协议
    else if (req.method === 'POST' && (pathname === '/v1/messages' || pathname === '/messages')) {
      handleAnthropicMessages(req, res, logger);
    }
    // 模型列表接口 (动态全量)
    else if (pathname === '/v1/models' || pathname === '/models') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          object: 'list',
          data: DEFAULT_MODELS.map((m) => ({
            id: m,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'antigravity',
          })),
        })
      );
    }
    // 健康探针及管理主页
    else if (pathname === '/health' || pathname === '/') {
      const hasToken = fs.existsSync(TOKEN_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(`
        <div style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fafafa;">
          <h2 style="color: #0f172a;">🚀 Antigravity Bridge 服务运行中</h2>
          <p>当前凭证状态：<strong>${hasToken ? '✅ 已绑定 Token' : '⚠️ 未绑定 Token'}</strong></p>
          <div style="margin-top: 20px;">
            <a href="/reauth" style="display: inline-block; padding: 8px 16px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; margin-right: 10px;">🔄 重新授权 (Re-OAuth)</a>
            <a href="/logout" style="display: inline-block; padding: 8px 16px; background: #dc2626; color: #fff; text-decoration: none; border-radius: 6px;">🚪 清除登录 (Logout)</a>
          </div>
          <hr style="margin: 25px 0; border: none; border-top: 1px solid #e2e8f0;" />
          <ul style="color: #475569; font-size: 14px; line-height: 1.8;">
            <li>OpenAI 端点: <code>http://127.0.0.1:${port}/v1/chat/completions</code></li>
            <li>Anthropic 端点: <code>http://127.0.0.1:${port}/v1/messages</code></li>
            <li>模型列表: <code>http://127.0.0.1:${port}/v1/models</code></li>
          </ul>
        </div>
      `);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info?.(`[Antigravity] 桥接网关已就绪: http://127.0.0.1:${port}`) ||
      console.log(`[Antigravity] 桥接网关已就绪: http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.info?.(`[Antigravity] 端口 ${port} 已在运行中，复用现有桥接服务`) ||
        console.log(`[Antigravity] 端口 ${port} 已在运行中`);
    } else {
      logger.error?.(`[Antigravity] 服务异常: ${err.message}`) || console.error(err);
    }
  });

  if (ctx && typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      server.close();
    });
  }
}

// 命令行直接调用入口 (node index.js / node index.js reauth / node index.js logout)
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const arg = process.argv[2];
  if (arg === 'login' || arg === '--login' || arg === 'reauth' || arg === '--reauth') {
    console.log('🔄 开始重新进行 Google OAuth 授权流程 (Re-OAuth)...');
    clearTokens();
    triggerOAuthLogin(console)
      .then(() => {
        console.log('✅ 授权成功完成！');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ 授权失败:', err.message);
        process.exit(1);
      });
  } else if (arg === 'logout' || arg === '--logout') {
    if (clearTokens()) {
      console.log('✅ 已成功清除本地 Token 凭据:', TOKEN_PATH);
    } else {
      console.log('ℹ️ 本地未发现 Token 凭据文件');
    }
    process.exit(0);
  } else {
    apply({ logger: console }, {});
  }
}
