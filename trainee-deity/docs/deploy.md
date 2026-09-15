# 部署说明（宝塔 / 静态托管）

## 打包

在项目根目录（含 `index.html`、`styles.css`、`js/`）打包上传。

## 宝塔步骤

1. **网站 → 添加站点**：填域名，PHP 选 **纯静态**
2. **文件**：进入站点根目录，上传并解压；根下必须直接是 `index.html`
3. **网站设置 → 配置文件**：确认 `root`；`.js` 使用 `application/javascript`
4. **域名 DNS**：A 记录 → 服务器 IP
5. **SSL**：申请证书并强制 HTTPS（推荐）

## Nginx 片段示例

```nginx
server {
  listen 443 ssl http2;
  server_name game.example.com;
  root /www/wwwroot/game.example.com;
  index index.html;

  location / { try_files $uri $uri/ /index.html; }
  location ~* \.js$ { default_type application/javascript; }
}
```

## 注意

- ES Module **不能**用 `file://` 打开
- Three.js 自 unpkg，客户端需外网；可改为本地 vendor 并改 `importmap`
- 账号与存档在**浏览器 localStorage**，与服务器无关

## 本地调试

```bash
python3 -m http.server 8080
# 或 npx serve .
```
