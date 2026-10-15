# 构建与审批发布

仓库：[ileenhow/portable-music-downloader](https://github.com/ileenhow/portable-music-downloader)。沿用 `school-ebook-downloader` 的 Release 工作流：单个 Ubuntu 构建任务，两个需要人工审批的商店发布任务；两个商店使用本次构建的同一个 ZIP。

启用此流程前，先完成[公开前检查](public-repository-review.md)，将仓库公开，并在 Settings → Environments 中为 `chrome-web-store`、`edge-addons` 设置 Required reviewers 为 `ileenhow`，允许本人批准自己触发的运行。环境保护配置完成前不运行新版发布流程。

## 构建和手动确认发布

- 推送 `v*.*.*` 标签或手动运行 Release，执行类型检查、构建、静态安全检查、ZIP 打包。无单元测试。
- 每次保存 `portable-music-downloader-v版本.zip` 和 SHA-256，artifact 保留 30 天。标签运行同时创建或更新 GitHub Release，标签必须与包版本一致。
- 构建完成后，两个发布任务等待环境审核。下载 artifact，解压内部 ZIP，再在 Chrome / Edge 加载含 `manifest.json` 的目录进行人工调试。
- 检查成功后，在**同一次 Release 运行**中点击 **Review deployments**，选中 `chrome-web-store`、`edge-addons`，点击 **Approve and deploy**。可以一起批准，也可以分别批准两个商店。
- 审批放行后，发布任务下载本次构建的同一个 ZIP，并校验 SHA-256 和 Manifest 版本，再提交对应商店。不会重新构建；artifact 过期时先重新构建并检查。
- main 普通推送不会触发 Release；构建阶段不访问发布凭据，商店任务审批放行后才执行。构建、等待审批和发布结果显示在同一次运行中。
- 发布脚本在访问商店前检查必需变量，缺失会列出变量名并停止。Edge 审核留言可选，不配置也能提交。0.1.0 的提交由开发者后台手动完成，0.2.0 尚未提交。

GitHub Free、Pro、Team 的 Required reviewers 只支持公开仓库。原生审核由环境保护设置控制；YAML 中引用环境名称不会自动添加审核人。发布者在运行页批准后，同一工作流继续执行。[GitHub 功能限制](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[审核部署](https://docs.github.com/en/actions/managing-workflow-runs/reviewing-deployments)。

## 所有扩展共用的发布凭据

以后由同一发布账号管理的扩展统一复用一套账号凭据，沿用现有变量名。Google OAuth 客户端可以命名为“浏览器扩展统一发布”；客户端名称不限定某个扩展。授权账号必须拥有目标商店条目的发布权限。[Chrome 说明](https://developer.chrome.com/docs/webstore/using-api)、[Edge 说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)。

| 范围 | 变量 |
| --- | --- |
| 同一 Chrome 发布者共用 | `CWS_PUBLISHER_ID`、`CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN` |
| 同一 Edge 发布账号共用 | `EDGE_CLIENT_ID`、`EDGE_API_KEY` |
| 每个扩展分别填写 | `CWS_EXTENSION_ID`、`EDGE_PRODUCT_ID`；`EDGE_CERTIFICATION_NOTES` 可选 |

NAS 保险箱按平台保存 `chrome-publisher.json` 与 `edge-publisher.json`，记录共用凭据、授权账号、创建时间和适用的到期时间；每个扩展的两个产品 ID 及审核说明另存。新增扩展时，把同一组账号凭据填入新仓库的 Repository secrets，产品 ID 填该扩展自己的值；已有 OAuth 客户端、授权与 API key 仍有效时无需重新生成。

当前采用各仓库分别配置 Repository secrets 的方式，不能假设在一个仓库填写后其他仓库会自动继承。仓库公开不会使 GitHub 托管的 Secret 明文出现在代码或安装包中；审核留言及测试账号也只保存在对应 Secret 中。[GitHub 说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

长期使用 Chrome 发布凭据前，检查 Google Auth Platform → Audience 的发布状态。External 应用处于 Testing 时，本项目所需的 `chromewebstore` 范围不属于例外，其 refresh token 会在 7 天后过期。应先按 Google 要求完成生产状态设置，再取得用于长期发布的 refresh token；生产状态下也仍可能因撤销授权等原因失效。Edge API key 按后台记录的到期时间更新。共用凭据更换时，更新 NAS 备份和所有使用该凭据的仓库。[Google 有效期说明](https://developers.google.com/identity/protocols/oauth2#expiration)。

## 变量放在哪里

打开本仓库 [Settings → Secrets and variables → Actions](https://github.com/ileenhow/portable-music-downloader/settings/secrets/actions) → **New repository secret**，按下表添加。变量名与 ebook 完全一致。

音乐项目需配置下表中的八项必需 Secrets；`EDGE_CERTIFICATION_NOTES` 可省略。此前核对 ebook 的五个 `CWS_*` 在 Repository secrets，四个 `EDGE_*` 在 `edge-addons` 环境。GitHub 不允许读回已有 Secret 的值，需要从你保存的凭据或对应开发者后台重新填写。本次没有复制、重置或生成任何凭据，也没有修改 ebook 仓库。

| Secret | 获取入口或当前值 | 与 ebook 统一方式 |
| --- | --- | --- |
| `CWS_PUBLISHER_ID` | [Chrome 开发者后台](https://chrome.google.com/webstore/devconsole) → Publisher → Settings → Publisher ID | 同一个发布者可沿用 |
| `CWS_EXTENSION_ID` | 本扩展条目 ID：`eonebnmcjiejpgfalimmmeeommdhccif` | 使用音乐扩展自己的 ID |
| `CWS_CLIENT_ID` | [Google Cloud](https://console.cloud.google.com/apis/credentials) 的 OAuth 客户端 ID | 可沿用 ebook 的 OAuth 客户端 |
| `CWS_CLIENT_SECRET` | 同一 OAuth 客户端的 Secret | 与 Client ID 配套，可沿用 |
| `CWS_REFRESH_TOKEN` | [OAuth Playground](https://developers.google.com/oauthplayground) 使用上述客户端及商店所属账号授权取得 | 客户端、账号及商店权限一致时可沿用 |
| `EDGE_PRODUCT_ID` | 本扩展 Product ID：`4d483856-dafe-4919-9ae7-0940ec5cbd23` | 使用音乐扩展自己的 ID，不能用 CRX ID 或 Store ID |
| `EDGE_CLIENT_ID` | [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) → Microsoft Edge → Publish API | 同一有权限的发布账号可沿用 |
| `EDGE_API_KEY` | 同一 Publish API 页面创建或已保存的 API key，注意有效期 | 可沿用仍有效的账号级凭据 |
| `EDGE_CERTIFICATION_NOTES`（可选） | 给审核员的说明，无需申请；音乐项目可以不填 | ebook 仍可独立配置测试账号与登录说明 |

Chrome 如尚无可复用 OAuth 凭据：在 Google Cloud 启用 Chrome Web Store API，配置 Web application OAuth 客户端，重定向 URI 使用 `https://developers.google.com/oauthplayground`。在 Playground 选择 Use your own OAuth credentials，以 `https://www.googleapis.com/auth/chromewebstore` 授权并交换 refresh token。使用拥有本扩展发布权限的账号。[Chrome 官方设置步骤](https://developer.chrome.com/docs/webstore/using-api)。

Edge 使用 Publish API 的 API key 模式。初次上架仍通过 Partner Center；API 用于后续更新。[Edge 官方设置步骤](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)。

音乐项目无需登录测试账号，可省略 `EDGE_CERTIFICATION_NOTES`，发布脚本会发送空的审核留言。若以后配置此 Secret，则按填写的内容提交。ebook 需要登录，继续通过它自己的审核留言向审核员提供专用测试账号、密码及操作步骤；这些内容不与其他扩展共用。

API 凭据不能从一个 GitHub 仓库自动继承到另一个仓库。统一的是名称、发布工具和有权限的账号凭据；两个产品 ID 和审核说明各自独立。密钥只填入 GitHub Secrets，不写入源码、ZIP 或日志。

提交 0.2.0 前仍需复核实际扩展交互和设备写入，并同步公开隐私政策与两店资料；CI 成功不代表商店审核通过。
