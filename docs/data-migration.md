# 部署数据迁移说明

基于 `deploy-compose.yml` 的卷挂载，迁移时需覆盖/复制的目录如下。

## 必须迁移的目录（复制到新机同路径并替换）

| 目录 | 用途 |
|------|------|
| `data-node` | MongoDB 数据目录 |
| `images` | 用户上传的图片（挂载到 `/app/client/public/images`） |
| `uploads` | 用户上传的文件（API 存储，挂载到 `/app/uploads`） |
| `meili_data_v1.12` | Meilisearch 搜索索引数据 |

## 可选

| 目录 | 说明 |
|------|------|
| `logs` | API 日志；不拷则新机从空日志开始 |
| `memory` | 项目内的 `memory/`（如 constitution 等）；若部署时该目录可写且被 Agent 使用，迁移时可一并复制以保留内容 |

## 不要迁移

| 项目 | 说明 |
|------|------|
| `node_modules` | 不要复制。新机应使用相同 Docker 镜像直接运行，或本地用 `npm install` 重新安装依赖；复制易产生路径/平台问题且无必要。 |

## 向量数据库（PostgreSQL）

- 在 compose 中使用的是**命名卷** `pgdata2`，不是主机上的文件夹。
- 迁移 PG 数据需要单独用 volume 导出/导入，例如：

```bash
# 源机：导出
docker run --rm -v pyqchat_deploy-compose_pgdata2:/data -v $(pwd):/backup alpine tar cvf /backup/pgdata2.tar -C /data .

# 目标机：创建卷并导入（卷名以 docker compose 实际生成为准）
docker volume create pyqchat_deploy-compose_pgdata2   # 或你本地的卷名
docker run --rm -v pyqchat_deploy-compose_pgdata2:/data -v $(pwd):/backup alpine tar xvf /backup/pgdata2.tar -C /data
```

（若未使用 RAG/向量检索，可忽略 PG 迁移。）

## 小结

- **仅做“数据”迁移**：复制并替换 `data-node`、`images`、`uploads`、`meili_data_v1.12`；可选 `logs`、`memory`。
- **不要**用复制 `node_modules` 的方式迁移；用同一镜像或在新环境重新 `npm install`。
- **若使用 RAG**：按上面步骤迁移 PostgreSQL 的 `pgdata2` 卷。
